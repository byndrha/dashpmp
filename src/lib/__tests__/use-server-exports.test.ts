import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// File "use server" hanya boleh mengekspor fungsi async. Ekspor ulang tipe
// (`export type { X }` / `export { type X }`) lolos tsc dan `next build`, tetapi
// saat runtime loader server action memperlakukannya sebagai nilai dan seluruh
// modul gagal dimuat (ReferenceError) — semua action di halaman yang
// mengimpornya ikut gagal. Insiden 2026-10-24: MitraLengkapInput di
// mkesindo/(dashboard)/mitra/actions.ts mematikan Mitra dan Validasi Rute.

function semuaFile(dir: string): string[] {
  return readdirSync(dir).flatMap((nama) => {
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) return nama === "node_modules" || nama === "__tests__" ? [] : semuaFile(p);
    return /\.(ts|tsx)$/.test(nama) ? [p] : [];
  });
}

test("file 'use server' tidak mengekspor ulang tipe atau nilai non-fungsi", () => {
  const pelanggaran: string[] = [];
  for (const file of semuaFile(join(process.cwd(), "src"))) {
    const isi = readFileSync(file, "utf8");
    if (!/^\s*["']use server["'];?/.test(isi)) continue;
    isi.split(/\r?\n/).forEach((baris, i) => {
      if (/^\s*export\s+(type\s+)?\{/.test(baris) || /^\s*export\s+\*\s+from/.test(baris)) {
        pelanggaran.push(`${file}:${i + 1}: ${baris.trim()}`);
      }
    });
  }
  assert.deepEqual(pelanggaran, []);
});
