// RoleID values from DashboardRole — already-existing roles in this
// database. Kept in a plain, DB-import-free module (unlike
// queries/mitra-pengajuan.ts, which pulls in server-only `mssql` code) so
// client components — e.g. the login page's post-signin redirect — can
// reference them without pulling server-only code into the client bundle.
export const MARKETING_ROLE_ID = 1003;
export const APPROVER_ROLE_IDS = [3, 4];

// Supervisor, Accounting, Manager — who can manage the Cakupan Wilayah
// Marketing assignment (and, going forward, the Kinerja Marketing period
// settings). Deliberately separate from APPROVER_ROLE_IDS: this list was
// requested independently of who approves/rejects Pengajuan Mitra, so
// changing one must not silently change the other.
export const WILAYAH_MANAGER_ROLE_IDS = [3, 4, 1004];
