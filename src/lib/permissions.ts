// Module keys mirror the sidebar's route segments (app-sidebar.tsx NAV_ITEMS)
// so a permission row maps 1:1 onto a nav item / page. "akun" (Account
// settings) is deliberately excluded — it's hard-gated to
// DashboardRole.IsSuperAdmin rather than being assignable per role, per the
// requirement that only Super Administrator can manage accounts/authority.
export const MODULE_KEYS = ["beranda", "pnl", "aging", "sales", "transaksi", "electricity", "delivery", "mitra", "pemasaran"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABEL: Record<ModuleKey, string> = {
  beranda: "Beranda",
  pnl: "Keuangan",
  aging: "Piutang",
  sales: "Penjualan",
  transaksi: "Transaksi",
  electricity: "Biaya Listrik",
  delivery: "Pengiriman",
  mitra: "Mitra",
  pemasaran: "Pemasaran",
};

export interface ModulePermission {
  canView: boolean;
  canEdit: boolean;
}

export type PermissionMap = Partial<Record<ModuleKey, ModulePermission>>;

export function fullPermissionMap(): PermissionMap {
  return Object.fromEntries(MODULE_KEYS.map((k) => [k, { canView: true, canEdit: true }])) as PermissionMap;
}

// permissions can be undefined for a session whose JWT was issued before
// this field existed (a user still logged in from before this deploy) —
// treat that the same as "no access" (redirected to /akses-ditolak, where
// they can sign out and back in for a fresh token) instead of crashing.
export function canView(permissions: PermissionMap | undefined, moduleKey: ModuleKey): boolean {
  return permissions?.[moduleKey]?.canView ?? false;
}
