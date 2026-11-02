// Denah produksi Es Balok — tipe dokumen + fungsi murni. CLIENT-SAFE: jangan
// mengimpor apa pun yang menarik pg/mssql/next server ke sini; modul ini
// dipakai builder (client), penampil, dan server action sekaligus.
// Spec tahap 1: docs/superpowers/specs/2026-10-25-produksi-es-balok-builder-denah-design.md
// Spec v2:      docs/superpowers/specs/2026-11-01-produksi-es-balok-denah-v2-3d-design.md
//
// Satuan (skemaVersi 2): 1 unit = 1 METER. x/y/w/h, titik, elevasiM, tinggiM,
// dan ukuran kanvas dalam meter; ukuran kecil (ice can, diameter pipa) dalam
// milimeter (field berakhiran Mm). Elevasi 0 = muka lantai jadi (±0,00),
// negatif = di bawah lantai. kanvas.ukuranGrid = piksel per meter pada zoom
// 100% (tampilan saja). Dokumen v1 (unit grid, 1 unit lama = 0,5 m) diubah
// ke v2 oleh migrasiDenah() saat DIBACA; server hanya menyimpan v2.
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
  /** Dasar benda dari ±0,00 (meter; negatif = di bawah lantai). */
  elevasiM: number;
  /** Tinggi benda (meter). */
  tinggiM: number;
}

export interface Titik {
  x: number;
  y: number;
}

export interface Titik3D {
  x: number;
  y: number;
  z: number;
}

/** Panjang = sumbu sepanjang kolom, lebar = sumbu antar-kolom, tinggi = vertikal. */
export interface DimensiIceCan {
  panjangMm: number;
  lebarMm: number;
  tinggiMm: number;
  beratKg: number;
  presetId?: string;
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
  // elevasiM = dasar bak (negatif bila tertanam), tinggiM = kedalaman total
  // (bibir = elevasiM + tinggiM).
  tebalDindingM: number;
  /** Tinggi permukaan brine diukur dari dasar bak. */
  levelBrineM: number;
  jarakAntarKolomMm: number;
  jarakAntarCanMm: number;
  iceCan: Record<Varian, DimensiIceCan>;
}

export type KategoriMesin = "refrigerasi" | "pompa" | "listrik" | "lainnya";

export interface MesinElemen extends ElemenDasar {
  tipe: "mesin";
  jenis: string; // mis. "Kompresor Amonia"
  kapasitas?: string;
  catatan: string;
  /** Menentukan lapisan & warna 3D. */
  kategori: KategoriMesin;
}

export interface DerekElemen extends ElemenDasar {
  tipe: "derek";
  titikAwal: Titik;
  titikAkhir: Titik;
  bakIds: string[];
  // elevasiM = tinggi REL dari ±0,00; tinggiM = tinggi balok rel.
  /** Jarak rel → dasar kait saat terangkat penuh. */
  tinggiKaitM: number;
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

/** Balok beton: pondasi mesin, plinth, saluran, pelat tambahan. */
export interface BetonElemen extends ElemenDasar {
  tipe: "beton";
}

export type JenisTangki = "tandon" | "filling" | "thawing" | "sumur" | "cooling-tower" | "lainnya";

export interface TangkiElemen extends ElemenDasar {
  tipe: "tangki";
  jenis: JenisTangki;
  bentuk: "kotak" | "silinder";
  kapasitasM3?: number;
  /** 0–100, visual saja. */
  levelIsiPersen: number;
}

export type Fluida = "air-baku" | "air-pendingin" | "air-thawing" | "drain" | "brine" | "nh3-cair" | "nh3-gas" | "udara";

/**
 * Polyline 3D; urutan titik = ARAH ALIRAN. x/y/w/h = kotak pembungkus titik
 * (kotakJalur, untuk seleksi). dariId/keId = elemen di ujung awal/akhir.
 */
export interface JalurElemen extends ElemenDasar {
  tipe: "jalur";
  jenis: "pipa" | "kabel";
  fluida?: Fluida; // pipa
  sistem?: "daya" | "kontrol"; // kabel
  diameterMm: number;
  titik: Titik3D[];
  dariId?: string;
  keId?: string;
}

export type DenahElemen =
  | BakElemen
  | MesinElemen
  | DerekElemen
  | DindingElemen
  | PintuElemen
  | AreaElemen
  | LabelElemen
  | BetonElemen
  | TangkiElemen
  | JalurElemen;
export type TipeElemen = DenahElemen["tipe"];
export const TIPE_ELEMEN: readonly TipeElemen[] = ["bak", "mesin", "derek", "dinding", "pintu", "area", "label", "beton", "tangki", "jalur"];

/** Lapisan turunan (spec v2 §4) — tidak disimpan di dokumen. */
export type Lapisan = "arsitektur" | "proses" | "refrigerasi" | "air" | "listrik" | "lainnya";

export interface KanvasDenah {
  /** Ukuran lahan (meter). */
  lebar: number;
  tinggi: number;
  /** Piksel per meter pada zoom 100% (tampilan saja). */
  ukuranGrid: number;
  langkahSnapM: number;
  /** 0 = utara ke atas kanvas; searah jarum jam, 0–359. */
  utaraDerajat: number;
  /** Pelat beton global di bawah ±0,00. */
  pelatLantai: { tebalM: number };
}

export interface DenahDokumen {
  skemaVersi: 2;
  kanvas: KanvasDenah;
  elemen: DenahElemen[];
}

export interface GalatDenah {
  elemenId?: string;
  kolomId?: string;
  pesan: string;
  /**
   * "galat" (bawaan bila tidak diisi) memblokir Simpan; "peringatan" (dari
   * periksaTeknik) hanya ditampilkan & disorot, tidak pernah memblokir.
   */
  tingkat?: "galat" | "peringatan";
  /** Elemen lain yang terlibat (mis. bak yang dilayani derek), ikut disorot. */
  elemenTerkaitIds?: string[];
  /**
   * Kode aturan peringatan teknik (diisi periksaTeknik) — untuk logika
   * (mis. 3D mewarnai kotak ruang bebas derek). `pesan` hanya untuk tampilan.
   */
  kode?: KodePeringatan;
}

/** Kode aturan periksaTeknik (spec v2 §5 aturan 1–7). */
export type KodePeringatan =
  | "ice-can-tidak-muat"
  | "ice-can-sentuh-dasar"
  | "brine-rendah"
  | "derek-terlalu-rendah"
  | "rel-tidak-melintasi-bak"
  | "pipa-menembus-bak"
  | "nh3-tertanam"
  | "ujung-menggantung";

// Kode perusahaan pabrik Es Balok yang punya modul Produksi.
export type KodeProduksi = "pmpersada" | "pmpakis";

// ---------- Hasil simpan (dipakai server action & builder) ----------
// VERSI_BASI     = denah sudah diubah orang lain sejak builder dibuka.
// KOLOM_TERKUNCI = perubahan menyentuh kolom yang masih berisi es (galat per kolom).
// VALIDASI       = validasiDenah() di server menolak dokumen (galat per elemen).
export type KodeGalatSimpanDenah = "VERSI_BASI" | "KOLOM_TERKUNCI" | "VALIDASI";

/** Baris denah tersimpan tidak bisa dibaca (migrasiDenah melempar) — tanpa detail internal. */
export const PESAN_DENAH_RUSAK = "Data denah tersimpan rusak — hubungi admin.";

export type HasilSimpanDenah =
  | { success: true; data: { versi: number } }
  | { success: false; error: string; kodeGalat?: KodeGalatSimpanDenah; galat?: GalatDenah[] };

// ---------- Batas ukuran dokumen (penjaga input mentah dari client) ----------
// Denah nyata terbesar yang diketahui: 5 bak × 66 kolom × 36 ice can. Batas di
// bawah ini jauh di atasnya; tujuannya hanya menolak data rusak/berbahaya.
export const BATAS_ELEMEN = 500;
export const BATAS_KOLOM_PER_BAK = 1000;
export const BATAS_TOTAL_KOLOM = 20000;
export const BATAS_ICE_CAN_PER_KOLOM = 200;
export const BATAS_KANVAS = 5000; // meter, per sisi
export const BATAS_UKURAN_GRID = 200; // piksel per meter
export const BATAS_LANGKAH_SNAP_M = 10; // meter
export const BATAS_TITIK_JALUR = 1000; // titik per jalur
export const BATAS_PANJANG_TEKS = 1000; // karakter per field teks
export const BATAS_REFERENSI = 500; // panjang mesinIds / bakIds
export const BATAS_UKURAN_JSON = 5_000_000; // karakter JSON.stringify seluruh dokumen

// ---------- Bawaan ----------
export const ICE_CAN_BAWAAN: Record<Varian, number> = { kecil: 36, besar: 18 };
export const DURASI_BEKU_BAWAAN = { kecil: 24, besar: 32 };
const KOLOM_BAWAAN = 36;

/**
 * Preset ukuran ice can (spec v2 §3; tabel pasar Indonesia & FAO). Dimensi =
 * ukuran bibir atas cetakan tirus. "kustom" = bebas; angkanya hanya titik
 * awal saat preset itu dipilih.
 */
export const PRESET_ICE_CAN: readonly { id: string; label: string; panjangMm: number; lebarMm: number; tinggiMm: number; beratKg: number }[] = [
  { id: "pasar-5", label: "Pasar 5 kg", panjangMm: 80, lebarMm: 165, tinggiMm: 500, beratKg: 5 },
  { id: "pasar-10", label: "Pasar 10 kg", panjangMm: 100, lebarMm: 205, tinggiMm: 610, beratKg: 10 },
  { id: "pasar-15", label: "Pasar 15 kg", panjangMm: 100, lebarMm: 320, tinggiMm: 610, beratKg: 15 },
  { id: "pasar-20", label: "Pasar 20 kg", panjangMm: 120, lebarMm: 320, tinggiMm: 750, beratKg: 20 },
  { id: "pasar-25", label: "Pasar 25 kg", panjangMm: 120, lebarMm: 360, tinggiMm: 750, beratKg: 25 },
  { id: "pasar-50", label: "Pasar 50 kg", panjangMm: 145, lebarMm: 460, tinggiMm: 1000, beratKg: 50 },
  { id: "pasar-100", label: "Pasar 100 kg", panjangMm: 210, lebarMm: 550, tinggiMm: 1200, beratKg: 100 },
  { id: "fao-25", label: "FAO 25 kg", panjangMm: 190, lebarMm: 190, tinggiMm: 1105, beratKg: 25 },
  { id: "fao-50", label: "FAO 50 kg", panjangMm: 184, lebarMm: 408, tinggiMm: 1000, beratKg: 50 },
  { id: "fao-136", label: "FAO 136 kg", panjangMm: 280, lebarMm: 560, tinggiMm: 1220, beratKg: 136 },
  { id: "kustom", label: "Kustom", panjangMm: 120, lebarMm: 360, tinggiMm: 750, beratKg: 25 },
];

/** Kecil = preset "pasar 25 kg"; Besar = panjang 2× Kecil (lebar & tinggi sama — fakta pengguna). */
export const ICE_CAN_DIMENSI_BAWAAN: Record<Varian, DimensiIceCan> = {
  kecil: { panjangMm: 120, lebarMm: 360, tinggiMm: 750, beratKg: 25, presetId: "pasar-25" },
  besar: { panjangMm: 240, lebarMm: 360, tinggiMm: 750, beratKg: 50 },
};

/** Elevasi/tinggi bawaan (meter) per tipe, spec v2 §3. */
export const ELEVASI_TINGGI_BAWAAN: Record<TipeElemen, { elevasiM: number; tinggiM: number }> = {
  bak: { elevasiM: -0.7, tinggiM: 1.0 },
  mesin: { elevasiM: 0, tinggiM: 1.8 },
  derek: { elevasiM: 3.5, tinggiM: 0.3 },
  dinding: { elevasiM: 0, tinggiM: 4.0 },
  pintu: { elevasiM: 0, tinggiM: 2.4 },
  area: { elevasiM: 0, tinggiM: 0 },
  label: { elevasiM: 0, tinggiM: 0 },
  beton: { elevasiM: -0.5, tinggiM: 0.5 },
  tangki: { elevasiM: 0, tinggiM: 1.5 },
  jalur: { elevasiM: 0, tinggiM: 0.05 },
};

export const BAK_BAWAAN = { w: 16, h: 6.5, tebalDindingM: 0.2, levelBrineM: 0.95, jarakAntarKolomMm: 60, jarakAntarCanMm: 40 } as const;
export const TINGGI_KAIT_BAWAAN = 0.8;
export const KATEGORI_MESIN_BAWAAN: KategoriMesin = "refrigerasi";
export const TANGKI_BAWAAN = { jenis: "tandon", bentuk: "kotak", levelIsiPersen: 70 } as const;
export const DIAMETER_JALUR_BAWAAN = { pipa: 50, kabel: 25 } as const;
export const FLUIDA_BAWAAN: Fluida = "air-baku";
export const SISTEM_KABEL_BAWAAN = "daya" as const;

function idBaru(): string {
  return crypto.randomUUID();
}

function salinIceCan(v: Record<Varian, DimensiIceCan> = ICE_CAN_DIMENSI_BAWAAN): Record<Varian, DimensiIceCan> {
  return { kecil: { ...v.kecil }, besar: { ...v.besar } };
}

function kanvasBawaan(): KanvasDenah {
  return { lebar: 60, tinggi: 40, ukuranGrid: 20, langkahSnapM: 0.1, utaraDerajat: 0, pelatLantai: { tebalM: 0.2 } };
}

export function denahKosong(): DenahDokumen {
  return { skemaVersi: 2, kanvas: kanvasBawaan(), elemen: [] };
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
    w: BAK_BAWAAN.w,
    h: BAK_BAWAAN.h,
    rotasi: 0,
    elevasiM: ELEVASI_TINGGI_BAWAAN.bak.elevasiM,
    tinggiM: ELEVASI_TINGGI_BAWAAN.bak.tinggiM,
    orientasiKolom: "horizontal",
    arahNomor: "maju",
    durasiBekuJam: { ...DURASI_BEKU_BAWAAN },
    kolomPerPanen: 1,
    mesinIds: [],
    catatan: "",
    tebalDindingM: BAK_BAWAAN.tebalDindingM,
    levelBrineM: BAK_BAWAAN.levelBrineM,
    jarakAntarKolomMm: BAK_BAWAAN.jarakAntarKolomMm,
    jarakAntarCanMm: BAK_BAWAAN.jarakAntarCanMm,
    ...opsi,
    iceCan: salinIceCan(opsi.iceCan),
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

// Kotak pembungkus titik jalur; sisi yang lebih tipis dari SISI_MIN_JALUR
// dipusatkan pada titik-titiknya (agar bisa diseleksi & lolos ukuran > 0).
export const SISI_MIN_JALUR = 0.05;
export function kotakJalur(titik: readonly Titik3D[]): { x: number; y: number; w: number; h: number } {
  if (titik.length === 0) return { x: 0, y: 0, w: SISI_MIN_JALUR, h: SISI_MIN_JALUR };
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const t of titik) {
    x1 = Math.min(x1, t.x);
    y1 = Math.min(y1, t.y);
    x2 = Math.max(x2, t.x);
    y2 = Math.max(y2, t.y);
  }
  const sumbu = (a: number, b: number) =>
    b - a >= SISI_MIN_JALUR ? { awal: a, panjang: b - a } : { awal: (a + b) / 2 - SISI_MIN_JALUR / 2, panjang: SISI_MIN_JALUR };
  const sx = sumbu(x1, x2);
  const sy = sumbu(y1, y2);
  return { x: sx.awal, y: sy.awal, w: sx.panjang, h: sy.panjang };
}

const FLUIDA_REFRIGERASI: ReadonlySet<Fluida> = new Set<Fluida>(["nh3-cair", "nh3-gas", "brine"]);

/** Lapisan elemen (spec v2 §4). Pipa tanpa fluida dianggap air (bawaan air-baku). */
export function lapisanElemen(e: DenahElemen): Lapisan {
  switch (e.tipe) {
    case "dinding":
    case "pintu":
    case "area":
    case "label":
    case "beton":
      return "arsitektur";
    case "bak":
    case "derek":
      return "proses";
    case "tangki":
      return e.jenis === "filling" || e.jenis === "thawing" ? "proses" : "air";
    case "mesin":
      if (e.kategori === "refrigerasi") return "refrigerasi";
      if (e.kategori === "pompa") return "air";
      if (e.kategori === "listrik") return "listrik";
      return "lainnya";
    case "jalur":
      if (e.jenis === "kabel") return "listrik";
      return e.fluida && FLUIDA_REFRIGERASI.has(e.fluida) ? "refrigerasi" : "air";
  }
}

function bertumpuk(a: ReturnType<typeof kotakElemen>, b: ReturnType<typeof kotakElemen>): boolean {
  // Bersentuhan tepi bukan tumpukan.
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function labelElemen(e: DenahElemen): string {
  const nama = e.nama.trim();
  return nama ? `"${nama}"` : `${e.tipe} tanpa nama`;
}

// Tipe tanpa volume: area/label datar (tinggi 0 sah); tinggi jalur = diameter.
const TIPE_TANPA_VOLUME: ReadonlySet<TipeElemen> = new Set<TipeElemen>(["area", "label", "jalur"]);

function normalNama(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

export function validasiDenah(dok: DenahDokumen): GalatDenah[] {
  const galat: GalatDenah[] = [];
  const { lebar, tinggi, utaraDerajat } = dok.kanvas;
  if (!(utaraDerajat >= 0 && utaraDerajat <= 359)) galat.push({ pesan: "Arah utara harus 0–359 derajat." });
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
    // Jalur: yang dicek titiknya, bukan kotak pembungkus — kotakJalur
    // melebarkan sisi tipis ke SISI_MIN_JALUR di sekitar titik, jadi jalur
    // tepat di tepi kanvas (x=0 / y=tinggi) akan "keluar" padahal sah.
    const keluar =
      e.tipe === "jalur"
        ? e.titik.some((t) => t.x < 0 || t.y < 0 || t.x > lebar || t.y > tinggi)
        : (() => {
            const k = kotakElemen(e);
            return k.x < 0 || k.y < 0 || k.x + k.w > lebar || k.y + k.h > tinggi;
          })();
    if (keluar) {
      galat.push({ elemenId: e.id, pesan: `${label} keluar dari batas kanvas.` });
    }
    if (!TIPE_TANPA_VOLUME.has(e.tipe) && !(e.tinggiM > 0)) galat.push({ elemenId: e.id, pesan: `Tinggi ${label} harus lebih dari 0 m.` });

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
      if (!(e.tebalDindingM >= 0)) galat.push({ elemenId: e.id, pesan: `Tebal dinding bak ${label} tidak boleh negatif.` });
      if (e.levelBrineM > e.tinggiM) galat.push({ elemenId: e.id, pesan: `Level brine bak ${label} melebihi kedalaman bak.` });
      for (const v of ["kecil", "besar"] as const) {
        const d = e.iceCan[v];
        if (!(d.panjangMm > 0) || !(d.lebarMm > 0) || !(d.tinggiMm > 0) || !(d.beratKg > 0)) {
          galat.push({ elemenId: e.id, pesan: `Dimensi & berat ice can ${v === "kecil" ? "Kecil" : "Besar"} bak ${label} harus lebih dari 0.` });
        }
      }
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
    } else if (e.tipe === "jalur") {
      if (e.titik.length < 2) galat.push({ elemenId: e.id, pesan: `Jalur ${label} harus punya minimal 2 titik.` });
      if (!(e.diameterMm > 0)) galat.push({ elemenId: e.id, pesan: `Diameter jalur ${label} harus lebih dari 0 mm.` });
      for (const [ujung, ref] of [["awal", e.dariId], ["akhir", e.keId]] as const) {
        if (ref && !byId.has(ref)) {
          galat.push({ elemenId: e.id, pesan: `Ujung ${ujung} jalur ${label} menunjuk elemen yang tidak ada.` });
        }
      }
    } else if (e.tipe === "tangki") {
      if (!(e.levelIsiPersen >= 0 && e.levelIsiPersen <= 100)) galat.push({ elemenId: e.id, pesan: `Level isi tangki ${label} harus 0–100%.` });
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

  // Dimensi ice can per varian (iceCan[varian]) terkunci selama bak masih
  // punya kolom berisi es bervarian itu (varian menurut denah lama). Satu
  // galat per bak per varian; bak yang dihapus sudah dilaporkan di atas.
  const bakBaru = new Map(baru.elemen.filter((e): e is BakElemen => e.tipe === "bak").map((e) => [e.id, e]));
  const sudah = new Set<string>();
  for (const id of kolomIsiIds) {
    const l = petaLama.get(id);
    if (!l) continue;
    const v = l.kolom.varian;
    const kunci = `${l.bak.id}:${v}`;
    const b = bakBaru.get(l.bak.id);
    if (!b || sudah.has(kunci)) continue;
    sudah.add(kunci);
    if (!samaDimensiIceCan(l.bak.iceCan?.[v], b.iceCan?.[v])) {
      const namaVarian = v === "kecil" ? "Kecil" : "Besar";
      galat.push({
        elemenId: l.bak.id,
        kolomId: id,
        pesan: `dimensi ice can ${namaVarian} tidak boleh diubah: kolom ${l.kolom.nomor} di bak "${l.bak.nama.trim()}" masih berisi es.`,
      });
    }
  }
  return galat;
}

function samaDimensiIceCan(a: DimensiIceCan | undefined, b: DimensiIceCan | undefined): boolean {
  if (!a || !b) return a === b;
  return a.panjangMm === b.panjangMm && a.lebarMm === b.lebarMm && a.tinggiMm === b.tinggiMm && a.beratKg === b.beratKg;
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
function titik3D(v: unknown): boolean {
  return objek(v) && angka(v.x) && angka(v.y) && angka(v.z);
}
function dimensiIceCan(v: unknown): boolean {
  return objek(v) && angka(v.panjangMm) && angka(v.lebarMm) && angka(v.tinggiMm) && angka(v.beratKg) && teksOpsional(v.presetId);
}
function anggota(v: unknown, sah: ReadonlySet<string>): boolean {
  return typeof v === "string" && sah.has(v);
}

const ROTASI_SAH = new Set([0, 90, 180, 270]);
const VARIAN_SAH = new Set(["kecil", "besar"]);
const KATEGORI_MESIN_SAH: ReadonlySet<string> = new Set<KategoriMesin>(["refrigerasi", "pompa", "listrik", "lainnya"]);
const JENIS_TANGKI_SAH: ReadonlySet<string> = new Set<JenisTangki>(["tandon", "filling", "thawing", "sumur", "cooling-tower", "lainnya"]);
const BENTUK_TANGKI_SAH: ReadonlySet<string> = new Set(["kotak", "silinder"]);
const JENIS_JALUR_SAH: ReadonlySet<string> = new Set(["pipa", "kabel"]);
const FLUIDA_SAH: ReadonlySet<string> = new Set<Fluida>([
  "air-baku", "air-pendingin", "air-thawing", "drain", "brine", "nh3-cair", "nh3-gas", "udara",
]);
const SISTEM_KABEL_SAH: ReadonlySet<string> = new Set(["daya", "kontrol"]);

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
  if (!angka(e.elevasiM) || !angka(e.tinggiM)) return "elevasi/tinggi elemen tidak sah";

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
      if (![e.tebalDindingM, e.levelBrineM, e.jarakAntarKolomMm, e.jarakAntarCanMm].every(angka)) return "ukuran dinding/brine/jarak bak tidak sah";
      if ((e.jarakAntarKolomMm as number) < 0 || (e.jarakAntarCanMm as number) < 0) return "jarak antar kolom/ice can tidak boleh negatif";
      if (!objek(e.iceCan) || !dimensiIceCan(e.iceCan.kecil) || !dimensiIceCan(e.iceCan.besar)) return "dimensi ice can tidak sah";
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
      if (!anggota(e.kategori, KATEGORI_MESIN_SAH)) return "kategori mesin tidak sah";
      return null;
    case "derek":
      if (!titik(e.titikAwal) || !titik(e.titikAkhir)) return "titik derek tidak sah";
      if (!daftarId(e.bakIds)) return "daftar bak derek tidak sah";
      if (!angka(e.tinggiKaitM)) return "tinggi kait derek tidak sah";
      return null;
    case "tangki":
      if (!anggota(e.jenis, JENIS_TANGKI_SAH)) return "jenis tangki tidak sah";
      if (!anggota(e.bentuk, BENTUK_TANGKI_SAH)) return "bentuk tangki tidak sah";
      if (e.kapasitasM3 !== undefined && !angka(e.kapasitasM3)) return "kapasitas tangki tidak sah";
      if (!angka(e.levelIsiPersen)) return "level isi tangki tidak sah";
      return null;
    case "jalur":
      if (!anggota(e.jenis, JENIS_JALUR_SAH)) return "jenis jalur tidak sah";
      if (e.fluida !== undefined && !anggota(e.fluida, FLUIDA_SAH)) return "fluida jalur tidak dikenal";
      if (e.sistem !== undefined && !anggota(e.sistem, SISTEM_KABEL_SAH)) return "sistem kabel tidak sah";
      if (!angka(e.diameterMm) || e.diameterMm <= 0) return "diameter jalur tidak sah";
      if (!Array.isArray(e.titik)) return "titik jalur tidak sah";
      if (e.titik.length > BATAS_TITIK_JALUR) return `titik jalur melebihi ${BATAS_TITIK_JALUR}`;
      if (!e.titik.every(titik3D)) return "titik jalur tidak sah";
      if (!teksOpsional(e.dariId) || !teksOpsional(e.keId)) return "ujung jalur tidak sah";
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
  if (raw.skemaVersi !== 2) return tolak("versi skema tidak didukung");
  const kv = raw.kanvas;
  if (!objek(kv) || !angka(kv.lebar) || !angka(kv.tinggi) || !angka(kv.ukuranGrid)) return tolak("ukuran kanvas tidak sah");
  if (kv.lebar <= 0 || kv.tinggi <= 0 || kv.lebar > BATAS_KANVAS || kv.tinggi > BATAS_KANVAS) {
    return tolak(`ukuran lahan harus lebih dari 0 dan paling besar ${BATAS_KANVAS} m`);
  }
  if (kv.ukuranGrid <= 0 || kv.ukuranGrid > BATAS_UKURAN_GRID) return tolak("ukuran grid tidak sah");
  if (!angka(kv.langkahSnapM) || kv.langkahSnapM <= 0 || kv.langkahSnapM > BATAS_LANGKAH_SNAP_M) return tolak("langkah snap tidak sah");
  if (!angka(kv.utaraDerajat) || kv.utaraDerajat < 0 || kv.utaraDerajat > 359) return tolak("arah utara harus 0–359 derajat");
  if (!objek(kv.pelatLantai) || !angka(kv.pelatLantai.tebalM) || kv.pelatLantai.tebalM < 0) return tolak("tebal pelat lantai tidak sah");
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

// ---------- Migrasi (dijalankan saat MEMBACA dokumen tersimpan) ----------

/** 1 unit grid v1 = 0,5 m. */
const SKALA_V1_KE_METER = 0.5;

type Mentah = Record<string, unknown>;

function isi(o: Mentah, kunci: string, nilai: unknown): void {
  if (o[kunci] === undefined) o[kunci] = nilai;
}

function skalakanTitik(v: unknown, skala: number): void {
  if (!objek(v)) return;
  if (angka(v.x)) v.x *= skala;
  if (angka(v.y)) v.y *= skala;
}

function lengkapiElemen(asli: unknown, skala: number): DenahElemen {
  if (!objek(asli)) throw new Error("Data denah tidak sah: elemen bukan objek.");
  const tipe = asli.tipe;
  if (typeof tipe !== "string" || !(TIPE_ELEMEN as readonly string[]).includes(tipe)) {
    throw new Error(`Data denah tidak sah: tipe elemen "${String(tipe)}" tidak dikenal.`);
  }
  const t = tipe as TipeElemen;
  const e = structuredClone(asli); // jangan mengubah objek masukan

  if (skala !== 1) {
    for (const k of ["x", "y", "w", "h"]) if (angka(e[k])) e[k] = (e[k] as number) * skala;
    skalakanTitik(e.titikAwal, skala);
    skalakanTitik(e.titikAkhir, skala);
    if (Array.isArray(e.titik)) for (const p of e.titik) skalakanTitik(p, skala);
  }

  isi(e, "elevasiM", ELEVASI_TINGGI_BAWAAN[t].elevasiM);
  isi(e, "tinggiM", ELEVASI_TINGGI_BAWAAN[t].tinggiM);
  switch (t) {
    case "bak": {
      isi(e, "tebalDindingM", BAK_BAWAAN.tebalDindingM);
      isi(e, "levelBrineM", BAK_BAWAAN.levelBrineM);
      isi(e, "jarakAntarKolomMm", BAK_BAWAAN.jarakAntarKolomMm);
      isi(e, "jarakAntarCanMm", BAK_BAWAAN.jarakAntarCanMm);
      if (!objek(e.iceCan)) e.iceCan = {};
      const ic = e.iceCan as Mentah;
      for (const v of ["kecil", "besar"] as const) {
        if (!objek(ic[v])) {
          ic[v] = { ...ICE_CAN_DIMENSI_BAWAAN[v] };
          continue;
        }
        // Lengkapi angka yang hilang saja; presetId TIDAK diisi (dimensi
        // yang sudah ada mungkin ukuran kustom).
        const d = ic[v] as Mentah;
        const bawaan = ICE_CAN_DIMENSI_BAWAAN[v];
        isi(d, "panjangMm", bawaan.panjangMm);
        isi(d, "lebarMm", bawaan.lebarMm);
        isi(d, "tinggiMm", bawaan.tinggiMm);
        isi(d, "beratKg", bawaan.beratKg);
      }
      break;
    }
    case "mesin":
      isi(e, "kategori", KATEGORI_MESIN_BAWAAN);
      break;
    case "derek":
      isi(e, "tinggiKaitM", TINGGI_KAIT_BAWAAN);
      break;
    case "tangki":
      isi(e, "jenis", TANGKI_BAWAAN.jenis);
      isi(e, "bentuk", TANGKI_BAWAAN.bentuk);
      isi(e, "levelIsiPersen", TANGKI_BAWAAN.levelIsiPersen);
      break;
    case "jalur": {
      isi(e, "jenis", "pipa");
      const kabel = e.jenis === "kabel";
      if (kabel) isi(e, "sistem", SISTEM_KABEL_BAWAAN);
      else isi(e, "fluida", FLUIDA_BAWAAN);
      isi(e, "diameterMm", kabel ? DIAMETER_JALUR_BAWAAN.kabel : DIAMETER_JALUR_BAWAAN.pipa);
      isi(e, "titik", []);
      break;
    }
    default:
      break;
  }
  return e as unknown as DenahElemen;
}

/**
 * Ubah dokumen tersimpan (v1 atau v2, mentah dari DB) menjadi DenahDokumen v2.
 * - v1: koordinat & ukuran (x, y, w, h, titikAwal/Akhir, kanvas lebar/tinggi)
 *   × 0,5 (1 unit lama = 0,5 m); ukuranGrid × 2 (tampilan piksel tetap sama);
 *   lalu field baru diisi bawaan.
 * - v2: diteruskan apa adanya; hanya field yang hilang dilengkapi bawaan.
 * - bentuk lain: lempar Error.
 * ID elemen & kolom tidak pernah diubah. Objek masukan tidak dimutasi.
 * Fungsi ini TIDAK memvalidasi isi secara menyeluruh (lihat validasiBentukDenah).
 */
export function migrasiDenah(raw: unknown): DenahDokumen {
  if (!objek(raw)) throw new Error("Data denah tidak sah: bukan objek.");
  const versi = raw.skemaVersi;
  if (versi !== 1 && versi !== 2) throw new Error(`Data denah tidak sah: versi skema ${String(versi)} tidak didukung.`);
  if (!objek(raw.kanvas)) throw new Error("Data denah tidak sah: kanvas bukan objek.");
  if (!Array.isArray(raw.elemen)) throw new Error("Data denah tidak sah: daftar elemen tidak sah.");
  const skala = versi === 1 ? SKALA_V1_KE_METER : 1;

  const kv: Mentah = structuredClone(raw.kanvas);
  if (skala !== 1) {
    if (angka(kv.lebar)) kv.lebar *= skala;
    if (angka(kv.tinggi)) kv.tinggi *= skala;
    // ×2 bisa melewati BATAS_UKURAN_GRID (mis. v1 150 → 300) dan membuat
    // dokumen hasil migrasi ditolak validasiBentukDenah saat disimpan.
    if (angka(kv.ukuranGrid)) kv.ukuranGrid = Math.min(kv.ukuranGrid / skala, BATAS_UKURAN_GRID);
  }
  const bawaan = kanvasBawaan();
  isi(kv, "lebar", bawaan.lebar);
  isi(kv, "tinggi", bawaan.tinggi);
  isi(kv, "ukuranGrid", bawaan.ukuranGrid);
  isi(kv, "langkahSnapM", bawaan.langkahSnapM);
  isi(kv, "utaraDerajat", bawaan.utaraDerajat);
  if (!objek(kv.pelatLantai)) kv.pelatLantai = { ...bawaan.pelatLantai };
  else isi(kv.pelatLantai, "tebalM", bawaan.pelatLantai.tebalM);

  return {
    skemaVersi: 2,
    kanvas: kv as unknown as KanvasDenah,
    elemen: raw.elemen.map((e) => lengkapiElemen(e, skala)),
  };
}
