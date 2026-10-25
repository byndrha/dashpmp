// Denah produksi Es Balok (tahap 1: builder denah) — tipe dokumen + fungsi
// murni. CLIENT-SAFE: jangan mengimpor apa pun yang menarik pg/mssql/next
// server ke sini; modul ini dipakai builder (client), penampil, dan server
// action sekaligus.
// Spec: docs/superpowers/specs/2026-10-25-produksi-es-balok-builder-denah-design.md
//
// Satuan: semua posisi/ukuran elemen dan ukuran kanvas dalam UNIT GRID.
// kanvas.ukuranGrid = lebar satu unit grid dalam piksel saat zoom 100%.
// Rotasi (0/90/180/270) berporos di titik tengah elemen; kotak efektif
// (dipakai cek kanvas & tumpukan) dihitung oleh kotakElemen().
//
// ID elemen & kolom (UUID) TIDAK PERNAH berubah walau elemen dipindah,
// diganti nama, atau kolom dinomori ulang — kolomTerkunciBerubah()
// bergantung pada itu untuk aturan "kolom berisi es tidak boleh diubah".

export type Varian = "kecil" | "besar";
export type Rotasi = 0 | 90 | 180 | 270;

export interface DenahKolom {
  id: string;
  nomor: number;
  varian: Varian;
  jumlahIceCan: number;
  ukuranIceCan?: string;
  catatan?: string;
  nonaktif?: boolean;
}

interface ElemenDasar {
  id: string;
  nama: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotasi: Rotasi;
  terkunci?: boolean;
}

export interface Titik {
  x: number;
  y: number;
}

export interface BakElemen extends ElemenDasar {
  tipe: "bak";
  orientasiKolom: "horizontal" | "vertikal";
  arahNomor: "maju" | "mundur";
  kolom: DenahKolom[];
  varianBawaan: Varian;
  iceCanPerKolomBawaan: number;
  durasiBekuJam: { kecil: number; besar: number };
  kolomPerPanen: number;
  mesinIds: string[];
  catatan: string;
}

export interface MesinElemen extends ElemenDasar {
  tipe: "mesin";
  jenis: string; // mis. "Kompresor Amonia"
  kapasitas?: string;
  catatan: string;
}

export interface DerekElemen extends ElemenDasar {
  tipe: "derek";
  titikAwal: Titik;
  titikAkhir: Titik;
  bakIds: string[];
}

export interface DindingElemen extends ElemenDasar {
  tipe: "dinding";
}

export interface PintuElemen extends ElemenDasar {
  tipe: "pintu";
}

export interface AreaElemen extends ElemenDasar {
  tipe: "area"; // zona berlabel, mis. "Thawing Tank", "Area Sortir"
  warna?: string;
}

export interface LabelElemen extends ElemenDasar {
  tipe: "label";
  teks: string;
  ukuranHuruf?: number;
}

export type DenahElemen = BakElemen | MesinElemen | DerekElemen | DindingElemen | PintuElemen | AreaElemen | LabelElemen;
export type TipeElemen = DenahElemen["tipe"];
export const TIPE_ELEMEN: readonly TipeElemen[] = ["bak", "mesin", "derek", "dinding", "pintu", "area", "label"];

export interface DenahDokumen {
  skemaVersi: 1;
  kanvas: { lebar: number; tinggi: number; ukuranGrid: number };
  elemen: DenahElemen[];
}

export interface GalatDenah {
  elemenId?: string;
  kolomId?: string;
  pesan: string;
}

// ---------- Batas ukuran dokumen (penjaga input mentah dari client) ----------
// Denah nyata terbesar yang diketahui: 5 bak × 66 kolom × 36 ice can. Batas di
// bawah ini jauh di atasnya; tujuannya hanya menolak data rusak/berbahaya.
export const BATAS_ELEMEN = 500;
export const BATAS_KOLOM_PER_BAK = 1000;
export const BATAS_TOTAL_KOLOM = 20000;
export const BATAS_ICE_CAN_PER_KOLOM = 200;
export const BATAS_KANVAS = 5000; // unit grid, per sisi
export const BATAS_UKURAN_GRID = 200; // piksel
export const BATAS_PANJANG_TEKS = 1000; // karakter per field teks
export const BATAS_REFERENSI = 500; // panjang mesinIds / bakIds
export const BATAS_UKURAN_JSON = 5_000_000; // karakter JSON.stringify seluruh dokumen

// ---------- Bawaan ----------
export const ICE_CAN_BAWAAN: Record<Varian, number> = { kecil: 36, besar: 18 };
export const DURASI_BEKU_BAWAAN = { kecil: 24, besar: 32 };
const KOLOM_BAWAAN = 36;

function idBaru(): string {
  return crypto.randomUUID();
}

export function denahKosong(): DenahDokumen {
  return { skemaVersi: 1, kanvas: { lebar: 120, tinggi: 80, ukuranGrid: 20 }, elemen: [] };
}

export function buatKolom(jumlah: number, bawaan: { varian: Varian; jumlahIceCan: number }, mulaiNomor = 1): DenahKolom[] {
  return Array.from({ length: Math.max(0, Math.floor(jumlah)) }, (_, i) => ({
    id: idBaru(),
    nomor: mulaiNomor + i,
    varian: bawaan.varian,
    jumlahIceCan: bawaan.jumlahIceCan,
  }));
}

export function buatBak(x: number, y: number, opsi: Partial<BakElemen> = {}): BakElemen {
  const varianBawaan = opsi.varianBawaan ?? "kecil";
  const iceCanPerKolomBawaan = opsi.iceCanPerKolomBawaan ?? ICE_CAN_BAWAAN[varianBawaan];
  return {
    nama: "BAK",
    w: 20,
    h: 8,
    rotasi: 0,
    orientasiKolom: "horizontal",
    arahNomor: "maju",
    durasiBekuJam: { ...DURASI_BEKU_BAWAAN },
    kolomPerPanen: 1,
    mesinIds: [],
    catatan: "",
    ...opsi,
    tipe: "bak",
    id: opsi.id ?? idBaru(),
    x,
    y,
    varianBawaan,
    iceCanPerKolomBawaan,
    kolom: opsi.kolom ?? buatKolom(KOLOM_BAWAAN, { varian: varianBawaan, jumlahIceCan: iceCanPerKolomBawaan }),
  };
}

// Tambah/kurangi kolom dari UJUNG; kolom yang tetap ada mempertahankan ID-nya.
export function ubahJumlahKolom(bak: BakElemen, n: number): BakElemen {
  const target = Math.max(0, Math.floor(n));
  if (target <= bak.kolom.length) return { ...bak, kolom: bak.kolom.slice(0, target) };
  const nomorAkhir = bak.kolom.reduce((m, k) => Math.max(m, k.nomor), 0);
  const tambahan = buatKolom(
    target - bak.kolom.length,
    { varian: bak.varianBawaan, jumlahIceCan: bak.iceCanPerKolomBawaan },
    nomorAkhir + 1
  );
  return { ...bak, kolom: [...bak.kolom, ...tambahan] };
}

// Nomor 1..n mengikuti urutan array; ID tidak disentuh.
export function nomoriUlangKolom(bak: BakElemen): BakElemen {
  return { ...bak, kolom: bak.kolom.map((k, i) => ({ ...k, nomor: i + 1 })) };
}

// Kotak efektif setelah rotasi (rotasi berporos di tengah elemen).
export function kotakElemen(e: Pick<ElemenDasar, "x" | "y" | "w" | "h" | "rotasi">): { x: number; y: number; w: number; h: number } {
  if (e.rotasi === 90 || e.rotasi === 270) {
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    return { x: cx - e.h / 2, y: cy - e.w / 2, w: e.h, h: e.w };
  }
  return { x: e.x, y: e.y, w: e.w, h: e.h };
}

function bertumpuk(a: ReturnType<typeof kotakElemen>, b: ReturnType<typeof kotakElemen>): boolean {
  // Bersentuhan tepi bukan tumpukan.
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function labelElemen(e: DenahElemen): string {
  const nama = e.nama.trim();
  return nama ? `"${nama}"` : `${e.tipe} tanpa nama`;
}

function normalNama(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

export function validasiDenah(dok: DenahDokumen): GalatDenah[] {
  const galat: GalatDenah[] = [];
  const { lebar, tinggi } = dok.kanvas;
  const byId = new Map<string, DenahElemen>();
  const idKolom = new Set<string>();

  for (const e of dok.elemen) {
    if (byId.has(e.id)) galat.push({ elemenId: e.id, pesan: `ID elemen ganda (${e.id}) pada ${labelElemen(e)}.` });
    byId.set(e.id, e);
  }

  const namaBak = new Map<string, BakElemen>();
  for (const e of dok.elemen) {
    const label = labelElemen(e);
    if (!e.nama.trim()) galat.push({ elemenId: e.id, pesan: `Nama ${e.tipe} tidak boleh kosong.` });
    if (!(e.w > 0) || !(e.h > 0)) galat.push({ elemenId: e.id, pesan: `Ukuran ${label} harus lebih dari 0.` });
    const k = kotakElemen(e);
    if (k.x < 0 || k.y < 0 || k.x + k.w > lebar || k.y + k.h > tinggi) {
      galat.push({ elemenId: e.id, pesan: `${label} keluar dari batas kanvas.` });
    }

    if (e.tipe === "bak") {
      const kunci = normalNama(e.nama);
      if (kunci) {
        const lain = namaBak.get(kunci);
        if (lain) galat.push({ elemenId: e.id, pesan: `Nama bak ${label} ganda — sudah dipakai bak lain.` });
        else namaBak.set(kunci, e);
      }
      if (e.kolom.length <= 0) galat.push({ elemenId: e.id, pesan: `Bak ${label} harus punya minimal 1 kolom.` });
      if (!(e.iceCanPerKolomBawaan > 0)) galat.push({ elemenId: e.id, pesan: `Ice can per kolom bawaan bak ${label} harus lebih dari 0.` });
      if (!(e.durasiBekuJam.kecil > 0) || !(e.durasiBekuJam.besar > 0)) {
        galat.push({ elemenId: e.id, pesan: `Durasi beku bak ${label} (Kecil & Besar) harus lebih dari 0 jam.` });
      }
      if (!(e.kolomPerPanen > 0)) galat.push({ elemenId: e.id, pesan: `Kolom per panen bak ${label} harus lebih dari 0.` });
      for (const mid of e.mesinIds) {
        if (byId.get(mid)?.tipe !== "mesin") galat.push({ elemenId: e.id, pesan: `Bak ${label} menunjuk mesin yang tidak ada.` });
      }
      for (const kol of e.kolom) {
        if (idKolom.has(kol.id)) galat.push({ elemenId: e.id, kolomId: kol.id, pesan: `ID kolom ganda pada bak ${label} kolom ${kol.nomor}.` });
        idKolom.add(kol.id);
        if (!(kol.jumlahIceCan > 0)) {
          galat.push({ elemenId: e.id, kolomId: kol.id, pesan: `Jumlah ice can bak ${label} kolom ${kol.nomor} harus lebih dari 0.` });
        }
      }
    } else if (e.tipe === "derek") {
      for (const bid of e.bakIds) {
        if (byId.get(bid)?.tipe !== "bak") galat.push({ elemenId: e.id, pesan: `Derek ${label} menunjuk bak yang tidak ada.` });
      }
    }
  }

  const daftarBak = dok.elemen.filter((e): e is BakElemen => e.tipe === "bak");
  for (let i = 0; i < daftarBak.length; i++) {
    for (let j = i + 1; j < daftarBak.length; j++) {
      if (bertumpuk(kotakElemen(daftarBak[i]), kotakElemen(daftarBak[j]))) {
        galat.push({
          elemenId: daftarBak[j].id,
          pesan: `Bak ${labelElemen(daftarBak[i])} dan ${labelElemen(daftarBak[j])} bertumpuk.`,
        });
      }
    }
  }
  return galat;
}

type LokasiKolom = { bak: BakElemen; kolom: DenahKolom };

function petaKolom(dok: DenahDokumen): Map<string, LokasiKolom> {
  const peta = new Map<string, LokasiKolom>();
  for (const e of dok.elemen) {
    if (e.tipe !== "bak") continue;
    for (const kolom of e.kolom) peta.set(kolom.id, { bak: e, kolom });
  }
  return peta;
}

// Pelanggaran aturan "kolom berisi es": untuk setiap kolom berisi es (ada di
// kolomIsiIds) yang ada di denah LAMA — kolom dihapus, bak induk dihapus,
// kolom pindah ke bak lain, atau varian/jumlahIceCan/ukuranIceCan/nonaktif
// berubah. Memindah/mengganti nama/memutar bak dan menomori ulang kolom
// bukan pelanggaran. Pesan memakai nama bak & nomor kolom dari denah lama
// (yang dikenal operator).
export function kolomTerkunciBerubah(lama: DenahDokumen | null, baru: DenahDokumen, kolomIsiIds: Set<string>): GalatDenah[] {
  if (!lama || kolomIsiIds.size === 0) return [];
  const petaLama = petaKolom(lama);
  const petaBaru = petaKolom(baru);
  const idBakBaru = new Set(baru.elemen.filter((e) => e.tipe === "bak").map((e) => e.id));
  const galat: GalatDenah[] = [];

  for (const id of kolomIsiIds) {
    const l = petaLama.get(id);
    if (!l) continue;
    const sebut = `kolom ${l.kolom.nomor} di bak "${l.bak.nama.trim()}"`;
    const akhir = "masih berisi es";
    if (!idBakBaru.has(l.bak.id)) {
      galat.push({ elemenId: l.bak.id, kolomId: id, pesan: `Bak "${l.bak.nama.trim()}" tidak boleh dihapus: ${sebut} ${akhir}.` });
      continue;
    }
    const b = petaBaru.get(id);
    if (!b) {
      galat.push({ elemenId: l.bak.id, kolomId: id, pesan: `Kolom tidak boleh dihapus: ${sebut} ${akhir}.` });
      continue;
    }
    if (b.bak.id !== l.bak.id) {
      galat.push({ elemenId: l.bak.id, kolomId: id, pesan: `Kolom tidak boleh dipindah ke bak lain: ${sebut} ${akhir}.` });
      continue;
    }
    const berubah: string[] = [];
    if (b.kolom.varian !== l.kolom.varian) berubah.push("varian");
    if (b.kolom.jumlahIceCan !== l.kolom.jumlahIceCan) berubah.push("jumlah ice can");
    if ((b.kolom.ukuranIceCan ?? "").trim() !== (l.kolom.ukuranIceCan ?? "").trim()) berubah.push("ukuran ice can");
    if (!!b.kolom.nonaktif !== !!l.kolom.nonaktif) berubah.push("status nonaktif");
    if (berubah.length > 0) {
      galat.push({ elemenId: l.bak.id, kolomId: id, pesan: `${berubah.join(", ")} tidak boleh diubah: ${sebut} ${akhir}.` });
    }
  }
  return galat;
}

// jumlahKolom menghitung semua kolom (termasuk nonaktif, sesuai gambar denah);
// iceCan* adalah kapasitas, jadi kolom nonaktif tidak dihitung.
export function ringkasDenah(dok: DenahDokumen): { jumlahBak: number; jumlahKolom: number; iceCanKecil: number; iceCanBesar: number; jumlahMesin: number } {
  const r = { jumlahBak: 0, jumlahKolom: 0, iceCanKecil: 0, iceCanBesar: 0, jumlahMesin: 0 };
  for (const e of dok.elemen) {
    if (e.tipe === "mesin") r.jumlahMesin++;
    if (e.tipe !== "bak") continue;
    r.jumlahBak++;
    r.jumlahKolom += e.kolom.length;
    for (const k of e.kolom) {
      if (k.nonaktif) continue;
      if (k.varian === "kecil") r.iceCanKecil += k.jumlahIceCan;
      else r.iceCanBesar += k.jumlahIceCan;
    }
  }
  return r;
}

// ---------- Validasi bentuk (input mentah, tidak dipercaya) ----------

function objek(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function angka(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function teks(v: unknown): v is string {
  return typeof v === "string" && v.length <= BATAS_PANJANG_TEKS;
}
function teksOpsional(v: unknown): boolean {
  return v === undefined || teks(v);
}
function daftarId(v: unknown): boolean {
  return Array.isArray(v) && v.length <= BATAS_REFERENSI && v.every(teks);
}
function titik(v: unknown): boolean {
  return objek(v) && angka(v.x) && angka(v.y);
}

const ROTASI_SAH = new Set([0, 90, 180, 270]);
const VARIAN_SAH = new Set(["kecil", "besar"]);

function cekKolom(k: unknown): string | null {
  if (!objek(k)) return "kolom bukan objek";
  if (!teks(k.id) || !k.id) return "ID kolom tidak sah";
  if (!angka(k.nomor)) return "nomor kolom tidak sah";
  if (typeof k.varian !== "string" || !VARIAN_SAH.has(k.varian)) return "varian kolom tidak sah";
  if (!angka(k.jumlahIceCan) || !Number.isInteger(k.jumlahIceCan)) return "jumlah ice can tidak sah";
  if (k.jumlahIceCan > BATAS_ICE_CAN_PER_KOLOM) return `jumlah ice can melebihi ${BATAS_ICE_CAN_PER_KOLOM} per kolom`;
  if (!teksOpsional(k.ukuranIceCan) || !teksOpsional(k.catatan)) return "teks kolom tidak sah";
  if (k.nonaktif !== undefined && typeof k.nonaktif !== "boolean") return "status nonaktif kolom tidak sah";
  return null;
}

function cekElemen(e: unknown): string | null {
  if (!objek(e)) return "elemen bukan objek";
  if (typeof e.tipe !== "string" || !(TIPE_ELEMEN as readonly string[]).includes(e.tipe)) return "tipe elemen tidak dikenal";
  if (!teks(e.id) || !e.id) return "ID elemen tidak sah";
  if (!teks(e.nama)) return "nama elemen tidak sah";
  if (![e.x, e.y, e.w, e.h].every(angka)) return "posisi/ukuran elemen tidak sah";
  if (!ROTASI_SAH.has(e.rotasi as number)) return "rotasi elemen tidak sah";
  if (e.terkunci !== undefined && typeof e.terkunci !== "boolean") return "status terkunci tidak sah";

  switch (e.tipe) {
    case "bak": {
      if (e.orientasiKolom !== "horizontal" && e.orientasiKolom !== "vertikal") return "orientasi kolom tidak sah";
      if (e.arahNomor !== "maju" && e.arahNomor !== "mundur") return "arah nomor tidak sah";
      if (typeof e.varianBawaan !== "string" || !VARIAN_SAH.has(e.varianBawaan)) return "varian bawaan tidak sah";
      if (!angka(e.iceCanPerKolomBawaan) || e.iceCanPerKolomBawaan > BATAS_ICE_CAN_PER_KOLOM) return "ice can per kolom bawaan tidak sah";
      if (!objek(e.durasiBekuJam) || !angka(e.durasiBekuJam.kecil) || !angka(e.durasiBekuJam.besar)) return "durasi beku tidak sah";
      if (!angka(e.kolomPerPanen)) return "kolom per panen tidak sah";
      if (!daftarId(e.mesinIds)) return "daftar mesin tidak sah";
      if (!teks(e.catatan)) return "catatan bak tidak sah";
      if (!Array.isArray(e.kolom)) return "daftar kolom tidak sah";
      if (e.kolom.length > BATAS_KOLOM_PER_BAK) return `jumlah kolom melebihi ${BATAS_KOLOM_PER_BAK} per bak`;
      for (const k of e.kolom) {
        const g = cekKolom(k);
        if (g) return g;
      }
      return null;
    }
    case "mesin":
      if (!teks(e.jenis) || !teks(e.catatan) || !teksOpsional(e.kapasitas)) return "data mesin tidak sah";
      return null;
    case "derek":
      if (!titik(e.titikAwal) || !titik(e.titikAkhir)) return "titik derek tidak sah";
      if (!daftarId(e.bakIds)) return "daftar bak derek tidak sah";
      return null;
    case "area":
      return teksOpsional(e.warna) ? null : "warna area tidak sah";
    case "label":
      if (!teks(e.teks)) return "teks label tidak sah";
      if (e.ukuranHuruf !== undefined && !angka(e.ukuranHuruf)) return "ukuran huruf label tidak sah";
      return null;
    default:
      return null;
  }
}

// Penjaga di server untuk dokumen yang datang dari client: null bila
// bentuknya sah, selain itu pesan galat (Bahasa Indonesia). Validasi aturan
// bisnis (nama ganda, tumpukan, dst.) tetap lewat validasiDenah().
export function validasiBentukDenah(raw: unknown): string | null {
  const tolak = (alasan: string) => `Data denah tidak sah: ${alasan}.`;
  if (!objek(raw)) return tolak("bukan objek");
  if (raw.skemaVersi !== 1) return tolak("versi skema tidak didukung");
  const kv = raw.kanvas;
  if (!objek(kv) || !angka(kv.lebar) || !angka(kv.tinggi) || !angka(kv.ukuranGrid)) return tolak("ukuran kanvas tidak sah");
  if (kv.lebar <= 0 || kv.tinggi <= 0 || kv.lebar > BATAS_KANVAS || kv.tinggi > BATAS_KANVAS) {
    return tolak(`ukuran kanvas harus 1–${BATAS_KANVAS} unit grid`);
  }
  if (kv.ukuranGrid <= 0 || kv.ukuranGrid > BATAS_UKURAN_GRID) return tolak("ukuran grid tidak sah");
  if (!Array.isArray(raw.elemen)) return tolak("daftar elemen tidak sah");
  if (raw.elemen.length > BATAS_ELEMEN) return tolak(`jumlah elemen melebihi ${BATAS_ELEMEN}`);
  let totalKolom = 0;
  for (const e of raw.elemen) {
    const g = cekElemen(e);
    if (g) return tolak(g);
    if (objek(e) && Array.isArray(e.kolom)) totalKolom += e.kolom.length;
  }
  if (totalKolom > BATAS_TOTAL_KOLOM) return tolak(`total kolom melebihi ${BATAS_TOTAL_KOLOM}`);
  let ukuran: number;
  try {
    ukuran = JSON.stringify(raw).length;
  } catch {
    return tolak("tidak bisa diserialisasi");
  }
  if (ukuran > BATAS_UKURAN_JSON) return tolak("ukuran dokumen terlalu besar");
  return null;
}
