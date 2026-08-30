import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canView, type ModuleKey } from "@/lib/permissions";
import { MARKETING_ROLE_ID } from "@/lib/roles";

// An account has cross-PT authority if it's superadmin, OR its Perusahaan
// is "PMP Group" itself (accountScope "direktur", the holding level above
// every PT) — the holding company naturally oversees all PTs beneath it,
// not just accounts with the isSuperAdmin flag set.
export function canAccessAllPT(user: { isSuperAdmin: boolean; accountScope: string }): boolean {
  return user.isSuperAdmin || user.accountScope === "direktur";
}

// Permissions are baked into the JWT at sign-in (see auth.ts) rather than
// re-queried on every request, so a role/permission change made via the
// Peran editor takes effect the next time the affected user logs in, not
// immediately — the standard tradeoff of JWT sessions, and an acceptable
// one here since it's a low-frequency admin action.
export async function requireModuleAccess(moduleKey: ModuleKey) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // A PMP Group-scoped account has no per-PT peran (permissions is always
  // {} for it — see auth.ts), so it must bypass this check the same way
  // isSuperAdmin does, or every module page in this PT's dashboard would
  // wrongly deny it.
  if (!canAccessAllPT(session.user) && !canView(session.user.permissions, moduleKey)) {
    redirect("/akses-ditolak");
  }
  return session;
}

export async function requireSuperAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.isSuperAdmin) redirect("/akses-ditolak");
  return session;
}

// Page-level defense-in-depth for /grup (and everything nested under it,
// including Akun/Perusahaan administration — see docs/superpowers/specs/
// 2026-07-30-postgres-directory-multi-company.md) — proxy.ts (repo root,
// not src/proxy.ts — see that file's own comment) already redirects by
// accountScope on every navigation, but a page component shouldn't rely
// on that alone. Uses canAccessAllPT() so any account with cross-PT
// authority reaches this, not just today's bootstrap mkesindo superadmin.
export async function requireGrupAccess() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.accountScope !== "direktur" && !canAccessAllPT(session.user)) redirect("/akses-ditolak");
  return session;
}

export async function requirePmputra() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.accountScope !== "pmputra" && !canAccessAllPT(session.user)) redirect("/akses-ditolak");
  return session;
}

export async function requirePmpersada() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.accountScope !== "pmpersada" && !canAccessAllPT(session.user)) redirect("/akses-ditolak");
  return session;
}

// requirePmpersada() sendiri hanya cek accountScope company-wide, tanpa
// cek modul — akun operator produksi PMPersada baru (Task 1 rencana ini)
// otomatis punya accountScope==="pmpersada" juga (dari perusahaan_id yang
// sama), jadi tanpa lapisan ini mereka bisa ikut membuka data finansial.
// canAccessAllPT() tetap lolos (Direktur/superadmin selalu boleh lihat semua).
export async function requirePmpersadaKeuangan() {
  const session = await requirePmpersada();
  if (session.user.isProduksi && !canAccessAllPT(session.user)) redirect("/akses-ditolak");
  return session;
}

export async function requireSatpam() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.isSatpam) redirect("/akses-ditolak");
  return session;
}

export async function requireDriver() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.isDriver) redirect("/akses-ditolak");
  return session;
}

export async function requireProduksi() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.isProduksi) redirect("/akses-ditolak");
  return session;
}

// Gerbang /mkesindo/pemasaran-app — Marketing bukan boolean flag seperti
// Driver/Satpam/Produksi, tapi Role (MARKETING_ROLE_ID) yang sudah ada sejak
// modul Pemasaran desktop dibangun. Super Admin tetap boleh masuk untuk
// keperluan preview/testing, sama seperti pola akses lain di app ini.
export async function requireMarketing() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.isSuperAdmin && session.user.roleId !== MARKETING_ROLE_ID) redirect("/akses-ditolak");
  return session;
}

// Desktop /mkesindo/produksi is now a regular, permission-gated module
// (like Pengiriman, Penjualan, etc.) rather than exclusively is_produksi's
// own view — but is_produksi accounts still get automatic access without
// needing the "produksi" module permission explicitly granted, since they
// remain a special role (mirrors canAccessAllPT's superadmin/direktur
// bypass pattern, just for this one module instead of every module).
export async function requireProduksiView() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAccessAllPT(session.user) && !session.user.isProduksi && !canView(session.user.permissions, "produksi")) {
    redirect("/akses-ditolak");
  }
  return session;
}

// Stricter than requireProduksiView() — deliberately excludes the bare
// isProduksi bypass. Guards actions that must stay supervisor/admin-only
// even though ordinary is_produksi (floor/Kepala Produksi) accounts can
// otherwise reach every other action in this module — see
// setJadwalTimAction/updateTimKepalaAction in
// src/app/mkesindo/produksi/actions.ts, both of which let the caller
// affect OTHER teams/accounts, not just their own.
export async function requireProduksiAdmin() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!canAccessAllPT(session.user) && !canView(session.user.permissions, "produksi")) {
    redirect("/akses-ditolak");
  }
  return session;
}

// Gerbang app mobile /pmpersada/produksi-app — operator lantai produksi
// PMPersada. Beda dari requireProduksiView() milik MKEsindo: sengaja TIDAK
// pakai canAccessAllPT() bypass di sini, karena akun Direktur/PMP Group
// yang mengelola banyak PT tidak otomatis relevan sebagai "operator
// lantai produksi PMPersada" — mereka melihat data ini lewat dashboard
// desktop /pmpersada/produksi (requirePmpersada() biasa), bukan app mobile ini.
export async function requirePmpersadaProduksi() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.isProduksi || session.user.accountScope !== "pmpersada") {
    redirect("/akses-ditolak");
  }
  return session;
}
