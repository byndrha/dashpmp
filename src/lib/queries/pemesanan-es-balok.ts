import { sql } from "@/lib/db";
import { getCompanyPool } from "@/lib/db-company";

// Modul Pemesanan Es Balok — BACA-SAJA dari ERP Es Balok (database `utama`
// tiap PT, sama dengan SUMBER_DO di produksi-do-erp.ts: utama tanpa filter
// branch; `logistik` adalah cermin/duplikat dan tidak dijumlahkan).
//
// Alur ERP (dicek live 2026-11-22, scripts/diag-pemesanan-es-balok-*):
//   PMP_Pemesanan (pesanan agen; Tanggal = tanggal kirim, tanpa jam)
//     → PMP_PenjadwalanDetail → PMP_Penjadwalan (jadwal per kendaraan/hari)
//   Status '2' = pesanan aktif (hari berjalan), '3' = selesai. Kolom
//   Realisasi biasanya langsung sama dengan Pesanan saat diinput; selisih
//   diberi AlasanBedaRealisasi, retur diberi AlasanRetur ('0' = tidak ada).
// Penulisan pesanan baru SENGAJA belum ada: pembuatan ID/NoDokumen oleh
// ERP desktop belum dipetakan — lihat docs/audit/2026-11-22-audit-dashpmp.md.

export type KodeEsBalok = "pmputra" | "pmpersada" | "pmpakis";
export type TahapBalok = "belum" | "dijadwalkan" | "selesai" | "retur";

export interface PesananBalok {
  id: string;
  noDokumen: string;
  tanggal: string; // YYYY-MM-DD (tanggal kirim)
  status: string;
  agenId: string | null;
  agen: string;
  wilayah: string | null;
  pesanKecil: number;
  pesanBesar: number;
  realKecil: number;
  realBesar: number;
  returKecil: number;
  returBesar: number;
  hargaKecil: number;
  hargaBesar: number;
  alasanBeda: string | null;
  alasanRetur: string | null;
  catatan: string | null;
  noJadwal: string | null;
  kendaraanId: string | null;
  kendaraan: string | null;
  kendaraanMaks: number | null;
  diubahPada: string; // ISO — ModifiedDate apa adanya (naive, waktu server ERP)
  tahap: TahapBalok;
}

function angka(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function kodeAlasan(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s !== "0" ? s : null;
}

export function tahapPesananBalok(p: Pick<PesananBalok, "returKecil" | "returBesar" | "status" | "noJadwal">): TahapBalok {
  if (p.returKecil + p.returBesar > 0) return "retur";
  if (p.status === "3") return "selesai";
  if (!p.noJadwal) return "belum";
  return "dijadwalkan";
}

// Semua pesanan (aktif, tidak dihapus/void) untuk satu tanggal kirim.
export async function getPesananBalokHari(kode: KodeEsBalok, tanggalISO: string): Promise<PesananBalok[]> {
  const mulai = new Date(`${tanggalISO}T00:00:00Z`);
  const akhir = new Date(mulai);
  akhir.setUTCDate(akhir.getUTCDate() + 1);
  const pool = await getCompanyPool(kode, "utama");
  const result = await pool
    .request()
    .input("mulai", sql.DateTime, mulai)
    .input("akhir", sql.DateTime, akhir)
    .query(`
      SELECT p.PemesananID, p.NoDokumen, p.Tanggal, p.Status, p.AgenID, a.Nama AS Agen,
             COALESCE(wAlamat.Nama, wAgen.Nama) AS Wilayah,
             p.BalokKecilPesanan, p.BalokBesarPesanan, p.BalokKecilRealisasi, p.BalokBesarRealisasi,
             p.BalokKecilRetur, p.BalokBesarRetur, p.BalokKecilHarga, p.BalokBesarHarga,
             p.AlasanBedaRealisasi, p.AlasanRetur, p.Catatan, p.ModifiedDate,
             j.NoDokumen AS NoJadwal, j.DaftarKendaraanID, k.Nama AS Kendaraan, k.MaxQty
      FROM PMP_Pemesanan p
      LEFT JOIN PMP_Agen a ON a.AgenID = p.AgenID
      -- Wilayah: dari alamat kirim pesanan (AlamatID = AgenDetailID) bila ada,
      -- selain itu alamat pertama agen.
      OUTER APPLY (
        SELECT TOP 1 w.Nama FROM PMP_AgenDetail ad JOIN PMP_Wilayah w ON w.WilayahID = ad.RegionID
        WHERE ad.AgenDetailID = p.AlamatID
      ) wAlamat
      OUTER APPLY (
        SELECT TOP 1 w.Nama FROM PMP_AgenDetail ad JOIN PMP_Wilayah w ON w.WilayahID = ad.RegionID
        WHERE ad.AgenID = p.AgenID AND ISNULL(ad.IsDeleted, 0) = 0
      ) wAgen
      OUTER APPLY (
        SELECT TOP 1 jj.NoDokumen, jj.DaftarKendaraanID
        FROM PMP_PenjadwalanDetail d
        JOIN PMP_Penjadwalan jj ON jj.PenjadwalanID = d.PenjadwalanID AND ISNULL(jj.IsDeleted, 0) = 0
        WHERE d.PemesananID = p.PemesananID AND ISNULL(d.IsDeleted, 0) = 0
        ORDER BY d.ModifiedDate DESC
      ) j
      LEFT JOIN PMP_DaftarKendaraan k ON k.DaftarKendaraanID = j.DaftarKendaraanID
      WHERE ISNULL(p.IsDeleted, 0) = 0 AND ISNULL(p.IsVoid, 0) = 0
        AND p.Tanggal >= @mulai AND p.Tanggal < @akhir
      ORDER BY p.NoDokumen DESC
    `);

  return (result.recordset as Record<string, unknown>[]).map((r) => {
    const baris = {
      id: String(r.PemesananID),
      noDokumen: String(r.NoDokumen ?? ""),
      tanggal: tanggalISO,
      status: String(r.Status ?? "").trim(),
      agenId: (r.AgenID as string | null) ?? null,
      agen: String(r.Agen ?? "Mitra tidak diketahui").trim(),
      wilayah: r.Wilayah ? String(r.Wilayah).trim() : null,
      pesanKecil: angka(r.BalokKecilPesanan),
      pesanBesar: angka(r.BalokBesarPesanan),
      realKecil: angka(r.BalokKecilRealisasi),
      realBesar: angka(r.BalokBesarRealisasi),
      returKecil: angka(r.BalokKecilRetur),
      returBesar: angka(r.BalokBesarRetur),
      hargaKecil: angka(r.BalokKecilHarga),
      hargaBesar: angka(r.BalokBesarHarga),
      alasanBeda: kodeAlasan(r.AlasanBedaRealisasi),
      alasanRetur: kodeAlasan(r.AlasanRetur),
      catatan: r.Catatan ? String(r.Catatan).trim() || null : null,
      noJadwal: r.NoJadwal ? String(r.NoJadwal) : null,
      kendaraanId: (r.DaftarKendaraanID as string | null) ?? null,
      kendaraan: r.Kendaraan ? String(r.Kendaraan).trim() : null,
      kendaraanMaks: r.MaxQty != null ? angka(r.MaxQty) : null,
      diubahPada: new Date(r.ModifiedDate as Date).toISOString(),
    };
    return { ...baris, tahap: tahapPesananBalok(baris) };
  });
}
