// Client-safe vehicle-check types/constants, split out of
// src/lib/queries/vehicle-check.ts so "use client" components (e.g.
// VehicleCheckPanel, RouteValidationDialog) don't pull in that module's
// `@/lib/db` import (mssql + its Node-only deps like tls) into the client
// bundle. Mirrors the same split already used for armada-status.ts vs
// armada.ts.

export type VehicleCheckTipe = "BERANGKAT" | "DATANG";
export type FuelLevel = "E" | "1/4" | "1/2" | "3/4" | "F";
export type JenisFotoKendaraan =
  | "DEPAN"
  | "SAMPING_KANAN"
  | "SAMPING_KIRI"
  | "BELAKANG"
  | "BOX_MUATAN"
  | "KABIN";

export const JENIS_FOTO_LIST: JenisFotoKendaraan[] = [
  "DEPAN",
  "SAMPING_KANAN",
  "SAMPING_KIRI",
  "BELAKANG",
  "BOX_MUATAN",
  "KABIN",
];

export const JENIS_FOTO_LABEL: Record<JenisFotoKendaraan, string> = {
  DEPAN: "Depan",
  SAMPING_KANAN: "Samping Kanan",
  SAMPING_KIRI: "Samping Kiri",
  BELAKANG: "Belakang",
  BOX_MUATAN: "Box Muatan",
  KABIN: "Kabin (Area Speedometer)",
};

export interface VehicleCheckPhoto {
  jenisFoto: JenisFotoKendaraan;
  filePath: string;
}

export interface VehicleCheckRow {
  vehicleCheckId: number;
  jadwalId: number;
  tipe: VehicleCheckTipe;
  odometerKM: number;
  fuelLevel: FuelLevel;
  checkedByUserId: string;
  checkedAt: string;
  photos: VehicleCheckPhoto[];
}
