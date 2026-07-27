export const PERUSAHAAN_STATUSES = ["Draft", "StandaloneHTML", "AktifPenuh"] as const;
export type PerusahaanStatus = (typeof PERUSAHAAN_STATUSES)[number];
