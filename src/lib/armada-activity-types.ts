// Split out from queries/armada-activity.ts (which pulls in @/lib/db ->
// mssql -> Node-only modules) — this file has zero DB dependency so
// client components (pengiriman-board.tsx) can safely import the
// constants/types without bundling the query layer into the browser.
export const ARMADA_ACTIVITY_TYPES = ["Perawatan", "Pencucian", "IsiBBM", "Menganggur"] as const;
export type ArmadaActivityType = (typeof ARMADA_ACTIVITY_TYPES)[number];

export const ARMADA_ACTIVITY_LABEL: Record<ArmadaActivityType, string> = {
  Perawatan: "Perawatan",
  Pencucian: "Pencucian",
  IsiBBM: "Isi BBM",
  Menganggur: "Menganggur",
};

export interface ArmadaActivity {
  ActivityID: number;
  ArmadaID: number;
  ActivityType: ArmadaActivityType;
  StartTime: string | Date;
  EndTime: string | Date;
  Notes: string | null;
}
