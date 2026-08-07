// Split out from lib/queries/driver-kendala.ts: that file imports the mssql
// driver at module scope, so a client component (kendala-dialog.tsx)
// importing this constant from there would pull the entire mssql/tedious
// package into the browser bundle — which fails outright (tedious needs
// Node's `dgram` module, unavailable in the browser). This file has no
// server-only imports, so both the query module and the client dialog can
// safely import from here.
export const JENIS_KENDALA_OPTIONS = ["Ban Bocor", "Mogok/Kerusakan Mesin", "Kecelakaan", "Macet Parah", "Lainnya"] as const;
export type JenisKendala = (typeof JENIS_KENDALA_OPTIONS)[number];
