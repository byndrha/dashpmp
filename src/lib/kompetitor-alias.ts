// Penyatuan ejaan kompetitor (alias → nama resmi, atau diabaikan) dari daftar
// yang disetujui pengguna pada migrasi 2026-10-23
// (docs/data-fixes/2026-10-23-kompetitor-mitra-disetujui.json). Dipakai
// skrip migrasi (scripts/fix-kompetitor-mitra-2026-10-23.ts) dan persetujuan
// pengajuan lama berteks bebas (resolveKompetitorPengajuan), supaya teks
// seperti "Es atlas" atau "Belum ada kompetitor" tidak menjadi baris master
// baru. Murni: tanpa mssql/pg/next.
import daftarDisetujui from "../../docs/data-fixes/2026-10-23-kompetitor-mitra-disetujui.json";

/** Satu entri file disetujui. `mitra` hanya informasi dry-run (diabaikan). */
export interface EntriAliasKompetitor {
  nama: string;
  alias?: string[];
  abaikan?: boolean;
  mitra?: unknown;
}

export type PetaAliasKompetitor = Map<string, EntriAliasKompetitor>;

/** Kunci pencocokan: tanpa beda huruf besar-kecil & spasi berlebih. */
export const kunciAliasKompetitor = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Bangun peta ejaan (nama + alias, dinormalisasi) → entri. Entri tidak sah
 * tidak menghentikan proses; masalahnya dikumpulkan di `galat` (skrip
 * migrasi berhenti bila ada). Nama entri dirapikan (trim + spasi tunggal).
 */
export function bangunPetaAliasKompetitor(entri: EntriAliasKompetitor[]): { peta: PetaAliasKompetitor; galat: string[] } {
  const peta: PetaAliasKompetitor = new Map();
  const galat: string[] = [];
  for (const e of entri) {
    const nama = typeof e?.nama === "string" ? e.nama.trim().replace(/\s+/g, " ") : "";
    if (!nama) {
      galat.push(`Entri tanpa nama: ${JSON.stringify(e)}`);
      continue;
    }
    if (nama.length > 128) galat.push(`Nama terlalu panjang (>128): ${nama}`);
    if (e.alias !== undefined && (!Array.isArray(e.alias) || e.alias.some((a) => typeof a !== "string")))
      galat.push(`alias harus larik teks: ${nama}`);
    const bersih: EntriAliasKompetitor = { nama, alias: e.alias ?? [], abaikan: e.abaikan === true };
    for (const ejaan of [nama, ...(bersih.alias ?? [])]) {
      const k = kunciAliasKompetitor(ejaan);
      if (!k) continue;
      const lain = peta.get(k);
      if (lain && lain !== bersih) galat.push(`Ejaan "${ejaan}" muncul di dua entri: "${lain.nama}" dan "${nama}"`);
      else peta.set(k, bersih);
    }
  }
  return { peta, galat };
}

export type HasilAliasKompetitor =
  | { jenis: "kanonik"; nama: string }
  | { jenis: "abaikan" }
  | { jenis: "tidak-dikenal" };

/** Satu potongan teks → nama resmi / diabaikan / tidak dikenal. */
export function resolveAliasKompetitor(peta: PetaAliasKompetitor, potongan: string): HasilAliasKompetitor {
  const e = peta.get(kunciAliasKompetitor(potongan));
  if (!e) return { jenis: "tidak-dikenal" };
  if (e.abaikan) return { jenis: "abaikan" };
  return { jenis: "kanonik", nama: e.nama };
}

let petaDisetujui: PetaAliasKompetitor | null = null;

/** Peta dari daftar yang disetujui 2026-10-23 (dibangun sekali, malas). */
export function petaAliasKompetitorDisetujui(): PetaAliasKompetitor {
  if (!petaDisetujui) petaDisetujui = bangunPetaAliasKompetitor(daftarDisetujui as EntriAliasKompetitor[]).peta;
  return petaDisetujui;
}
