"use client";

// Komponen 3D per tipe elemen denah (spec v2 §7 "Isi adegan").
// HANYA boleh dimuat lewat adegan-3d.tsx (dynamic import, ssr:false) — file
// ini mengimpor three secara statis.
//
// Semua posisi dari koordinat.ts (yang memakai geometri bersama 2D). Semua
// material & geometri dasar dibuat di SATU tempat (buatSumberDaya) agar alat
// 3D (x-ray, potongan/clipping plane) cukup mengubah material di sana.

import { createContext, memo, useContext, useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  DataTexture,
  LineBasicMaterial,
  LineCurve3,
  MeshStandardMaterial,
  Plane,
  RepeatWrapping,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  Object3D,
  type InstancedMesh,
  type Material,
  type Mesh,
} from "three";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { kotakElemen, type BakElemen, type DenahElemen, type DerekElemen, type DindingElemen, type JalurElemen, type KategoriMesin, type PintuElemen, type TangkiElemen, type Varian } from "@/lib/produksi-denah";
import { garisRel, segmenJalur, tataBakMeter } from "@/lib/produksi-denah-geometri";
import { WARNA_AIR, WARNA_BETON, WARNA_MESIN, warnaJalur } from "@/components/produksi-denah/warna";
import type { ModePotongan } from "./kamera";
import { ModelMesin3D } from "./model-mesin-3d";
import { CoolingTower3D, Perlengkapan3D } from "./perlengkapan-3d";
import { balokAntara, diameterVisualM, iceCanBak, keThree, kunciDerekBak, kotakThree, potongDinding, ruangBebasDerek, type Kotak2D, type Vek3 } from "./koordinat";

// ---------- Sumber daya (material + geometri dasar) ----------

const WARNA_CAN: Record<Varian | "nonaktif", string> = { kecil: "#7dd3fc", besar: "#fbbf24", nonaktif: "#9ca3af" };
const WARNA_AREA_BAWAAN = "#10b981";
const POLA_WARNA = /^#[0-9a-fA-F]{3,8}$|^[a-z]+$/;
/** Opasitas material beton/arsitektur saat X-ray beton menyala. */
export const OPASITAS_XRAY = 0.15;
/** Panjang satu pita tekstur aliran sepanjang pipa (m). */
export const PANJANG_PITA_ALIRAN_M = 0.6;

/** Tekstur pita terang/gelap (8×1) untuk animasi aliran, berulang sepanjang pipa. */
function buatTeksturAliran(): DataTexture {
  const n = 8;
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = i < n / 2 ? 255 : 120;
    data.set([v, v, v, 255], i * 4);
  }
  const t = new DataTexture(data, n, 1);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export function buatSumberDaya() {
  const std = (color: string, o: Partial<ConstructorParameters<typeof MeshStandardMaterial>[0]> = {}) =>
    new MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });
  const transparan = (color: string, opacity: number) => std(color, { transparent: true, opacity, depthWrite: false });

  const mesin = Object.fromEntries(Object.entries(WARNA_MESIN).map(([k, w]) => [k, std(w, { roughness: 0.6 })])) as Record<KategoriMesin, MeshStandardMaterial>;
  const materi = {
    // Pelat didorong sedikit ke belakang agar beton/area yang sebidang (z = 0) tidak berkedip.
    pelat: std("#d6d3d1", { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
    tanah: std("#c9d3bd", { side: DoubleSide }),
    beton: std(WARNA_BETON),
    dinding: std("#e7e5e4"),
    pintu: transparan("#b45309", 0.55),
    brine: transparan(WARNA_AIR, 0.35),
    airTangki: transparan(WARNA_AIR, 0.6),
    dindingTangki: transparan("#94a3b8", 0.3),
    iceCan: std("#ffffff", { roughness: 0.45, metalness: 0.25 }),
    rel: std("#475569", { roughness: 0.5, metalness: 0.5 }),
    troli: std("#f59e0b", { roughness: 0.6 }),
    kait: std("#1f2937", { roughness: 0.4, metalness: 0.6 }),
    bebasOk: transparan("#22c55e", 0.16),
    bebasGagal: transparan("#ef4444", 0.28),
    mawarUtara: std("#dc2626"),
    mawarSelatan: std("#9ca3af"),
    mawarCincin: std("#57534e"),
    // Model mesin detail (model-mesin-3d.tsx).
    catBiru: std("#2f6aa8", { roughness: 0.5, metalness: 0.15 }),
    catBiruTua: std("#234f7e", { roughness: 0.55, metalness: 0.15 }),
    tabungAbu: std("#7f949c", { roughness: 0.45, metalness: 0.3 }),
    tabungAbuTua: std("#5b6b72", { roughness: 0.5, metalness: 0.35 }),
    logam: std("#a8b0b8", { roughness: 0.35, metalness: 0.7 }),
    logamGelap: std("#3b434c", { roughness: 0.45, metalness: 0.55 }),
    panelAbu: std("#a7adb3", { roughness: 0.6, metalness: 0.2 }),
    putih: std("#eef1f4", { roughness: 0.6 }),
    kuning: std("#eab308", { roughness: 0.5 }),
    merah: std("#dc2626", { roughness: 0.5 }),
    hijau: std("#16a34a", { roughness: 0.5 }),
    kayu: std("#8b5a2b", { roughness: 0.9 }),
    kaca: transparan("#bae6fd", 0.55),
    // Perlengkapan area bak, derek detail, cooling tower (perlengkapan-3d.tsx).
    oranye: std("#ea580c", { roughness: 0.5, metalness: 0.2 }),
    rantai: std("#4b5563", { roughness: 0.35, metalness: 0.75 }),
    frp: std("#e6e8e3", { roughness: 0.55 }),
    frpTua: std("#cfd3cc", { roughness: 0.55 }),
    airKucur: transparan("#7dd3fc", 0.55),
    esBalok: std("#e0f2fe", { roughness: 0.2, metalness: 0.05, transparent: true, opacity: 0.88 }),
    celana: std("#1f2937", { roughness: 0.8 }),
    bajuAbu: std("#9ca3af", { roughness: 0.8 }),
    rompi: std("#f97316", { roughness: 0.7 }),
    kulit: std("#c68e5e", { roughness: 0.8 }),
    mesin,
  };
  const tepi = {
    pilih: new LineBasicMaterial({ color: "#0ea5e9", depthTest: false, transparent: true }),
    hover: new LineBasicMaterial({ color: "#64748b", depthTest: false, transparent: true, opacity: 0.8 }),
    // Elemen yang terkena peringatan teknik (spec §7 "Sorotan peringatan").
    peringatan: new LineBasicMaterial({ color: "#facc15", depthTest: false, transparent: true }),
  };
  const teksturAliran = buatTeksturAliran();

  // Potongan: SATU bidang bersama, dipasang ke clippingPlanes semua material mesh.
  const bidang = new Plane();
  let modePotongan: ModePotongan = "tidak";
  const planesAktif: Plane[] = [bidang];
  const planesKosong: Plane[] = [];
  const planesSaatIni = () => (modePotongan === "tidak" ? planesKosong : planesAktif);
  let xray = false;
  const kotak = new BoxGeometry(1, 1, 1);
  const geo = {
    kotak,
    tepiKotak: new EdgesGeometry(kotak),
    silinder: new CylinderGeometry(0.5, 0.5, 1, 32),
    bola: new SphereGeometry(0.5, 16, 12),
    // Jari-jari 1 (diskalakan); tabung tipis untuk roda tangan/rantai/kait.
    torus: new TorusGeometry(1, 0.12, 8, 24),
  };

  // Material berwarna bebas (jalur per fluida, tint area) di-cache per warna.
  const cache = new Map<string, MeshStandardMaterial>();
  const berwarna = (kunci: string, buat: () => MeshStandardMaterial) => {
    let m = cache.get(kunci);
    if (!m) {
      m = buat();
      m.clippingPlanes = planesSaatIni(); // material baru ikut potongan yang sedang aktif
      cache.set(kunci, m);
    }
    return m;
  };
  // Nilai asli material beton, dipulihkan saat X-ray dimatikan.
  const asliBeton = [materi.pelat, materi.beton, materi.dinding].map((m) => ({ m, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite }));
  let dibuang = false;

  return {
    materi,
    tepi,
    geo,
    warnaJalur: (hex: string) => berwarna(`jalur:${hex}`, () => std(hex, { roughness: 0.4, metalness: 0.3 })),
    warnaArea: (hex: string) => berwarna(`area:${hex}`, () => transparan(hex, 0.28)),
    /** Material jalur bertekstur pita bergerak (animasi aliran). */
    warnaJalurAliran: (hex: string) => berwarna(`aliran:${hex}`, () => std(hex, { roughness: 0.4, metalness: 0.3, map: teksturAliran })),
    /** Geser pita aliran sejauh `pita` (satuan panjang pita). Offset negatif → pita bergerak ke arah u bertambah (a→b, urutan titik). */
    majukanAliran(pita: number) {
      teksturAliran.offset.x = (teksturAliran.offset.x - pita) % 1;
    },
    /** Material beton/arsitektur (pelat, beton, dinding, cangkang bak) — sasaran x-ray. */
    materiBeton: (): MeshStandardMaterial[] => [materi.pelat, materi.beton, materi.dinding],
    /** Semua material mesh — sasaran clipping plane potongan. */
    semuaMateri(): Material[] {
      const { mesin: m, ...lain } = materi;
      return [...Object.values(lain), ...Object.values(m), ...cache.values()];
    },
    /** X-ray beton: material beton jadi transparan (opasitas OPASITAS_XRAY). */
    aturXray(nyala: boolean) {
      if (nyala === xray) return;
      xray = nyala;
      for (const a of asliBeton) {
        a.m.transparent = nyala ? true : a.transparent;
        a.m.opacity = nyala ? OPASITAS_XRAY : a.opacity;
        a.m.depthWrite = nyala ? false : a.depthWrite;
        a.m.needsUpdate = true;
      }
    },
    /**
     * Potongan: horizontal menyisakan bagian di bawah elevasi `posisi`;
     * vertikal X/Y menyisakan bagian di sisi kecil sumbu denah. Menggeser
     * slider hanya mengganti konstanta bidang (tanpa kompilasi ulang shader).
     */
    aturPotongan(mode: ModePotongan, posisi: number) {
      if (mode === "horizontal") bidang.normal.set(0, -1, 0);
      else if (mode === "x") bidang.normal.set(-1, 0, 0);
      else bidang.normal.set(0, 0, -1); // y denah = z three
      bidang.constant = posisi;
      if (mode === modePotongan) return;
      modePotongan = mode;
      const planes = planesSaatIni();
      for (const m of this.semuaMateri()) m.clippingPlanes = planes;
    },
    /** Titik (three) berada di bagian yang dibuang potongan. */
    terpotong(p: Vector3): boolean {
      return modePotongan !== "tidak" && bidang.distanceToPoint(p) < 0;
    },
    /** Material ini sedang tembus pandang karena X-ray beton. */
    tembusXray(m: unknown): boolean {
      return xray && (m === materi.pelat || m === materi.beton || m === materi.dinding);
    },
    /**
     * Klik/hover yang harus menembus objek ini: titiknya terpotong, atau
     * mengenai beton yang sedang di-x-ray. Penangan lalu TIDAK menghentikan
     * propagasi sehingga objek di belakangnya yang menerima.
     */
    lewatiKlik(ev: ThreeEvent<PointerEvent | MouseEvent>): boolean {
      return this.terpotong(ev.point) || this.tembusXray((ev.object as Mesh).material);
    },
    /** Sudah dibuang (buang()) — pemilik harus membuat sumber daya baru, bukan memakainya lagi. */
    get dibuang(): boolean {
      return dibuang;
    },
    /** Idempoten. Cache TIDAK dikosongkan agar semuaMateri() tetap lengkap bila ada yang masih memegang objek ini. */
    buang() {
      if (dibuang) return;
      dibuang = true;
      for (const m of this.semuaMateri()) m.dispose();
      for (const m of Object.values(tepi)) m.dispose();
      for (const g of Object.values(geo)) g.dispose();
      teksturAliran.dispose();
    },
  };
}

export type SumberDaya = ReturnType<typeof buatSumberDaya>;

export const SumberDayaKonteks = createContext<SumberDaya | null>(null);

export function useSumberDaya(): SumberDaya {
  const sd = useContext(SumberDayaKonteks);
  if (!sd) throw new Error("useSumberDaya di luar SumberDayaKonteks");
  return sd;
}

// ---------- Primitif ----------

const tanpaRaycast = () => null;

function Kotak({ pusat, ukuran, materi, tembus }: { pusat: Vek3; ukuran: Vek3; materi: Material; tembus?: boolean }) {
  const { geo } = useSumberDaya();
  if (!(ukuran[0] > 0 && ukuran[1] > 0 && ukuran[2] > 0)) return null;
  return <mesh geometry={geo.kotak} material={materi} position={pusat} scale={ukuran} raycast={tembus ? tanpaRaycast : undefined} />;
}

function KotakZ({ kotak, zBawah, zAtas, materi, tembus }: { kotak: Kotak2D; zBawah: number; zAtas: number; materi: Material; tembus?: boolean }) {
  const k = kotakThree(kotak, zBawah, zAtas - zBawah);
  return <Kotak pusat={k.pusat} ukuran={k.ukuran} materi={materi} tembus={tembus} />;
}

/** Kerangka kotak (outline seleksi/hover) — selalu di atas benda lain. */
export function TepiKotak({ kotak, zBawah, zAtas, jenis }: { kotak: Kotak2D; zBawah: number; zAtas: number; jenis: "pilih" | "hover" | "peringatan" }) {
  const { geo, tepi } = useSumberDaya();
  // Outline peringatan sedikit lebih lebar agar tetap terlihat di luar outline seleksi.
  const pad = jenis === "peringatan" ? 0.07 : 0.03;
  const k = kotakThree({ x: kotak.x - pad, y: kotak.y - pad, w: kotak.w + 2 * pad, h: kotak.h + 2 * pad }, zBawah - pad, zAtas - zBawah + 2 * pad);
  return <lineSegments geometry={geo.tepiKotak} material={tepi[jenis]} position={k.pusat} scale={k.ukuran} renderOrder={10} raycast={tanpaRaycast} />;
}

// ---------- Bak ----------

const CELAH_VISUAL_CAN_M = 0.008;
const bantu = new Object3D();
const warnaBantu = new Color();

function IceCanVarian({ bak, varian, onKlikKolom }: { bak: BakElemen; varian: Varian; onKlikKolom: (kolomId: string, ev: ThreeEvent<MouseEvent>) => void }) {
  const sd = useSumberDaya();
  const { geo, materi } = sd;
  const invalidate = useThree((s) => s.invalidate);
  const instans = useMemo(() => iceCanBak(bak)[varian], [bak, varian]);
  const ref = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    for (let i = 0; i < instans.length; i++) {
      const c = instans[i];
      bantu.position.set(c.pusat[0], c.pusat[1], c.pusat[2]);
      // Celah visual tipis (≤ 8 mm, maks 6% sisi) agar can yang berdempet tampak terpisah;
      // hanya tampilan — posisi & panjang rek tetap dari tataBakMeter.
      const celahA = Math.min(CELAH_VISUAL_CAN_M, c.ukuran[0] * 0.06);
      const celahB = Math.min(CELAH_VISUAL_CAN_M, c.ukuran[2] * 0.06);
      bantu.scale.set(c.ukuran[0] - celahA, c.ukuran[1], c.ukuran[2] - celahB);
      bantu.updateMatrix();
      mesh.setMatrixAt(i, bantu.matrix);
      mesh.setColorAt(i, warnaBantu.set(c.nonaktif ? WARNA_CAN.nonaktif : WARNA_CAN[varian]));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.boundingSphere = null;
    mesh.boundingBox = null;
    mesh.computeBoundingSphere();
    invalidate();
  }, [instans, varian, invalidate]);

  if (instans.length === 0) return null;
  return (
    <instancedMesh
      // Jumlah instans tetap sejak dibuat → buat ulang bila jumlahnya berubah.
      key={instans.length}
      ref={ref}
      args={[geo.kotak, materi.iceCan, instans.length]}
      onClick={(ev) => {
        if (ev.instanceId === undefined || sd.lewatiKlik(ev)) return;
        ev.stopPropagation(); // grup bak tidak boleh menimpa pilihan kolom
        const c = instans[ev.instanceId];
        if (c) onKlikKolom(c.kolomId, ev);
      }}
    />
  );
}

function Bak3D({ bak, tampilIceCan, onKlikKolom }: { bak: BakElemen; tampilIceCan: boolean; onKlikKolom: (kolomId: string, ev: ThreeEvent<MouseEvent>) => void }) {
  const { materi } = useSumberDaya();
  const k = kotakElemen(bak);
  // Tebal mentah, SAMA dengan tataBakMeter & 2D (BakTubuh) — tidak di-clamp,
  // agar 2D/3D sepakat. Bila dinding melebihi setengah sisi, kotak bersisi
  // ≤ 0 tidak digambar oleh <Kotak>.
  const t = bak.tebalDindingM;
  const zB = bak.elevasiM;
  const tata = useMemo(() => tataBakMeter(bak), [bak]);
  const zA = tata.bibirZ;
  const dalam = { x: k.x + t, y: k.y + t, w: k.w - 2 * t, h: k.h - 2 * t };
  const brineZ = Math.min(tata.brineZ, zA);
  return (
    <group>
      {/* Cangkang beton: 4 dinding + lantai dalam. */}
      <KotakZ kotak={{ x: k.x, y: k.y, w: k.w, h: t }} zBawah={zB} zAtas={zA} materi={materi.beton} />
      <KotakZ kotak={{ x: k.x, y: k.y + k.h - t, w: k.w, h: t }} zBawah={zB} zAtas={zA} materi={materi.beton} />
      <KotakZ kotak={{ x: k.x, y: k.y + t, w: t, h: k.h - 2 * t }} zBawah={zB} zAtas={zA} materi={materi.beton} />
      <KotakZ kotak={{ x: k.x + k.w - t, y: k.y + t, w: t, h: k.h - 2 * t }} zBawah={zB} zAtas={zA} materi={materi.beton} />
      <KotakZ kotak={dalam} zBawah={zB} zAtas={tata.lantaiDalamZ} materi={materi.beton} />
      {/* Permukaan brine (transparan, tidak menghalangi klik ice can). */}
      {brineZ > tata.lantaiDalamZ && <KotakZ kotak={dalam} zBawah={brineZ - 0.004} zAtas={brineZ} materi={materi.brine} tembus />}
      {tampilIceCan && <IceCanVarian bak={bak} varian="kecil" onKlikKolom={onKlikKolom} />}
      {tampilIceCan && <IceCanVarian bak={bak} varian="besar" onKlikKolom={onKlikKolom} />}
    </group>
  );
}

// ---------- Derek ----------

const LEBAR_REL = 0.3;

function Derek3D({ derek, byId, terlaluRendah }: { derek: DerekElemen; byId: ReadonlyMap<string, DenahElemen>; terlaluRendah: ReadonlySet<string> }) {
  const { geo, materi } = useSumberDaya();
  const rel = garisRel(derek);
  const b = balokAntara(rel.a, rel.b);
  const zRel = derek.elevasiM;
  // Persis nilai yang diperiksa periksaTeknik (aturan 3).
  const kaitZ = zRel - derek.tinggiKaitM;
  const tinggiBalok = Math.max(derek.tinggiM, 0.05);
  const bebas = derek.bakIds.flatMap((id) => {
    const bak = byId.get(id);
    if (bak?.tipe !== "bak") return [];
    const r = ruangBebasDerek(bak);
    return r ? [{ id, ...r }] : [];
  });
  // Rek yang dibawa (opsional): jumlah & ukuran can dari bak pertama yang dilayani.
  const bakRek = derek.bakIds.map((id) => byId.get(id)).find((x): x is BakElemen => x?.tipe === "bak");
  const rek = derek.bawaRek && bakRek ? { n: bakRek.iceCanPerKolomBawaan, can: bakRek.iceCan[bakRek.varianBawaan] } : null;
  const canLebar = rek ? rek.can.lebarMm / 1000 : 0;
  const canTinggi = rek ? rek.can.tinggiMm / 1000 : 0;
  const pjRek = rek ? rek.n * (canLebar + bakRek!.jarakAntarCanMm / 1000) : 1.2;
  // Rantai: dari hoist (di bawah troli) sampai blok kait; mata rantai bergantian arah.
  const atasRantai = zRel - 0.5;
  const atasBlok = kaitZ + 0.32;
  const jumlahMata = Math.max(0, Math.min(120, Math.floor((atasRantai - atasBlok) / 0.07)));
  return (
    <group>
      {b.panjang > 0 && (
        <mesh geometry={geo.kotak} material={materi.rel} position={keThree(b.pusat.x, b.pusat.y, zRel + tinggiBalok / 2)} rotation={[0, b.rotY, 0]} scale={[b.panjang, tinggiBalok, LEBAR_REL]} />
      )}
      {/* Kelompok lokal di tengah rel: X sepanjang rel, Z melintang rel. */}
      <group position={keThree(b.pusat.x, b.pusat.y, 0)} rotation={[0, b.rotY, 0]}>
        {/* Troli beroda + hoist bermotor di bawah rel */}
        {[-1, 1].map((sx) =>
          [-1, 1].map((sz) => <mesh key={`${sx}${sz}`} geometry={geo.silinder} material={materi.kait} position={[sx * 0.18, zRel - 0.02, sz * (LEBAR_REL / 2 + 0.05)]} rotation={[Math.PI / 2, 0, 0]} scale={[0.12, 0.05, 0.12]} />)
        )}
        <Kotak pusat={[0, zRel - 0.1, 0]} ukuran={[0.55, 0.08, LEBAR_REL + 0.16]} materi={materi.troli} />
        <mesh geometry={geo.silinder} material={materi.troli} position={[0, zRel - 0.3, 0]} rotation={[0, 0, Math.PI / 2]} scale={[0.32, 0.55, 0.32]} />
        <mesh geometry={geo.silinder} material={materi.kait} position={[0.36, zRel - 0.3, 0]} rotation={[0, 0, Math.PI / 2]} scale={[0.24, 0.18, 0.24]} />
        {/* Rantai */}
        {Array.from({ length: jumlahMata }, (_, i) => (
          <mesh key={i} geometry={geo.torus} material={materi.rantai} position={[0, atasRantai - 0.035 - i * 0.07, 0]} rotation={[0, i % 2 ? Math.PI / 2 : 0, Math.PI / 2]} scale={[0.04, 0.025, 0.04]} />
        ))}
        {/* Blok kait oranye + kait */}
        <Kotak pusat={[0, kaitZ + 0.22, 0]} ukuran={[0.16, 0.2, 0.12]} materi={materi.oranye} />
        <mesh geometry={geo.silinder} material={materi.oranye} position={[0, kaitZ + 0.22, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[0.18, 0.14, 0.18]} />
        <mesh geometry={geo.torus} material={materi.oranye} position={[0, kaitZ + 0.06, 0]} rotation={[0, Math.PI / 2, 0]} scale={[0.07, 0.07, 0.07]} />
        {/* Pengangkut kerangka: balok melintang rel + dua penggantung */}
        <Kotak pusat={[0, kaitZ - 0.06, 0]} ukuran={[0.08, 0.1, pjRek * 0.95]} materi={materi.oranye} />
        {[-1, 1].map((sz) => (
          <Kotak key={sz} pusat={[0, kaitZ - 0.2, sz * pjRek * 0.42]} ukuran={[0.03, 0.2, 0.03]} materi={materi.kait} />
        ))}
        {/* Rek + deretan ice can tergantung */}
        {rek && (
          <group>
            {[-1, 1].map((sx) => (
              <Kotak key={sx} pusat={[sx * (canLebar / 2 + 0.03), kaitZ - 0.32, 0]} ukuran={[0.04, 0.06, pjRek]} materi={materi.rel} />
            ))}
            {Array.from({ length: rek.n }, (_, i) => (
              <Kotak
                key={i}
                pusat={[0, kaitZ - 0.35 - canTinggi / 2, -pjRek / 2 + (i + 0.5) * (pjRek / rek.n)]}
                ukuran={[canLebar, canTinggi, Math.max(pjRek / rek.n - 0.01, 0.01)]}
                materi={materi.iceCan}
              />
            ))}
          </group>
        )}
      </group>
      {/* Kotak ruang bebas per bak yang dilayani: merah bila aturan 3 aktif. */}
      {bebas.map((r) => (
        <KotakZ key={r.id} kotak={r.kotak} zBawah={r.zBawah} zAtas={r.zAtas} materi={terlaluRendah.has(kunciDerekBak(derek.id, r.id)) ? materi.bebasGagal : materi.bebasOk} tembus />
      ))}
    </group>
  );
}

// ---------- Arsitektur ----------

function Dinding3D({ dinding, daftarPintu }: { dinding: DindingElemen; daftarPintu: readonly PintuElemen[] }) {
  const { materi } = useSumberDaya();
  const balok = useMemo(() => potongDinding(dinding, daftarPintu), [dinding, daftarPintu]);
  return (
    <group>
      {balok.map((p, i) => (
        <KotakZ key={i} kotak={p.kotak} zBawah={p.zBawah} zAtas={p.zAtas} materi={materi.dinding} />
      ))}
    </group>
  );
}

function Tangki3D({ tangki }: { tangki: TangkiElemen }) {
  const { geo, materi } = useSumberDaya();
  const k = kotakElemen(tangki);
  const tinggi = Math.max(tangki.tinggiM, 0.01);
  const isi = (Math.min(100, Math.max(0, tangki.levelIsiPersen)) / 100) * tinggi;
  const luar = kotakThree(k, tangki.elevasiM, tinggi);
  const air = kotakThree({ x: k.x + 0.02, y: k.y + 0.02, w: Math.max(k.w - 0.04, 0.01), h: Math.max(k.h - 0.04, 0.01) }, tangki.elevasiM, isi);
  const g = tangki.bentuk === "silinder" ? geo.silinder : geo.kotak;
  return (
    <group>
      <mesh geometry={g} material={materi.dindingTangki} position={luar.pusat} scale={luar.ukuran} />
      {isi > 0 && <mesh geometry={g} material={materi.airTangki} position={air.pusat} scale={air.ukuran} raycast={tanpaRaycast} />}
    </group>
  );
}

// ---------- Jalur ----------

function Jalur3D({ jalur, aliran }: { jalur: JalurElemen; aliran: boolean }) {
  const sd = useSumberDaya();
  const materi = aliran ? sd.warnaJalurAliran(warnaJalur(jalur)) : sd.warnaJalur(warnaJalur(jalur));
  const r = diameterVisualM(jalur) / 2;
  // TubeGeometry per segmen (sudut siku tajam), di-memo per elemen. u tabung
  // berjalan a→b (urutan titik) dan diskalakan ke panjang/PANJANG_PITA_ALIRAN_M
  // agar pita aliran berjarak sama di semua segmen dan bergerak searah titik.
  const tabung = useMemo(
    () =>
      segmenJalur(jalur)
        .filter((s) => s.panjang > 1e-6)
        .map((s) => {
          const g = new TubeGeometry(new LineCurve3(new Vector3(...keThree(s.a.x, s.a.y, s.a.z)), new Vector3(...keThree(s.b.x, s.b.y, s.b.z))), 1, r, 12, false);
          const uv = g.attributes.uv;
          const skala = s.panjang / PANJANG_PITA_ALIRAN_M;
          for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * skala);
          uv.needsUpdate = true;
          return g;
        }),
    [jalur, r]
  );
  useLayoutEffect(() => () => tabung.forEach((g) => g.dispose()), [tabung]);
  const sambungan = jalur.titik.slice(1, -1);
  return (
    <group>
      {tabung.map((g, i) => (
        <mesh key={i} geometry={g} material={materi} />
      ))}
      {sambungan.map((t, i) => (
        <mesh key={`s${i}`} geometry={sd.geo.bola} material={materi} position={keThree(t.x, t.y, t.z)} scale={r * 2} />
      ))}
    </group>
  );
}

// ---------- Pembagi per tipe ----------

export interface Elemen3DProps {
  e: DenahElemen;
  byId: ReadonlyMap<string, DenahElemen>;
  daftarPintu: readonly PintuElemen[];
  /** Pasangan derek–bak (kunciDerekBak) yang terkena aturan 3. */
  derekRendah: ReadonlySet<string>;
  /** Animasi aliran (hanya berarti untuk jalur; tipe lain selalu false agar memo efektif). */
  aliran: boolean;
  /** Gambar ice can (bak saja). false bila total instans melebihi BATAS_INSTANS_ICE_CAN. */
  tampilIceCan: boolean;
  onKlik: (elemenId: string, kolomId: string | null, ev: ThreeEvent<MouseEvent>) => void;
  onHover: (elemenId: string | null) => void;
}

/** Satu elemen + penanganan klik/hover. Di-memo: elemen yang tidak berubah tidak dirender ulang. */
export const Elemen3D = memo(function Elemen3D({ e, byId, daftarPintu, derekRendah, aliran, tampilIceCan, onKlik, onHover }: Elemen3DProps) {
  const sd = useSumberDaya();
  const { materi } = sd;
  let isi: React.ReactNode = null;
  switch (e.tipe) {
    case "bak":
      isi = <Bak3D bak={e} tampilIceCan={tampilIceCan} onKlikKolom={(kolomId, ev) => onKlik(e.id, kolomId, ev)} />;
      break;
    case "derek":
      isi = <Derek3D derek={e} byId={byId} terlaluRendah={derekRendah} />;
      break;
    case "dinding":
      isi = <Dinding3D dinding={e} daftarPintu={daftarPintu} />;
      break;
    case "pintu":
      isi = <KotakZ kotak={kotakElemen(e)} zBawah={e.elevasiM} zAtas={e.elevasiM + Math.max(e.tinggiM, 0.01)} materi={materi.pintu} />;
      break;
    case "mesin":
      isi = e.model ? (
        <ModelMesin3D e={{ ...e, model: e.model }} />
      ) : (
        <KotakZ kotak={kotakElemen(e)} zBawah={e.elevasiM} zAtas={e.elevasiM + Math.max(e.tinggiM, 0.01)} materi={materi.mesin[e.kategori] ?? materi.mesin.lainnya} />
      );
      break;
    case "beton":
      isi = <KotakZ kotak={kotakElemen(e)} zBawah={e.elevasiM} zAtas={e.elevasiM + Math.max(e.tinggiM, 0.01)} materi={materi.beton} />;
      break;
    case "tangki":
      isi = e.jenis === "cooling-tower" ? <CoolingTower3D t={e} /> : <Tangki3D tangki={e} />;
      break;
    case "perlengkapan":
      isi = <Perlengkapan3D e={e} />;
      break;
    case "jalur":
      isi = <Jalur3D jalur={e} aliran={aliran} />;
      break;
    case "area": {
      const warna = e.warna && POLA_WARNA.test(e.warna) ? e.warna : WARNA_AREA_BAWAAN;
      isi = <KotakZ kotak={kotakElemen(e)} zBawah={e.elevasiM + 0.004} zAtas={e.elevasiM + 0.008} materi={sd.warnaArea(warna)} />;
      break;
    }
    case "label": {
      const k = kotakElemen(e);
      isi = (
        <Html position={keThree(k.x + k.w / 2, k.y + k.h / 2, e.elevasiM + 0.05)} center zIndexRange={[20, 0]} pointerEvents="none">
          <div className="pointer-events-none whitespace-nowrap rounded bg-background/80 px-1.5 py-0.5 text-xs font-medium text-foreground shadow-sm">{e.teks || e.nama}</div>
        </Html>
      );
      break;
    }
  }
  return (
    <group
      onClick={(ev) => {
        if (sd.lewatiKlik(ev)) return; // terpotong / beton x-ray: teruskan ke objek di belakang
        ev.stopPropagation();
        onKlik(e.id, null, ev);
      }}
      onPointerOver={(ev) => {
        if (sd.lewatiKlik(ev)) return;
        ev.stopPropagation();
        onHover(e.id);
      }}
      onPointerOut={() => onHover(null)}
    >
      {isi}
    </group>
  );
});
