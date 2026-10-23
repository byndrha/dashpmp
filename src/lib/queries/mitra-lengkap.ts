// Orkestrasi simpan form Mitra Es Kristal (identitas, alamat mitra, lokasi
// pengiriman ganda, kompetitor) — inti simpanMitraLengkapAction tanpa sesi,
// supaya bisa diuji dari skrip. Pemanggil (server action) yang menentukan
// userId, perusahaanKode, holdingKode, dan hak ubah NIK.
// Spec: docs/superpowers/specs/2026-10-23-mitra-identitas-lokasi-pengiriman-design.md §5, §8.
import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";
import {
  normalisasiMitraForm,
  PESAN_SIMPAN_SEBAGIAN,
  type MitraAlamatForm,
  type MitraAlamatTernormalisasi,
} from "@/lib/mitra-lokasi";
import { createMitra, updateMitra, type MitraInput } from "@/lib/queries/mitra";
import { setMitraLocation } from "@/lib/queries/mitra-location";
import { rapikan, simpanAlamatDanLokasiMitra } from "@/lib/queries/mitra-lokasi-pengiriman";
import { simpanIdentitasMitra, type IdentitasKunci } from "@/lib/queries/mitra-identitas";
import { listKompetitor, setKompetitorMitra } from "@/lib/queries/kompetitor";

export interface MitraLengkapInput extends MitraAlamatForm {
  // nama, gender (segmentasi), priceLevel, termOfPaymentId, capacity
  mitra: Omit<MitraInput, "mobileNo" | "address" | "wilayah" | "kecamatan">;
  namaPenanggungJawab: string | null;
  nik?: string | null; // hanya dikirim bila pengguna punya hak ubah
  kompetitorIds: number[];
}

export interface KonteksSimpanMitra {
  userId: string;
  perusahaanKode: string; // kode Es Kristal (currentEskristalKode())
  holdingKode: string;
  // false → NIK tidak disentuh sama sekali, apa pun isi input.nik.
  bolehUbahNik: boolean;
}

const SELISIH_KOORDINAT = 1e-7; // presisi kolom decimal(10,7)

/**
 * Tulis pin utama hanya bila berbeda dari yang tersimpan. Pin kosong di form
 * = lewati (pin lama TIDAK dihapus; form tidak punya tombol "hapus pin").
 * Pin yang sama tidak ditulis ulang supaya mitra yang disimpan tanpa
 * perubahan tidak mengubah DashboardMitraLocation sama sekali.
 */
async function tulisPinUtamaBilaBerubah(
  tx: sql.Transaction,
  bpId: string,
  utama: MitraAlamatTernormalisasi["utama"],
  userId: string
): Promise<void> {
  if (utama.latitude == null || utama.longitude == null) return;
  const res = await tx
    .request()
    .input("bpId", sql.VarChar(16), bpId)
    .query(`SELECT Latitude, Longitude, Alamat FROM DashboardMitraLocation WITH (UPDLOCK) WHERE BusinessPartnerID = @bpId`);
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
  await setMitraLocation(
    { businessPartnerId: bpId, latitude: utama.latitude, longitude: utama.longitude, alamat: geoAlamat, userId },
    tx
  );
}

/**
 * Urutan (brief Task 6):
 * 1. normalisasiMitraForm + validasi (nama, kompetitor milik holding ini).
 * 2. Satu transaksi MSSQL: create/updateMitra (kolom ERP = lokasi utama),
 *    pin utama (lewati bila kosong/tidak berubah), alamat mitra + lokasi
 *    tambahan. Commit.
 * 3. Postgres: identitas (NIK hanya bila bolehUbahNik) + kompetitor.
 * 4. Langkah 3 gagal setelah langkah 2 commit → AppError PESAN_SIMPAN_SEBAGIAN.
 * Mengembalikan BusinessPartnerID.
 */
export async function simpanMitraLengkap(
  id: string | null,
  input: MitraLengkapInput,
  k: KonteksSimpanMitra
): Promise<string> {
  // 1. Normalisasi & validasi — semua sebelum menulis apa pun.
  let n: MitraAlamatTernormalisasi;
  try {
    n = normalisasiMitraForm(input);
  } catch (err) {
    throw new AppError(err instanceof Error ? err.message : "Data alamat mitra tidak valid.");
  }
  const nama = input.mitra.name?.trim();
  if (!nama) throw new AppError("Nama mitra wajib diisi.");

  const kompetitorIds = [...new Set(input.kompetitorIds)];
  if (kompetitorIds.length > 0) {
    const milikHolding = new Set((await listKompetitor(k.holdingKode, "es_kristal")).map((x) => x.id));
    if (kompetitorIds.some((kid) => !milikHolding.has(kid))) {
      throw new AppError("Daftar kompetitor tidak valid. Muat ulang halaman lalu coba lagi.");
    }
  }

  const mitraInput: MitraInput = {
    ...input.mitra,
    name: nama,
    // Kolom ERP = lokasi utama (invarian spec §5); updateMitra tidak me-trim.
    address: rapikan(n.utama.alamat),
    wilayah: rapikan(n.utama.wilayah),
    kecamatan: rapikan(n.utama.kecamatan),
    mobileNo: rapikan(n.utama.kontak),
  };

  // 2. MSSQL — satu transaksi.
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  let bpId: string;
  try {
    if (id) {
      const ada = await tx
        .request()
        .input("id", sql.VarChar(16), id)
        .query(`SELECT 1 AS ok FROM BusinessPartner WITH (UPDLOCK) WHERE BusinessPartnerID = @id AND ISNULL(IsDeleted, 0) = 0`);
      if (ada.recordset.length === 0) throw new AppError("Mitra tidak ditemukan atau sudah dihapus.");
      await updateMitra(id, mitraInput, tx);
      bpId = id;
    } else {
      bpId = await createMitra(mitraInput, tx);
    }
    await tulisPinUtamaBilaBerubah(tx, bpId, n.utama, k.userId);
    await simpanAlamatDanLokasiMitra(tx, bpId, n, k.userId);
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }

  // 3. Postgres — identitas + kompetitor.
  const kunci: IdentitasKunci = { perusahaanKode: k.perusahaanKode, sumber: "utama", partnerId: bpId };
  try {
    await simpanIdentitasMitra(
      kunci,
      { namaPenanggungJawab: input.namaPenanggungJawab, nik: k.bolehUbahNik ? (input.nik ?? null) : undefined },
      k.userId
    );
    await setKompetitorMitra(kunci, kompetitorIds);
  } catch (err) {
    console.error("[simpanMitraLengkap] identitas/kompetitor gagal setelah MSSQL commit:", bpId, err);
    throw new AppError(PESAN_SIMPAN_SEBAGIAN);
  }
  return bpId;
}
