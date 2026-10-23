import { getPool, sql } from "@/lib/db";
import { getPgPool } from "@/lib/pg";
import { getBusinessDate, monthBoundary } from "@/lib/business-date";
import { createMitra, type MitraInput } from "@/lib/queries/mitra";
import { setMitraLocation } from "@/lib/queries/mitra-location";
import {
  getKompetitorIdsMitra,
  listKompetitor,
  setKompetitorMitra,
  tambahKompetitor,
} from "@/lib/queries/kompetitor";
import { pecahTeksKompetitor } from "@/lib/mitra-lokasi";
import { createSalesOrderFromPengajuan } from "@/lib/queries/sales-order";
import { MARKETING_ROLE_ID, APPROVER_ROLE_IDS } from "@/lib/roles";
import { AGEN_QTY_THRESHOLD, RPA_QTY_THRESHOLD } from "@/lib/mitra-classification";
import { AppError } from "@/lib/action-result";

// qty <= AGEN_QTY_THRESHOLD -> Outlet (Gender "Female"), AGEN_QTY_THRESHOLD <
// qty <= RPA_QTY_THRESHOLD -> Agen (Gender "Male"), qty > RPA_QTY_THRESHOLD
// -> RPA (Gender "Other") — see PARTNER_TYPE_CASE in aging.ts for the
// Gender->PartnerType mapping this feeds into. Thresholds live in
// lib/mitra-classification.ts (a plain, DB-import-free module) rather than
// here, so pengajuan-sub-tab.tsx's client-side classifyPartnerType() can
// import them directly without pulling this file's server-only mssql/pg
// code into the client bundle — re-exported below for server-side callers
// that already import other constants from this file.
export { AGEN_QTY_THRESHOLD, RPA_QTY_THRESHOLD };

export { MARKETING_ROLE_ID, APPROVER_ROLE_IDS };

// A plain HTML <input type="datetime-local"> value ("2026-07-25T14:30") has
// no timezone info. This app's users are all in WIB (UTC+7) — parsing that
// string with `new Date(...)` directly would interpret it in the SERVER's
// local timezone instead (commonly UTC on a Coolify container), silently
// shifting the time by 7 hours. Convert explicitly, the same way every
// other WIB-sensitive date in this codebase is built (see business-date.ts).
function parseWibDateTimeLocal(value: string): Date {
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = (timePart ?? "00:00").split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 7, minute));
}

export type PengajuanStatus = "Menunggu" | "Diproses" | "Disetujui" | "Ditolak";

export interface PengajuanRow {
  PengajuanID: number;
  MarketingUserID: string;
  MarketingNama: string;
  NamaCalon: string;
  NoHP: string | null;
  WaktuPermintaanSampai: string | null;
  QtyKantong: number | null;
  PriceLevel: number | null;
  Wilayah: string | null;
  Kecamatan: string | null;
  Alamat: string | null;
  Latitude: number | null;
  Longitude: number | null;
  Kapasitas: number | null;
  Kompetitor: string | null;
  Status: PengajuanStatus;
  CatatanTolak: string | null;
  Keterangan: string | null;
  ConvertedBusinessPartnerID: string | null;
  CreatedAt: string;
}

// MarketingUserID -> nama can't be joined in one SQL statement since
// DashboardMitraPengajuan (MSSQL) and akun (Postgres) are different
// database engines — resolved here in application code instead. Same
// pattern as getMarketingWilayahAssignments/getMarketingMitraAssignments
// in marketing-wilayah.ts.
export async function getPengajuanList(): Promise<PengajuanRow[]> {
  const mssqlPool = await getPool();
  const pgPool = getPgPool();
  const result = await mssqlPool.request().query(`
    SELECT
        dmp.PengajuanID,
        dmp.MarketingUserID,
        dmp.NamaCalon,
        dmp.NoHP,
        dmp.WaktuPermintaanSampai,
        dmp.QtyKantong,
        dmp.PriceLevel,
        dmp.Wilayah,
        dmp.Kecamatan,
        dmp.Alamat,
        dmp.Latitude,
        dmp.Longitude,
        dmp.Kapasitas,
        dmp.Kompetitor,
        dmp.Status,
        dmp.CatatanTolak,
        dmp.Keterangan,
        dmp.ConvertedBusinessPartnerID,
        dmp.CreatedAt
    FROM DashboardMitraPengajuan dmp
    ORDER BY dmp.CreatedAt DESC
  `);
  const rows = result.recordset as Omit<PengajuanRow, "MarketingNama">[];

  const akunIds = [...new Set(rows.map((r) => Number(r.MarketingUserID)).filter(Number.isFinite))];
  const nameMap = new Map<number, string>();
  if (akunIds.length > 0) {
    const namesResult = await pgPool.query(`SELECT id, nama FROM akun WHERE id = ANY($1::int[])`, [akunIds]);
    for (const r of namesResult.rows as { id: number; nama: string }[]) nameMap.set(r.id, r.nama);
  }

  return rows.map((r) => ({ ...r, MarketingNama: nameMap.get(Number(r.MarketingUserID)) ?? "Tidak diketahui" }));
}

export interface MarketingKPIRow {
  UserID: string;
  Nama: string;
  Kunjungan: number;
  Konversi: number;
}

// "Kunjungan" and "Konversi" are both scoped to the WIB business month
// (same monthBoundary() convention as every other monthly metric in this
// app — see revenue-target.ts, sales-overview.ts). Every active Marketing
// user is included even with zero pengajuan this month, so management can
// see who hasn't logged any visits yet, not just who has.
//
// Active Marketing users come from Postgres (akun/peran); the visit/convert
// counts come from MSSQL DashboardMitraPengajuan, keyed on the same
// MarketingUserID = akun.id values migrate-marketing-userid-to-akun-id.ts
// established — aggregated per user in application code since the two
// tables live in different database engines.
export async function getMarketingKPI(): Promise<MarketingKPIRow[]> {
  const mssqlPool = await getPool();
  const pgPool = getPgPool();
  const businessToday = getBusinessDate();
  const monthStart = monthBoundary(businessToday);
  const monthEnd = monthBoundary(businessToday, 1);

  const usersResult = await pgPool.query(
    `SELECT id, nama FROM akun WHERE peran_id = $1 AND is_active = true ORDER BY nama`,
    [MARKETING_ROLE_ID]
  );
  const users = usersResult.rows as { id: number; nama: string }[];

  const pengajuanResult = await mssqlPool
    .request()
    .input("monthStart", sql.Date, monthStart)
    .input("monthEnd", sql.Date, monthEnd).query(`
      SELECT MarketingUserID, QtyKantong
      FROM DashboardMitraPengajuan
      WHERE CreatedAt >= @monthStart AND CreatedAt < @monthEnd
    `);
  const pengajuanRows = pengajuanResult.recordset as { MarketingUserID: string; QtyKantong: number | null }[];

  return users.map((u) => {
    const own = pengajuanRows.filter((p) => Number(p.MarketingUserID) === u.id);
    return {
      UserID: String(u.id),
      Nama: u.nama,
      Kunjungan: own.length,
      Konversi: own.filter((p) => (p.QtyKantong ?? 0) > 0).length,
    };
  });
}

export interface PengajuanInput {
  namaCalon: string;
  noHP: string | null;
  waktuPermintaanSampai: string;
  qtyKantong: number | null;
  priceLevel: number | null;
  wilayah: string | null;
  kecamatan: string | null;
  alamat: string | null;
  latitude: number | null;
  longitude: number | null;
  kapasitas: number | null;
  // ID master kompetitor (Postgres `kompetitor`, bisnis es_kristal, holding
  // akun pengaju). Disimpan ke DashboardMitraPengajuan.KompetitorIDs (CSV);
  // kolom teks Kompetitor diisi nama-namanya untuk tampilan daftar.
  kompetitorIds: number[];
}

// Konteks holding/perusahaan untuk kompetitor terstruktur — diisi server
// action dari sesi (holdingKode) dan currentEskristalKode().
export interface KonteksKompetitorPengajuan {
  holdingKode: string;
}
export interface KonteksPersetujuanPengajuan extends KonteksKompetitorPengajuan {
  perusahaanKode: string; // kode Es Kristal (mitra_kompetitor.perusahaan_kode)
}

const KOMPETITOR_IDS_MAKS = 512; // lebar DashboardMitraPengajuan.KompetitorIDs
const KOMPETITOR_TEKS_MAKS = 1024; // lebar DashboardMitraPengajuan.Kompetitor

/** "3,17,42" → [3, 17, 42]; NULL → null (pengajuan lama). Potongan tak sah diabaikan. */
export function uraiKompetitorIds(csv: string | null): number[] | null {
  if (csv == null) return null;
  const ids = csv
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(ids)];
}

export async function createPengajuan(
  input: PengajuanInput,
  marketingUserId: string,
  k: KonteksKompetitorPengajuan
): Promise<void> {
  // Validasi kompetitor terhadap master holding ini (es_kristal) sebelum menulis.
  const ids = [...new Set(input.kompetitorIds ?? [])];
  let kompetitorTeks: string | null = null;
  let kompetitorCsv: string | null = null;
  if (ids.length > 0) {
    const master = new Map((await listKompetitor(k.holdingKode, "es_kristal")).map((x) => [x.id, x.nama]));
    if (ids.some((id) => !master.has(id))) {
      throw new AppError("Daftar kompetitor tidak valid. Muat ulang halaman lalu coba lagi.");
    }
    kompetitorCsv = ids.join(",");
    if (kompetitorCsv.length > KOMPETITOR_IDS_MAKS) throw new AppError("Kompetitor terlalu banyak.");
    kompetitorTeks = ids.map((id) => master.get(id)!).join(", ").slice(0, KOMPETITOR_TEKS_MAKS);
  }
  const pool = await getPool();
  await pool
    .request()
    .input("marketingUserId", sql.VarChar(16), marketingUserId)
    .input("namaCalon", sql.VarChar(128), input.namaCalon)
    .input("noHP", sql.VarChar(50), input.noHP)
    .input("waktu", sql.DateTime, input.waktuPermintaanSampai ? parseWibDateTimeLocal(input.waktuPermintaanSampai) : null)
    .input("qty", sql.Decimal(23, 4), input.qtyKantong)
    .input("priceLevel", sql.Int, input.priceLevel)
    .input("wilayah", sql.VarChar(128), input.wilayah)
    .input("kecamatan", sql.VarChar(128), input.kecamatan)
    .input("alamat", sql.VarChar(1024), input.alamat)
    .input("lat", sql.Decimal(10, 7), input.latitude)
    .input("lng", sql.Decimal(10, 7), input.longitude)
    .input("kapasitas", sql.Decimal(23, 4), input.kapasitas)
    .input("kompetitor", sql.VarChar(1024), kompetitorTeks)
    .input("kompetitorIds", sql.VarChar(512), kompetitorCsv).query(`
      INSERT INTO DashboardMitraPengajuan
        (MarketingUserID, NamaCalon, NoHP, WaktuPermintaanSampai, QtyKantong, PriceLevel,
         Wilayah, Kecamatan, Alamat, Latitude, Longitude, Kapasitas, Kompetitor, KompetitorIDs, Status, CreatedAt)
      VALUES
        (@marketingUserId, @namaCalon, @noHP, @waktu, @qty, @priceLevel,
         @wilayah, @kecamatan, @alamat, @lat, @lng, @kapasitas, @kompetitor, @kompetitorIds, 'Menunggu', GETDATE())
    `);
}

/**
 * Kompetitor untuk mitra hasil persetujuan:
 * - KompetitorIDs terisi → ID itu, disaring ke master holding ini (master
 *   tidak pernah dihapus, jadi normalnya tidak ada yang terbuang);
 * - KompetitorIDs NULL (pengajuan lama, teks bebas) → pecahTeksKompetitor +
 *   tambahKompetitor per nama (nama yang sudah ada dipakai ulang).
 */
async function resolveKompetitorPengajuan(
  row: { Kompetitor: string | null; KompetitorIDs: string | null },
  k: KonteksKompetitorPengajuan,
  reviewerUserId: string
): Promise<number[]> {
  const ids = uraiKompetitorIds(row.KompetitorIDs);
  if (ids !== null) {
    const master = new Set((await listKompetitor(k.holdingKode, "es_kristal")).map((x) => x.id));
    const sah = ids.filter((id) => master.has(id));
    if (sah.length !== ids.length) {
      console.warn("[approvePengajuan] KompetitorIDs di luar master holding dibuang:", ids.filter((id) => !master.has(id)));
    }
    return sah;
  }
  const hasil: number[] = [];
  for (const nama of pecahTeksKompetitor(row.Kompetitor)) {
    const kompetitor = await tambahKompetitor(k.holdingKode, "es_kristal", nama, reviewerUserId);
    if (!hasil.includes(kompetitor.id)) hasil.push(kompetitor.id);
  }
  return hasil;
}

export async function approvePengajuan(
  pengajuanId: number,
  reviewerUserId: string,
  keterangan: string | null | undefined,
  k: KonteksPersetujuanPengajuan
): Promise<void> {
  const pool = await getPool();

  // Atomically claim the row before doing any create-mitra work: an UPDATE
  // (not a plain SELECT) is the only way to guarantee that, under concurrent
  // double-click calls for the same pengajuanId, at most one caller can ever
  // see the row transition out of 'Menunggu'. Losing callers get an empty
  // OUTPUT and bail out before creating anything.
  const claimResult = await pool
    .request()
    .input("id", sql.Int, pengajuanId).query(`
      UPDATE DashboardMitraPengajuan
      SET Status = 'Diproses'
      OUTPUT inserted.NamaCalon, inserted.NoHP, inserted.Alamat, inserted.Wilayah,
             inserted.Kecamatan, inserted.PriceLevel, inserted.Latitude, inserted.Longitude,
             inserted.Kapasitas, inserted.Kompetitor, inserted.KompetitorIDs, inserted.QtyKantong, inserted.WaktuPermintaanSampai
      WHERE PengajuanID = @id AND Status = 'Menunggu'
    `);

  const row = claimResult.recordset[0] as
    | {
        NamaCalon: string;
        NoHP: string | null;
        Alamat: string | null;
        Wilayah: string | null;
        Kecamatan: string | null;
        PriceLevel: number | null;
        Latitude: number | null;
        Longitude: number | null;
        Kapasitas: number | null;
        Kompetitor: string | null;
        KompetitorIDs: string | null;
        QtyKantong: number | null;
        WaktuPermintaanSampai: Date | null;
      }
    | undefined;
  if (!row) throw new AppError("Pengajuan tidak ditemukan atau sudah diproses");

  let businessPartnerId: string;
  let kompetitorIds: number[];
  try {
    // Diselesaikan SEBELUM mitra dibuat: kegagalan di sini (mis. Postgres)
    // masih bisa dikembalikan ke 'Menunggu' tanpa meninggalkan mitra.
    kompetitorIds = await resolveKompetitorPengajuan(row, k, reviewerUserId);

    // Reuses the exact mitra-creation path the Mitra module's own "Tambah
    // Mitra" form uses — same Code/BusinessPartnerID generation, same
    // required-column defaults (see mitra.ts createMitra()).
    const mitraInput: MitraInput = {
      name: row.NamaCalon,
      mobileNo: row.NoHP,
      address: row.Alamat,
      wilayah: row.Wilayah,
      kecamatan: row.Kecamatan,
      gender:
        row.QtyKantong != null && row.QtyKantong > RPA_QTY_THRESHOLD
          ? "Other"
          : row.QtyKantong != null && row.QtyKantong > AGEN_QTY_THRESHOLD
            ? "Male"
            : "Female",
      priceLevel: row.PriceLevel,
      termOfPaymentId: null,
      capacity: row.Kapasitas,
    };
    businessPartnerId = await createMitra(mitraInput);

    if (row.Latitude != null && row.Longitude != null) {
      await setMitraLocation({
        businessPartnerId,
        latitude: row.Latitude,
        longitude: row.Longitude,
        alamat: row.Alamat,
        userId: reviewerUserId,
      });
    }

    // A Pengajuan with no captured Qty has nothing to order yet — approving
    // it still creates the Mitra above, just without a Sales Order.
    if (row.QtyKantong != null && row.QtyKantong > 0) {
      await createSalesOrderFromPengajuan({
        businessPartnerId,
        address: row.Alamat,
        qtyKantong: row.QtyKantong,
        priceLevel: row.PriceLevel,
        dueDate: row.WaktuPermintaanSampai,
      });
    }

    await pool
      .request()
      .input("id", sql.Int, pengajuanId)
      .input("bpId", sql.VarChar(16), businessPartnerId)
      .input("reviewer", sql.VarChar(16), reviewerUserId)
      .input("keterangan", sql.VarChar(500), keterangan ?? null).query(`
        UPDATE DashboardMitraPengajuan
        SET Status = 'Disetujui', ConvertedBusinessPartnerID = @bpId,
            ReviewedByUserID = @reviewer, ReviewedAt = GETDATE(), Keterangan = @keterangan
        WHERE PengajuanID = @id AND Status = 'Diproses'
      `);
  } catch (err) {
    // Don't leave the row permanently stuck in 'Diproses' limbo if the
    // create-mitra/set-location work fails partway through — revert the
    // claim so the submission can be seen as pending / re-approved.
    await pool
      .request()
      .input("id", sql.Int, pengajuanId)
      .query(`UPDATE DashboardMitraPengajuan SET Status = 'Menunggu' WHERE PengajuanID = @id AND Status = 'Diproses'`);
    throw err;
  }

  // Kompetitor terstruktur (Postgres mitra_kompetitor), bukan lagi teks
  // DashboardMitraCompetitor. Ditulis SETELAH pengajuan berstatus Disetujui:
  // mitra sudah ada, jadi kegagalan di sini tidak boleh mengembalikan status
  // (persetujuan ulang akan membuat mitra ganda). Gabung dengan set yang
  // sudah ada, bukan menimpa.
  if (kompetitorIds.length > 0) {
    const kunci = { perusahaanKode: k.perusahaanKode, sumber: "utama" as const, partnerId: businessPartnerId };
    try {
      const ada = await getKompetitorIdsMitra(kunci);
      await setKompetitorMitra(kunci, [...new Set([...ada, ...kompetitorIds])]);
    } catch (err) {
      console.error("[approvePengajuan] kompetitor gagal disimpan setelah mitra dibuat:", businessPartnerId, err);
      throw new AppError(
        "Pengajuan disetujui dan mitra sudah dibuat, tetapi daftar kompetitor gagal disimpan — tambahkan lewat Edit Mitra."
      );
    }
  }
}

export async function rejectPengajuan(
  pengajuanId: number,
  reviewerUserId: string,
  keterangan: string | null
): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, pengajuanId)
    .input("reviewer", sql.VarChar(16), reviewerUserId)
    .input("keterangan", sql.VarChar(500), keterangan).query(`
      UPDATE DashboardMitraPengajuan
      SET Status = 'Ditolak', Keterangan = @keterangan,
          ReviewedByUserID = @reviewer, ReviewedAt = GETDATE()
      WHERE PengajuanID = @id AND Status = 'Menunggu'
    `);
}

// Hard delete — this only removes the pengajuan log entry, never the
// BusinessPartner it may have already been converted into (that's a
// separate, independently-stored record via ConvertedBusinessPartnerID;
// deleting this row has no effect on it). Restricted to Super Admin only,
// enforced in the server action, not here.
export async function deletePengajuan(pengajuanId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.Int, pengajuanId)
    .query(`DELETE FROM DashboardMitraPengajuan WHERE PengajuanID = @id`);
}
