// src/lib/queries/inventaris-pengiriman.ts
import { getPgPool } from "@/lib/pg";
import { AppError } from "@/lib/action-result";

export interface VendorPengirimanInput {
  vendorPerusahaanLinkId: number;
  vendorProdukId: number | null;
  tanggalPesan: string; // ISO date, e.g. "2026-09-15"
  tanggalTiba: string;
  ratingKualitas: number; // 1-5
  catatan: string | null;
  dicatatOlehAkunId: number;
}

export interface VendorPengirimanRow {
  id: number;
  vendorPerusahaanLinkId: number;
  perusahaanNama: string;
  vendorProdukId: number | null;
  produkLabel: string | null;
  tanggalPesan: string;
  tanggalTiba: string;
  lamaKirimHari: number;
  ratingKualitas: number;
  catatan: string | null;
  dicatatOlehNama: string;
}

function assertValidRating(rating: number) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new AppError("Rating kualitas harus bilangan bulat 1-5.");
  }
}

function assertValidDates(tanggalPesan: string, tanggalTiba: string) {
  if (new Date(tanggalTiba) < new Date(tanggalPesan)) {
    throw new AppError("Tanggal tiba tidak boleh sebelum tanggal pesan.");
  }
}

export async function addVendorPengiriman(input: VendorPengirimanInput): Promise<number> {
  assertValidRating(input.ratingKualitas);
  assertValidDates(input.tanggalPesan, input.tanggalTiba);
  const pool = getPgPool();
  const result = await pool.query(
    `INSERT INTO vendor_pengiriman
       (vendor_perusahaan_link_id, vendor_produk_id, tanggal_pesan, tanggal_tiba, rating_kualitas, catatan, dicatat_oleh_akun_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [input.vendorPerusahaanLinkId, input.vendorProdukId, input.tanggalPesan, input.tanggalTiba, input.ratingKualitas, input.catatan, input.dicatatOlehAkunId]
  );
  return result.rows[0].id as number;
}

export async function listVendorPengiriman(vendorId: number): Promise<VendorPengirimanRow[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT vpg.id, vpg.vendor_perusahaan_link_id, p.nama AS perusahaan_nama,
            vpg.vendor_produk_id, vpd.brand, vpd.model,
            vpg.tanggal_pesan, vpg.tanggal_tiba,
            (vpg.tanggal_tiba - vpg.tanggal_pesan) AS lama_kirim_hari,
            vpg.rating_kualitas, vpg.catatan, a.nama AS dicatat_oleh_nama
     FROM vendor_pengiriman vpg
     JOIN vendor_perusahaan_link vpl ON vpl.id = vpg.vendor_perusahaan_link_id
     JOIN perusahaan p ON p.id = vpl.perusahaan_id
     JOIN akun a ON a.id = vpg.dicatat_oleh_akun_id
     LEFT JOIN vendor_produk vpd ON vpd.id = vpg.vendor_produk_id
     WHERE vpl.vendor_id = $1
     ORDER BY vpg.tanggal_tiba DESC`,
    [vendorId]
  );
  return result.rows.map((r) => ({
    id: r.id,
    vendorPerusahaanLinkId: r.vendor_perusahaan_link_id,
    perusahaanNama: r.perusahaan_nama,
    vendorProdukId: r.vendor_produk_id,
    produkLabel: r.vendor_produk_id ? [r.brand, r.model].filter(Boolean).join(" ") || null : null,
    tanggalPesan: r.tanggal_pesan,
    tanggalTiba: r.tanggal_tiba,
    lamaKirimHari: Number(r.lama_kirim_hari),
    ratingKualitas: r.rating_kualitas,
    catatan: r.catatan,
    dicatatOlehNama: r.dicatat_oleh_nama,
  }));
}

export async function deleteVendorPengiriman(id: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM vendor_pengiriman WHERE id = $1`, [id]);
}

export interface VendorRanking {
  jumlahLog: number;
  rataRataLamaKirimHari: number | null;
  rataRataRatingKualitas: number | null;
}

// perusahaanId narrows to one company's log entries; omit for a combined
// ranking across every company the vendor transacts with (spec's "Bisa
// dilihat gabungan atau difilter per perusahaan").
export async function getVendorRanking(vendorId: number, perusahaanId?: number): Promise<VendorRanking> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT
       COUNT(*) AS jumlah_log,
       AVG(vpg.tanggal_tiba - vpg.tanggal_pesan) AS avg_lama_kirim,
       AVG(vpg.rating_kualitas) AS avg_rating
     FROM vendor_pengiriman vpg
     JOIN vendor_perusahaan_link vpl ON vpl.id = vpg.vendor_perusahaan_link_id
     WHERE vpl.vendor_id = $1 AND ($2::int IS NULL OR vpl.perusahaan_id = $2)`,
    [vendorId, perusahaanId ?? null]
  );
  const row = result.rows[0];
  const jumlahLog = Number(row.jumlah_log);
  return {
    jumlahLog,
    rataRataLamaKirimHari: jumlahLog > 0 ? Number(row.avg_lama_kirim) : null,
    rataRataRatingKualitas: jumlahLog > 0 ? Number(row.avg_rating) : null,
  };
}
