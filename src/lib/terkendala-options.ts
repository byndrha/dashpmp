// Split out from lib/queries/driver-terkendala.ts for the same reason as
// istirahat-options.ts: that file imports the mssql driver at module scope, so
// a client component (terkendala-dialog.tsx) importing this constant from
// there would pull the entire mssql/tedious package into the browser bundle.
// This file has no server-only imports, so both the query module and the
// client dialog can safely import from here.
export const ALASAN_TERKENDALA_OPTIONS = ["Alamat tidak ditemukan", "Lokasi tutup", "Penerima tidak merespon", "Lainnya"] as const;
export type AlasanTerkendala = (typeof ALASAN_TERKENDALA_OPTIONS)[number];
