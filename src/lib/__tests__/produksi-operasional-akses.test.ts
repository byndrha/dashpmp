import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bolehAksiProduksi, bolehEditDenah, bolehKelolaProduksi, peranProduksi } from "../permissions";

const operator = { isProduksi: true, isSuperAdmin: false, accountScope: "pmpersada", permissions: {} };
const kantor = { isProduksi: false, isSuperAdmin: false, accountScope: "pmpersada", permissions: {} };
const canEdit = {
  isProduksi: false,
  isSuperAdmin: false,
  accountScope: "pmpersada",
  permissions: { produksi: { canView: true, canEdit: true } },
};
const superadmin = { isProduksi: false, isSuperAdmin: true, accountScope: "pmpersada", permissions: {} };
const direktur = { isProduksi: false, isSuperAdmin: false, accountScope: "direktur", permissions: {} };

test("aksi admin ditolak untuk operator", () => {
  assert.equal(bolehKelolaProduksi({ isSuperAdmin: false, accountScope: "pmpersada", permissions: {} }), false);
  assert.equal(bolehKelolaProduksi(operator), false);
});

test("bolehKelolaProduksi: superadmin, direktur, dan produksi.canEdit", () => {
  assert.equal(bolehKelolaProduksi(superadmin), true);
  assert.equal(bolehKelolaProduksi(direktur), true);
  assert.equal(bolehKelolaProduksi(canEdit), true);
  // canView saja tidak cukup.
  assert.equal(
    bolehKelolaProduksi({ isSuperAdmin: false, accountScope: "pmpersada", permissions: { produksi: { canView: true, canEdit: false } } }),
    false,
  );
  // permissions undefined (JWT lama) = tanpa akses.
  assert.equal(bolehKelolaProduksi({ isSuperAdmin: false, accountScope: "pmpersada" }), false);
});

test("bolehKelolaProduksi sama dengan bolehEditDenah", () => {
  for (const u of [operator, kantor, canEdit, superadmin, direktur]) {
    assert.equal(bolehKelolaProduksi(u), bolehEditDenah(u));
  }
});

test("bolehAksiProduksi: isProduksi atau admin produksi", () => {
  assert.equal(bolehAksiProduksi(operator), true);
  assert.equal(bolehAksiProduksi(canEdit), true);
  assert.equal(bolehAksiProduksi(superadmin), true);
  assert.equal(bolehAksiProduksi(direktur), true);
  assert.equal(bolehAksiProduksi(kantor), false);
  assert.equal(bolehAksiProduksi({ isSuperAdmin: false, accountScope: "pmpersada" }), false);
});

test("peranProduksi: operator vs admin", () => {
  assert.equal(peranProduksi(operator), "operator");
  assert.equal(peranProduksi(canEdit), "admin");
  assert.equal(peranProduksi(superadmin), "admin");
  assert.equal(peranProduksi(direktur), "admin");
  // operator yang juga punya produksi.canEdit = admin (supervisor lapangan).
  assert.equal(peranProduksi({ ...operator, permissions: { produksi: { canView: true, canEdit: true } } }), "admin");
});

// Aturan peran ditegakkan di server action, bukan hanya di UI: action admin
// wajib lewat gerbang "kelola", aksi tulis & data operator lewat "aksi", dan
// hanya bacaan keadaan (Peta/Ringkasan/FIFO/Peringatan) yang boleh "lihat".
test("server action operasional memakai gerbang yang benar", () => {
  const isi = readFileSync(join(process.cwd(), "src/app/produksi-operasional-actions.ts"), "utf8");
  assert.match(isi, /^\s*["']use server["'];/);
  const potong = isi.split(/(?=^export async function )/m).slice(1);
  const badan = new Map(potong.map((b) => [/^export async function (\w+)/.exec(b)![1], b]));
  const admin = ["koreksiIsianAction", "batalkanPanenAction", "getPencocokanAction", "getLogAction", "getPanenTerakhirAction"];
  const lihat = ["getKeadaanAction"];
  const semua = [
    "getKeadaanAction",
    "isiAirAction",
    "panenAction",
    "tandaiBabonanAction",
    "buangBabonanAction",
    "mulaiMaintenanceAction",
    "selesaiMaintenanceAction",
    "getPilihanKendaraanAction",
    "setKendaraanAktifAction",
    "cariAgenAction",
    "getRiwayatSayaAction",
    ...admin,
  ];
  assert.deepEqual([...badan.keys()].sort(), [...semua].sort());
  for (const nama of semua) {
    const b = badan.get(nama)!;
    const tingkat = admin.includes(nama) ? "kelola" : lihat.includes(nama) ? "lihat" : "aksi";
    assert.match(b, new RegExp(`gerbang\\(kode, "${tingkat}"\\)`), `${nama} harus memakai gerbang "${tingkat}"`);
    // Gerbang "lihat" (tanpa cek peran) tidak boleh menyebar tanpa disengaja.
    if (!lihat.includes(nama)) assert.doesNotMatch(b, /gerbang\(kode, "lihat"\)/, `${nama} tidak boleh memakai gerbang "lihat"`);
  }
});
