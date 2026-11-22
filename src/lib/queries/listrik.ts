import { getPgPool } from "@/lib/pg";
import { AppError } from "@/lib/action-result";
import {
  PENGATURAN_BAWAAN,
  slotDari,
  standTotal,
  type BacaanMeter,
  type PengaturanListrik,
  type SlotListrik,
  type SumberBacaan,
} from "@/lib/listrik";

// Modul Kelistrikan tahap 1 — tabel dibuat oleh scripts/create-listrik-tables.ts.

const angka = (v: string | null): number | null =>
  v == null ? null : Number(v);

export async function getPengaturanListrik(
  kode: string
): Promise<PengaturanListrik> {
  const { rows } = await getPgPool().query<{
    golongan: string | null;
    daya_kva: string | null;
    faktor_kali: string | null;
    harga_lwbp: string | null;
    faktor_k: string | null;
    jam_wbp_mulai: number;
    jam_wbp_selesai: number;
    register_terpisah: boolean;
    diubah_oleh_nama: string | null;
    diubah_at: Date | null;
  }>(`SELECT * FROM listrik_pengaturan WHERE perusahaan_kode = $1`, [kode]);
  const r = rows[0];
  if (!r) return PENGATURAN_BAWAAN;
  return {
    golongan: r.golongan,
    dayaKva: angka(r.daya_kva),
    faktorKali: angka(r.faktor_kali),
    hargaLwbp: angka(r.harga_lwbp),
    faktorK: angka(r.faktor_k),
    jamWbpMulai: r.jam_wbp_mulai,
    jamWbpSelesai: r.jam_wbp_selesai,
    registerTerpisah: r.register_terpisah,
    diubahOlehNama: r.diubah_oleh_nama,
    diubahAt: r.diubah_at?.toISOString() ?? null,
  };
}

export type InputPengaturanListrik = Omit<
  PengaturanListrik,
  "diubahOlehNama" | "diubahAt"
>;

export async function simpanPengaturanListrik(
  kode: string,
  p: InputPengaturanListrik,
  oleh: { akunId: string; nama: string }
): Promise<void> {
  await getPgPool().query(
    `INSERT INTO listrik_pengaturan (perusahaan_kode, golongan, daya_kva, faktor_kali, harga_lwbp, faktor_k,
        jam_wbp_mulai, jam_wbp_selesai, register_terpisah, diubah_oleh_akun_id, diubah_oleh_nama, diubah_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
     ON CONFLICT (perusahaan_kode) DO UPDATE SET
       golongan = EXCLUDED.golongan, daya_kva = EXCLUDED.daya_kva, faktor_kali = EXCLUDED.faktor_kali,
       harga_lwbp = EXCLUDED.harga_lwbp, faktor_k = EXCLUDED.faktor_k, jam_wbp_mulai = EXCLUDED.jam_wbp_mulai,
       jam_wbp_selesai = EXCLUDED.jam_wbp_selesai, register_terpisah = EXCLUDED.register_terpisah,
       diubah_oleh_akun_id = EXCLUDED.diubah_oleh_akun_id, diubah_oleh_nama = EXCLUDED.diubah_oleh_nama,
       diubah_at = now()`,
    [
      kode,
      p.golongan,
      p.dayaKva,
      p.faktorKali,
      p.hargaLwbp,
      p.faktorK,
      p.jamWbpMulai,
      p.jamWbpSelesai,
      p.registerTerpisah,
      oleh.akunId,
      oleh.nama,
    ]
  );
}

interface BarisBacaan {
  id: string;
  waktu: Date;
  slot: SlotListrik;
  kwh_total: string | null;
  kwh_lwbp: string | null;
  kwh_wbp: string | null;
  kvarh: string | null;
  foto_path: string | null;
  sumber: SumberBacaan;
  catatan: string | null;
  dicatat_oleh_nama: string;
}

function keBacaan(r: BarisBacaan): BacaanMeter {
  return {
    id: r.id,
    waktu: r.waktu.toISOString(),
    slot: r.slot,
    kwhTotal: angka(r.kwh_total),
    kwhLwbp: angka(r.kwh_lwbp),
    kwhWbp: angka(r.kwh_wbp),
    kvarh: angka(r.kvarh),
    fotoPath: r.foto_path,
    sumber: r.sumber,
    catatan: r.catatan,
    olehNama: r.dicatat_oleh_nama,
  };
}

const KOLOM_BACAAN = `id::text AS id, waktu, slot, kwh_total, kwh_lwbp, kwh_wbp, kvarh, foto_path, sumber, catatan, dicatat_oleh_nama`;

/** Pembacaan aktif (tidak dibatalkan) sejak `sejak`, terbaru dulu. */
export async function getBacaanMeter(
  kode: string,
  sejak: Date
): Promise<BacaanMeter[]> {
  const { rows } = await getPgPool().query<BarisBacaan>(
    `SELECT ${KOLOM_BACAAN} FROM listrik_bacaan_meter
      WHERE perusahaan_kode = $1 AND dibatalkan_at IS NULL AND waktu >= $2
      ORDER BY waktu DESC`,
    [kode, sejak]
  );
  return rows.map(keBacaan);
}

/** Waktu pembacaan aktif pertama (awal pencatatan), ISO; null bila belum ada. */
export async function getWaktuBacaanPertama(
  kode: string
): Promise<string | null> {
  const { rows } = await getPgPool().query<{ w: Date | null }>(
    `SELECT min(waktu) AS w FROM listrik_bacaan_meter WHERE perusahaan_kode = $1 AND dibatalkan_at IS NULL`,
    [kode]
  );
  return rows[0]?.w?.toISOString() ?? null;
}

export async function getBacaanTerakhir(
  kode: string
): Promise<BacaanMeter | null> {
  const { rows } = await getPgPool().query<BarisBacaan>(
    `SELECT ${KOLOM_BACAAN} FROM listrik_bacaan_meter
      WHERE perusahaan_kode = $1 AND dibatalkan_at IS NULL
      ORDER BY waktu DESC LIMIT 1`,
    [kode]
  );
  return rows[0] ? keBacaan(rows[0]) : null;
}

export interface InputBacaanMeter {
  kwhTotal: number | null;
  kwhLwbp: number | null;
  kwhWbp: number | null;
  kvarh: number | null;
  fotoPath: string | null;
  fotoLat: number | null;
  fotoLng: number | null;
  catatan: string | null;
  sumber: SumberBacaan;
}

/**
 * Simpan pembacaan. Waktu = jam server (bukan jam perangkat) supaya slot
 * 17.00/22.00 tidak bisa dipalsukan. Stand tidak boleh lebih kecil dari
 * pembacaan aktif sebelumnya (register meter tidak pernah turun).
 */
export async function catatBacaanMeter(
  kode: string,
  input: InputBacaanMeter,
  oleh: { akunId: string; nama: string }
): Promise<{ id: string; slot: SlotListrik }> {
  const pengaturan = await getPengaturanListrik(kode);
  const terakhir = await getBacaanTerakhir(kode);
  const baru = standTotal(input);
  if (baru == null) throw new AppError("Angka stand meter wajib diisi.");
  if (terakhir) {
    const lama = standTotal(terakhir);
    if (lama != null && baru < lama) {
      throw new AppError(
        `Stand ${baru.toLocaleString(
          "id-ID"
        )} lebih kecil dari pembacaan terakhir (${lama.toLocaleString(
          "id-ID"
        )}). Periksa kembali angka di meter.`
      );
    }
    for (const [label, a, b] of [
      ["LWBP", input.kwhLwbp, terakhir.kwhLwbp],
      ["WBP", input.kwhWbp, terakhir.kwhWbp],
      ["kVArh", input.kvarh, terakhir.kvarh],
    ] as const) {
      if (a != null && b != null && a < b) {
        throw new AppError(
          `Stand ${label} ${a.toLocaleString(
            "id-ID"
          )} lebih kecil dari pembacaan terakhir (${b.toLocaleString(
            "id-ID"
          )}).`
        );
      }
    }
  }
  const sekarang = new Date();
  const slot = slotDari(sekarang, pengaturan);
  const { rows } = await getPgPool().query<{ id: string }>(
    `INSERT INTO listrik_bacaan_meter (perusahaan_kode, waktu, slot, kwh_total, kwh_lwbp, kwh_wbp, kvarh,
        foto_path, foto_lat, foto_lng, sumber, catatan, dicatat_oleh_akun_id, dicatat_oleh_nama)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id::text AS id`,
    [
      kode,
      sekarang,
      slot,
      input.kwhTotal,
      input.kwhLwbp,
      input.kwhWbp,
      input.kvarh,
      input.fotoPath,
      input.fotoLat,
      input.fotoLng,
      input.sumber,
      input.catatan,
      oleh.akunId,
      oleh.nama,
    ]
  );
  return { id: rows[0].id, slot };
}

export async function batalkanBacaanMeter(
  kode: string,
  id: string,
  alasan: string,
  olehNama: string
): Promise<void> {
  const { rowCount } = await getPgPool().query(
    `UPDATE listrik_bacaan_meter SET dibatalkan_at = now(), dibatalkan_oleh_nama = $3, alasan_batal = $4
      WHERE perusahaan_kode = $1 AND id = $2 AND dibatalkan_at IS NULL`,
    [kode, id, olehNama, alasan]
  );
  if (!rowCount)
    throw new AppError("Pembacaan tidak ditemukan atau sudah dibatalkan.");
}
