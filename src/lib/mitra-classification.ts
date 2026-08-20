// Qty thresholds for classifying a mitra's PartnerType from its proposed
// QtyKantong: qty <= AGEN_QTY_THRESHOLD -> Outlet, AGEN_QTY_THRESHOLD < qty
// <= RPA_QTY_THRESHOLD -> Agen, qty > RPA_QTY_THRESHOLD -> RPA. Used by both
// approvePengajuan() (queries/mitra-pengajuan.ts, server) and the mobile
// Pengajuan card's classifyPartnerType() (pengajuan-sub-tab.tsx, client).
// Kept in a plain, DB-import-free module (unlike queries/mitra-pengajuan.ts,
// which pulls in server-only mssql/pg code) so the client component can
// reference them without pulling server-only code into the client bundle —
// same pattern as roles.ts.
export const AGEN_QTY_THRESHOLD = 10;
export const RPA_QTY_THRESHOLD = 100;
