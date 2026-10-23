import { getPool, sql } from "@/lib/db";
import { getCompanyPool } from "@/lib/db-company";
import { resolveAgenKoneksi, type SumberAgen } from "@/lib/queries/mitra-es-balok";
import { branchFilterFor } from "@/lib/queries/piutang-pembayaran";
import {
  getEsBalokInvoiceOutstanding,
  esBalokAgingBucket,
  type EsBalokAgingBucket,
} from "@/lib/queries/piutang-invoice-outstanding";
import { extractPhones, last9, normalizePhone, phoneMatches } from "@/lib/bychat/phone";
import { cocokkanNomorKeMitra } from "@/lib/bychat/cocok-mitra";
import { AppError } from "@/lib/action-result";
import { isPmpDeployment } from "@/lib/tenant";
import { listActiveMetodePembayaran } from "@/lib/queries/metode-pembayaran";
import { ringkasIsi, type IsiPesanan } from "@/lib/bychat/isi-pesanan";

// Lookup mitra + data kartu piutang, SELALU terhadap database SATU PT (kode
// dari pemetaan akun ByChat). Tidak pernah menggabungkan lintas PT. mkesindo
// memakai BusinessPartner (ERP); PT Es Balok memakai PMP_Agen.

export type PtKode = "mkesindo" | "pmputra" | "pmpersada" | "pmpakis";
const ES_BALOK: PtKode[] = ["pmputra", "pmpersada", "pmpakis"];

export function assertPtKode(kode: string): PtKode {
  // Cabang "mkesindo" membaca getPool(), yang di deployment demo mengarah ke
  // database demo -- jadi ByChat hanya dilayani di deployment PMP, supaya
  // pemetaan akun ByChat milik PT PMP tidak pernah dipasangkan dengan data
  // tenant lain.
  if (isPmpDeployment() && (kode === "mkesindo" || ES_BALOK.includes(kode as PtKode))) return kode as PtKode;
  throw new AppError(`PT "${kode}" belum didukung integrasi ByChat.`);
}

// Ringkasan satu lokasi mitra untuk panel /embed/mitra. `cocok` = kolom
// kontak lokasi ini memuat nomor percakapan.
export interface LokasiRingkas {
  label: string; // "Utama" / "Alamat Mitra" / label lokasi / "Lokasi N"
  wilayah: string | null;
  alamat: string | null;
  kontak: string | null;
  cocok: boolean;
}

export interface MitraRingkas {
  id: string;
  nama: string;
  wilayah: string | null;
  // Hanya diisi cariMitraByNomor (tidak oleh ambilMitraById / tautan publik).
  lokasi?: LokasiRingkas[];
}

export interface FakturRow {
  noDokumen: string;
  tanggal: string; // yyyy-MM-dd
  jatuhTempo: string; // yyyy-MM-dd
  hariLewat: number; // <= 0: belum jatuh tempo
  sisa: number;
  isi: IsiPesanan[]; // rincian pesanan (Kantong 10/5 KG, Bonus); kosong bila sumber data tak punya
}

export interface AgingRingkas {
  bucket: EsBalokAgingBucket;
  jumlah: number;
  total: number;
}

export interface PembelianRow {
  noDokumen: string;
  tanggal: string;
  nilai: number;
}

// Rekening tujuan pembayaran, dibaca dari "Metode Pembayaran" PT di
// /grup/perusahaan (metode TRANSFER aktif berkonteks "publik" -- sama dengan
// yang ditampilkan di invoice publik). Kosong bila PT belum mengaturnya.
export interface RekeningBayar {
  bank: string;
  nomorRekening: string;
  atasNama: string;
  catatan: string | null;
}

// QRIS statis aktif (konteks "publik") untuk tab QRIS di tautan publik kartu.
export interface QrisBayar {
  gambar: string; // path /api/files/... (proxy Google Drive, publik)
  catatan: string | null;
}

export interface KartuPiutangData {
  ptKode: PtKode;
  ptNama: string;
  mitra: MitraRingkas;
  tanggalPosisi: string; // yyyy-MM-dd (WIB) -- dasar idempotency_key
  rekening: RekeningBayar[];
  qris?: QrisBayar[];
  faktur: FakturRow[];
  aging: AgingRingkas[];
  totalPiutang: number;
  pembelianTerbaru: PembelianRow[];
  pembelian30Hari: number;
  pembelian90Hari: number;
}

export const AGING_ORDER: EsBalokAgingBucket[] = ["Belum Jatuh Tempo", "1-30 Hari", "31-60 Hari", "61-90 Hari", ">90 Hari"];

export function tanggalPosisiWib(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

const iso = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

// ---------------------------------------------------------------- lookup

const STRIP_SQL = (kolom: string) => `REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(${kolom},''),' ',''),'-',''),'+',''),'.','')`;

export async function cariMitraByNomor(ptKode: PtKode, nomorMentah: string): Promise<MitraRingkas[]> {
  const nomor = normalizePhone(nomorMentah);
  if (!nomor) return [];
  const l9 = last9(nomor);
  if (!l9) return [];
  return ptKode === "mkesindo" ? cariMkesindo(nomor, l9) : cariEsBalok(ptKode, nomor, l9);
}

// Baris kontak tambahan (alamat mitra / lokasi pengiriman) per mitra kandidat.
interface KontakTambahanRow {
  PartnerID: string;
  Jenis: "alamat" | "lokasi";
  Label: string | null;
  Wilayah: string | null;
  Alamat: string | null;
  Kontak: string | null;
}

interface KandidatMitra {
  id: string;
  nama: string;
  wilayah: string | null;
  kontakUtama: (string | null)[];
  utama: LokasiRingkas;
}

// Placeholder IN (@p0, @p1, ...) untuk daftar ID kandidat (sedikit, hasil prefilter).
function inputDaftarId(req: sql.Request, ids: string[]): string {
  return ids
    .map((id, i) => {
      req.input(`p${i}`, sql.VarChar(16), id);
      return `@p${i}`;
    })
    .join(",");
}

/**
 * Kandidat prefilter → cocokkanNomorKeMitra (semua kolom kontak) →
 * MitraRingkas + ringkasan lokasi (utama, alamat mitra, lokasi tambahan
 * aktif) dengan penanda kontak mana yang cocok.
 */
function susunHasil(nomor: string, kandidat: KandidatMitra[], tambahan: KontakTambahanRow[]): MitraRingkas[] {
  const perMitra = new Map<string, KontakTambahanRow[]>();
  for (const t of tambahan) perMitra.set(t.PartnerID, [...(perMitra.get(t.PartnerID) ?? []), t]);
  const cocok = new Set(
    cocokkanNomorKeMitra(
      nomor,
      kandidat.map((k) => ({ id: k.id, kontak: [...k.kontakUtama, ...(perMitra.get(k.id) ?? []).map((t) => t.Kontak)] }))
    )
  );
  return kandidat
    .filter((k) => cocok.has(k.id))
    .map((k) => {
      let nomorLokasi = 1;
      const lokasi: LokasiRingkas[] = [
        k.utama,
        ...(perMitra.get(k.id) ?? []).map((t) => ({
          label: t.Jenis === "alamat" ? "Alamat Mitra" : t.Label?.trim() || `Lokasi ${++nomorLokasi}`,
          wilayah: t.Wilayah,
          alamat: t.Alamat,
          kontak: t.Kontak,
          cocok: phoneMatches(t.Kontak, nomor),
        })),
      ];
      return { id: k.id, nama: k.nama, wilayah: k.wilayah, lokasi };
    })
    .sort((a, b) => a.nama.localeCompare(b.nama, "id"));
}

async function cariMkesindo(nomor: string, l9: string): Promise<MitraRingkas[]> {
  const pool = await getPool();
  const r = await pool
    .request()
    .input("l9", sql.VarChar(16), `%${l9}%`)
    .query(`
      SELECT bp.BusinessPartnerID, bp.Name, bp.NPWPName AS Wilayah, bp.Address AS Alamat, bp.MobileNo, bp.PhoneNo
      FROM BusinessPartner bp WITH (NOLOCK)
      WHERE bp.IsDeleted = 0 AND (
        ${STRIP_SQL("bp.MobileNo")} LIKE @l9 OR ${STRIP_SQL("bp.PhoneNo")} LIKE @l9
        OR EXISTS (SELECT 1 FROM DashboardMitraAlamat ma WITH (NOLOCK)
                   WHERE ma.BusinessPartnerID = bp.BusinessPartnerID AND ${STRIP_SQL("ma.Kontak")} LIKE @l9)
        OR EXISTS (SELECT 1 FROM DashboardMitraLokasiPengiriman lp WITH (NOLOCK)
                   WHERE lp.BusinessPartnerID = bp.BusinessPartnerID AND lp.IsDeleted = 0 AND ${STRIP_SQL("lp.Kontak")} LIKE @l9)
      )
    `);
  const rows = r.recordset as {
    BusinessPartnerID: string;
    Name: string;
    Wilayah: string | null;
    Alamat: string | null;
    MobileNo: string | null;
    PhoneNo: string | null;
  }[];
  if (rows.length === 0) return [];

  const req = pool.request();
  const daftar = inputDaftarId(req, rows.map((b) => b.BusinessPartnerID));
  const t = await req.query(`
    SELECT BusinessPartnerID AS PartnerID, 'alamat' AS Jenis, CAST(NULL AS varchar(64)) AS Label,
           Wilayah, Alamat, Kontak, 0 AS Urutan, 0 AS LokasiPengirimanID
    FROM DashboardMitraAlamat WITH (NOLOCK) WHERE BusinessPartnerID IN (${daftar})
    UNION ALL
    SELECT BusinessPartnerID, 'lokasi', Label, Wilayah, Alamat, Kontak, Urutan, LokasiPengirimanID
    FROM DashboardMitraLokasiPengiriman WITH (NOLOCK) WHERE IsDeleted = 0 AND BusinessPartnerID IN (${daftar})
    ORDER BY PartnerID, Urutan, LokasiPengirimanID
  `);
  return susunHasil(
    nomor,
    rows.map((b) => ({
      id: b.BusinessPartnerID,
      nama: b.Name,
      wilayah: b.Wilayah,
      kontakUtama: [b.MobileNo, b.PhoneNo],
      utama: {
        label: "Utama",
        wilayah: b.Wilayah,
        alamat: b.Alamat,
        kontak: b.MobileNo,
        cocok: phoneMatches(b.MobileNo, nomor) || phoneMatches(b.PhoneNo, nomor),
      },
    })),
    t.recordset as KontakTambahanRow[]
  );
}

// Es Balok: hanya DB "utama" PT (sama dengan perilaku sebelumnya). Alamat
// mitra & lokasi tambahan Agen sumber "utama" disimpan di DB yang sama
// (resolveAgenKoneksi), jadi cukup satu pool.
async function cariEsBalok(ptKode: PtKode, nomor: string, l9: string): Promise<MitraRingkas[]> {
  const { kode, label } = resolveAgenKoneksi(ptKode, "utama");
  const pool = await getCompanyPool(kode, label);
  const r = await pool
    .request()
    .input("l9", sql.VarChar(16), `%${l9}%`)
    .query(`
      SELECT a.AgenID, a.Nama, a.Telepon, w.Nama AS WilayahNama, ad.Address1 AS Alamat
      FROM PMP_Agen a WITH (NOLOCK)
      OUTER APPLY (SELECT TOP 1 d.RegionID, d.Address1 FROM PMP_AgenDetail d WITH (NOLOCK)
                   WHERE d.AgenID = a.AgenID AND ISNULL(d.IsDeleted, 0) = 0 ORDER BY d.AgenDetailID) ad
      LEFT JOIN PMP_Wilayah w ON w.WilayahID = ad.RegionID
      WHERE a.IsDeleted = 0 AND (
        ${STRIP_SQL("a.Telepon")} LIKE @l9
        OR EXISTS (SELECT 1 FROM DashboardAgenAlamat aa WITH (NOLOCK)
                   WHERE aa.AgenID = a.AgenID AND ${STRIP_SQL("aa.Kontak")} LIKE @l9)
        OR EXISTS (SELECT 1 FROM DashboardAgenLokasiPengiriman lp WITH (NOLOCK)
                   WHERE lp.AgenID = a.AgenID AND lp.IsDeleted = 0 AND ${STRIP_SQL("lp.Kontak")} LIKE @l9)
      )
    `);
  const rows = r.recordset as { AgenID: string; Nama: string; Telepon: string | null; WilayahNama: string | null; Alamat: string | null }[];
  if (rows.length === 0) return [];

  const req = pool.request();
  const daftar = inputDaftarId(req, rows.map((a) => a.AgenID));
  const t = await req.query(`
    SELECT aa.AgenID AS PartnerID, 'alamat' AS Jenis, CAST(NULL AS varchar(64)) AS Label,
           w.Nama AS Wilayah, aa.Alamat, aa.Kontak, 0 AS Urutan, 0 AS LokasiPengirimanID
    FROM DashboardAgenAlamat aa WITH (NOLOCK) LEFT JOIN PMP_Wilayah w ON w.WilayahID = aa.WilayahID
    WHERE aa.AgenID IN (${daftar})
    UNION ALL
    SELECT lp.AgenID, 'lokasi', lp.Label, w.Nama, lp.Alamat, lp.Kontak, lp.Urutan, lp.LokasiPengirimanID
    FROM DashboardAgenLokasiPengiriman lp WITH (NOLOCK) LEFT JOIN PMP_Wilayah w ON w.WilayahID = lp.WilayahID
    WHERE lp.IsDeleted = 0 AND lp.AgenID IN (${daftar})
    ORDER BY PartnerID, Urutan, LokasiPengirimanID
  `);
  return susunHasil(
    nomor,
    rows.map((a) => ({
      id: a.AgenID,
      nama: a.Nama,
      wilayah: null, // sama dengan perilaku lama: wilayah kartu Es Balok tidak diisi
      kontakUtama: [a.Telepon],
      utama: { label: "Utama", wilayah: a.WilayahNama, alamat: a.Alamat, kontak: a.Telepon, cocok: phoneMatches(a.Telepon, nomor) },
    })),
    t.recordset as KontakTambahanRow[]
  );
}

// Nomor tujuan pengiriman = nomor kanonik yang sudah terbukti cocok dengan
// mitra terpilih (bukan input bebas) -- dipakai kirim.ts.
export function nomorKanonikDariKontak(phoneNumber: string | null, identifier: string | null): string | null {
  const n = normalizePhone(phoneNumber);
  if (n) return n;
  // Identifier WhatsApp berbentuk "62812...@s.whatsapp.net"; JID berakhiran
  // @lid TIDAK memuat nomor asli -> tidak dipakai (null).
  if (identifier && /@s\.whatsapp\.net$/i.test(identifier)) return normalizePhone(identifier.split("@")[0]);
  return null;
}

// ----------------------------------------------------------- data kartu

function ringkasAging(faktur: FakturRow[]): AgingRingkas[] {
  return AGING_ORDER.map((bucket) => {
    const rows = faktur.filter((f) => esBalokAgingBucket(f.hariLewat) === bucket);
    return { bucket, jumlah: rows.length, total: rows.reduce((s, f) => s + f.sisa, 0) };
  });
}

async function kartuMkesindo(mitra: MitraRingkas): Promise<Omit<KartuPiutangData, "ptKode" | "ptNama" | "mitra" | "tanggalPosisi" | "rekening">> {
  const pool = await getPool();
  const fakturRes = await pool
    .request()
    .input("bp", sql.VarChar(16), mitra.id)
    .query(`
      WITH CustomerBalance AS (
        SELECT SalesInvoiceID, SUM(Netto) AS Netto, SUM(Deposit) AS Deposit, SUM(Paid) AS Paid, SUM(OtherPayment) AS OtherPayment
        FROM vCustomerStatement
        WHERE SalesInvoiceID IN (SELECT SalesInvoiceID FROM SalesInvoice WHERE BusinessPartnerID = @bp AND IsDeleted = 0)
        GROUP BY SalesInvoiceID
      )
      SELECT si.SalesInvoiceID, si.VoucherNo, si.TransDate, si.DueDate,
             (cb.Netto - cb.Paid - cb.Deposit - cb.OtherPayment) AS Sisa,
             DATEDIFF(DAY, si.DueDate, GETDATE()) AS HariLewat
      FROM CustomerBalance cb JOIN SalesInvoice si ON si.SalesInvoiceID = cb.SalesInvoiceID
      WHERE si.IsDeleted = 0 AND (cb.Netto - cb.Paid - cb.Deposit - cb.OtherPayment) > 0
      ORDER BY si.TransDate ASC
    `);
  const fakturRaw = fakturRes.recordset as { SalesInvoiceID: string; VoucherNo: string; TransDate: Date; DueDate: Date; Sisa: number; HariLewat: number }[];

  // Rincian pesanan per faktur (Kantong 10/5 KG, Bonus) dari SalesInvoiceDetail.
  const isiPerFaktur = new Map<string, { itemId: string; nama: string; qty: number }[]>();
  if (fakturRaw.length > 0) {
    const req = pool.request();
    const ph = fakturRaw.map((f, i) => {
      req.input(`f${i}`, sql.VarChar(16), f.SalesInvoiceID);
      return `@f${i}`;
    });
    const det = await req.query(
      `SELECT SalesInvoiceID, ItemID, Name, Qty FROM SalesInvoiceDetail WITH (NOLOCK) WHERE SalesInvoiceID IN (${ph.join(",")})`
    );
    for (const d of det.recordset as { SalesInvoiceID: string; ItemID: string; Name: string; Qty: number }[]) {
      const arr = isiPerFaktur.get(d.SalesInvoiceID) ?? [];
      arr.push({ itemId: d.ItemID, nama: d.Name, qty: Number(d.Qty) });
      isiPerFaktur.set(d.SalesInvoiceID, arr);
    }
  }
  const faktur: FakturRow[] = fakturRaw.map((r) => ({
    noDokumen: r.VoucherNo,
    tanggal: iso(r.TransDate),
    jatuhTempo: iso(r.DueDate),
    hariLewat: r.HariLewat,
    sisa: Number(r.Sisa),
    isi: ringkasIsi(isiPerFaktur.get(r.SalesInvoiceID) ?? []),
  }));

  const beli = await pool
    .request()
    .input("bp", sql.VarChar(16), mitra.id)
    .query(`
      SELECT TOP 5 VoucherNo, TransDate, Netto FROM SalesInvoice WITH (NOLOCK)
      WHERE BusinessPartnerID = @bp AND IsDeleted = 0 ORDER BY TransDate DESC;
      SELECT
        ISNULL(SUM(CASE WHEN TransDate >= DATEADD(DAY, -30, GETDATE()) THEN Netto END), 0) AS T30,
        ISNULL(SUM(CASE WHEN TransDate >= DATEADD(DAY, -90, GETDATE()) THEN Netto END), 0) AS T90
      FROM SalesInvoice WITH (NOLOCK) WHERE BusinessPartnerID = @bp AND IsDeleted = 0 AND TransDate >= DATEADD(DAY, -90, GETDATE());
    `);
  const sets = beli.recordsets as unknown as { VoucherNo?: string; TransDate?: Date; Netto?: number; T30?: number; T90?: number }[][];
  return {
    faktur,
    aging: ringkasAging(faktur),
    totalPiutang: faktur.reduce((s, f) => s + f.sisa, 0),
    pembelianTerbaru: sets[0].map((r) => ({ noDokumen: r.VoucherNo as string, tanggal: iso(r.TransDate as Date), nilai: Number(r.Netto) })),
    pembelian30Hari: Number(sets[1][0]?.T30 ?? 0),
    pembelian90Hari: Number(sets[1][0]?.T90 ?? 0),
  };
}

async function kartuEsBalok(ptKode: PtKode, mitra: MitraRingkas): Promise<Omit<KartuPiutangData, "ptKode" | "ptNama" | "mitra" | "tanggalPosisi" | "rekening">> {
  const semua = await getEsBalokInvoiceOutstanding(ptKode);
  const faktur: FakturRow[] = semua
    .filter((r) => r.agenId === mitra.id)
    .map((r) => ({
      noDokumen: r.noDokumen,
      tanggal: r.tanggal,
      jatuhTempo: new Date(new Date(r.tanggal).getTime() + 14 * 86400000).toISOString().slice(0, 10),
      hariLewat: r.daysOverdue,
      sisa: r.outstanding,
      isi: [],
    }))
    .sort((a, b) => a.tanggal.localeCompare(b.tanggal));

  const pembelian: PembelianRow[] = [];
  for (const sumber of ["utama", "logistik"] as SumberAgen[]) {
    const { kode, label } = resolveAgenKoneksi(ptKode, sumber);
    const pool = await getCompanyPool(kode, label);
    const branchId = branchFilterFor(ptKode, sumber);
    const req = pool.request().input("agen", sql.VarChar(16), mitra.id);
    if (branchId) req.input("branchId", sql.VarChar(16), branchId);
    const r = await req.query(`
      SELECT TOP 90 NoDokumen, Tanggal,
        (BalokKecilRealisasi - ISNULL(BalokKecilRetur,0)) * BalokKecilHarga
          + (BalokBesarRealisasi - ISNULL(BalokBesarRetur,0)) * BalokBesarHarga AS NetValue
      FROM PMP_Pemesanan WITH (NOLOCK)
      WHERE IsDeleted = 0 AND AgenID = @agen ${branchId ? "AND BranchID = @branchId" : ""}
      ORDER BY Tanggal DESC
    `);
    for (const x of r.recordset as { NoDokumen: string; Tanggal: Date; NetValue: number }[]) {
      pembelian.push({ noDokumen: x.NoDokumen, tanggal: iso(x.Tanggal), nilai: Number(x.NetValue) });
    }
  }
  pembelian.sort((a, b) => b.tanggal.localeCompare(a.tanggal));
  const sejak = (hari: number) => new Date(Date.now() - hari * 86400000).toISOString().slice(0, 10);
  return {
    faktur,
    aging: ringkasAging(faktur),
    totalPiutang: faktur.reduce((s, f) => s + f.sisa, 0),
    pembelianTerbaru: pembelian.slice(0, 5),
    pembelian30Hari: pembelian.filter((p) => p.tanggal >= sejak(30)).reduce((s, p) => s + p.nilai, 0),
    pembelian90Hari: pembelian.filter((p) => p.tanggal >= sejak(90)).reduce((s, p) => s + p.nilai, 0),
  };
}

// Mitra HARUS dipilih dari hasil cariMitraByNomor di PT yang sama; id yang
// tidak ditemukan di PT itu ditolak (mencegah id lintas PT / id karangan).
// Dipakai tautan publik (tanpa nomor telepon): mitra dicari langsung dari ID
// di database PT-nya; null bila sudah tidak ada.
export async function ambilMitraById(ptKode: PtKode, mitraId: string): Promise<MitraRingkas | null> {
  if (ptKode === "mkesindo") {
    const pool = await getPool();
    const r = await pool.request().input("id", sql.VarChar(16), mitraId).query(
      `SELECT BusinessPartnerID, Name, NPWPName AS Wilayah FROM BusinessPartner WITH (NOLOCK) WHERE BusinessPartnerID = @id AND IsDeleted = 0`
    );
    const b = r.recordset[0] as { BusinessPartnerID: string; Name: string; Wilayah: string | null } | undefined;
    return b ? { id: b.BusinessPartnerID, nama: b.Name, wilayah: b.Wilayah } : null;
  }
  const { kode, label } = resolveAgenKoneksi(ptKode, "utama");
  const pool = await getCompanyPool(kode, label);
  const r = await pool.request().input("id", sql.VarChar(16), mitraId).query(
    `SELECT AgenID, Nama FROM PMP_Agen WITH (NOLOCK) WHERE AgenID = @id AND IsDeleted = 0`
  );
  const a = r.recordset[0] as { AgenID: string; Nama: string } | undefined;
  return a ? { id: a.AgenID, nama: a.Nama, wilayah: null } : null;
}

export async function getKartuByMitraId(ptKode: PtKode, ptNama: string, perusahaanId: number, mitraId: string): Promise<KartuPiutangData | null> {
  const mitra = await ambilMitraById(ptKode, mitraId);
  if (!mitra) return null;
  const [bagian, rekening, qris] = await Promise.all([
    ptKode === "mkesindo" ? kartuMkesindo(mitra) : kartuEsBalok(ptKode, mitra),
    getRekeningPembayaran(perusahaanId),
    getQrisBayar(perusahaanId),
  ]);
  return { ptKode, ptNama, mitra, tanggalPosisi: tanggalPosisiWib(), rekening, qris, ...bagian };
}

export async function getRekeningPembayaran(perusahaanId: number): Promise<RekeningBayar[]> {
  const metode = await listActiveMetodePembayaran(perusahaanId, "publik");
  return metode
    .filter((m) => m.metode === "TRANSFER" && m.nomorRekening && m.nomorRekening.trim())
    .map((m) => ({
      bank: (m.bankNama ?? "").trim() || "Bank",
      nomorRekening: (m.nomorRekening as string).trim(),
      atasNama: (m.atasNama ?? "").trim(),
      catatan: m.catatan && m.catatan.trim() ? m.catatan.trim() : null,
    }));
}

export async function getQrisBayar(perusahaanId: number): Promise<QrisBayar[]> {
  const metode = await listActiveMetodePembayaran(perusahaanId, "publik");
  return metode
    .filter((m) => m.jenis === "qris_static" && m.qrisStatisImagePath)
    .map((m) => ({ gambar: m.qrisStatisImagePath as string, catatan: m.catatan && m.catatan.trim() ? m.catatan.trim() : null }));
}

export async function getKartuPiutang(
  ptKode: PtKode,
  ptNama: string,
  perusahaanId: number,
  nomor: string,
  mitraId: string
): Promise<KartuPiutangData> {
  const cocok = await cariMitraByNomor(ptKode, nomor);
  const mitra = cocok.find((m) => m.id === mitraId);
  if (!mitra) throw new AppError("Mitra tidak cocok dengan nomor percakapan ini.");
  const [bagian, rekening, qris] = await Promise.all([
    ptKode === "mkesindo" ? kartuMkesindo(mitra) : kartuEsBalok(ptKode, mitra),
    getRekeningPembayaran(perusahaanId),
    getQrisBayar(perusahaanId),
  ]);
  return { ptKode, ptNama, mitra, tanggalPosisi: tanggalPosisiWib(), rekening, qris, ...bagian };
}

export { extractPhones };
