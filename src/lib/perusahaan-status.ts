export const PERUSAHAAN_STATUSES = ["Draft", "StandaloneHTML", "AktifPenuh"] as const;
export type PerusahaanStatus = (typeof PERUSAHAAN_STATUSES)[number];

// Locked enum, not free text — every module that branches on business type
// (which table/column set a company's data lives under, e.g. Es Balok's
// FINAC_ES_PO/FINAC_LOGISTIC_PO vs Es Kristal's MSSQL schema) depends on
// this being exactly one of these two values, never an arbitrary string.
export const PERUSAHAAN_JENIS_BISNIS = ["Es Kristal", "Es Balok"] as const;
export type PerusahaanJenisBisnis = (typeof PERUSAHAAN_JENIS_BISNIS)[number];
