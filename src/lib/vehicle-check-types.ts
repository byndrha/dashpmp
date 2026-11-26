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
  | "KABIN"
  // Satu foto tekanan ban (pengukur/ban) — hanya Cek Berangkat.
  | "TEKANAN_BAN";

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
  SAMPING_KANAN: "Kanan",
  SAMPING_KIRI: "Kiri",
  BELAKANG: "Belakang",
  BOX_MUATAN: "Muatan",
  KABIN: "Kabin",
  TEKANAN_BAN: "Ban",
};

// Foto wajib Cek Berangkat = 6 foto sisi kendaraan + 1 foto tekanan ban.
// Cek Datang tetap 6 foto (JENIS_FOTO_LIST) tanpa tekanan ban.
export const JENIS_FOTO_BERANGKAT: JenisFotoKendaraan[] = [...JENIS_FOTO_LIST, "TEKANAN_BAN"];
export function jenisFotoWajib(tipe: VehicleCheckTipe): JenisFotoKendaraan[] {
  return tipe === "BERANGKAT" ? JENIS_FOTO_BERANGKAT : JENIS_FOTO_LIST;
}

// ---- Tekanan ban (PSI), dicatat per ban pada Cek Berangkat ----
// Posisi tetap: 4 ban (mobil kecil, mis. GranMax) atau 6 ban (truk dengan
// ban ganda di belakang, mis. Hino). Urutan = urutan tampil (depan dulu,
// kiri ke kanan).
export type PosisiBan = "DKI" | "DKA" | "BKI" | "BKA" | "BKI_LUAR" | "BKI_DALAM" | "BKA_DALAM" | "BKA_LUAR";
export type JumlahBan = 4 | 6;

export const POSISI_BAN: Record<JumlahBan, PosisiBan[]> = {
  4: ["DKI", "DKA", "BKI", "BKA"],
  6: ["DKI", "DKA", "BKI_LUAR", "BKI_DALAM", "BKA_DALAM", "BKA_LUAR"],
};

export const LABEL_POSISI_BAN: Record<PosisiBan, string> = {
  DKI: "Depan kiri",
  DKA: "Depan kanan",
  BKI: "Belakang kiri",
  BKA: "Belakang kanan",
  BKI_LUAR: "Belakang kiri luar",
  BKI_DALAM: "Belakang kiri dalam",
  BKA_DALAM: "Belakang kanan dalam",
  BKA_LUAR: "Belakang kanan luar",
};

// Label pendek untuk chip/hasil cek.
export const SINGKATAN_POSISI_BAN: Record<PosisiBan, string> = {
  DKI: "DKi",
  DKA: "DKa",
  BKI: "BKi",
  BKA: "BKa",
  BKI_LUAR: "BKi-L",
  BKI_DALAM: "BKi-D",
  BKA_DALAM: "BKa-D",
  BKA_LUAR: "BKa-L",
};

// Placeholder tekanan aman (PSI) — patokan umum, bukan batas mutlak; angka
// resmi ada di stiker tekanan ban kendaraan. 4 ban = mobil kecil bermuatan
// (GranMax PU: depan ±33, belakang ±45); 6 ban = truk ringan (Hino Dutro:
// depan ±70, belakang ±75).
export const PSI_AMAN: Record<JumlahBan, { depan: number; belakang: number }> = {
  4: { depan: 33, belakang: 45 },
  6: { depan: 70, belakang: 75 },
};
export function psiAman(jumlahBan: JumlahBan, posisi: PosisiBan): number {
  return posisi.startsWith("D") ? PSI_AMAN[jumlahBan].depan : PSI_AMAN[jumlahBan].belakang;
}

// Jumlah ban armada: nilai yang diatur di Kelola Armada bila ada; bila
// kosong, ditebak dari merek (Hino = truk 6 ban, selain itu 4 ban).
export function jumlahBanArmada(armada: { JumlahBan: number | null; Brand: string | null }): JumlahBan {
  if (armada.JumlahBan === 4 || armada.JumlahBan === 6) return armada.JumlahBan;
  return /hino/i.test(armada.Brand ?? "") ? 6 : 4;
}

export interface TekananBan {
  posisi: PosisiBan;
  psi: number;
}
export const PSI_MIN = 1;
export const PSI_MAKS = 200;

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
  // Free-text note — Cek Datang's own use case is flagging a driver
  // mismatch or a return-qty (e.g. ice) discrepancy. Nullable, and only
  // ever collected on the DATANG form; BERANGKAT checks always save null.
  remark: string | null;
  checkedByUserId: string;
  checkedAt: string;
  photos: VehicleCheckPhoto[];
  // Tekanan ban per posisi (Cek Berangkat; kosong untuk Cek Datang dan
  // cek lama sebelum fitur ini).
  tekananBan: TekananBan[];
}
