export const ARMADA_STATUS = ["Baik", "Rusak", "Perbaikan", "Tertahan"] as const;
export type ArmadaStatus = (typeof ARMADA_STATUS)[number];
