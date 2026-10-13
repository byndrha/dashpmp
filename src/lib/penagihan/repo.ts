import { getPgPool } from "@/lib/pg";
import { AppError } from "@/lib/action-result";
import { normalizePhone } from "@/lib/bychat/phone";
import { JEDA_AUTOPAUSE_MENIT, MAKS_GAGAL_BERUNTUN, PENGATURAN_AWAL, validasiPengaturan, type Kandidat, type Pengaturan } from "@/lib/penagihan/logika";

// Akses Postgres untuk penagihan otomatis: pengaturan, ronde, antrean, opt-out.

export interface PengaturanLengkap extends Pengaturan {
  jedaSampai: Date | null;
  gagalBeruntun: number;
  tersimpan: boolean;
}

export async function getPengaturan(perusahaanId: number): Promise<PengaturanLengkap> {
  const r = await getPgPool().query(`SELECT * FROM penagihan_pengaturan WHERE perusahaan_id = $1`, [perusahaanId]);
  const x = r.rows[0];
  if (!x) return { ...PENGATURAN_AWAL, jedaSampai: null, gagalBeruntun: 0, tersimpan: false };
  return {
    hari: (x.hari as number[]).map(Number),
    jamMulai: x.jam_mulai,
    jamSelesai: x.jam_selesai,
    jedaMinDtk: x.jeda_min_dtk,
    jedaMaksDtk: x.jeda_maks_dtk,
    jedaPanjangTiap: x.jeda_panjang_tiap,
    jedaPanjangDtk: x.jeda_panjang_dtk,
    batasHarian: x.batas_harian,
    minHariLewat: x.min_hari_lewat,
    minPiutang: Number(x.min_piutang),
    ulangHari: x.ulang_hari,
    mode: x.mode,
    jedaSampai: x.jeda_sampai ? new Date(x.jeda_sampai) : null,
    gagalBeruntun: x.gagal_beruntun,
    tersimpan: true,
  };
}

export async function simpanPengaturan(perusahaanId: number, input: Partial<Pengaturan>, oleh: string): Promise<Pengaturan> {
  const v = validasiPengaturan(input);
  if (!v.ok) throw new AppError(v.galat);
  const p = v.nilai;
  await getPgPool().query(
    `INSERT INTO penagihan_pengaturan
       (perusahaan_id, hari, jam_mulai, jam_selesai, jeda_min_dtk, jeda_maks_dtk, jeda_panjang_tiap, jeda_panjang_dtk,
        batas_harian, min_hari_lewat, min_piutang, ulang_hari, mode, updated_oleh)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (perusahaan_id) DO UPDATE SET
       hari=$2, jam_mulai=$3, jam_selesai=$4, jeda_min_dtk=$5, jeda_maks_dtk=$6, jeda_panjang_tiap=$7, jeda_panjang_dtk=$8,
       batas_harian=$9, min_hari_lewat=$10, min_piutang=$11, ulang_hari=$12, mode=$13, updated_oleh=$14, updated_at=now()`,
    [perusahaanId, p.hari, p.jamMulai, p.jamSelesai, p.jedaMinDtk, p.jedaMaksDtk, p.jedaPanjangTiap, p.jedaPanjangDtk, p.batasHarian, p.minHariLewat, p.minPiutang, p.ulangHari, p.mode, oleh]
  );
  return p;
}

export async function lepasJeda(perusahaanId: number): Promise<void> {
  await getPgPool().query(`UPDATE penagihan_pengaturan SET jeda_sampai = NULL, gagal_beruntun = 0 WHERE perusahaan_id = $1`, [perusahaanId]);
}

// Hitung hasil satu pengiriman: sukses mereset hitungan; gagal beruntun >= batas -> auto-pause.
export async function catatHasilKirim(perusahaanId: number, sukses: boolean): Promise<{ autoPause: boolean }> {
  const pg = getPgPool();
  await pg.query(
    `INSERT INTO penagihan_pengaturan (perusahaan_id, hari, jam_mulai, jam_selesai, jeda_min_dtk, jeda_maks_dtk, jeda_panjang_tiap, jeda_panjang_dtk, batas_harian, min_hari_lewat, min_piutang, ulang_hari, mode)
     SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
     WHERE NOT EXISTS (SELECT 1 FROM penagihan_pengaturan WHERE perusahaan_id = $1)`,
    [perusahaanId, PENGATURAN_AWAL.hari, PENGATURAN_AWAL.jamMulai, PENGATURAN_AWAL.jamSelesai, PENGATURAN_AWAL.jedaMinDtk, PENGATURAN_AWAL.jedaMaksDtk, PENGATURAN_AWAL.jedaPanjangTiap, PENGATURAN_AWAL.jedaPanjangDtk, PENGATURAN_AWAL.batasHarian, PENGATURAN_AWAL.minHariLewat, PENGATURAN_AWAL.minPiutang, PENGATURAN_AWAL.ulangHari, PENGATURAN_AWAL.mode]
  );
  if (sukses) {
    await pg.query(`UPDATE penagihan_pengaturan SET gagal_beruntun = 0 WHERE perusahaan_id = $1`, [perusahaanId]);
    return { autoPause: false };
  }
  const r = await pg.query(
    `UPDATE penagihan_pengaturan
     SET gagal_beruntun = gagal_beruntun + 1,
         jeda_sampai = CASE WHEN gagal_beruntun + 1 >= $2 THEN now() + ($3 || ' minutes')::interval ELSE jeda_sampai END
     WHERE perusahaan_id = $1 RETURNING gagal_beruntun`,
    [perusahaanId, MAKS_GAGAL_BERUNTUN, String(JEDA_AUTOPAUSE_MENIT)]
  );
  return { autoPause: (r.rows[0]?.gagal_beruntun ?? 0) >= MAKS_GAGAL_BERUNTUN };
}

// ----------------------------------------------------------------- ronde & antrean

export interface RondeRow {
  id: number;
  tanggal: string;
  status: "pratinjau" | "berjalan" | "selesai" | "dibatalkan";
  dibuatPada: Date;
  disetujuiOleh: string | null;
  jumlah: number;
}

const rondeDari = (x: Record<string, unknown>): RondeRow => ({
  id: Number(x.id),
  tanggal: new Date(x.tanggal as string).toISOString().slice(0, 10),
  status: x.status as RondeRow["status"],
  dibuatPada: new Date(x.dibuat_pada as string),
  disetujuiOleh: (x.disetujui_oleh as string | null) ?? null,
  jumlah: Number(x.jumlah),
});

export async function getRonde(perusahaanId: number, tanggal: string): Promise<RondeRow | null> {
  const r = await getPgPool().query(
    `SELECT id, tanggal::text AS tanggal, status, dibuat_pada, disetujui_oleh, jumlah FROM penagihan_ronde WHERE perusahaan_id = $1 AND tanggal = $2`,
    [perusahaanId, tanggal]
  );
  return r.rows[0] ? rondeDari(r.rows[0]) : null;
}

export interface BarisDilewati {
  mitraId: string;
  nama: string;
  alasan: string;
}

// Satu transaksi: ronde + semua baris antrean (terjadwal & dilewati). UNIQUE
// (perusahaan_id, tanggal) mencegah dua tick membuat ronde ganda (yang kalah → null).
export async function buatRonde(p: {
  perusahaanId: number;
  tanggal: string;
  status: "pratinjau" | "berjalan";
  terjadwal: { kandidat: Kandidat; jadwal: Date }[];
  tertunda: Kandidat[]; // lolos kriteria tetapi jadwalnya melewati jam selesai
  dilewati: BarisDilewati[];
}): Promise<RondeRow | null> {
  const client = await getPgPool().connect();
  try {
    await client.query("BEGIN");
    const ins = await client.query(
      `INSERT INTO penagihan_ronde (perusahaan_id, tanggal, status, jumlah) VALUES ($1,$2,$3,$4)
       ON CONFLICT (perusahaan_id, tanggal) DO NOTHING RETURNING id, tanggal::text AS tanggal, status, dibuat_pada, disetujui_oleh, jumlah`,
      [p.perusahaanId, p.tanggal, p.status, p.terjadwal.length]
    );
    if (ins.rows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const rondeId = Number(ins.rows[0].id);
    for (const { kandidat: k, jadwal } of p.terjadwal) {
      await client.query(
        `INSERT INTO penagihan_antrean (ronde_id, perusahaan_id, mitra_id, mitra_nama, nomor, total_piutang, jumlah_faktur, hari_lewat_maks, jadwal_rencana, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'menunggu')`,
        [rondeId, p.perusahaanId, k.mitraId, k.nama, k.nomor, k.total, k.jumlahFaktur, k.hariLewatMaks, jadwal]
      );
    }
    for (const k of p.tertunda) {
      await client.query(
        `INSERT INTO penagihan_antrean (ronde_id, perusahaan_id, mitra_id, mitra_nama, nomor, total_piutang, jumlah_faktur, hari_lewat_maks, status, alasan)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'dilewati','Jadwal melewati jam selesai; ditagih pada ronde berikutnya')`,
        [rondeId, p.perusahaanId, k.mitraId, k.nama, k.nomor, k.total, k.jumlahFaktur, k.hariLewatMaks]
      );
    }
    for (const d of p.dilewati) {
      await client.query(
        `INSERT INTO penagihan_antrean (ronde_id, perusahaan_id, mitra_id, mitra_nama, status, alasan) VALUES ($1,$2,$3,$4,'dilewati',$5)
         ON CONFLICT (ronde_id, mitra_id) DO NOTHING`,
        [rondeId, p.perusahaanId, d.mitraId, d.nama, d.alasan]
      );
    }
    await client.query("COMMIT");
    return rondeDari(ins.rows[0]);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export interface AntreanRow {
  id: number;
  mitraId: string;
  mitraNama: string;
  nomor: string | null;
  totalPiutang: number;
  jumlahFaktur: number;
  hariLewatMaks: number;
  jadwalRencana: Date | null;
  status: "menunggu" | "terkirim" | "dilewati" | "gagal" | "dibatalkan";
  alasan: string | null;
  messageId: number | null;
  diprosesPada: Date | null;
  statusPesan: string | null;
}

const antreanDari = (x: Record<string, unknown>): AntreanRow => ({
  id: Number(x.id),
  mitraId: x.mitra_id as string,
  mitraNama: x.mitra_nama as string,
  nomor: (x.nomor as string | null) ?? null,
  totalPiutang: Number(x.total_piutang),
  jumlahFaktur: Number(x.jumlah_faktur),
  hariLewatMaks: Number(x.hari_lewat_maks),
  jadwalRencana: x.jadwal_rencana ? new Date(x.jadwal_rencana as string) : null,
  status: x.status as AntreanRow["status"],
  alasan: (x.alasan as string | null) ?? null,
  messageId: x.message_id == null ? null : Number(x.message_id),
  diprosesPada: x.diproses_pada ? new Date(x.diproses_pada as string) : null,
  statusPesan: (x.status_pesan as string | null) ?? null,
});

export async function listAntrean(rondeId: number): Promise<AntreanRow[]> {
  const r = await getPgPool().query(
    `SELECT * FROM penagihan_antrean WHERE ronde_id = $1 ORDER BY (jadwal_rencana IS NULL), jadwal_rencana, id`,
    [rondeId]
  );
  return r.rows.map(antreanDari);
}

export async function listRiwayat(perusahaanId: number, limit = 100): Promise<(AntreanRow & { tanggalRonde: string })[]> {
  const r = await getPgPool().query(
    `SELECT a.*, r.tanggal::text AS tanggal_ronde FROM penagihan_antrean a JOIN penagihan_ronde r ON r.id = a.ronde_id
     WHERE a.perusahaan_id = $1 AND a.status IN ('terkirim','gagal') ORDER BY a.diproses_pada DESC NULLS LAST LIMIT $2`,
    [perusahaanId, limit]
  );
  return r.rows.map((x) => ({ ...antreanDari(x), tanggalRonde: x.tanggal_ronde as string }));
}

// Ambil baris yang jadwalnya tiba pada ronde BERJALAN dan "klaim" (diproses_pada)
// agar tick yang tumpang-tindih tidak memprosesnya dua kali (klaim basi 10 menit dilepas).
export async function klaimJatuhTempo(perusahaanId: number, sekarang: Date, batas: number): Promise<AntreanRow[]> {
  const r = await getPgPool().query(
    `UPDATE penagihan_antrean SET diproses_pada = $2
     WHERE id IN (
       SELECT a.id FROM penagihan_antrean a JOIN penagihan_ronde r ON r.id = a.ronde_id
       WHERE a.perusahaan_id = $1 AND r.status = 'berjalan' AND a.status = 'menunggu' AND a.jadwal_rencana <= $2
         AND (a.diproses_pada IS NULL OR a.diproses_pada < $2::timestamptz - interval '10 minutes')
       ORDER BY a.jadwal_rencana LIMIT $3 FOR UPDATE OF a SKIP LOCKED
     ) RETURNING *`,
    [perusahaanId, sekarang, batas]
  );
  return r.rows.map(antreanDari);
}

export async function tandaiAntrean(id: number, status: "terkirim" | "dilewati" | "gagal", alasan: string | null, messageId: number | null = null, conversationId: number | null = null): Promise<void> {
  await getPgPool().query(
    `UPDATE penagihan_antrean SET status = $2, alasan = $3, message_id = $4, conversation_id = $5, diproses_pada = now() WHERE id = $1`,
    [id, status, alasan, messageId, conversationId]
  );
}

// Ronde selesai bila tak ada lagi baris 'menunggu'.
export async function selesaikanRondeBilaHabis(rondeId: number): Promise<void> {
  await getPgPool().query(
    `UPDATE penagihan_ronde SET status = 'selesai'
     WHERE id = $1 AND status = 'berjalan' AND NOT EXISTS (SELECT 1 FROM penagihan_antrean WHERE ronde_id = $1 AND status = 'menunggu')`,
    [rondeId]
  );
}

export async function setujuiRonde(perusahaanId: number, rondeId: number, oleh: string): Promise<void> {
  const r = await getPgPool().query(
    `UPDATE penagihan_ronde SET status = 'berjalan', disetujui_oleh = $3, disetujui_pada = now()
     WHERE id = $2 AND perusahaan_id = $1 AND status = 'pratinjau'`,
    [perusahaanId, rondeId, oleh]
  );
  if (r.rowCount === 0) throw new AppError("Ronde tidak ditemukan atau sudah tidak berstatus pratinjau.");
}

export async function batalkanRonde(perusahaanId: number, rondeId: number): Promise<void> {
  const pg = getPgPool();
  const r = await pg.query(
    `UPDATE penagihan_ronde SET status = 'dibatalkan' WHERE id = $2 AND perusahaan_id = $1 AND status IN ('pratinjau','berjalan')`,
    [perusahaanId, rondeId]
  );
  if (r.rowCount === 0) throw new AppError("Ronde tidak ditemukan atau sudah selesai/dibatalkan.");
  await pg.query(`UPDATE penagihan_antrean SET status = 'dibatalkan', alasan = 'Ronde dibatalkan' WHERE ronde_id = $1 AND status = 'menunggu'`, [rondeId]);
}

export async function terakhirDitagih(ptKode: string): Promise<Map<string, Date>> {
  const r = await getPgPool().query(
    `SELECT mitra_id, MAX(created_at) AS t FROM bychat_kirim_audit WHERE perusahaan_kode = $1 AND status IN ('terkirim','replay') GROUP BY mitra_id`,
    [ptKode]
  );
  return new Map(r.rows.map((x) => [x.mitra_id as string, new Date(x.t as string)]));
}

// ----------------------------------------------------------------- opt-out

export interface OptoutRow {
  id: number;
  nomor: string;
  alasan: string | null;
  sumber: string;
  dicatatOleh: string | null;
  createdAt: Date;
}

export async function listOptout(perusahaanId: number): Promise<OptoutRow[]> {
  const r = await getPgPool().query(`SELECT * FROM penagihan_optout WHERE perusahaan_id = $1 ORDER BY created_at DESC`, [perusahaanId]);
  return r.rows.map((x) => ({
    id: Number(x.id), nomor: x.nomor, alasan: x.alasan, sumber: x.sumber, dicatatOleh: x.dicatat_oleh, createdAt: new Date(x.created_at),
  }));
}

export async function setOptout(perusahaanId: number): Promise<Set<string>> {
  const r = await getPgPool().query(`SELECT nomor FROM penagihan_optout WHERE perusahaan_id = $1`, [perusahaanId]);
  return new Set(r.rows.map((x) => x.nomor as string));
}

export async function tambahOptout(perusahaanId: number, nomorMentah: string, alasan: string | null, oleh: string, sumber = "manual"): Promise<void> {
  const nomor = normalizePhone(nomorMentah);
  if (!nomor) throw new AppError("Nomor tidak valid (gunakan nomor Indonesia, mis. 0812… atau +62812…).");
  await getPgPool().query(
    `INSERT INTO penagihan_optout (perusahaan_id, nomor, alasan, sumber, dicatat_oleh) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (perusahaan_id, nomor) DO NOTHING`,
    [perusahaanId, nomor, alasan, sumber, oleh]
  );
}

export async function hapusOptout(perusahaanId: number, id: number): Promise<void> {
  await getPgPool().query(`DELETE FROM penagihan_optout WHERE id = $1 AND perusahaan_id = $2`, [id, perusahaanId]);
}

// Ronde hari-hari sebelumnya yang masih menyisakan antrean dibatalkan (kedaluwarsa).
export async function kedaluwarsakanRondeLama(perusahaanId: number, tanggalHariIni: string): Promise<void> {
  const pg = getPgPool();
  await pg.query(
    `UPDATE penagihan_antrean SET status = 'dibatalkan', alasan = 'Kedaluwarsa (hari sudah berganti)'
     WHERE perusahaan_id = $1 AND status = 'menunggu' AND ronde_id IN (SELECT id FROM penagihan_ronde WHERE perusahaan_id = $1 AND tanggal < $2)`,
    [perusahaanId, tanggalHariIni]
  );
  await pg.query(
    `UPDATE penagihan_ronde SET status = 'selesai' WHERE perusahaan_id = $1 AND tanggal < $2 AND status IN ('berjalan','pratinjau')`,
    [perusahaanId, tanggalHariIni]
  );
}

export interface KoneksiPenagihan {
  perusahaanId: number;
  bychatAccountId: number;
  penagihanAktif: boolean;
}

export async function getPenagihanAktif(perusahaanId: number): Promise<boolean> {
  const r = await getPgPool().query(`SELECT penagihan_aktif FROM perusahaan_bychat_koneksi WHERE perusahaan_id = $1`, [perusahaanId]);
  return r.rows[0]?.penagihan_aktif === true;
}

export async function setPenagihanAktif(perusahaanId: number, aktif: boolean): Promise<void> {
  const r = await getPgPool().query(`UPDATE perusahaan_bychat_koneksi SET penagihan_aktif = $2, updated_at = now() WHERE perusahaan_id = $1`, [perusahaanId, aktif]);
  if (r.rowCount === 0) throw new AppError("Simpan dulu koneksi ByChat PT ini sebelum mengaktifkan penagihan otomatis.");
}

export async function listPenagihanAktif(): Promise<KoneksiPenagihan[]> {
  const r = await getPgPool().query(
    `SELECT perusahaan_id, bychat_account_id FROM perusahaan_bychat_koneksi WHERE aktif = TRUE AND penagihan_aktif = TRUE ORDER BY perusahaan_id`
  );
  return r.rows.map((x) => ({ perusahaanId: x.perusahaan_id, bychatAccountId: x.bychat_account_id, penagihanAktif: true }));
}

// Setelah persetujuan, jadwal disusun ulang dari saat ini agar jeda antar pesan
// tetap terjaga walau petugas menyetujui jauh setelah ronde disusun.
export async function jadwalUlangAntrean(rondeId: number, jadwal: Date[]): Promise<void> {
  const pg = getPgPool();
  const r = await pg.query(`SELECT id FROM penagihan_antrean WHERE ronde_id = $1 AND status = 'menunggu' ORDER BY jadwal_rencana, id`, [rondeId]);
  for (let i = 0; i < r.rows.length; i++) {
    const id = r.rows[i].id;
    if (i < jadwal.length) await pg.query(`UPDATE penagihan_antrean SET jadwal_rencana = $2 WHERE id = $1`, [id, jadwal[i]]);
    else await pg.query(`UPDATE penagihan_antrean SET status = 'dilewati', alasan = 'Jadwal melewati jam selesai; ditagih pada ronde berikutnya' WHERE id = $1`, [id]);
  }
}

// ----------------------------------------------------------------- status pesan

export interface PerluCek {
  id: number;
  mitraId: string;
  conversationId: number;
  messageId: number;
  jumlahCek: number;
}

// Pengecekan ke-1 setelah 45 dtk, ke-2 setelah 10 mnt, ke-3 setelah 60 mnt dari
// pengecekan sebelumnya; selesai bila delivered/read/failed atau tiga kali cek.
export async function listPerluCekStatus(perusahaanId: number, sekarang: Date, limit = 10): Promise<PerluCek[]> {
  const r = await getPgPool().query(
    `SELECT id, mitra_id, conversation_id, message_id, status_cek_jumlah FROM penagihan_antrean
     WHERE perusahaan_id = $1 AND status = 'terkirim' AND message_id IS NOT NULL AND conversation_id IS NOT NULL
       AND (status_pesan IS NULL OR status_pesan = 'sent') AND status_cek_jumlah < 3
       AND (
         (status_cek_jumlah = 0 AND diproses_pada <= $2::timestamptz - interval '45 seconds') OR
         (status_cek_jumlah = 1 AND status_cek_pada <= $2::timestamptz - interval '10 minutes') OR
         (status_cek_jumlah = 2 AND status_cek_pada <= $2::timestamptz - interval '60 minutes')
       )
     ORDER BY diproses_pada LIMIT $3`,
    [perusahaanId, sekarang, limit]
  );
  return r.rows.map((x) => ({ id: Number(x.id), mitraId: x.mitra_id, conversationId: x.conversation_id, messageId: x.message_id, jumlahCek: x.status_cek_jumlah }));
}

export async function catatCekStatus(id: number, jumlahCekSebelum: number, status: string, galat: string | null): Promise<void> {
  const akhir = jumlahCekSebelum + 1 >= 3 && (status === "sent" || status === "tidak_ditemukan");
  const nilai = akhir ? "tidak_terkonfirmasi" : status === "tidak_ditemukan" ? "sent" : status;
  await getPgPool().query(
    `UPDATE penagihan_antrean SET status_pesan = $2, status_cek_jumlah = status_cek_jumlah + 1, status_cek_pada = now(),
       status = CASE WHEN $2 = 'failed' THEN 'gagal' ELSE status END,
       alasan = CASE WHEN $2 = 'failed' THEN $3 ELSE alasan END
     WHERE id = $1`,
    [id, nilai, galat ? `WhatsApp gagal: ${galat}` : "WhatsApp gagal (tanpa keterangan)"]
  );
}
