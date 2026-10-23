// Inti server action form Mitra Es Balok, dipakai bersama oleh
// src/app/{pmputra,pmpersada,pmpakis}/…/mitra/actions.ts. Tiap actions.ts
// tetap memegang gerbang halamannya sendiri (requirePmputra/…) lalu
// memanggil fungsi di sini dengan KODE-nya. Bukan berkas "use server".
import type { Session } from "next-auth";
import { AppError } from "@/lib/action-result";
import { aksesIdentitasMitra } from "@/lib/permissions";
import { saringNikMasukan } from "@/lib/mitra-lokasi";
import { getMitraCard, type MitraCard } from "@/lib/queries/mitra-es-balok";
import {
  jadikanLokasiUtamaAgen,
  muatKonteksFormEsBalok,
  simpanMitraLengkapEsBalok,
  validasiKartuAgen,
  type MitraFormKonteksEsBalok,
  type MitraLengkapEsBalokInput,
} from "@/lib/queries/mitra-es-balok-lokasi";
import { tambahKompetitor, type Kompetitor } from "@/lib/queries/kompetitor";

type User = Session["user"];

// Holding akun (kompetitor dipisah per holding). "pmp" hanya jaring pengaman,
// sama dengan actions Mitra Es Kristal.
function holdingDari(user: { holdingKode?: string | null }): string {
  return user.holdingKode || "pmp";
}

/** Path halaman Mitra yang ikut berubah: logistik pmpersada/pmpakis = DB bersama. */
export function pathMitraTerdampak(kode: string, sumber: string): string[] {
  if (sumber === "logistik" && (kode === "pmpersada" || kode === "pmpakis")) return ["/pmpersada/mitra", "/pmpakis/mitra"];
  return [`/${kode}/mitra`];
}

export async function aksiSimpanMitraEsBalok(
  kode: string,
  user: User,
  sumber: unknown,
  agenId: string | null,
  agenDetailId: string | null,
  input: MitraLengkapEsBalokInput
): Promise<string> {
  const s = validasiKartuAgen(kode, sumber, agenId, agenDetailId);
  if (!agenId && agenDetailId) throw new AppError("ID alamat mitra tidak valid.");
  // Selalu lewat aksesIdentitasMitra (Direktur: peta izin kosong, tetap boleh).
  const akses = aksesIdentitasMitra(user);
  return simpanMitraLengkapEsBalok(kode, s, agenId, agenDetailId, saringNikMasukan(input, akses.ubah), {
    userId: String(user.id),
    holdingKode: holdingDari(user),
    bolehUbahNik: akses.ubah,
  });
}

export async function aksiJadikanLokasiUtamaEsBalok(
  kode: string,
  user: User,
  sumber: unknown,
  agenId: string,
  agenDetailId: string | null,
  lokasiPengirimanId: number
): Promise<{ wilayahLama: string | null; wilayahBaru: string | null }> {
  const s = validasiKartuAgen(kode, sumber, agenId, agenDetailId);
  if (!Number.isInteger(lokasiPengirimanId) || lokasiPengirimanId <= 0) throw new AppError("Lokasi pengiriman tidak valid.");
  return jadikanLokasiUtamaAgen(kode, s, agenId, lokasiPengirimanId, String(user.id), agenDetailId);
}

export async function aksiTambahKompetitorEsBalok(user: User, bisnis: unknown, nama: string): Promise<Kompetitor> {
  if (bisnis !== "es_balok") throw new AppError("Jenis bisnis tidak valid.");
  return tambahKompetitor(holdingDari(user), "es_balok", nama, String(user.id));
}

export async function aksiKonteksFormEsBalok(
  kode: string,
  user: User,
  sumber: unknown,
  agenId: string | null
): Promise<MitraFormKonteksEsBalok> {
  const s = validasiKartuAgen(kode, sumber, agenId);
  return muatKonteksFormEsBalok(kode, s, agenId, aksesIdentitasMitra(user), holdingDari(user));
}

export async function aksiMuatKartuEsBalok(
  kode: string,
  sumber: unknown,
  agenId: string,
  agenDetailId: string | null
): Promise<MitraCard | null> {
  const s = validasiKartuAgen(kode, sumber, agenId, agenDetailId);
  return getMitraCard(kode, s, agenId, agenDetailId);
}
