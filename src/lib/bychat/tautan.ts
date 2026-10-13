import { createHash } from "node:crypto";
import { getPgPool } from "@/lib/pg";
import { defaultAudience } from "@/lib/bychat/token";
import { assertPtKode, getKartuByMitraId, type KartuPiutangData } from "@/lib/bychat/mitra";
import { bolehPakaiUlang, buatToken, formatTokenValid, hitungKedaluwarsa, urlTautan } from "@/lib/bychat/tautan-util";

// Tautan publik kartu piutang: https://<dashpmp>/kartu/<token> -- dapat dibuka
// tanpa login, TANPA tombol bayar, dan dipakai sebagai gambar lewat
// /kartu/<token>/gambar. Token acak ringkas disimpan di Postgres (bisa
// dicabut, kedaluwarsa 30 hari); halaman selalu menampilkan data TERKINI.

export interface TautanKartu {
  token: string;
  url: string;
  kedaluwarsa: Date;
}

export async function ambilAtauBuatTautan(p: {
  ptKode: string;
  perusahaanId: number;
  mitraId: string;
  agenNama: string;
  agenEmail: string;
}): Promise<TautanKartu> {
  const pg = getPgPool();
  const sekarang = new Date();
  const ada = await pg.query(
    `SELECT token, kedaluwarsa, dicabut FROM kartu_piutang_tautan
     WHERE perusahaan_kode = $1 AND mitra_id = $2 AND dicabut = FALSE AND kedaluwarsa > now()
     ORDER BY kedaluwarsa DESC LIMIT 1`,
    [p.ptKode, p.mitraId]
  );
  const row = ada.rows[0];
  if (row && bolehPakaiUlang(new Date(row.kedaluwarsa), row.dicabut, sekarang)) {
    return { token: row.token, url: urlTautan(defaultAudience(), row.token), kedaluwarsa: new Date(row.kedaluwarsa) };
  }
  const kedaluwarsa = hitungKedaluwarsa(sekarang);
  for (let percobaan = 0; percobaan < 5; percobaan++) {
    const token = buatToken();
    try {
      await pg.query(
        `INSERT INTO kartu_piutang_tautan (token, perusahaan_id, perusahaan_kode, mitra_id, dibuat_oleh_nama, dibuat_oleh_email, kedaluwarsa)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [token, p.perusahaanId, p.ptKode, p.mitraId, p.agenNama || null, p.agenEmail || null, kedaluwarsa]
      );
      return { token, url: urlTautan(defaultAudience(), token), kedaluwarsa };
    } catch (e) {
      if ((e as { code?: string }).code !== "23505") throw e; // bentrok token: coba lagi
    }
  }
  throw new Error("Gagal membuat token tautan unik.");
}

// Token tak dikenal / kedaluwarsa / dicabut -> null (halaman menampilkan "tidak ditemukan").
export async function muatKartuDariTautan(token: string, ip = ""): Promise<KartuPiutangData | null> {
  if (!formatTokenValid(token)) return null;
  const pg = getPgPool();
  const r = await pg.query(
    `UPDATE kartu_piutang_tautan t
     SET jumlah_dibuka = jumlah_dibuka + 1, terakhir_dibuka = now()
     FROM perusahaan p
     WHERE t.token = $1 AND t.dicabut = FALSE AND t.kedaluwarsa > now() AND p.id = t.perusahaan_id
     RETURNING t.perusahaan_id, t.perusahaan_kode, t.mitra_id, p.nama`,
    [token]
  );
  const row = r.rows[0];
  if (!row) return null;
  // Log akses (IP di-hash, bukan disimpan mentah); kegagalan log tidak boleh menggagalkan halaman.
  const ipHash = createHash("sha256").update(`${process.env.AUTH_SECRET ?? ""}:${ip}`).digest("hex").slice(0, 16);
  pg.query(`INSERT INTO kartu_piutang_akses (token, ip_hash) VALUES ($1, $2)`, [token, ipHash]).catch(() => undefined);
  return getKartuByMitraId(assertPtKode(row.perusahaan_kode), row.nama, row.perusahaan_id, row.mitra_id);
}
