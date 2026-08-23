// Split out from lib/queries/driver-istirahat.ts for the same reason as
// kendala-options.ts: that file imports the mssql driver at module scope, so
// a client component (istirahat-dialog.tsx) importing this constant from
// there would pull the entire mssql/tedious package into the browser bundle.
// This file has no server-only imports, so both the query module and the
// client dialog can safely import from here.
export const KETERANGAN_ISTIRAHAT_OPTIONS = ["Makan", "Toilet", "Sholat", "Lainnya"] as const;
export type KeteranganIstirahat = (typeof KETERANGAN_ISTIRAHAT_OPTIONS)[number];
