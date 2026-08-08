import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canView, type ModuleKey } from "@/lib/permissions";

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
// including Akun/Perusahaan/Akun Direktori administration — see
// docs/superpowers/specs/2026-07-30-postgres-directory-multi-company.md) —
// proxy.ts already redirects by accountScope on every navigation, but a
// page component shouldn't rely on that alone.
//
// Deliberately a hybrid: a real Postgres "direktur" account, OR today's
// MSSQL superadmin (accountScope "mkesindo" + isSuperAdmin). Without the
// second branch, moving Administrasi under /grup would lock out the only
// admin account that exists until someone creates a direktur account
// through /grup/akun/direktori — which itself lives under /grup. The
// superadmin bridge is what makes that first-account bootstrap possible.
export async function requireGrupAccess() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const isBridgedSuperAdmin = session.user.accountScope === "mkesindo" && session.user.isSuperAdmin;
  if (session.user.accountScope !== "direktur" && !isBridgedSuperAdmin) redirect("/akses-ditolak");
  return session;
}

export async function requirePmputra() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // TEMPORARY diagnostic — remove once the production redirect-to-/grup
  // mystery is solved. Prints straight to server stdout (Coolify "Logs"
  // tab), since this exact check passes locally but production somehow
  // still ends up back on /grup for a "direktur"-scoped account.
  console.log(
    "[requirePmputra]",
    "username=", session.user.username,
    "accountScope=", session.user.accountScope,
    "isSuperAdmin=", session.user.isSuperAdmin,
    "canAccessAllPT=", canAccessAllPT(session.user)
  );
  if (session.user.accountScope !== "pmputra" && !canAccessAllPT(session.user)) redirect("/akses-ditolak");
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
