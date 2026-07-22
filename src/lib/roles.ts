// RoleID values from DashboardRole — already-existing roles in this
// database. Kept in a plain, DB-import-free module (unlike
// queries/mitra-pengajuan.ts, which pulls in server-only `mssql` code) so
// client components — e.g. the login page's post-signin redirect — can
// reference them without pulling server-only code into the client bundle.
export const MARKETING_ROLE_ID = 1003;
export const APPROVER_ROLE_IDS = [3, 4];
