// State Builder Denah Produksi — reducer MURNI + riwayat undo/redo.
// TIDAK BOLEH mengimpor React (diuji langsung oleh node:test di
// src/lib/__tests__/produksi-denah-builder.test.ts).
//
// Riwayat menyimpan SNAPSHOT dokumen (objek immutable, jadi murah: elemen
// yang tidak berubah dibagi antar-snapshot). Aturannya:
// - Setiap aksi yang mengubah dokumen = satu entri riwayat.
// - Selama "transaksi" (drag ubah ukuran / titik derek) perubahan langsung
//   diterapkan TANPA entri; akhiriTransaksi menambah SATU entri (dokumen
//   sebelum transaksi), batalTransaksi mengembalikan dokumen awal.
// - Aksi dengan `gabung` yang sama berturut-turut (mis. mengetik nama)
//   digabung menjadi satu entri.
// - Seleksi & papan klip BUKAN bagian riwayat.

import {
  buatBak,
  kotakElemen,
  kotakJalur,
  DIAMETER_JALUR_BAWAAN,
  ELEVASI_TINGGI_BAWAAN,
  FLUIDA_BAWAAN,
  KATEGORI_MESIN_BAWAAN,
  SISTEM_KABEL_BAWAAN,
  TANGKI_BAWAAN,
  TINGGI_KAIT_BAWAAN,
  nomoriUlangKolom,
  ubahJumlahKolom,
  type BakElemen,
  type DenahDokumen,
  type DenahElemen,
  type DenahKolom,
  type DerekElemen,
  type Fluida,
  type JalurElemen,
  type Rotasi,
  type TipeElemen,
  type Titik,
  type Titik3D,
} from "@/lib/produksi-denah";

export const BATAS_RIWAYAT = 200;

export interface Kotak {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StateBuilder {
  dok: DenahDokumen;
  /** Dokumen yang terakhir tersimpan di server (kotor = dok !== tersimpan). */
  tersimpan: DenahDokumen;
  lalu: DenahDokumen[]; // tumpukan undo (terlama di depan)
  nanti: DenahDokumen[]; // tumpukan redo (terdekat di belakang)
  /** Dokumen saat transaksi dimulai; null = tidak ada transaksi. */
  transaksi: DenahDokumen | null;
  /** Kunci gabung entri terakhir (null = entri berikutnya selalu baru). */
  gabungTerakhir: string | null;
  terpilih: string[];
  /** Kolom terpilih — selalu milik SATU bak (= terpilih[0]). */
  kolomTerpilih: string[];
  /** Jangkar shift-klik rentang kolom. */
  jangkarKolom: string | null;
  papanKlip: DenahElemen[];
  jumlahTempel: number;
}

export type SisiRata = "kiri" | "tengahH" | "kanan" | "atas" | "tengahV" | "bawah";

export type AksiBuilder =
  | { type: "muat"; dok: DenahDokumen }
  | { type: "tandaiTersimpan"; dok: DenahDokumen }
  | { type: "tambah"; elemen: DenahElemen[] }
  | { type: "pindah"; ids: string[]; dx: number; dy: number }
  | { type: "hapus"; ids: string[] }
  | { type: "duplikat"; ids: string[]; offset?: number }
  | { type: "salin"; ids: string[] }
  | { type: "potong"; ids: string[] }
  | { type: "tempel"; offset?: number }
  | { type: "ubahElemen"; id: string; patch: Partial<DenahElemen>; gabung?: string }
  | { type: "aturKotak"; id: string; kotak: Kotak }
  | { type: "aturTitikDerek"; id: string; titikAwal: Titik; titikAkhir: Titik }
  | { type: "putar"; ids: string[] }
  /** Balik arah aliran jalur: urutan titik dibalik, dariId/keId ditukar. */
  | { type: "balikJalur"; id: string }
  | { type: "urutan"; ids: string[]; ke: "depan" | "belakang" }
  | { type: "kunci"; ids: string[]; terkunci: boolean }
  | { type: "ratakan"; ids: string[]; sisi: SisiRata }
  | { type: "ubahJumlahKolom"; bakId: string; n: number }
  | { type: "ubahKolom"; bakId: string; kolomIds: string[]; patch: Partial<Omit<DenahKolom, "id" | "nomor">>; gabung?: string }
  | { type: "terapkanBawaan"; bakId: string }
  | { type: "nomoriUlang"; bakId: string }
  | { type: "ubahKanvas"; kanvas: Partial<DenahDokumen["kanvas"]>; gabung?: string }
  | { type: "mulaiTransaksi" }
  | { type: "akhiriTransaksi" }
  | { type: "batalTransaksi" }
  | { type: "undo" }
  | { type: "redo" }
  /** Putus penggabungan (mis. saat input kehilangan fokus). */
  | { type: "putusGabung" }
  | { type: "pilih"; ids: string[]; tambah?: boolean }
  | { type: "togglePilih"; id: string }
  | { type: "pilihSemua" }
  | { type: "pilihKolom"; bakId: string; kolomId: string; rentang?: boolean; toggle?: boolean }
  | { type: "aturKolomTerpilih"; bakId: string; kolomIds: string[] };

export function stateAwal(dok: DenahDokumen): StateBuilder {
  return {
    dok,
    tersimpan: dok,
    lalu: [],
    nanti: [],
    transaksi: null,
    gabungTerakhir: null,
    terpilih: [],
    kolomTerpilih: [],
    jangkarKolom: null,
    papanKlip: [],
    jumlahTempel: 0,
  };
}

export const bisaUndo = (s: StateBuilder) => s.transaksi === null && s.lalu.length > 0;
export const bisaRedo = (s: StateBuilder) => s.transaksi === null && s.nanti.length > 0;
export const kotor = (s: StateBuilder) => s.dok !== s.tersimpan;

// ---------- Nama & pabrik elemen ----------

export const NAMA_TIPE: Record<TipeElemen, string> = {
  bak: "Bak",
  mesin: "Mesin",
  derek: "Derek",
  dinding: "Dinding",
  pintu: "Pintu",
  area: "Area",
  label: "Label",
  beton: "Beton",
  tangki: "Tangki",
  jalur: "Jalur",
};

/** Ukuran bawaan saat alat diklik (tanpa drag), dalam meter. */
export const UKURAN_BAWAAN: Record<TipeElemen, { w: number; h: number }> = {
  bak: { w: 16, h: 6.5 },
  mesin: { w: 2, h: 2 },
  derek: { w: 16, h: 0.3 },
  dinding: { w: 10, h: 0.2 },
  pintu: { w: 1.2, h: 0.2 },
  area: { w: 6, h: 4 },
  label: { w: 4, h: 1 },
  beton: { w: 2, h: 2 },
  tangki: { w: 2, h: 2 },
  jalur: { w: 1, h: 1 },
};

/** Tebal dinding bawaan (meter), juga untuk dinding yang ditarik dari garis. */
export const TEBAL_DINDING = 0.2;
/** Lebar minimum kotak derek (meter) = tinggi balok rel bawaan. */
const LEBAR_MIN_DEREK = 0.3;
/** z bawaan titik jalur baru (meter) sampai builder punya "elevasi kerja". */
const Z_JALUR_BAWAAN = -0.1;

/** Pilihan langkah snap (meter), spec §1. */
export const PILIHAN_LANGKAH_SNAP = [0.05, 0.1, 0.25, 0.5, 1] as const;
/** Elevasi kerja bawaan (meter) — z titik alat Jalur; state builder, BUKAN dokumen. */
export const ELEVASI_KERJA_BAWAAN = -0.1;

const bulat2 = (v: number) => Math.round(v * 100) / 100;
// Buang sisa floating-point (0.1 * 3 = 0.30000000000000004).
const bersih = (v: number) => Math.round(v * 1e6) / 1e6 + 0;

/** Snap ke kelipatan `langkah` (meter); nonaktif (Alt) = presisi 1 cm. */
export function snapTitik(p: Titik, aktif: boolean, langkah: number): Titik {
  if (!aktif || !(langkah > 0)) return { x: bulat2(p.x), y: bulat2(p.y) };
  return { x: bersih(Math.round(p.x / langkah) * langkah), y: bersih(Math.round(p.y / langkah) * langkah) };
}

/** Arah utara → derajat BULAT 0–359 (validasiDenah menolak pecahan / di luar rentang). */
export function normalisasiUtara(derajat: number): number {
  if (!Number.isFinite(derajat)) return 0;
  return (((Math.round(derajat) % 360) + 360) % 360) + 0;
}

/** Kapasitas per siklus (kg) satu bak: Σ jumlah ice can × berat varian, kolom aktif saja. */
export function kapasitasSiklusKg(bak: BakElemen): number {
  let kg = 0;
  for (const k of bak.kolom) if (!k.nonaktif) kg += k.jumlahIceCan * bak.iceCan[k.varian].beratKg;
  return kg;
}

function normal(s: string) {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/** "Bak N" berikutnya: N = (angka terbesar yang sudah dipakai pola "<Tipe> N") + 1. */
export function namaBerikut(elemen: readonly DenahElemen[], tipe: TipeElemen): string {
  const dasar = NAMA_TIPE[tipe];
  const pola = new RegExp(`^${dasar}\\s+(\\d+)$`, "i");
  let maks = 0;
  for (const e of elemen) {
    if (e.tipe !== tipe) continue;
    const m = pola.exec(e.nama.trim());
    if (m) maks = Math.max(maks, Number(m[1]));
  }
  return `${dasar} ${maks + 1}`;
}

/** Nama unik di antara `dipakai` (dinormalisasi): "Bak 3" -> "Bak 4", "BAK A" -> "BAK A 2". */
export function namaUnik(nama: string, dipakai: Set<string>): string {
  if (!dipakai.has(normal(nama))) return nama;
  const m = /^(.*?)(\s*)(\d+)$/.exec(nama.trim());
  const dasar = m ? m[1] : nama.trim();
  const spasi = m ? m[2] || " " : " ";
  let n = m ? Number(m[3]) + 1 : 2;
  while (dipakai.has(normal(`${dasar}${spasi}${n}`))) n++;
  return `${dasar}${spasi}${n}`;
}

function garisKeKotak(a: Titik, b: Titik): Kotak {
  // Kotak derek minimal LEBAR_MIN_DEREK per sisi (validasi ukuran > 0); sisi
  // yang lebih tipis dipusatkan pada garis agar garis seleksi tidak miring.
  const sumbu = (p: number, q: number) => {
    const d = Math.abs(p - q);
    return d >= LEBAR_MIN_DEREK
      ? { awal: Math.min(p, q), panjang: d }
      : { awal: (p + q) / 2 - LEBAR_MIN_DEREK / 2, panjang: LEBAR_MIN_DEREK };
  };
  const sx = sumbu(a.x, b.x);
  const sy = sumbu(a.y, b.y);
  return { x: sx.awal, y: sy.awal, w: sx.panjang, h: sy.panjang };
}

/**
 * Buat elemen baru. Untuk derek/dinding `kotak` diabaikan bila `garis` diisi:
 * derek memakai titik A→B apa adanya; dinding diluruskan ke sumbu dominan
 * dengan tebal TEBAL_DINDING. Elevasi/tinggi memakai bawaan spec v2 §3.
 */
export function buatElemen(
  tipe: TipeElemen,
  kotak: Kotak,
  elemenAda: readonly DenahElemen[],
  garis?: { a: Titik; b: Titik }
): DenahElemen {
  const id = crypto.randomUUID();
  const nama = namaBerikut(elemenAda, tipe);
  const dasar = { id, nama, rotasi: 0 as Rotasi, ...ELEVASI_TINGGI_BAWAAN[tipe], ...kotak };
  switch (tipe) {
    case "bak":
      return buatBak(kotak.x, kotak.y, { id, nama, w: kotak.w, h: kotak.h });
    case "mesin":
      return { ...dasar, tipe, jenis: "Kompresor Amonia", catatan: "", kategori: KATEGORI_MESIN_BAWAAN };
    case "derek": {
      const a = garis?.a ?? { x: kotak.x, y: kotak.y + kotak.h / 2 };
      const b = garis?.b ?? { x: kotak.x + kotak.w, y: kotak.y + kotak.h / 2 };
      return { ...dasar, ...garisKeKotak(a, b), tipe, titikAwal: { ...a }, titikAkhir: { ...b }, bakIds: [], tinggiKaitM: TINGGI_KAIT_BAWAAN };
    }
    case "dinding": {
      if (!garis) return { ...dasar, tipe };
      const { a, b } = garis;
      const mendatar = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
      const k = mendatar
        ? { x: Math.min(a.x, b.x), y: a.y, w: Math.max(TEBAL_DINDING, Math.abs(b.x - a.x)), h: TEBAL_DINDING }
        : { x: a.x, y: Math.min(a.y, b.y), w: TEBAL_DINDING, h: Math.max(TEBAL_DINDING, Math.abs(b.y - a.y)) };
      return { ...dasar, ...k, tipe };
    }
    case "pintu":
      return { ...dasar, tipe };
    case "area":
      return { ...dasar, tipe };
    case "label":
      return { ...dasar, tipe, teks: "Label" };
    case "beton":
      return { ...dasar, tipe };
    case "tangki":
      return { ...dasar, tipe, jenis: TANGKI_BAWAAN.jenis, bentuk: TANGKI_BAWAAN.bentuk, levelIsiPersen: TANGKI_BAWAAN.levelIsiPersen };
    case "jalur": {
      // Sementara: pipa lurus sepanjang kotak/garis; alat Jalur titik-demi-titik menyusul.
      const a = garis?.a ?? { x: kotak.x, y: kotak.y + kotak.h / 2 };
      const b = garis?.b ?? { x: kotak.x + kotak.w, y: kotak.y + kotak.h / 2 };
      const titik = [{ ...a, z: Z_JALUR_BAWAAN }, { ...b, z: Z_JALUR_BAWAAN }];
      return { ...buatJalur(titik, { jenis: "pipa", fluida: FLUIDA_BAWAAN, diameterMm: DIAMETER_JALUR_BAWAAN.pipa }, elemenAda), id, nama };
    }
  }
}

/** Opsi alat Jalur (bilah opsi saat alat aktif). */
export interface OpsiJalur {
  jenis: JalurElemen["jenis"];
  fluida?: Fluida;
  sistem?: "daya" | "kontrol";
  diameterMm: number;
}

/** Kotak, elevasi (z terendah) & tinggi (= diameter) jalur diturunkan dari titik/diameter. */
export function rapikanJalur(j: JalurElemen): JalurElemen {
  const elevasiM = j.titik.length ? Math.min(...j.titik.map((t) => t.z)) : j.elevasiM;
  const baru: JalurElemen = { ...j, ...kotakJalur(j.titik), rotasi: 0, elevasiM, tinggiM: j.diameterMm > 0 ? j.diameterMm / 1000 : j.tinggiM };
  // Field opsional yang dikosongkan (patch `undefined`) dibuang agar dokumen ringkas.
  for (const k of ["fluida", "sistem", "dariId", "keId"] as const) if (baru[k] === undefined) delete baru[k];
  return baru;
}

/** Jalur baru dari titik (urutan = arah aliran). Pipa memakai fluida, kabel memakai sistem. */
export function buatJalur(titik: readonly Titik3D[], opsi: OpsiJalur, elemenAda: readonly DenahElemen[], dariId?: string, keId?: string): JalurElemen {
  const j: JalurElemen = {
    tipe: "jalur",
    id: crypto.randomUUID(),
    nama: namaBerikut(elemenAda, "jalur"),
    rotasi: 0,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    elevasiM: 0,
    tinggiM: 0,
    jenis: opsi.jenis,
    diameterMm: opsi.diameterMm,
    titik: titik.map((t) => ({ x: t.x, y: t.y, z: t.z })),
  };
  if (opsi.jenis === "kabel") j.sistem = opsi.sistem ?? SISTEM_KABEL_BAWAAN;
  else j.fluida = opsi.fluida ?? FLUIDA_BAWAAN;
  if (dariId) j.dariId = dariId;
  if (keId) j.keId = keId;
  return rapikanJalur(j);
}

/** Panjang total jalur (meter, 3D: termasuk naik/turun). */
export function panjangJalur(j: Pick<JalurElemen, "titik">): number {
  let l = 0;
  for (let i = 1; i < j.titik.length; i++) {
    const a = j.titik[i - 1];
    const b = j.titik[i];
    l += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return l;
}

/** Hasil tempel ujung jalur: posisi baru (+ z bila menempel ke ujung jalur lain) & elemen yang disambung. */
export interface TempelUjung {
  x: number;
  y: number;
  z?: number;
  elemenId: string;
}

// Area & label adalah zona/teks: jalur boleh melintas tanpa ditarik ke tepinya.
const TIDAK_DITEMPEL = new Set<TipeElemen>(["jalur", "area", "label"]);

/**
 * Tempel titik ujung jalur (spec §6): (1) ke ujung jalur lain dalam `radiusM`
 * (ikut z-nya agar benar-benar tersambung), atau (2) ke tepi terdekat elemen
 * non-jalur `idDiBawah` (elemen di bawah kursor). null = tidak menempel.
 */
export function tempelUjungJalur(
  p: Titik,
  elemen: readonly DenahElemen[],
  radiusM: number,
  idDiBawah: string | null,
  kecualiId?: string
): TempelUjung | null {
  let terbaik: (TempelUjung & { d: number }) | null = null;
  for (const e of elemen) {
    if (e.tipe !== "jalur" || e.id === kecualiId || e.titik.length === 0) continue;
    for (const t of [e.titik[0], e.titik[e.titik.length - 1]]) {
      const d = Math.hypot(t.x - p.x, t.y - p.y);
      if (d <= radiusM && (!terbaik || d < terbaik.d)) terbaik = { x: t.x, y: t.y, z: t.z, elemenId: e.id, d };
    }
  }
  if (terbaik) return { x: terbaik.x, y: terbaik.y, z: terbaik.z, elemenId: terbaik.elemenId };
  const e = idDiBawah ? elemen.find((x) => x.id === idDiBawah) : undefined;
  if (!e || TIDAK_DITEMPEL.has(e.tipe)) return null;
  const k = kotakElemen(e);
  const x = Math.min(Math.max(p.x, k.x), k.x + k.w);
  const y = Math.min(Math.max(p.y, k.y), k.y + k.h);
  const jarak = [x - k.x, k.x + k.w - x, y - k.y, k.y + k.h - y];
  const i = jarak.indexOf(Math.min(...jarak));
  if (i === 0) return { x: k.x, y, elemenId: e.id };
  if (i === 1) return { x: k.x + k.w, y, elemenId: e.id };
  if (i === 2) return { x, y: k.y, elemenId: e.id };
  return { x, y: k.y + k.h, elemenId: e.id };
}

// ---------- Geometri ----------

/** Pindahkan elemen; derek juga menggeser kedua titik ABSOLUT-nya. */
export function geserElemen<E extends DenahElemen>(e: E, dx: number, dy: number): E {
  if (dx === 0 && dy === 0) return e;
  const baru = { ...e, x: e.x + dx, y: e.y + dy };
  if (baru.tipe === "derek") {
    const d = baru as DerekElemen;
    d.titikAwal = { x: d.titikAwal.x + dx, y: d.titikAwal.y + dy };
    d.titikAkhir = { x: d.titikAkhir.x + dx, y: d.titikAkhir.y + dy };
  } else if (baru.tipe === "jalur") {
    // Titik jalur juga absolut: ikut bergeser agar tetap di dalam kotak pembungkusnya.
    baru.titik = baru.titik.map((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
  }
  return baru;
}

/** Kebalikan kotakElemen(): kotak efektif (setelah rotasi) -> x/y/w/h tersimpan. */
export function dariKotakEfektif(rotasi: Rotasi, k: Kotak): Kotak {
  if (rotasi === 90 || rotasi === 270) {
    const cx = k.x + k.w / 2;
    const cy = k.y + k.h / 2;
    return { x: cx - k.h / 2, y: cy - k.w / 2, w: k.h, h: k.w };
  }
  return { ...k };
}

/** Garis derek efektif (sama seperti penggambaran kanvas bila kedua titik sama). */
export function garisDerek(d: DerekElemen): { a: Titik; b: Titik } {
  const { titikAwal: a, titikAkhir: b } = d;
  if (a.x !== b.x || a.y !== b.y) return { a, b };
  const k = kotakElemen(d);
  return k.w >= k.h
    ? { a: { x: k.x, y: k.y + k.h / 2 }, b: { x: k.x + k.w, y: k.y + k.h / 2 } }
    : { a: { x: k.x + k.w / 2, y: k.y }, b: { x: k.x + k.w / 2, y: k.y + k.h } };
}

function putar90(e: DenahElemen): DenahElemen {
  if (e.tipe === "derek") {
    // Titik derek absolut: putar keduanya 90° searah jarum jam di pusat garis.
    const { a, b } = garisDerek(e);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const r = (p: Titik): Titik => ({ x: cx - (p.y - cy), y: cy + (p.x - cx) });
    const ta = r(a);
    const tb = r(b);
    return { ...e, ...garisKeKotak(ta, tb), titikAwal: ta, titikAkhir: tb };
  }
  if (e.tipe === "jalur") {
    // Titik jalur absolut: putar 90° searah jarum jam di pusat kotak pembungkus; z tetap.
    const k = kotakJalur(e.titik);
    const cx = k.x + k.w / 2;
    const cy = k.y + k.h / 2;
    const titik = e.titik.map((t) => ({ x: bersih(cx - (t.y - cy)), y: bersih(cy + (t.x - cx)), z: t.z }));
    return rapikanJalur({ ...e, titik });
  }
  return { ...e, rotasi: ((e.rotasi + 90) % 360) as Rotasi };
}

export function kotakGabungan(elemen: readonly DenahElemen[]): Kotak | null {
  if (elemen.length === 0) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const e of elemen) {
    const k = kotakElemen(e);
    x1 = Math.min(x1, k.x);
    y1 = Math.min(y1, k.y);
    x2 = Math.max(x2, k.x + k.w);
    y2 = Math.max(y2, k.y + k.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// ---------- Salinan dengan ID baru ----------

/**
 * Salin elemen dengan ID elemen & kolom BARU. Referensi (mesinIds / bakIds)
 * ke elemen yang ikut disalin dipetakan ke salinannya; referensi ke elemen
 * lain dibiarkan (salinan bak tetap dilayani mesin yang sama). Nama bak
 * dibuat unik.
 */
function salinElemen(sumber: readonly DenahElemen[], elemenAda: readonly DenahElemen[], dx: number, dy: number): DenahElemen[] {
  const petaId = new Map<string, string>();
  for (const e of sumber) petaId.set(e.id, crypto.randomUUID());
  const idAda = new Set(elemenAda.map((e) => e.id));
  const namaBakDipakai = new Set(elemenAda.filter((e) => e.tipe === "bak").map((e) => normal(e.nama)));
  const peta = (id: string) => petaId.get(id) ?? id;
  return sumber.map((asli) => {
    const e = geserElemen(structuredClone(asli), dx, dy);
    e.id = petaId.get(asli.id)!;
    delete e.terkunci;
    if (e.tipe === "bak") {
      e.kolom = e.kolom.map((k) => ({ ...k, id: crypto.randomUUID() }));
      e.mesinIds = e.mesinIds.filter((id) => petaId.has(id) || idAda.has(id)).map(peta);
      e.nama = namaUnik(e.nama, namaBakDipakai);
      namaBakDipakai.add(normal(e.nama));
    } else if (e.tipe === "derek") {
      e.bakIds = e.bakIds.filter((id) => petaId.has(id) || idAda.has(id)).map(peta);
    } else if (e.tipe === "jalur") {
      // Ujung ke elemen yang ikut disalin -> salinannya; ke elemen yang sudah tidak ada -> dibuang.
      if (e.dariId !== undefined) {
        if (petaId.has(e.dariId) || idAda.has(e.dariId)) e.dariId = peta(e.dariId);
        else delete e.dariId;
      }
      if (e.keId !== undefined) {
        if (petaId.has(e.keId) || idAda.has(e.keId)) e.keId = peta(e.keId);
        else delete e.keId;
      }
    }
    return e;
  });
}

// ---------- Reducer ----------

function petaUbah(dok: DenahDokumen, ids: ReadonlySet<string>, fn: (e: DenahElemen) => DenahElemen): DenahDokumen {
  let berubah = false;
  const elemen = dok.elemen.map((e) => {
    if (!ids.has(e.id)) return e;
    const b = fn(e);
    if (b !== e) berubah = true;
    return b;
  });
  return berubah ? { ...dok, elemen } : dok;
}

function ubahBak(dok: DenahDokumen, bakId: string, fn: (b: BakElemen) => BakElemen): DenahDokumen {
  return petaUbah(dok, new Set([bakId]), (e) => (e.tipe === "bak" ? fn(e) : e));
}

/** Terapkan dokumen baru + catat riwayat. */
function catat(s: StateBuilder, dok: DenahDokumen, gabung: string | null = null): StateBuilder {
  if (dok === s.dok) return s;
  if (s.transaksi) return { ...s, dok };
  if (gabung !== null && gabung === s.gabungTerakhir) {
    // Entri sebelumnya sudah menyimpan dokumen sebelum rangkaian ini.
    return { ...s, dok, nanti: [] };
  }
  const lalu = [...s.lalu, s.dok];
  if (lalu.length > BATAS_RIWAYAT) lalu.splice(0, lalu.length - BATAS_RIWAYAT);
  return { ...s, dok, lalu, nanti: [], gabungTerakhir: gabung };
}

/** Buang ID seleksi yang tidak lagi ada di dokumen. */
function rapikanSeleksi(s: StateBuilder): StateBuilder {
  const ada = new Set(s.dok.elemen.map((e) => e.id));
  const terpilih = s.terpilih.filter((id) => ada.has(id));
  let kolomTerpilih = s.kolomTerpilih;
  if (kolomTerpilih.length > 0) {
    const bak = terpilih.length === 1 ? s.dok.elemen.find((e) => e.id === terpilih[0]) : undefined;
    const idKolom = bak?.tipe === "bak" ? new Set(bak.kolom.map((k) => k.id)) : new Set<string>();
    kolomTerpilih = kolomTerpilih.filter((id) => idKolom.has(id));
  }
  const sama = terpilih.length === s.terpilih.length && kolomTerpilih.length === s.kolomTerpilih.length;
  return sama ? s : { ...s, terpilih, kolomTerpilih, jangkarKolom: kolomTerpilih.length ? s.jangkarKolom : null };
}

function bisaDigeser(e: DenahElemen) {
  return !e.terkunci;
}

export function builderReducer(s: StateBuilder, a: AksiBuilder): StateBuilder {
  switch (a.type) {
    case "muat":
      return stateAwal(a.dok);
    case "tandaiTersimpan":
      return { ...s, tersimpan: a.dok, gabungTerakhir: null };

    case "tambah": {
      if (a.elemen.length === 0) return s;
      const t = catat(s, { ...s.dok, elemen: [...s.dok.elemen, ...a.elemen] });
      return { ...t, terpilih: a.elemen.map((e) => e.id), kolomTerpilih: [], jangkarKolom: null };
    }

    case "pindah": {
      if (a.dx === 0 && a.dy === 0) return s;
      const ids = new Set(a.ids);
      return catat(s, petaUbah(s.dok, ids, (e) => (bisaDigeser(e) ? geserElemen(e, a.dx, a.dy) : e)));
    }

    case "hapus": {
      const ids = new Set(a.ids);
      if (!s.dok.elemen.some((e) => ids.has(e.id))) return s;
      // Bersihkan referensi ke elemen terhapus agar tidak jadi galat validasi.
      const elemen = s.dok.elemen
        .filter((e) => !ids.has(e.id))
        .map((e) => {
          if (e.tipe === "bak" && e.mesinIds.some((m) => ids.has(m))) return { ...e, mesinIds: e.mesinIds.filter((m) => !ids.has(m)) };
          if (e.tipe === "derek" && e.bakIds.some((b) => ids.has(b))) return { ...e, bakIds: e.bakIds.filter((b) => !ids.has(b)) };
          if (e.tipe === "jalur" && ((e.dariId && ids.has(e.dariId)) || (e.keId && ids.has(e.keId)))) {
            const j = { ...e };
            if (j.dariId && ids.has(j.dariId)) delete j.dariId;
            if (j.keId && ids.has(j.keId)) delete j.keId;
            return j;
          }
          return e;
        });
      return rapikanSeleksi(catat(s, { ...s.dok, elemen }));
    }

    case "duplikat": {
      const ids = new Set(a.ids);
      const sumber = s.dok.elemen.filter((e) => ids.has(e.id));
      if (sumber.length === 0) return s;
      const off = a.offset ?? 2;
      const baru = salinElemen(sumber, s.dok.elemen, off, off);
      const t = catat(s, { ...s.dok, elemen: [...s.dok.elemen, ...baru] });
      return { ...t, terpilih: baru.map((e) => e.id), kolomTerpilih: [], jangkarKolom: null };
    }

    case "salin":
    case "potong": {
      const ids = new Set(a.ids);
      const papanKlip = s.dok.elemen.filter((e) => ids.has(e.id));
      if (papanKlip.length === 0) return s;
      const t = { ...s, papanKlip, jumlahTempel: 0 };
      return a.type === "salin" ? t : builderReducer(t, { type: "hapus", ids: a.ids });
    }

    case "tempel": {
      if (s.papanKlip.length === 0) return s;
      const n = s.jumlahTempel + 1;
      const off = (a.offset ?? 2) * n;
      const baru = salinElemen(s.papanKlip, s.dok.elemen, off, off);
      const t = catat(s, { ...s.dok, elemen: [...s.dok.elemen, ...baru] });
      return { ...t, jumlahTempel: n, terpilih: baru.map((e) => e.id), kolomTerpilih: [], jangkarKolom: null };
    }

    case "ubahElemen": {
      const dok = petaUbah(s.dok, new Set([a.id]), (e) => {
        const kunci = Object.keys(a.patch) as (keyof DenahElemen)[];
        if (kunci.every((k) => Object.is(e[k], a.patch[k]))) return e;
        const baru = { ...e, ...a.patch, id: e.id, tipe: e.tipe } as DenahElemen;
        // Jalur: kotak/elevasi selalu diturunkan dari titik (bukan disunting langsung).
        return baru.tipe === "jalur" ? rapikanJalur(baru) : baru;
      });
      return catat(s, dok, a.gabung ?? null);
    }

    case "aturKotak": {
      const dok = petaUbah(s.dok, new Set([a.id]), (e) => {
        // Jalur tidak punya handle ubah ukuran: bentuknya diatur lewat titik.
        if (e.terkunci || e.tipe === "jalur") return e;
        const k = dariKotakEfektif(e.rotasi, a.kotak);
        if (k.x === e.x && k.y === e.y && k.w === e.w && k.h === e.h) return e;
        if (e.tipe === "derek") {
          // Derek diubah lewat titiknya; aturKotak menskala titik ke kotak baru.
          const lama = kotakElemen(e);
          const sx = (p: Titik): Titik => ({
            x: k.x + (lama.w ? ((p.x - lama.x) / lama.w) * k.w : 0),
            y: k.y + (lama.h ? ((p.y - lama.y) / lama.h) * k.h : 0),
          });
          return { ...e, ...k, titikAwal: sx(e.titikAwal), titikAkhir: sx(e.titikAkhir) };
        }
        return { ...e, ...k };
      });
      return catat(s, dok);
    }

    case "aturTitikDerek": {
      const dok = petaUbah(s.dok, new Set([a.id]), (e) => {
        if (e.tipe !== "derek" || e.terkunci) return e;
        const { titikAwal: ta, titikAkhir: tb } = a;
        if (ta.x === e.titikAwal.x && ta.y === e.titikAwal.y && tb.x === e.titikAkhir.x && tb.y === e.titikAkhir.y) return e;
        return { ...e, ...garisKeKotak(ta, tb), rotasi: 0, titikAwal: { ...ta }, titikAkhir: { ...tb } };
      });
      return catat(s, dok);
    }

    case "putar":
      return catat(s, petaUbah(s.dok, new Set(a.ids), (e) => (e.terkunci ? e : putar90(e))));

    case "balikJalur": {
      const dok = petaUbah(s.dok, new Set([a.id]), (e) => {
        if (e.tipe !== "jalur" || e.terkunci || e.titik.length < 2) return e;
        const j: JalurElemen = { ...e, titik: [...e.titik].reverse() };
        delete j.dariId;
        delete j.keId;
        if (e.keId !== undefined) j.dariId = e.keId;
        if (e.dariId !== undefined) j.keId = e.dariId;
        return j;
      });
      return catat(s, dok);
    }

    case "urutan": {
      const ids = new Set(a.ids);
      const pilih = s.dok.elemen.filter((e) => ids.has(e.id));
      if (pilih.length === 0) return s;
      const sisa = s.dok.elemen.filter((e) => !ids.has(e.id));
      const elemen = a.ke === "depan" ? [...sisa, ...pilih] : [...pilih, ...sisa];
      if (elemen.every((e, i) => e === s.dok.elemen[i])) return s;
      return catat(s, { ...s.dok, elemen });
    }

    case "kunci":
      return catat(
        s,
        petaUbah(s.dok, new Set(a.ids), (e) => {
          if (!!e.terkunci === a.terkunci) return e;
          const b = { ...e };
          if (a.terkunci) b.terkunci = true;
          else delete b.terkunci;
          return b;
        })
      );

    case "ratakan": {
      const ids = new Set(a.ids);
      const pilih = s.dok.elemen.filter((e) => ids.has(e.id));
      const g = kotakGabungan(pilih);
      if (!g || pilih.length < 2) return s;
      return catat(
        s,
        petaUbah(s.dok, ids, (e) => {
          if (e.terkunci) return e;
          const k = kotakElemen(e);
          let dx = 0;
          let dy = 0;
          if (a.sisi === "kiri") dx = g.x - k.x;
          else if (a.sisi === "kanan") dx = g.x + g.w - (k.x + k.w);
          else if (a.sisi === "tengahH") dx = g.x + g.w / 2 - (k.x + k.w / 2);
          else if (a.sisi === "atas") dy = g.y - k.y;
          else if (a.sisi === "bawah") dy = g.y + g.h - (k.y + k.h);
          else dy = g.y + g.h / 2 - (k.y + k.h / 2);
          return geserElemen(e, dx, dy);
        })
      );
    }

    case "ubahJumlahKolom": {
      const n = Math.max(1, Math.min(1000, Math.floor(a.n)));
      const dok = ubahBak(s.dok, a.bakId, (b) => (b.kolom.length === n ? b : ubahJumlahKolom(b, n)));
      return rapikanSeleksi(catat(s, dok));
    }

    case "ubahKolom": {
      const ids = new Set(a.kolomIds);
      const kunci = Object.keys(a.patch) as (keyof typeof a.patch)[];
      const dok = ubahBak(s.dok, a.bakId, (b) => {
        let berubah = false;
        const kolom = b.kolom.map((k) => {
          if (!ids.has(k.id) || kunci.every((x) => Object.is(k[x], a.patch[x]))) return k;
          berubah = true;
          const baru: DenahKolom = { ...k, ...a.patch };
          // Field opsional kosong dibuang agar dokumen tetap ringkas.
          if (baru.nonaktif === false) delete baru.nonaktif;
          if (baru.catatan === "") delete baru.catatan;
          if (baru.ukuranIceCan === "") delete baru.ukuranIceCan;
          return baru;
        });
        return berubah ? { ...b, kolom } : b;
      });
      return catat(s, dok, a.gabung ?? null);
    }

    case "terapkanBawaan": {
      const dok = ubahBak(s.dok, a.bakId, (b) => {
        const ori = b.orientasiCanBawaan ?? "mendatar";
        if (b.kolom.every((k) => k.varian === b.varianBawaan && k.jumlahIceCan === b.iceCanPerKolomBawaan && (k.orientasiCan ?? "mendatar") === ori)) return b;
        return { ...b, kolom: b.kolom.map((k) => ({ ...k, varian: b.varianBawaan, jumlahIceCan: b.iceCanPerKolomBawaan, orientasiCan: ori })) };
      });
      return catat(s, dok);
    }

    case "nomoriUlang": {
      const dok = ubahBak(s.dok, a.bakId, (b) => (b.kolom.every((k, i) => k.nomor === i + 1) ? b : nomoriUlangKolom(b)));
      return catat(s, dok);
    }

    case "ubahKanvas": {
      const kv = { ...s.dok.kanvas, ...a.kanvas };
      const lama = s.dok.kanvas;
      const sama =
        kv.lebar === lama.lebar &&
        kv.tinggi === lama.tinggi &&
        kv.ukuranGrid === lama.ukuranGrid &&
        kv.langkahSnapM === lama.langkahSnapM &&
        kv.utaraDerajat === lama.utaraDerajat &&
        kv.pelatLantai.tebalM === lama.pelatLantai.tebalM;
      return sama ? s : catat(s, { ...s.dok, kanvas: kv }, a.gabung ?? null);
    }

    case "mulaiTransaksi":
      return s.transaksi ? s : { ...s, transaksi: s.dok };

    case "akhiriTransaksi": {
      if (!s.transaksi) return s;
      const awal = s.transaksi;
      if (awal === s.dok) return { ...s, transaksi: null };
      const lalu = [...s.lalu, awal];
      if (lalu.length > BATAS_RIWAYAT) lalu.splice(0, lalu.length - BATAS_RIWAYAT);
      return { ...s, transaksi: null, lalu, nanti: [], gabungTerakhir: null };
    }

    case "batalTransaksi":
      return s.transaksi ? rapikanSeleksi({ ...s, dok: s.transaksi, transaksi: null }) : s;

    case "undo": {
      if (!bisaUndo(s)) return s;
      const dok = s.lalu[s.lalu.length - 1];
      return rapikanSeleksi({ ...s, dok, lalu: s.lalu.slice(0, -1), nanti: [...s.nanti, s.dok], gabungTerakhir: null });
    }
    case "redo": {
      if (!bisaRedo(s)) return s;
      const dok = s.nanti[s.nanti.length - 1];
      return rapikanSeleksi({ ...s, dok, nanti: s.nanti.slice(0, -1), lalu: [...s.lalu, s.dok], gabungTerakhir: null });
    }

    case "putusGabung":
      return s.gabungTerakhir === null ? s : { ...s, gabungTerakhir: null };

    case "pilih": {
      const ids = a.tambah ? [...new Set([...s.terpilih, ...a.ids])] : [...new Set(a.ids)];
      const sama = ids.length === s.terpilih.length && ids.every((id, i) => id === s.terpilih[i]);
      if (sama && s.kolomTerpilih.length === 0) return s.gabungTerakhir === null ? s : { ...s, gabungTerakhir: null };
      return { ...s, terpilih: ids, kolomTerpilih: [], jangkarKolom: null, gabungTerakhir: null };
    }
    case "togglePilih": {
      const ada = s.terpilih.includes(a.id);
      return { ...s, terpilih: ada ? s.terpilih.filter((x) => x !== a.id) : [...s.terpilih, a.id], kolomTerpilih: [], jangkarKolom: null, gabungTerakhir: null };
    }
    case "pilihSemua":
      return { ...s, terpilih: s.dok.elemen.map((e) => e.id), kolomTerpilih: [], jangkarKolom: null, gabungTerakhir: null };

    case "pilihKolom": {
      const bak = s.dok.elemen.find((e): e is BakElemen => e.id === a.bakId && e.tipe === "bak");
      if (!bak || !bak.kolom.some((k) => k.id === a.kolomId)) return s;
      const bakSama = s.terpilih.length === 1 && s.terpilih[0] === bak.id;
      let kolomTerpilih: string[];
      let jangkar: string | null = a.kolomId;
      if (a.rentang && bakSama && s.jangkarKolom) {
        const i = bak.kolom.findIndex((k) => k.id === s.jangkarKolom);
        const j = bak.kolom.findIndex((k) => k.id === a.kolomId);
        const [lo, hi] = i < j ? [i, j] : [j, i];
        kolomTerpilih = i < 0 ? [a.kolomId] : bak.kolom.slice(lo, hi + 1).map((k) => k.id);
        jangkar = i < 0 ? a.kolomId : s.jangkarKolom;
      } else if (a.toggle && bakSama) {
        const ada = s.kolomTerpilih.includes(a.kolomId);
        kolomTerpilih = ada ? s.kolomTerpilih.filter((x) => x !== a.kolomId) : [...s.kolomTerpilih, a.kolomId];
      } else {
        kolomTerpilih = [a.kolomId];
      }
      return { ...s, terpilih: [bak.id], kolomTerpilih, jangkarKolom: kolomTerpilih.length ? jangkar : null, gabungTerakhir: null };
    }
    case "aturKolomTerpilih": {
      const bak = s.dok.elemen.find((e): e is BakElemen => e.id === a.bakId && e.tipe === "bak");
      if (!bak) return s;
      const sah = new Set(bak.kolom.map((k) => k.id));
      const kolomTerpilih = a.kolomIds.filter((id) => sah.has(id));
      return { ...s, terpilih: [bak.id], kolomTerpilih, jangkarKolom: kolomTerpilih[0] ?? null, gabungTerakhir: null };
    }
  }
}

// ---------- Utilitas untuk builder ----------

export function elemenTerpilih(s: StateBuilder): DenahElemen[] {
  const ids = new Set(s.terpilih);
  return s.dok.elemen.filter((e) => ids.has(e.id));
}

/** Pasangan bak yang bertumpuk (ID keduanya), opsional dengan pergeseran sementara. */
export function bakBertumpuk(elemen: readonly DenahElemen[], geser?: { ids: ReadonlySet<string>; dx: number; dy: number } | null): Set<string> {
  const bak = elemen
    .filter((e): e is BakElemen => e.tipe === "bak")
    .map((b) => {
      const k = kotakElemen(b);
      if (geser && geser.ids.has(b.id) && !b.terkunci) return { id: b.id, ...k, x: k.x + geser.dx, y: k.y + geser.dy };
      return { id: b.id, ...k };
    });
  const hasil = new Set<string>();
  for (let i = 0; i < bak.length; i++) {
    for (let j = i + 1; j < bak.length; j++) {
      const a = bak[i];
      const b = bak[j];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        hasil.add(a.id);
        hasil.add(b.id);
      }
    }
  }
  return hasil;
}
