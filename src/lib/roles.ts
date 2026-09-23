// RoleID values from DashboardRole — already-existing roles in this
// database. Kept in a plain, DB-import-free module (unlike
// queries/mitra-pengajuan.ts, which pulls in server-only `mssql` code) so
// client components — e.g. the login page's post-signin redirect — can
// reference them without pulling server-only code into the client bundle.
export const MARKETING_ROLE_ID = 1003;
export const APPROVER_ROLE_IDS = [3, 4];
export const STAFF_ROLE_ID = 2;

// Supervisor, Accounting, Manager — who can manage the Cakupan Wilayah
// Marketing assignment (and, going forward, the Kinerja Marketing period
// settings). Deliberately separate from APPROVER_ROLE_IDS: this list was
// requested independently of who approves/rejects Pengajuan Mitra, so
// changing one must not silently change the other.
export const WILAYAH_MANAGER_ROLE_IDS = [3, 4, 1004];

// Both "Accounting" peran rows that exist in the live Postgres `peran`
// table (id 4 for MKEsindo, id 1009 duplicated for the other PT-scoped
// account sets under the same multi-company setup — confirmed live
// 2026-09-23) — used to grant Accounting the "Proses" action on Kesehatan
// Posting GL (/mkesindo/pnl) without also granting the unrelated Kode
// Ambil-Alih Mulai/Selesai Muat permission (see requireGLBacklogAccess in
// require-access.ts).
export const ACCOUNTING_ROLE_IDS = [4, 1009];
