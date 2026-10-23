// Validasi murni untuk rute berkas identitas mitra (NIK & SK) — tanpa import
// server (DB/Drive/sesi) supaya bisa diuji langsung dengan node:test.
// Spec: docs/superpowers/specs/2026-10-23-mitra-identitas-lokasi-pengiriman-design.md §7.
import type { IdentitasKunci } from "@/lib/queries/mitra-identitas";

export type JenisBerkas = "nik" | "sk";
export const JENIS_BERKAS: readonly JenisBerkas[] = ["nik", "sk"];

export const MAKS_UKURAN_BERKAS = 5 * 1024 * 1024;

const EKSTENSI_PER_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export function validasiBerkas(berkas: { type: string; size: number }): { ok: true; ext: string } | { ok: false; error: string } {
  const ext = EKSTENSI_PER_MIME[berkas.type];
  if (!ext) return { ok: false, error: "Format berkas harus JPG, PNG, WEBP, atau PDF" };
  if (berkas.size <= 0) return { ok: false, error: "Berkas kosong" };
  if (berkas.size > MAKS_UKURAN_BERKAS) return { ok: false, error: "Ukuran berkas maksimal 5 MB" };
  return { ok: true, ext };
}

// Pasangan (kode, sumber) fisik Es Balok yang sah — sama dengan hasil
// resolveAgenKoneksi(): logistik pmpakis selalu dipetakan ke pmpersada,
// jadi "pmpakis"+"logistik" tidak pernah menjadi kunci fisik.
const PASANGAN_FISIK_ES_BALOK: readonly string[] = [
  "pmputra:utama",
  "pmpersada:utama",
  "pmpakis:utama",
  "pmputra:logistik",
  "pmpersada:logistik",
];

export function apakahKunciFisikEsBalok(kode: string, sumber: string): boolean {
  return PASANGAN_FISIK_ES_BALOK.includes(`${kode}:${sumber}`);
}

// partnerId ikut menjadi nama folder Drive — dibatasi ketat.
const POLA_PARTNER_ID = /^[A-Za-z0-9]{1,16}$/;

export interface KonteksAkses {
  /** currentEskristalKode() untuk request ini. */
  eskristalKode: string;
  /** isPmpScope(session.user.accountScope) */
  pmpScope: boolean;
  /** isPmpDeployment() */
  pmpDeployment: boolean;
}

export type HasilKunci =
  | { ok: true; kunci: IdentitasKunci; jenis: JenisBerkas }
  | { ok: false; status: 400 | 403; error: string };

export function validasiKunciBerkas(
  input: { kode: unknown; sumber: unknown; partnerId: unknown; jenis: unknown },
  ctx: KonteksAkses
): HasilKunci {
  const { kode, sumber, partnerId, jenis } = input;
  if (typeof jenis !== "string" || !JENIS_BERKAS.includes(jenis as JenisBerkas)) {
    return { ok: false, status: 400, error: "Jenis berkas harus 'nik' atau 'sk'" };
  }
  if (typeof partnerId !== "string" || !POLA_PARTNER_ID.test(partnerId)) {
    return { ok: false, status: 400, error: "ID mitra tidak valid" };
  }
  if (typeof kode !== "string" || !kode || typeof sumber !== "string" || (sumber !== "utama" && sumber !== "logistik")) {
    return { ok: false, status: 400, error: "Perusahaan atau sumber mitra tidak valid" };
  }

  if (kode === ctx.eskristalKode) {
    // Es Kristal selalu bersumber "utama".
    if (sumber !== "utama") return { ok: false, status: 400, error: "Sumber mitra Es Kristal harus 'utama'" };
  } else if (apakahKunciFisikEsBalok(kode, sumber)) {
    if (!ctx.pmpDeployment || !ctx.pmpScope) {
      return { ok: false, status: 403, error: "Anda tidak berhak mengakses mitra perusahaan ini" };
    }
  } else {
    return { ok: false, status: 403, error: "Anda tidak berhak mengakses mitra perusahaan ini" };
  }

  return { ok: true, kunci: { perusahaanKode: kode, sumber, partnerId }, jenis: jenis as JenisBerkas };
}

/** Nama berkas asli yang aman untuk disimpan & ditampilkan (tanpa path, maks 120 karakter). */
export function rapikanNamaBerkas(nama: string, cadangan: string): string {
  const dasar = nama.split(/[\\/]/).pop() ?? "";
  const bersih = dasar.replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 120);
  return bersih || cadangan;
}

/** Header Content-Disposition inline dengan nama UTF-8 (RFC 5987) + cadangan ASCII. */
export function contentDispositionInline(nama: string): string {
  const ascii = nama.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nama)}`;
}
