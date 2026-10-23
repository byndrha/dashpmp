// Identitas mitra (penanggung jawab, NIK, berkas NIK & SK) — Postgres direktori.
// Spec: docs/superpowers/specs/2026-10-23-mitra-identitas-lokasi-pengiriman-design.md §6.3, §6.4, §7.
//
// NIK + seluruh info berkas SENSITIF. Fungsi di sini tidak membaca sesi:
// pemanggil menentukan `bolehLihat` lewat aksesIdentitasMitra(user). Tanpa
// izin, kolom sensitif bahkan tidak di-SELECT. ID berkas mentah hanya keluar
// lewat getBerkasIdentitas(), khusus untuk rute baca berkas privat.
import { getPgPool } from "@/lib/pg";

export interface IdentitasKunci {
  perusahaanKode: string;
  sumber: "utama" | "logistik";
  partnerId: string;
}

export interface IdentitasMitra {
  namaPenanggungJawab: string | null;
  nik: string | null;
  punyaBerkasNik: boolean;
  punyaBerkasSk: boolean;
  nikNamaFile: string | null;
  nikMime: string | null;
  skNamaFile: string | null;
  skMime: string | null;
  tanggalPendaftaran: string | null; // YYYY-MM-DD
}

function rapikan(s: string | null | undefined): string | null {
  const v = s?.trim();
  return v ? v : null;
}

const KUNCI_WHERE = "perusahaan_kode = $1 AND sumber = $2 AND partner_id = $3";
const kunciParams = (k: IdentitasKunci) => [k.perusahaanKode, k.sumber, k.partnerId];

/** bolehLihat=false → nik null, tanpa info berkas (kolomnya tidak di-SELECT sama sekali). */
export async function getIdentitasMitra(k: IdentitasKunci, bolehLihat: boolean): Promise<IdentitasMitra> {
  const pg = getPgPool();
  const kolomSensitif = bolehLihat
    ? `, nik, (nik_file_id IS NOT NULL) AS punya_berkas_nik, (sk_file_id IS NOT NULL) AS punya_berkas_sk,
       nik_file_nama, nik_file_mime, sk_file_nama, sk_file_mime`
    : "";
  const { rows } = await pg.query(
    `SELECT nama_penanggung_jawab, to_char(tanggal_pendaftaran, 'YYYY-MM-DD') AS tanggal_pendaftaran${kolomSensitif}
     FROM mitra_identitas WHERE ${KUNCI_WHERE}`,
    kunciParams(k)
  );
  const r = rows[0] as
    | { nama_penanggung_jawab: string | null; tanggal_pendaftaran: string | null; nik?: string | null;
        punya_berkas_nik?: boolean; punya_berkas_sk?: boolean; nik_file_nama?: string | null;
        nik_file_mime?: string | null; sk_file_nama?: string | null; sk_file_mime?: string | null }
    | undefined;
  return {
    namaPenanggungJawab: r?.nama_penanggung_jawab ?? null,
    nik: bolehLihat ? (r?.nik ?? null) : null,
    punyaBerkasNik: bolehLihat ? Boolean(r?.punya_berkas_nik) : false,
    punyaBerkasSk: bolehLihat ? Boolean(r?.punya_berkas_sk) : false,
    nikNamaFile: bolehLihat ? (r?.nik_file_nama ?? null) : null,
    nikMime: bolehLihat ? (r?.nik_file_mime ?? null) : null,
    skNamaFile: bolehLihat ? (r?.sk_file_nama ?? null) : null,
    skMime: bolehLihat ? (r?.sk_file_mime ?? null) : null,
    tanggalPendaftaran: r?.tanggal_pendaftaran ?? null,
  };
}

/** partner_id → nama penanggung jawab (tidak sensitif), untuk daftar mitra. */
export async function getPenanggungJawabMap(perusahaanKode: string, sumber: "utama" | "logistik"): Promise<Map<string, string>> {
  const { rows } = await getPgPool().query<{ partner_id: string; nama_penanggung_jawab: string }>(
    `SELECT partner_id, nama_penanggung_jawab FROM mitra_identitas
     WHERE perusahaan_kode = $1 AND sumber = $2 AND nama_penanggung_jawab IS NOT NULL`,
    [perusahaanKode, sumber]
  );
  return new Map(rows.map((r) => [r.partner_id, r.nama_penanggung_jawab]));
}

/** `nik` undefined = kolom NIK tidak disentuh (mis. pengguna tanpa izin ubah NIK). */
export async function simpanIdentitasMitra(
  k: IdentitasKunci,
  v: { namaPenanggungJawab: string | null; nik?: string | null },
  userId: string
): Promise<void> {
  const sentuhNik = v.nik !== undefined;
  const params = [...kunciParams(k), rapikan(v.namaPenanggungJawab), userId];
  if (sentuhNik) params.push(rapikan(v.nik));
  await getPgPool().query(
    `INSERT INTO mitra_identitas (perusahaan_kode, sumber, partner_id, nama_penanggung_jawab, updated_by, updated_at${sentuhNik ? ", nik" : ""})
     VALUES ($1, $2, $3, $4, $5, now()${sentuhNik ? ", $6" : ""})
     ON CONFLICT (perusahaan_kode, sumber, partner_id) DO UPDATE SET
       nama_penanggung_jawab = EXCLUDED.nama_penanggung_jawab,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()${sentuhNik ? ", nik = EXCLUDED.nik" : ""}`,
    params
  );
}

// Nama kolom per jenis berkas — daftar tetap, bukan dari input pengguna.
const KOLOM_BERKAS = {
  nik: { id: "nik_file_id", nama: "nik_file_nama", mime: "nik_file_mime" },
  sk: { id: "sk_file_id", nama: "sk_file_nama", mime: "sk_file_mime" },
} as const;

/**
 * Pasang/ganti/kosongkan berkas (berkas null = kosongkan). Mengembalikan
 * file ID lama supaya pemanggil bisa menghapusnya dari Google Drive.
 */
export async function setBerkasIdentitas(
  k: IdentitasKunci,
  jenis: "nik" | "sk",
  berkas: { fileId: string; nama: string; mime: string } | null,
  userId: string
): Promise<{ fileIdLama: string | null }> {
  const c = KOLOM_BERKAS[jenis];
  const client = await getPgPool().connect();
  try {
    await client.query("BEGIN");
    const lama = await client.query<{ file_id: string | null }>(
      `SELECT ${c.id} AS file_id FROM mitra_identitas WHERE ${KUNCI_WHERE} FOR UPDATE`,
      kunciParams(k)
    );
    await client.query(
      `INSERT INTO mitra_identitas (perusahaan_kode, sumber, partner_id, ${c.id}, ${c.nama}, ${c.mime}, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (perusahaan_kode, sumber, partner_id) DO UPDATE SET
         ${c.id} = EXCLUDED.${c.id}, ${c.nama} = EXCLUDED.${c.nama}, ${c.mime} = EXCLUDED.${c.mime},
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [...kunciParams(k), berkas?.fileId ?? null, berkas?.nama ?? null, berkas?.mime ?? null, userId]
    );
    await client.query("COMMIT");
    return { fileIdLama: lama.rows[0]?.file_id ?? null };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** HANYA untuk rute baca berkas privat (izin can_view sudah dicek di sana). */
export async function getBerkasIdentitas(
  k: IdentitasKunci,
  jenis: "nik" | "sk"
): Promise<{ fileId: string; nama: string; mime: string } | null> {
  const c = KOLOM_BERKAS[jenis];
  const { rows } = await getPgPool().query<{ file_id: string | null; nama: string | null; mime: string | null }>(
    `SELECT ${c.id} AS file_id, ${c.nama} AS nama, ${c.mime} AS mime FROM mitra_identitas WHERE ${KUNCI_WHERE}`,
    kunciParams(k)
  );
  const r = rows[0];
  if (!r?.file_id) return null;
  return { fileId: r.file_id, nama: r.nama ?? "berkas", mime: r.mime ?? "application/octet-stream" };
}
