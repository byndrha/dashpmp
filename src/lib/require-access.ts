import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canView, type ModuleKey } from "@/lib/permissions";

// Permissions are baked into the JWT at sign-in (see auth.ts) rather than
// re-queried on every request, so a role/permission change made via the
// Peran editor takes effect the next time the affected user logs in, not
// immediately — the standard tradeoff of JWT sessions, and an acceptable
// one here since it's a low-frequency admin action.
export async function requireModuleAccess(moduleKey: ModuleKey) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!session.user.isSuperAdmin && !canView(session.user.permissions, moduleKey)) {
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
