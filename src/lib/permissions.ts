// Module keys mirror the sidebar's route segments (app-sidebar.tsx NAV_ITEMS)
// so a permission row maps 1:1 onto a nav item / page. "akun" (Account
// settings) is deliberately excluded — it's hard-gated to
// DashboardRole.IsSuperAdmin rather than being assignable per role, per the
// requirement that only Super Administrator can manage accounts/authority.
export const MODULE_KEYS = ["beranda", "pnl", "aging", "sales", "transaksi", "electricity", "delivery", "pemesanan", "mitra", "pemasaran", "produksi", "laporan", "kinerja", "inventaris"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_LABEL: Record<ModuleKey, string> = {
  beranda: "Beranda",
  pnl: "Keuangan",
  aging: "Piutang",
  sales: "Penjualan",
  transaksi: "Transaksi",
  electricity: "Biaya Listrik",
  delivery: "Pengiriman",
  pemesanan: "Pemesanan",
  mitra: "Mitra",
  pemasaran: "Pemasaran",
  produksi: "Produksi",
  laporan: "Laporan",
  kinerja: "Kinerja",
  inventaris: "Inventaris",
};

export interface ModulePermission {
  canView: boolean;
  canEdit: boolean;
}

// Izin khusus: disimpan di tabel peran_izin yang sama (module_key) tetapi
// BUKAN modul/halaman — tidak pernah muncul di sidebar (sidebar hanya
// membaca MODULE_KEYS/NAV_ITEMS). Dipakai untuk membatasi data sensitif di
// dalam sebuah modul, mis. NIK & berkas identitas mitra.
export const SPECIAL_PERMISSION_KEYS = ["mitra_identitas"] as const;
export type SpecialPermissionKey = (typeof SPECIAL_PERMISSION_KEYS)[number];

export const SPECIAL_PERMISSION_LABEL: Record<SpecialPermissionKey, string> = {
  mitra_identitas: "Identitas Mitra (NIK & Berkas)",
};

export type PermissionMap = Partial<Record<ModuleKey | SpecialPermissionKey, ModulePermission>>;

export function fullPermissionMap(): PermissionMap {
  return Object.fromEntries(
    [...MODULE_KEYS, ...SPECIAL_PERMISSION_KEYS].map((k) => [k, { canView: true, canEdit: true }])
  ) as PermissionMap;
}

// Keputusan server-side: apakah NIK / berkas identitas mitra boleh dikirim
// ke klien (lihat) dan diubah (ubah). Super Admin dan akun Direktur (tanpa
// peran, accountScope "direktur") selalu boleh. Selain itu mengikuti izin
// khusus mitra_identitas pada peran; "ubah" juga mensyaratkan "lihat".
// permissions undefined (JWT lama) = tanpa akses.
export function aksesIdentitasMitra(user: {
  isSuperAdmin: boolean;
  accountScope?: string | null;
  permissions?: PermissionMap;
}): { lihat: boolean; ubah: boolean } {
  if (user.isSuperAdmin || user.accountScope === "direktur") return { lihat: true, ubah: true };
  const izin = user.permissions?.mitra_identitas;
  const lihat = izin?.canView === true;
  return { lihat, ubah: lihat && izin?.canEdit === true };
}

// Izin "Edit Denah" produksi Es Balok (builder denah). Super Admin dan
// Direktur selalu boleh; selain itu butuh produksi.canEdit pada peran.
// Ditegakkan di server action simpan denah, bukan hanya di UI.
export function bolehEditDenah(user: {
  isSuperAdmin: boolean;
  accountScope?: string | null;
  permissions?: PermissionMap;
}): boolean {
  return user.isSuperAdmin || user.accountScope === "direktur" || !!user.permissions?.produksi?.canEdit;
}

// permissions can be undefined for a session whose JWT was issued before
// this field existed (a user still logged in from before this deploy) —
// treat that the same as "no access" (redirected to /akses-ditolak, where
// they can sign out and back in for a fresh token) instead of crashing.
export function canView(permissions: PermissionMap | undefined, moduleKey: ModuleKey): boolean {
  return permissions?.[moduleKey]?.canView ?? false;
}
