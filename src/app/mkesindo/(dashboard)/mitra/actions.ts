"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  updateMitraCapacity,
  deleteMitra,
  setMitraSuspended,
  getMitraDetail,
  getTermOfPaymentOptions,
  getPriceLevelOptions,
  type MitraRow,
  type TermOfPaymentOption,
  type PriceLevelOption,
} from "@/lib/queries/mitra";
import { setMitraLocation } from "@/lib/queries/mitra-location";
import { jadikanLokasiUtama } from "@/lib/queries/mitra-lokasi-pengiriman";
import { simpanMitraLengkap, type MitraLengkapInput } from "@/lib/queries/mitra-lengkap";
import { getIdentitasMitra, type IdentitasMitra } from "@/lib/queries/mitra-identitas";
import {
  getKompetitorMitraMap,
  listKompetitor,
  tambahKompetitor,
  type BisnisKompetitor,
  type Kompetitor,
} from "@/lib/queries/kompetitor";
import { aksesIdentitasMitra } from "@/lib/permissions";
import { currentEskristalKode } from "@/lib/tenant-request";
import { saringNikMasukan } from "@/lib/mitra-lokasi";
import {
  getMarketingUsers,
  getDriverUserOptions,
  setMitraPemilik,
  getMitraOptions,
  type MarketingUserOption,
  type MitraOption,
} from "@/lib/queries/marketing-wilayah";
import { WILAYAH_MANAGER_ROLE_IDS } from "@/lib/roles";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

// Same role gate as Cakupan Wilayah's own requireWilayahManager
// (pemasaran/actions.ts) — Supervisor/Accounting/Manager/Super Admin —
// kept as its own local copy rather than a shared export since the two
// call sites were requested independently and shouldn't be forced to
// change together.
async function requireWilayahManager() {
  const session = await auth();
  const user = session?.user;
  if (!user) throw new AppError("Unauthorized");
  if (!user.isSuperAdmin && !WILAYAH_MANAGER_ROLE_IDS.includes(user.roleId)) {
    throw new AppError("Tidak punya izin mengubah Pemilik mitra.");
  }
  return user;
}

export type { MitraLengkapInput };

async function requireUser() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) throw new AppError("Unauthorized");
  return user;
}

// Holding akun (kompetitor dipisah per holding). Diisi session() di
// auth.config.ts; "pmp" hanya jaring pengaman.
function holdingDari(user: { holdingKode?: string | null }): string {
  return user.holdingKode || "pmp";
}

function kunciEsKristal(perusahaanKode: string, partnerId: string) {
  return { perusahaanKode, sumber: "utama" as const, partnerId };
}

// Satu-satunya jalur simpan form Mitra (tambah & edit) sejak form identitas +
// lokasi pengiriman ganda. NIK hanya diteruskan bila sesi punya hak ubah —
// selain itu nik dibuang di sini, apa pun yang dikirim client.
export async function simpanMitraLengkapAction(id: string | null, input: MitraLengkapInput): Promise<ActionResult<string>> {
  return runAction(async () => {
    const user = await requireUser();
    const akses = aksesIdentitasMitra(user);
    const bpId = await simpanMitraLengkap(id, saringNikMasukan(input, akses.ubah), {
      userId: user.id,
      perusahaanKode: await currentEskristalKode(),
      holdingKode: holdingDari(user),
      bolehUbahNik: akses.ubah,
    });
    revalidatePath("/mkesindo/mitra");
    return bpId;
  });
}

export async function jadikanLokasiUtamaAction(
  bpId: string,
  lokasiPengirimanId: number
): Promise<ActionResult<{ wilayahLama: string | null; wilayahBaru: string | null }>> {
  return runAction(async () => {
    const user = await requireUser();
    const hasil = await jadikanLokasiUtama(bpId, lokasiPengirimanId, user.id);
    revalidatePath("/mkesindo/mitra");
    revalidatePath("/mkesindo/pengiriman");
    return hasil;
  });
}

export async function tambahKompetitorAction(bisnis: BisnisKompetitor, nama: string): Promise<ActionResult<Kompetitor>> {
  return runAction(async () => {
    const user = await requireUser();
    if (bisnis !== "es_kristal" && bisnis !== "es_balok") throw new AppError("Jenis bisnis tidak valid.");
    return tambahKompetitor(holdingDari(user), bisnis, nama, user.id);
  });
}

// Tanpa izin lihat: NIK & info berkas tidak pernah di-SELECT (lihat
// getIdentitasMitra), jadi tidak ikut ke respons action.
export async function getIdentitasMitraAction(bpId: string): Promise<ActionResult<IdentitasMitra>> {
  return runAction(async () => {
    const user = await requireUser();
    const akses = aksesIdentitasMitra(user);
    return getIdentitasMitra(kunciEsKristal(await currentEskristalKode(), bpId), akses.lihat);
  });
}

export interface MitraFormKonteks {
  akses: { lihat: boolean; ubah: boolean };
  perusahaanKode: string; // untuk rute berkas /api/mitra-berkas
  kompetitorOpsi: Kompetitor[];
  kompetitorDipilih: number[];
  identitas: IdentitasMitra | null; // null untuk mitra baru
}

// Semua yang dibutuhkan form/detail Mitra di luar MitraRow, satu round-trip,
// dimuat saat dialog dibuka (tidak lewat props halaman — NIK tidak boleh
// ikut payload RSC).
export async function getMitraFormKonteksAction(bpId: string | null): Promise<ActionResult<MitraFormKonteks>> {
  return runAction(async () => {
    const user = await requireUser();
    const akses = aksesIdentitasMitra(user);
    const perusahaanKode = await currentEskristalKode();
    const [kompetitorOpsi, kompetitorMap, identitas] = await Promise.all([
      listKompetitor(holdingDari(user), "es_kristal"),
      bpId ? getKompetitorMitraMap(perusahaanKode, "utama") : Promise.resolve(new Map<string, Kompetitor[]>()),
      bpId ? getIdentitasMitra(kunciEsKristal(perusahaanKode, bpId), akses.lihat) : Promise.resolve(null),
    ]);
    return {
      akses,
      perusahaanKode,
      kompetitorOpsi,
      kompetitorDipilih: bpId ? (kompetitorMap.get(bpId) ?? []).map((x) => x.id) : [],
      identitas,
    };
  });
}

export async function updateMitraCapacityAction(id: string, capacity: number | null): Promise<ActionResult<void>> {
  return runAction(async () => {
    await updateMitraCapacity(id, capacity);
    revalidatePath("/mkesindo/mitra");
    revalidatePath("/mkesindo/transaksi");
  });
}

export async function deleteMitraAction(id: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await deleteMitra(id);
    revalidatePath("/mkesindo/mitra");
  });
}

export async function setMitraSuspendedAction(id: string, suspended: boolean): Promise<ActionResult<void>> {
  return runAction(async () => {
    await setMitraSuspended(id, suspended);
    revalidatePath("/mkesindo/mitra");
    revalidatePath("/mkesindo/pemesanan");
  });
}

export async function setMitraLocationAction(input: {
  businessPartnerId: string;
  latitude: number;
  longitude: number;
  alamat: string | null;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) throw new AppError("Unauthorized");

    await setMitraLocation({ ...input, userId });
    revalidatePath("/mkesindo/mitra");
  });
}

// Read-only, fetched on demand (e.g. clicking a mitra name in Kinerja
// Marketing) — same isAuthenticated-only baseline as the rest of this
// already-gated mkesindo route tree, no extra role check needed.
export async function getMitraDetailAction(businessPartnerId: string): Promise<ActionResult<MitraRow | null>> {
  return runAction(async () => {
    const session = await auth();
    if (!session?.user?.id) throw new AppError("Unauthorized");

    return getMitraDetail(businessPartnerId);
  });
}

// Lightweight mitra picker list (BusinessPartnerID/Name/Wilayah only, active
// mitra only) for MitraSelect — fetched on demand here rather than plumbed
// through page props, since callers like JualUlangReturDialog
// (jual-ulang-retur-dialog.tsx, Papan Pengiriman's "Jual Ulang Retur" jalur
// LUAR_RUTE picker) sit several component layers below a page that doesn't
// otherwise fetch a mitra list. Same getMitraOptions() query Cakupan Wilayah
// already uses for its own mitra search.
export async function getMitraOptionsAction(): Promise<ActionResult<MitraOption[]>> {
  return runAction(async () => {
    const session = await auth();
    if (!session?.user?.id) throw new AppError("Unauthorized");

    return getMitraOptions();
  });
}

// Bundled in one round-trip for MitraEditDialog (mitra-edit-dialog.tsx) —
// both are needed to render MitraFormDialog's Harga/Tenggat Bayar selects,
// same two queries MitraPage already fetches server-side for MitraList's
// own inline edit flow.
export async function getMitraEditOptionsAction(): Promise<
  ActionResult<{ termOptions: TermOfPaymentOption[]; priceLevels: PriceLevelOption[] }>
> {
  return runAction(async () => {
    const session = await auth();
    if (!session?.user?.id) throw new AppError("Unauthorized");

    const [termOptions, priceLevels] = await Promise.all([getTermOfPaymentOptions(), getPriceLevelOptions()]);
    return { termOptions, priceLevels };
  });
}

// Gated the same as setMitraPemilikAction below — no point handing out the
// Marketing/Driver picker list to a session that isn't allowed to act on it.
export async function getMitraPemilikOptionsAction(): Promise<
  ActionResult<{ marketing: MarketingUserOption[]; driver: MarketingUserOption[] }>
> {
  return runAction(async () => {
    await requireWilayahManager();
    const [marketing, driver] = await Promise.all([getMarketingUsers(), getDriverUserOptions()]);
    return { marketing, driver };
  });
}

// ownerAkunId is a Postgres akun.id (either a Marketing or a Driver
// account) — null clears the override, reverting this Mitra to whatever
// Wilayah/Kecamatan coverage or cross-wilayah proposal would otherwise
// resolve it to.
export async function setMitraPemilikAction(businessPartnerId: string, ownerAkunId: string | null): Promise<ActionResult<void>> {
  return runAction(async () => {
    const user = await requireWilayahManager();
    await setMitraPemilik(businessPartnerId, ownerAkunId, user.id);
    revalidatePath("/mkesindo/mitra");
    revalidatePath("/mkesindo/pemasaran");
    revalidatePath("/mkesindo/transaksi");
  });
}
