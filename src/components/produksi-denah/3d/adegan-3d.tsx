"use client";

// Adegan R3F Mode 3D Replika (spec v2 §7). Dimuat HANYA lewat
// tampilan-3d.tsx: dynamic(() => import("./adegan-3d"), { ssr: false }).
//
// Struktur (agar alat 3D Task 8 bisa ditambahkan tanpa menulis ulang):
// - Adegan3D: wrapper DOM (HUD, kursor, deteksi klik kosong) + <Canvas>.
// - IsiAdegan: sumber daya (material/geometri, satu tempat), lampu, lantai,
//   elemen, outline seleksi, label, kamera. Bilah alat & clipping plane bisa
//   masuk sebagai anak/pengatur sumber daya di sini.

import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { CameraControls, Grid, Html } from "@react-three/drei";
import { Box3, DoubleSide, ExtrudeGeometry, Path, Shape, ShapeGeometry, Vector3 } from "three";
import { lapisanElemen, type DenahDokumen, type DenahElemen, type PintuElemen } from "@/lib/produksi-denah";
import { MawarAngin } from "@/components/produksi-denah/mawar-angin";
import { formatMeter } from "@/components/produksi-denah/format";
import { arahUtaraThree, batasElemen, derekTerlaluRendah, keThree, lubangPelat, sudutLayarUtara } from "./koordinat";
import { buatSumberDaya, Elemen3D, SumberDayaKonteks, TepiKotak, useSumberDaya } from "./elemen-3d";
import type { Tampilan3DProps } from "./tampilan-3d";

export type Adegan3DProps = Omit<Tampilan3DProps, "className" | "onGagal">;

const NAMA_TIPE: Record<DenahElemen["tipe"], string> = {
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
/** Geser pointer (px) di atas ini dianggap memutar kamera, bukan klik. */
const BATAS_GESER_PX = 4;
const MAKS_LABEL_TERPILIH = 20;
const MAP_KOSONG: ReadonlyMap<string, DenahElemen> = new Map();
const PINTU_KOSONG: readonly PintuElemen[] = [];
const SET_KOSONG: ReadonlySet<string> = new Set();

interface HudHandle {
  atur(derajat: number): void;
}

export default function Adegan3D(props: Adegan3DProps) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const hudRef = useRef<HudHandle>(null);
  const awalPointer = useRef<{ x: number; y: number } | null>(null);
  const onPilihRef = useRef(props.onPilih);
  useLayoutEffect(() => {
    onPilihRef.current = props.onPilih;
  });

  return (
    <div
      className="relative h-full w-full bg-gradient-to-b from-sky-100 to-slate-100 dark:from-slate-900 dark:to-slate-950"
      style={{ cursor: hoverId ? "pointer" : undefined }}
      onPointerDown={(ev) => {
        awalPointer.current = { x: ev.clientX, y: ev.clientY };
      }}
    >
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        camera={{ fov: 45, near: 0.05, far: 10000, position: [0, 40, 40] }}
        gl={{ antialias: true }}
        onCreated={({ gl }) => {
          // Disiapkan untuk alat potongan (clipping plane per material) di Task 8.
          gl.localClippingEnabled = true;
        }}
        onPointerMissed={(ev) => {
          const a = awalPointer.current;
          if (a && Math.hypot(ev.clientX - a.x, ev.clientY - a.y) > BATAS_GESER_PX) return;
          onPilihRef.current(null, null);
        }}
      >
        <IsiAdegan {...props} onPilihRef={onPilihRef} hoverId={hoverId} setHoverId={setHoverId} hudRef={hudRef} />
      </Canvas>
      <HudUtara ref={hudRef} awal={props.dokumen.kanvas.utaraDerajat} />
    </div>
  );
}

function HudUtara({ ref, awal }: { ref: Ref<HudHandle>; awal: number }) {
  const [derajat, setDerajat] = useState(awal);
  useImperativeHandle(ref, () => ({ atur: (d: number) => setDerajat(Math.round(d) % 360) }), []);
  return (
    <div className="pointer-events-none absolute top-3 right-3">
      <MawarAngin utaraDerajat={derajat} />
    </div>
  );
}

interface IsiAdeganProps extends Adegan3DProps {
  onPilihRef: { current: Adegan3DProps["onPilih"] };
  hoverId: string | null;
  setHoverId: (f: (id: string | null) => string | null) => void;
  hudRef: { current: HudHandle | null };
}

function IsiAdegan({ dokumen, terpilihIds, lapisanTampil, peringatan, fokusId, onPilihRef, hoverId, setHoverId, hudRef }: IsiAdeganProps) {
  // Sumber daya dibuat sekali per kanvas dan dibuang saat kanvas ditutup.
  const sd = useMemo(() => buatSumberDaya(), []);
  useEffect(() => () => sd.buang(), [sd]);

  const elemenTampil = useMemo(() => dokumen.elemen.filter((e) => lapisanTampil.has(lapisanElemen(e))), [dokumen.elemen, lapisanTampil]);
  const byId = useMemo(() => new Map(dokumen.elemen.map((e) => [e.id, e])), [dokumen.elemen]);
  const daftarPintu = useMemo(() => elemenTampil.filter((e): e is PintuElemen => e.tipe === "pintu"), [elemenTampil]);
  const derekRendah = useMemo(() => derekTerlaluRendah(peringatan), [peringatan]);

  const onKlik = useCallback(
    (elemenId: string, kolomId: string | null, ev: ThreeEvent<MouseEvent>) => {
      if (ev.delta > BATAS_GESER_PX) return; // kamera diputar, bukan klik
      onPilihRef.current(elemenId, kolomId);
    },
    [onPilihRef]
  );
  const onHover = useCallback((id: string | null) => setHoverId((lama) => (id === null ? null : id === lama ? lama : id)), [setHoverId]);

  // Label & outline: elemen terpilih (dibatasi) + yang di-hover, hanya di lapisan tampil.
  const sorot = useMemo(() => {
    const hasil: { e: DenahElemen; jenis: "pilih" | "hover" }[] = [];
    for (const e of elemenTampil) if (terpilihIds.has(e.id) && hasil.length < MAKS_LABEL_TERPILIH) hasil.push({ e, jenis: "pilih" });
    const h = hoverId ? byId.get(hoverId) : undefined;
    if (h && !terpilihIds.has(h.id) && lapisanTampil.has(lapisanElemen(h))) hasil.push({ e: h, jenis: "hover" });
    return hasil;
  }, [elemenTampil, terpilihIds, hoverId, byId, lapisanTampil]);

  return (
    <SumberDayaKonteks.Provider value={sd}>
      <hemisphereLight args={["#f8fafc", "#a8a29e", 0.9]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[dokumen.kanvas.lebar * 0.8, 60, -dokumen.kanvas.tinggi * 0.3]} intensity={1.3} />
      <Lantai dokumen={dokumen} />
      <MawarLantai dokumen={dokumen} />
      {elemenTampil.map((e) => (
        <Elemen3D
          key={e.id}
          e={e}
          // Hanya tipe yang butuh yang menerima map/daftar yang berubah tiap edit,
          // agar memo Elemen3D (terutama bak dengan ribuan ice can) tetap efektif.
          byId={e.tipe === "derek" ? byId : MAP_KOSONG}
          daftarPintu={e.tipe === "dinding" ? daftarPintu : PINTU_KOSONG}
          derekRendah={e.tipe === "derek" ? derekRendah : SET_KOSONG}
          onKlik={onKlik}
          onHover={onHover}
        />
      ))}
      {sorot.map(({ e, jenis }) => (
        <Sorotan key={`${jenis}:${e.id}`} e={e} jenis={jenis} />
      ))}
      <Kamera dokumen={dokumen} fokusId={fokusId ?? null} byId={byId} hudRef={hudRef} />
    </SumberDayaKonteks.Provider>
  );
}

// ---------- Lantai, grid, mata angin ----------

const Lantai = memo(function Lantai({ dokumen }: { dokumen: DenahDokumen }) {
  const { materi } = useSumberDaya();
  const { lebar, tinggi, pelatLantai } = dokumen.kanvas;
  const tebal = Math.max(pelatLantai.tebalM, 0.01);
  const lubang = useMemo(() => lubangPelat(dokumen), [dokumen]);
  const kunciLubang = JSON.stringify(lubang);

  // Pelat lantai = lahan, berlubang di bak/tangki tertanam. Shape di bidang
  // (x, y denah), diekstrusi lalu diputar +90° di sumbu X: (sx, sy, sz) → (sx, −sz, sy).
  const pelat = useMemo(() => {
    const s = new Shape().moveTo(0, 0).lineTo(lebar, 0).lineTo(lebar, tinggi).lineTo(0, tinggi).closePath();
    for (const l of JSON.parse(kunciLubang) as typeof lubang) {
      s.holes.push(new Path().moveTo(l.x, l.y).lineTo(l.x, l.y + l.h).lineTo(l.x + l.w, l.y + l.h).lineTo(l.x + l.w, l.y).closePath());
    }
    return new ExtrudeGeometry(s, { depth: tebal, bevelEnabled: false });
  }, [lebar, tinggi, tebal, kunciLubang]);
  useLayoutEffect(() => () => pelat.dispose(), [pelat]);

  // Tanah di luar lahan (cincin), rata dengan muka lantai.
  const tanah = useMemo(() => {
    const m = Math.max(lebar, tinggi);
    const s = new Shape().moveTo(-m, -m).lineTo(lebar + m, -m).lineTo(lebar + m, tinggi + m).lineTo(-m, tinggi + m).closePath();
    s.holes.push(new Path().moveTo(0, 0).lineTo(0, tinggi).lineTo(lebar, tinggi).lineTo(lebar, 0).closePath());
    return new ShapeGeometry(s);
  }, [lebar, tinggi]);
  useLayoutEffect(() => () => tanah.dispose(), [tanah]);

  return (
    <group>
      <mesh geometry={pelat} material={materi.pelat} rotation={[Math.PI / 2, 0, 0]} />
      <mesh geometry={tanah} material={materi.tanah} rotation={[Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} />
      <Grid
        args={[lebar, tinggi]}
        position={[lebar / 2, 0.003, tinggi / 2]}
        cellSize={1}
        sectionSize={5}
        cellThickness={0.6}
        sectionThickness={1.1}
        cellColor="#a8a29e"
        sectionColor="#78716c"
        fadeDistance={Math.max(lebar, tinggi) * 4}
        fadeStrength={1}
        side={DoubleSide}
        raycast={() => null}
      />
    </group>
  );
});

/** Mawar mata angin di lantai, pojok kanan atas lahan (sama dengan 2D). */
const MawarLantai = memo(function MawarLantai({ dokumen }: { dokumen: DenahDokumen }) {
  const { materi } = useSumberDaya();
  const { lebar, tinggi, utaraDerajat } = dokumen.kanvas;
  const r = Math.min(4, Math.max(1, Math.max(lebar, tinggi) * 0.04));
  // Jarum di bidang shape menunjuk +sy; diputar −90° di X → menunjuk −z (utara saat 0°).
  const [utara, selatan] = useMemo(() => {
    const u = new Shape().moveTo(0, r).lineTo(r * 0.28, 0).lineTo(-r * 0.28, 0).closePath();
    const s = new Shape().moveTo(0, -r).lineTo(r * 0.28, 0).lineTo(-r * 0.28, 0).closePath();
    return [new ShapeGeometry(u), new ShapeGeometry(s)];
  }, [r]);
  useLayoutEffect(
    () => () => {
      utara.dispose();
      selatan.dispose();
    },
    [utara, selatan]
  );
  const pos = keThree(Math.max(lebar - r - 0.5, r), Math.min(r + 0.5, tinggi / 2), 0.01);
  const ujung = arahUtaraThree(utaraDerajat).map((v) => v * (r + 0.6)) as [number, number, number];
  return (
    <group position={pos} raycast={() => null}>
      <group rotation={[0, (-utaraDerajat * Math.PI) / 180, 0]}>
        <mesh geometry={utara} material={materi.mawarUtara} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} />
        <mesh geometry={selatan} material={materi.mawarSelatan} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} />
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} material={materi.mawarCincin} raycast={() => null}>
        <ringGeometry args={[r * 1.02, r * 1.1, 48]} />
      </mesh>
      <Html position={ujung} center zIndexRange={[15, 0]} pointerEvents="none">
        <span className="pointer-events-none text-sm font-bold text-red-600 drop-shadow dark:text-red-400">U</span>
      </Html>
    </group>
  );
});

// ---------- Sorotan (outline + label) ----------

function Sorotan({ e, jenis }: { e: DenahElemen; jenis: "pilih" | "hover" }) {
  const b = batasElemen(e);
  const label = `${e.nama.trim() || NAMA_TIPE[e.tipe]}`;
  const detail = e.tipe === "jalur" ? `${NAMA_TIPE[e.tipe]} Ø ${e.diameterMm} mm` : `${NAMA_TIPE[e.tipe]} · ${formatMeter(b.kotak.w)} × ${formatMeter(b.kotak.h)}`;
  return (
    <>
      <TepiKotak kotak={b.kotak} zBawah={b.zBawah} zAtas={b.zAtas} jenis={jenis} />
      <Html position={keThree(b.kotak.x + b.kotak.w / 2, b.kotak.y + b.kotak.h / 2, b.zAtas + 0.15)} center zIndexRange={[30, 20]} pointerEvents="none">
        <div className="pointer-events-none -translate-y-1/2 whitespace-nowrap rounded-md border bg-background/95 px-2 py-1 text-xs shadow">
          <div className="font-medium text-foreground">{label}</div>
          <div className="text-[10px] text-muted-foreground">{detail}</div>
        </div>
      </Html>
    </>
  );
}

// ---------- Kamera ----------

const vTarget = new Vector3();
const vUtara = new Vector3();

function Kamera({ dokumen, fokusId, byId, hudRef }: { dokumen: DenahDokumen; fokusId: string | null; byId: ReadonlyMap<string, DenahElemen>; hudRef: { current: HudHandle | null } }) {
  const ref = useRef<CameraControls>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const { lebar, tinggi, utaraDerajat } = dokumen.kanvas;

  const perbaruiHud = useCallback(() => {
    const c = ref.current;
    if (!c) return;
    c.getTarget(vTarget);
    const [ux, uy, uz] = arahUtaraThree(utaraDerajat);
    vUtara.set(vTarget.x + ux, vTarget.y + uy, vTarget.z + uz).project(camera);
    vTarget.project(camera);
    const ke = (v: Vector3) => ({ x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height });
    hudRef.current?.atur(sudutLayarUtara(ke(vTarget), ke(vUtara)));
  }, [camera, size.width, size.height, utaraDerajat, hudRef]);

  // Pandangan awal isometrik ke tengah lahan (sekali saat kanvas dibuka).
  const awalRef = useRef({ lebar, tinggi });
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const { lebar: l, tinggi: t } = awalRef.current;
    const L = Math.max(l, t, 5);
    c.minDistance = 0.5;
    c.maxDistance = L * 4;
    void c.setLookAt(l / 2 - L * 0.45, L * 0.7, t / 2 + L * 0.85, l / 2, 0, t / 2, false);
  }, []);

  useEffect(() => {
    perbaruiHud();
  }, [perbaruiHud]);

  useEffect(() => {
    const c = ref.current;
    const e = fokusId ? byId.get(fokusId) : undefined;
    if (!c || !e) return;
    const b = batasElemen(e);
    const kotak = new Box3(new Vector3(...keThree(b.kotak.x, b.kotak.y, b.zBawah)), new Vector3(...keThree(b.kotak.x + b.kotak.w, b.kotak.y + b.kotak.h, b.zAtas)));
    void c.fitToBox(kotak, true, { paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1 });
    // Hanya saat fokusId berganti; perubahan dokumen tidak memindahkan kamera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fokusId]);

  return <CameraControls ref={ref} makeDefault onUpdate={perbaruiHud} />;
}
