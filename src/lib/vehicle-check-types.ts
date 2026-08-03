// Client-safe vehicle-check types/constants, split out of
// src/lib/queries/vehicle-check.ts so "use client" components (e.g.
// VehicleCheckDialog, RouteValidationDialog) don't pull in that module's
// `@/lib/db` import (mssql + its Node-only deps like tls) into the client
// bundle. Mirrors the same split already used for armada-status.ts vs
// armada.ts.

export type VehicleCheckTipe = "BERANGKAT" | "DATANG";

// 0-4 bar fuel gauge, replacing the old 5-value fraction scale
// (E/1/4/1/2/3/4/F) with the same 5 discrete levels.
export type FuelBar = 0 | 1 | 2 | 3 | 4;
export const FUEL_BAR_MAX: FuelBar = 4;

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

// The 4 physical sides a Satpam walks around, in the order
// TruckCubeCarousel rotates through them (a clockwise walk around the
// vehicle: DEPAN -> KANAN -> BELAKANG -> KIRI -> back to DEPAN).
export type TruckSide = "DEPAN" | "KANAN" | "BELAKANG" | "KIRI";

export const TRUCK_SIDE_ORDER: TruckSide[] = ["DEPAN", "KANAN", "BELAKANG", "KIRI"];

export const TRUCK_SIDE_LABEL: Record<TruckSide, string> = {
  DEPAN: "Depan",
  KANAN: "Kanan",
  BELAKANG: "Belakang",
  KIRI: "Kiri",
};

// Each side's primary exterior photo slot.
export const TRUCK_SIDE_PRIMARY_PHOTO: Record<TruckSide, JenisFotoKendaraan> = {
  DEPAN: "DEPAN",
  KANAN: "SAMPING_KANAN",
  BELAKANG: "BELAKANG",
  KIRI: "SAMPING_KIRI",
};

// Only DEPAN and BELAKANG have a second, nested photo slot.
export const TRUCK_SIDE_SECONDARY_PHOTO: Partial<Record<TruckSide, JenisFotoKendaraan>> = {
  DEPAN: "KABIN",
  BELAKANG: "BOX_MUATAN",
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
  fuelBar: FuelBar;
  muatanQty: number;
  checkedByUserId: string;
  checkedAt: string;
  photos: VehicleCheckPhoto[];
}
