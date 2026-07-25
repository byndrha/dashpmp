export const FUEL_TYPES = ["Pertalite", "Pertamax", "Pertamax Turbo", "Solar", "Dexlite"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];
