// Alamat mitra, lokasi pengiriman ganda, identitas & kompetitor — Es Balok
// (PMPutra, PMPersada, PMPakis). Padanan mitra-lokasi-pengiriman.ts +
// mitra-lengkap.ts (Es Kristal) dengan kunci (kode, sumber, AgenID); DB fisik
// SELALU dipilih lewat resolveAgenKoneksi().
// Spec: docs/superpowers/specs/2026-10-23-mitra-identitas-lokasi-pengiriman-design.md §5, §6.2, §6.3, §8.
//
// Invarian (§5): PMP_AgenDetail.Address1 + RegionID (alamat/wilayah),
// PMP_Agen.Telepon (kontak), DashboardAgenProfil.Kecamatan, dan
// DashboardAgenLocation (pin) SELALU berisi lokasi pengiriman utama.
// DashboardAgenLokasiPengiriman hanya berisi lokasi ke-2 dst.;
// DashboardAgenAlamat hanya ada barisnya bila kotak "lokasi berbeda" dicentang.
//
// Agen dengan >1 baris PMP_AgenDetail aktif (keputusan pengguna 2026-10-23:
// semua kartu dipertahankan) — penulisan Address1/RegionID selalu menyasar
// AgenDetailID kartu yang sedang diedit. Telepon, pin, profil, alamat mitra,
// lokasi tambahan, identitas, dan kompetitor dikunci per AgenID (dipakai
// bersama kartu-kartu Agen yang sama).
import { sql } from "@/lib/db";
import { getCompanyPool } from "@/lib/db-company";
import { AppError } from "@/lib/action-result";
import { getNaiveWibNow } from "@/lib/business-date";
import {
  normalisasiMitraForm,
  PESAN_SIMPAN_SEBAGIAN,
  type MitraAlamatForm,
  type MitraAlamatTernormalisasi,
} from "@/lib/mitra-lokasi";
import { rapikan } from "@/lib/queries/mitra-lokasi-pengiriman";
import {
  createMitra,
  getWilayahOptions,
  resolveAgenKoneksi,
  setAgenLocation,
  setAgenProfil,
  updateMitra,
  type MitraInput,
  type SumberAgen,
  type WilayahOption,
} from "@/lib/queries/mitra-es-balok";
import {
  getIdentitasMitra,
  setTanggalPendaftaranBilaKosong,
  simpanIdentitasMitra,
  type IdentitasKunci,
  type IdentitasMitra,
} from "@/lib/queries/mitra-identitas";
import { getKompetitorMitraMap, listKompetitor, setKompetitorMitra, type Kompetitor } from "@/lib/queries/kompetitor";

// Lebar kolom ERP (dicek live 2026-10-23 di kelima DB Es Balok).
const MAKS_NAMA = 128; // PMP_Agen.Nama
const MAKS_TELEPON = 16; // PMP_Agen.Telepon
const MAKS_ADDRESS1 = 256; // PMP_AgenDetail.Address1
const MAKS_KECAMATAN = 128; // DashboardAgenProfil.Kecamatan / Dashboard*.Kecamatan
const MAKS_ALAMAT_DASHBOARD = 1024; // DashboardAgenAlamat/LokasiPengiriman.Alamat
const MAKS_KONTAK_DASHBOARD = 128;

const POLA_AGEN_ID = /^[A-Za-z0-9]{1,16}$/;

/** Validasi parameter dari client. pmputra hanya punya kartu "utama". */
export function validasiKartuAgen(kode: string, sumber: unknown, agenId: unknown, agenDetailId?: unknown): SumberAgen {
  if (sumber !== "utama" && sumber !== "logistik") throw new AppError("Sumber mitra tidak valid.");
  if (kode === "pmputra" && sumber !== "utama") throw new AppError("Sumber mitra tidak valid.");
  if (agenId !== null && (typeof agenId !== "string" || !POLA_AGEN_ID.test(agenId))) throw new AppError("ID mitra tidak valid.");
  if (agenDetailId != null && (typeof agenDetailId !== "string" || !POLA_AGEN_ID.test(agenDetailId))) {
    throw new AppError("ID alamat mitra tidak valid.");
  }
  return sumber;
}

/**
 * Kunci identitas/kompetitor Postgres: kode & sumber FISIK hasil
 * resolveAgenKoneksi(), supaya kartu logistik bersama pmpersada/pmpakis
 * berbagi identitas yang sama (spec §6.3).
 */
export function kunciIdentitasAgen(kode: string, sumber: SumberAgen, agenId: string): IdentitasKunci {
  const fisik = resolveAgenKoneksi(kode, sumber);
  return { perusahaanKode: fisik.kode, sumber: fisik.label, partnerId: agenId };
}

async function poolAgen(kode: string, sumber: SumberAgen): Promise<sql.ConnectionPool> {
  const { kode: physKode, label } = resolveAgenKoneksi(kode, sumber);
  return getCompanyPool(physKode, label);
}

/**
 * Simpan alamat mitra + lokasi tambahan, semuanya di dalam `tx` milik
 * pemanggil. Kolom ERP + pin utama ditulis pemanggil sendiri dengan nilai
 * `n.utama`. Es Balok belum punya Papan Pengiriman, jadi tidak ada cek
 * "dipakai Jadwal" sebelum soft-delete.
 * 1. Upsert/hapus DashboardAgenAlamat sesuai `n.alamatMitra`.
 * 2. Sinkronkan lokasi tambahan: id lama yang hilang dari input → soft-delete;
 *    baris ber-id → UPDATE; baris tanpa id → INSERT. Urutan = posisi + 2.
 */
export async function simpanAlamatDanLokasiAgen(
  tx: sql.Transaction,
  agenId: string,
  n: MitraAlamatTernormalisasi,
  userId: string
): Promise<void> {
  // 1. Alamat mitra
  if (n.alamatMitra) {
    await tx
      .request()
      .input("agenId", sql.VarChar(16), agenId)
      .input("wilayahId", sql.VarChar(16), rapikan(n.alamatMitra.wilayah))
      .input("kecamatan", sql.VarChar(128), rapikan(n.alamatMitra.kecamatan))
      .input("alamat", sql.VarChar(1024), rapikan(n.alamatMitra.alamat))
      .input("kontak", sql.VarChar(128), rapikan(n.alamatMitra.kontak))
      .input("userId", sql.VarChar(16), userId).query(`
        MERGE DashboardAgenAlamat WITH (HOLDLOCK) AS t
        USING (SELECT @agenId AS AgenID) AS s ON t.AgenID = s.AgenID
        WHEN MATCHED THEN
          UPDATE SET WilayahID = @wilayahId, Kecamatan = @kecamatan, Alamat = @alamat, Kontak = @kontak,
                     UpdatedByUserID = @userId, UpdatedAt = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (AgenID, WilayahID, Kecamatan, Alamat, Kontak, CreatedByUserID, UpdatedByUserID)
          VALUES (@agenId, @wilayahId, @kecamatan, @alamat, @kontak, @userId, @userId);
      `);
  } else {
    await tx.request().input("agenId", sql.VarChar(16), agenId).query(`DELETE FROM DashboardAgenAlamat WHERE AgenID = @agenId`);
  }

  // 2. Lokasi tambahan
  const lama = await tx
    .request()
    .input("agenId", sql.VarChar(16), agenId)
    .query(`SELECT LokasiPengirimanID FROM DashboardAgenLokasiPengiriman WITH (UPDLOCK)
            WHERE AgenID = @agenId AND IsDeleted = 0`);
  const idLama = new Set((lama.recordset as { LokasiPengirimanID: number }[]).map((r) => r.LokasiPengirimanID));

  const idInput = new Set<number>();
  for (const l of n.tambahan) {
    if (l.lokasiPengirimanId == null) continue;
    if (!idLama.has(l.lokasiPengirimanId)) {
      throw new AppError("Lokasi pengiriman yang diubah tidak ditemukan atau sudah dihapus. Muat ulang data mitra lalu coba lagi.");
    }
    if (idInput.has(l.lokasiPengirimanId)) throw new AppError("Lokasi pengiriman yang sama muncul dua kali di form.");
    idInput.add(l.lokasiPengirimanId);
  }

  const dihapus = [...idLama].filter((id) => !idInput.has(id));
  if (dihapus.length > 0) {
    const req = tx.request().input("agenId", sql.VarChar(16), agenId).input("userId", sql.VarChar(16), userId);
    const params = dihapus.map((id, i) => {
      req.input(`d${i}`, sql.Int, id);
      return `@d${i}`;
    });
    await req.query(`
      UPDATE DashboardAgenLokasiPengiriman
      SET IsDeleted = 1, UpdatedByUserID = @userId, UpdatedAt = GETDATE()
      WHERE AgenID = @agenId AND LokasiPengirimanID IN (${params.join(",")})
    `);
  }

  for (let i = 0; i < n.tambahan.length; i++) {
    const l = n.tambahan[i];
    const req = tx
      .request()
      .input("agenId", sql.VarChar(16), agenId)
      .input("urutan", sql.Int, i + 2)
      .input("label", sql.VarChar(64), rapikan(l.label))
      .input("wilayahId", sql.VarChar(16), rapikan(l.wilayah))
      .input("kecamatan", sql.VarChar(128), rapikan(l.kecamatan))
      .input("alamat", sql.VarChar(1024), rapikan(l.alamat))
      .input("kontak", sql.VarChar(128), rapikan(l.kontak))
      .input("lat", sql.Decimal(10, 7), l.latitude)
      .input("lng", sql.Decimal(10, 7), l.longitude)
      .input("geoAlamat", sql.VarChar(512), rapikan(l.geoAlamat))
      .input("userId", sql.VarChar(16), userId);
    if (l.lokasiPengirimanId != null) {
      await req.input("id", sql.Int, l.lokasiPengirimanId).query(`
        UPDATE DashboardAgenLokasiPengiriman SET
          Urutan = @urutan, Label = @label, WilayahID = @wilayahId, Kecamatan = @kecamatan,
          Alamat = @alamat, Kontak = @kontak, Latitude = @lat, Longitude = @lng, GeoAlamat = @geoAlamat,
          UpdatedByUserID = @userId, UpdatedAt = GETDATE()
        WHERE LokasiPengirimanID = @id AND AgenID = @agenId AND IsDeleted = 0
      `);
    } else {
      await req.query(`
        INSERT INTO DashboardAgenLokasiPengiriman
          (AgenID, Urutan, Label, WilayahID, Kecamatan, Alamat, Kontak, Latitude, Longitude, GeoAlamat,
           IsDeleted, CreatedByUserID, UpdatedByUserID)
        VALUES
          (@agenId, @urutan, @label, @wilayahId, @kecamatan, @alamat, @kontak, @lat, @lng, @geoAlamat,
           0, @userId, @userId)
      `);
    }
  }
}

async function namaWilayah(tx: sql.Transaction, wilayahId: string | null): Promise<string | null> {
  if (!wilayahId) return null;
  const r = await tx.request().input("w", sql.VarChar(16), wilayahId).query(`SELECT Nama FROM PMP_Wilayah WHERE WilayahID = @w`);
  return (r.recordset[0] as { Nama: string | null } | undefined)?.Nama ?? wilayahId;
}

/** AgenDetailID kartu: yang diberikan, atau satu-satunya baris aktif (null bila tidak ada). >1 tanpa ID → tolak. */
async function tentukanAgenDetailId(tx: sql.Transaction, agenId: string, agenDetailId: string | null | undefined): Promise<string | null> {
  const r = await tx
    .request()
    .input("agenId", sql.VarChar(16), agenId)
    .query(`SELECT AgenDetailID FROM PMP_AgenDetail WITH (UPDLOCK, HOLDLOCK) WHERE AgenID = @agenId AND ISNULL(IsDeleted,0) = 0`);
  const ids = (r.recordset as { AgenDetailID: string }[]).map((x) => x.AgenDetailID);
  if (agenDetailId) {
    if (!ids.includes(agenDetailId)) throw new AppError("Alamat ERP mitra ini sudah berubah atau dihapus. Muat ulang halaman lalu coba lagi.");
    return agenDetailId;
  }
  if (ids.length > 1) throw new AppError("Mitra ini punya lebih dari satu baris alamat ERP. Muat ulang halaman lalu edit kartu yang dimaksud.");
  return ids[0] ?? null;
}

/**
 * "Jadikan Utama" (spec §8) dalam satu transaksi sendiri di DB fisik kartu:
 * 1. baca utama (PMP_Agen.Telepon, baris PMP_AgenDetail kartu, profil
 *    Kecamatan, pin) dan baris target (milik Agen ini & belum dihapus);
 * 2. INSERT baris tambahan baru berisi utama lama (menempati Urutan target);
 * 3. tulis target ke kolom ERP (Address1/RegionID baris detail KARTU INI saja,
 *    Telepon), Kecamatan profil, dan pin (pin dihapus bila target tanpa
 *    koordinat — pin harus selalu = utama);
 * 4. soft-delete baris target.
 * `agenDetailId` (tambahan di luar signature brief, opsional): wajib untuk
 * Agen dengan >1 baris detail aktif. Mengembalikan NAMA wilayah lama & baru
 * agar UI bisa memperingatkan perpindahan laporan per wilayah.
 */
export async function jadikanLokasiUtamaAgen(
  kode: string,
  sumber: SumberAgen,
  agenId: string,
  lokasiPengirimanId: number,
  userId: string,
  agenDetailId?: string | null
): Promise<{ wilayahLama: string | null; wilayahBaru: string | null }> {
  const pool = await poolAgen(kode, sumber);
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const agenRes = await tx
      .request()
      .input("agenId", sql.VarChar(16), agenId).query(`
        SELECT a.Telepon, prof.Kecamatan, loc.Latitude, loc.Longitude, loc.Alamat AS GeoAlamat
        FROM PMP_Agen a WITH (UPDLOCK)
        LEFT JOIN DashboardAgenProfil prof WITH (UPDLOCK) ON prof.AgenID = a.AgenID
        LEFT JOIN DashboardAgenLocation loc WITH (UPDLOCK) ON loc.AgenID = a.AgenID
        WHERE a.AgenID = @agenId AND ISNULL(a.IsDeleted,0) = 0
      `);
    const agen = agenRes.recordset[0] as
      | { Telepon: string | null; Kecamatan: string | null; Latitude: number | null; Longitude: number | null; GeoAlamat: string | null }
      | undefined;
    if (!agen) throw new AppError("Mitra tidak ditemukan.");

    const detailId = await tentukanAgenDetailId(tx, agenId, agenDetailId);
    let detail: { Address1: string | null; RegionID: string | null } = { Address1: null, RegionID: null };
    if (detailId) {
      const d = await tx
        .request()
        .input("d", sql.VarChar(16), detailId)
        .query(`SELECT Address1, RegionID FROM PMP_AgenDetail WHERE AgenDetailID = @d`);
      detail = d.recordset[0] as typeof detail;
    }

    const targetRes = await tx
      .request()
      .input("agenId", sql.VarChar(16), agenId)
      .input("id", sql.Int, lokasiPengirimanId).query(`
        SELECT LokasiPengirimanID, Urutan, WilayahID, Kecamatan, Alamat, Kontak, Latitude, Longitude, GeoAlamat
        FROM DashboardAgenLokasiPengiriman WITH (UPDLOCK)
        WHERE LokasiPengirimanID = @id AND AgenID = @agenId AND IsDeleted = 0
      `);
    const target = targetRes.recordset[0] as
      | { Urutan: number; WilayahID: string | null; Kecamatan: string | null; Alamat: string | null; Kontak: string | null;
          Latitude: number | null; Longitude: number | null; GeoAlamat: string | null }
      | undefined;
    if (!target) throw new AppError("Lokasi pengiriman tidak ditemukan atau sudah dihapus.");
    const wilayahBaruId = rapikan(target.WilayahID);
    if (!wilayahBaruId) throw new AppError("Wilayah lokasi ini kosong — isi Wilayah dulu sebelum dijadikan Lokasi Utama.");
    const kontakBaru = rapikan(target.Kontak);
    if (kontakBaru && kontakBaru.length > MAKS_TELEPON) {
      throw new AppError(`Kontak lokasi ini lebih dari ${MAKS_TELEPON} karakter (batas kolom Telepon ERP). Pendekkan dulu sebelum dijadikan Lokasi Utama.`);
    }
    const alamatBaru = rapikan(target.Alamat);
    if (alamatBaru && alamatBaru.length > MAKS_ADDRESS1) {
      throw new AppError(`Alamat lokasi ini lebih dari ${MAKS_ADDRESS1} karakter (batas kolom alamat ERP). Pendekkan dulu sebelum dijadikan Lokasi Utama.`);
    }

    // 2. Utama lama → baris tambahan baru
    await tx
      .request()
      .input("agenId", sql.VarChar(16), agenId)
      .input("urutan", sql.Int, target.Urutan)
      .input("wilayahId", sql.VarChar(16), rapikan(detail.RegionID))
      .input("kecamatan", sql.VarChar(128), rapikan(agen.Kecamatan))
      .input("alamat", sql.VarChar(1024), rapikan(detail.Address1))
      .input("kontak", sql.VarChar(128), rapikan(agen.Telepon))
      .input("lat", sql.Decimal(10, 7), agen.Latitude)
      .input("lng", sql.Decimal(10, 7), agen.Longitude)
      .input("geoAlamat", sql.VarChar(512), rapikan(agen.GeoAlamat))
      .input("userId", sql.VarChar(16), userId).query(`
        INSERT INTO DashboardAgenLokasiPengiriman
          (AgenID, Urutan, Label, WilayahID, Kecamatan, Alamat, Kontak, Latitude, Longitude, GeoAlamat,
           IsDeleted, CreatedByUserID, UpdatedByUserID)
        VALUES
          (@agenId, @urutan, NULL, @wilayahId, @kecamatan, @alamat, @kontak, @lat, @lng, @geoAlamat,
           0, @userId, @userId)
      `);

    // 3. Target → kolom ERP (baris detail kartu ini saja) + Telepon + Kecamatan + pin
    if (detailId) {
      await tx
        .request()
        .input("d", sql.VarChar(16), detailId)
        .input("address1", sql.VarChar(256), alamatBaru)
        .input("regionId", sql.VarChar(16), wilayahBaruId)
        .query(`UPDATE PMP_AgenDetail SET Address1 = @address1, RegionID = @regionId, ModifiedDate = GETDATE() WHERE AgenDetailID = @d`);
    } else {
      // Agen tanpa baris detail: jalur buat-baru updateMitra (agenDetailId null).
      const r = await tx
        .request()
        .input("agenId", sql.VarChar(16), agenId)
        .query(`SELECT Nama, Telepon, BalokKecil, BalokBesar, MaksimumHutang FROM PMP_Agen WHERE AgenID = @agenId`);
      const a = r.recordset[0] as { Nama: string; Telepon: string | null; BalokKecil: number; BalokBesar: number; MaksimumHutang: number };
      await updateMitra(kode, sumber, agenId, {
        nama: a.Nama, telepon: a.Telepon ?? "", wilayahId: wilayahBaruId, alamat: alamatBaru ?? "",
        hargaBalokKecil: Number(a.BalokKecil), hargaBalokBesar: Number(a.BalokBesar), maksimumHutang: Number(a.MaksimumHutang),
        kapasitasBalokKecil: null, kapasitasBalokBesar: null, segmentasi: null,
      }, tx, null);
    }
    await tx
      .request()
      .input("agenId", sql.VarChar(16), agenId)
      .input("telepon", sql.VarChar(16), kontakBaru)
      .query(`UPDATE PMP_Agen SET Telepon = @telepon, ModifiedDate = GETDATE() WHERE AgenID = @agenId`);
    await tx
      .request()
      .input("agenId", sql.VarChar(16), agenId)
      .input("kecamatan", sql.VarChar(128), rapikan(target.Kecamatan))
      .input("userId", sql.VarChar(16), userId).query(`
        MERGE DashboardAgenProfil WITH (HOLDLOCK) AS t
        USING (SELECT @agenId AS AgenID) AS s ON t.AgenID = s.AgenID
        WHEN MATCHED THEN UPDATE SET Kecamatan = @kecamatan, UpdatedAt = GETDATE()
        WHEN NOT MATCHED THEN INSERT (AgenID, Kecamatan, CreatedByUserID) VALUES (@agenId, @kecamatan, @userId);
      `);
    if (target.Latitude != null && target.Longitude != null) {
      await setAgenLocation(
        kode,
        sumber,
        agenId,
        { latitude: Number(target.Latitude), longitude: Number(target.Longitude), alamat: rapikan(target.GeoAlamat), userId },
        tx
      );
    } else {
      await tx.request().input("agenId", sql.VarChar(16), agenId).query(`DELETE FROM DashboardAgenLocation WHERE AgenID = @agenId`);
    }

    // 4. Soft-delete target
    await tx
      .request()
      .input("id", sql.Int, lokasiPengirimanId)
      .input("userId", sql.VarChar(16), userId).query(`
        UPDATE DashboardAgenLokasiPengiriman
        SET IsDeleted = 1, UpdatedByUserID = @userId, UpdatedAt = GETDATE()
        WHERE LokasiPengirimanID = @id
      `);

    const hasil = { wilayahLama: await namaWilayah(tx, rapikan(detail.RegionID)), wilayahBaru: await namaWilayah(tx, wilayahBaruId) };
    await tx.commit();
    return hasil;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

export interface MitraLengkapEsBalokInput extends MitraAlamatForm {
  // nama, harga kecil/besar, maksimumHutang, kapasitas kecil/besar, segmentasi
  mitra: Omit<MitraInput, "telepon" | "wilayahId" | "alamat">;
  namaPenanggungJawab: string | null;
  nik?: string | null; // hanya dikirim bila pengguna punya hak ubah
  kompetitorIds: number[];
}

export interface KonteksSimpanMitraEsBalok {
  userId: string;
  holdingKode: string;
  // false → NIK tidak disentuh sama sekali, apa pun isi input.nik.
  bolehUbahNik: boolean;
}

const SELISIH_KOORDINAT = 1e-7; // presisi kolom decimal(10,7)

/** Tulis pin utama hanya bila berbeda dari yang tersimpan; pin kosong di form = lewati (pin lama tidak dihapus). */
async function tulisPinUtamaBilaBerubah(
  tx: sql.Transaction,
  kode: string,
  sumber: SumberAgen,
  agenId: string,
  utama: MitraAlamatTernormalisasi["utama"],
  userId: string
): Promise<void> {
  if (utama.latitude == null || utama.longitude == null) return;
  const res = await tx
    .request()
    .input("agenId", sql.VarChar(16), agenId)
    .query(`SELECT Latitude, Longitude, Alamat FROM DashboardAgenLocation WITH (UPDLOCK) WHERE AgenID = @agenId`);
  const lama = res.recordset[0] as { Latitude: number | null; Longitude: number | null; Alamat: string | null } | undefined;
  const geoAlamat = rapikan(utama.geoAlamat);
  if (
    lama &&
    lama.Latitude != null &&
    lama.Longitude != null &&
    Math.abs(Number(lama.Latitude) - utama.latitude) < SELISIH_KOORDINAT &&
    Math.abs(Number(lama.Longitude) - utama.longitude) < SELISIH_KOORDINAT &&
    rapikan(lama.Alamat) === geoAlamat
  ) {
    return;
  }
  await setAgenLocation(kode, sumber, agenId, { latitude: utama.latitude, longitude: utama.longitude, alamat: geoAlamat, userId }, tx);
}

function cekPanjang(nilai: string | null, maks: number, nama: string) {
  if (nilai && nilai.length > maks) throw new AppError(`${nama} maksimal ${maks} karakter.`);
}

function validasiPanjang(n: MitraAlamatTernormalisasi) {
  cekPanjang(rapikan(n.utama.kontak), MAKS_TELEPON, "Kontak lokasi utama (kolom Telepon ERP)");
  cekPanjang(rapikan(n.utama.alamat), MAKS_ADDRESS1, "Alamat lokasi utama (kolom alamat ERP)");
  cekPanjang(rapikan(n.utama.kecamatan), MAKS_KECAMATAN, "Kecamatan lokasi utama");
  const lain = [...(n.alamatMitra ? [n.alamatMitra] : []), ...n.tambahan];
  for (const a of lain) {
    cekPanjang(rapikan(a.alamat), MAKS_ALAMAT_DASHBOARD, "Alamat");
    cekPanjang(rapikan(a.kontak), MAKS_KONTAK_DASHBOARD, "Kontak");
    cekPanjang(rapikan(a.kecamatan), MAKS_KECAMATAN, "Kecamatan");
  }
}

/** Semua WilayahID di form harus ada di PMP_Wilayah DB fisik yang sama. */
async function cekWilayahAda(tx: sql.Transaction, n: MitraAlamatTernormalisasi) {
  const ids = [
    ...new Set(
      [n.utama.wilayah, n.alamatMitra?.wilayah, ...n.tambahan.map((l) => l.wilayah)]
        .map((w) => rapikan(w))
        .filter((w): w is string => w !== null)
    ),
  ];
  if (ids.length === 0) return;
  const req = tx.request();
  const params = ids.map((id, i) => {
    req.input(`w${i}`, sql.VarChar(16), id);
    return `@w${i}`;
  });
  const r = await req.query(`SELECT WilayahID FROM PMP_Wilayah WHERE WilayahID IN (${params.join(",")})`);
  const ada = new Set((r.recordset as { WilayahID: string }[]).map((x) => x.WilayahID));
  if (ids.some((id) => !ada.has(id))) throw new AppError("Wilayah tidak dikenal untuk sumber mitra ini. Muat ulang halaman lalu pilih ulang Wilayah.");
}

/** Tanggal kalender WIB hari ini, YYYY-MM-DD (tanpa rollover jam bisnis). */
export function tanggalHariIniWib(now: Date = new Date()): string {
  return getNaiveWibNow(now).toISOString().slice(0, 10);
}

/**
 * Orkestrasi simpan form Mitra Es Balok (padanan simpanMitraLengkap):
 * 1. normalisasi + validasi (nama, panjang kolom ERP, kompetitor milik holding).
 * 2. Satu transaksi MSSQL di DB fisik kartu: create/updateMitra (Telepon,
 *    Address1/RegionID baris detail kartu = lokasi utama), profil (kapasitas,
 *    segmentasi, Kecamatan utama), pin utama (lewati bila kosong/tidak
 *    berubah), alamat mitra + lokasi tambahan. Commit.
 * 3. Postgres: identitas (NIK hanya bila bolehUbahNik; tanggal pendaftaran =
 *    hari ini WIB untuk mitra baru) + kompetitor.
 * 4. Langkah 3 gagal setelah commit → AppError PESAN_SIMPAN_SEBAGIAN.
 * Mengembalikan AgenID.
 */
export async function simpanMitraLengkapEsBalok(
  kode: string,
  sumber: SumberAgen,
  agenId: string | null,
  agenDetailId: string | null,
  input: MitraLengkapEsBalokInput,
  k: KonteksSimpanMitraEsBalok
): Promise<string> {
  // 1. Normalisasi & validasi — semua sebelum menulis apa pun.
  let n: MitraAlamatTernormalisasi;
  try {
    n = normalisasiMitraForm(input);
  } catch (err) {
    throw new AppError(err instanceof Error ? err.message : "Data alamat mitra tidak valid.");
  }
  const nama = input.mitra.nama?.trim();
  if (!nama) throw new AppError("Nama mitra wajib diisi.");
  cekPanjang(nama, MAKS_NAMA, "Nama mitra");
  validasiPanjang(n);
  for (const v of [input.mitra.hargaBalokKecil, input.mitra.hargaBalokBesar, input.mitra.maksimumHutang]) {
    if (!Number.isFinite(v) || v < 0) throw new AppError("Harga dan Batas Hutang harus angka ≥ 0.");
  }
  for (const v of [input.mitra.kapasitasBalokKecil, input.mitra.kapasitasBalokBesar]) {
    if (v != null && (!Number.isFinite(v) || v < 0)) throw new AppError("Kapasitas harus angka ≥ 0.");
  }

  const kompetitorIds = [...new Set(input.kompetitorIds)];
  if (kompetitorIds.length > 0) {
    const milikHolding = new Set((await listKompetitor(k.holdingKode, "es_balok")).map((x) => x.id));
    if (kompetitorIds.some((kid) => !milikHolding.has(kid))) {
      throw new AppError("Daftar kompetitor tidak valid. Muat ulang halaman lalu coba lagi.");
    }
  }

  const mitraInput: MitraInput = {
    ...input.mitra,
    nama,
    // Kolom ERP = lokasi utama (invarian spec §5).
    telepon: rapikan(n.utama.kontak) ?? "",
    wilayahId: rapikan(n.utama.wilayah),
    alamat: rapikan(n.utama.alamat) ?? "",
  };

  // 2. MSSQL — satu transaksi di DB fisik.
  const pool = await poolAgen(kode, sumber);
  const tx = new sql.Transaction(pool);
  await tx.begin();
  let id: string;
  try {
    await cekWilayahAda(tx, n);
    if (agenId) {
      const ada = await tx
        .request()
        .input("id", sql.VarChar(16), agenId)
        .query(`SELECT 1 AS ok FROM PMP_Agen WITH (UPDLOCK) WHERE AgenID = @id AND ISNULL(IsDeleted,0) = 0`);
      if (ada.recordset.length === 0) throw new AppError("Mitra tidak ditemukan atau sudah dihapus.");
      await updateMitra(kode, sumber, agenId, mitraInput, tx, agenDetailId);
      id = agenId;
    } else {
      id = await createMitra(kode, sumber, mitraInput, tx);
    }
    await setAgenProfil(
      kode,
      sumber,
      id,
      {
        kapasitasBalokKecil: mitraInput.kapasitasBalokKecil,
        kapasitasBalokBesar: mitraInput.kapasitasBalokBesar,
        segmentasi: mitraInput.segmentasi,
        kecamatan: rapikan(n.utama.kecamatan),
        userId: k.userId,
      },
      tx
    );
    await tulisPinUtamaBilaBerubah(tx, kode, sumber, id, n.utama, k.userId);
    await simpanAlamatDanLokasiAgen(tx, id, n, k.userId);
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }

  // 3. Postgres — identitas + kompetitor (kunci fisik).
  const kunci = kunciIdentitasAgen(kode, sumber, id);
  try {
    await simpanIdentitasMitra(
      kunci,
      { namaPenanggungJawab: input.namaPenanggungJawab, nik: k.bolehUbahNik ? (input.nik ?? null) : undefined },
      k.userId
    );
    if (!agenId) await setTanggalPendaftaranBilaKosong(kunci, tanggalHariIniWib(), k.userId);
    await setKompetitorMitra(kunci, kompetitorIds);
  } catch (err) {
    console.error("[simpanMitraLengkapEsBalok] identitas/kompetitor gagal setelah MSSQL commit:", kode, sumber, id, err);
    throw new AppError(PESAN_SIMPAN_SEBAGIAN);
  }
  return id;
}

export interface MitraFormKonteksEsBalok {
  akses: { lihat: boolean; ubah: boolean };
  // Kunci fisik untuk rute berkas /api/mitra-berkas (kode/sumber hasil resolveAgenKoneksi).
  berkasKode: string;
  berkasSumber: "utama" | "logistik";
  wilayahOptions: WilayahOption[];
  kompetitorOpsi: Kompetitor[];
  kompetitorDipilih: number[];
  identitas: IdentitasMitra | null; // null untuk mitra baru
}

/**
 * Semua yang dibutuhkan form Mitra Es Balok di luar MitraCard, satu
 * round-trip saat dialog dibuka (tidak lewat props halaman — NIK & info
 * berkas hanya terbaca bila akses.lihat, lihat getIdentitasMitra).
 */
export async function muatKonteksFormEsBalok(
  kode: string,
  sumber: SumberAgen,
  agenId: string | null,
  akses: { lihat: boolean; ubah: boolean },
  holdingKode: string
): Promise<MitraFormKonteksEsBalok> {
  const fisik = resolveAgenKoneksi(kode, sumber);
  const kunci = agenId ? kunciIdentitasAgen(kode, sumber, agenId) : null;
  const [wilayahOptions, kompetitorOpsi, kompetitorMap, identitas] = await Promise.all([
    getWilayahOptions(kode, sumber),
    listKompetitor(holdingKode, "es_balok"),
    kunci ? getKompetitorMitraMap(kunci.perusahaanKode, kunci.sumber) : Promise.resolve(new Map<string, Kompetitor[]>()),
    kunci ? getIdentitasMitra(kunci, akses.lihat) : Promise.resolve(null),
  ]);
  return {
    akses,
    berkasKode: fisik.kode,
    berkasSumber: fisik.label,
    wilayahOptions,
    kompetitorOpsi,
    kompetitorDipilih: agenId ? (kompetitorMap.get(agenId) ?? []).map((x) => x.id) : [],
    identitas,
  };
}
