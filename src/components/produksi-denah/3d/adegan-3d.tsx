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
import { CameraControls, Grid, Html, OrthographicCamera } from "@react-three/drei";
import { DoubleSide, ExtrudeGeometry, Path, Shape, ShapeGeometry, Vector3, type OrthographicCamera as KameraOrto } from "three";
import { lapisanElemen, type DenahDokumen, type DenahElemen, type PintuElemen } from "@/lib/produksi-denah";
import { MawarAngin } from "@/components/produksi-denah/mawar-angin";
import { formatMeter } from "@/components/produksi-denah/format";
import { useLapisanTampil } from "@/components/produksi-denah/lapisan";
import { arahUtaraThree, BATAS_INSTANS_ICE_CAN, batasElemen, derekTerlaluRendah, hitungInstansIceCan, keThree, lubangPelat, sudutLayarUtara, type Vek3 } from "./koordinat";
import { buatSumberDaya, Elemen3D, SumberDayaKonteks, TepiKotak, useSumberDaya } from "./elemen-3d";
import { gabungKotak, kotakAdegan, posisiPreset, zoomOrtografis, type Kotak3D, type PresetKamera } from "./kamera";
import { ALAT_3D_AWAL, AlatUkur, AnimasiAliran, BilahAlat3D, TerapkanAlat, type StateAlat3D } from "./alat-3d";
import type { Tampilan3DProps } from "./tampilan-3d";

export type Adegan3DProps = Omit<Tampilan3DProps, "className">;

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
const TITIK_KOSONG: readonly Vek3[] = [];
/** Batas outline peringatan yang digambar sekaligus. */
const MAKS_SOROT_PERINGATAN = 200;
const FOV = 45;

interface HudHandle {
  atur(derajat: number): void;
}

/** Permintaan kamera (preset bilah alat / fokus dari panel validasi). seq naik tiap permintaan. */
interface PermintaanKamera {
  preset: PresetKamera;
  kotak: Kotak3D;
  seq: number;
  transisi: boolean;
}

export default function Adegan3D(props: Adegan3DProps) {
  const { dokumen, terpilihIds, lapisanTampil, fokusId, fokusSeq } = props;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [alat, setAlat] = useState<StateAlat3D>(ALAT_3D_AWAL);
  // Hasil alat Ukur: sementara, tidak pernah masuk dokumen.
  const [titikUkur, setTitikUkur] = useState<readonly Vek3[]>(TITIK_KOSONG);
  const [, aturLapisanToko] = useLapisanTampil();
  const onUbahLapisan = props.onUbahLapisan ?? aturLapisanToko;
  const hudRef = useRef<HudHandle>(null);
  const awalPointer = useRef<{ x: number; y: number } | null>(null);
  const onPilihRef = useRef(props.onPilih);
  const ukurRef = useRef(false);
  useLayoutEffect(() => {
    onPilihRef.current = props.onPilih;
    ukurRef.current = alat.ukur;
  });

  const kotakSeluruh = useMemo(() => kotakAdegan(dokumen), [dokumen]);
  // Batas kinerja: terlalu banyak instans → ice can tidak digambar (cangkang bak saja).
  const jumlahIceCan = useMemo(() => hitungInstansIceCan(dokumen.elemen.filter((e) => e.tipe === "bak" && lapisanTampil.has(lapisanElemen(e)))), [dokumen.elemen, lapisanTampil]);
  const tampilIceCan = jumlahIceCan <= BATAS_INSTANS_ICE_CAN;
  const onGagalRef = useRef(props.onGagal);
  useLayoutEffect(() => {
    onGagalRef.current = props.onGagal;
  });
  // Konteks WebGL hilang (perangkat mobile / memori GPU habis) → induk kembali ke 2D.
  // Listener dipasang lewat efek (bukan langsung di onCreated) agar ikut
  // dipasang ulang setelah unmount simulasi StrictMode dan dilepas saat unmount.
  const [kanvasGl, setKanvasGl] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (!kanvasGl) return;
    const onHilang = (ev: Event) => {
      ev.preventDefault();
      onGagalRef.current?.();
    };
    kanvasGl.addEventListener("webglcontextlost", onHilang);
    return () => kanvasGl.removeEventListener("webglcontextlost", onHilang);
  }, [kanvasGl]);
  const [permintaan, setPermintaan] = useState<PermintaanKamera>(() => ({ preset: "iso", kotak: kotakAdegan(dokumen), seq: 0, transisi: false }));

  const terpilihTampil = useMemo(() => dokumen.elemen.filter((e) => terpilihIds.has(e.id) && lapisanTampil.has(lapisanElemen(e))), [dokumen.elemen, terpilihIds, lapisanTampil]);
  const mintaKamera = (preset: PresetKamera) => {
    const kotak = preset === "fokus" ? gabungKotak(terpilihTampil.map(batasElemen)) : kotakSeluruh;
    if (kotak) setPermintaan((p) => ({ preset, kotak, seq: p.seq + 1, transisi: true }));
  };

  // Fokus dari luar (klik peringatan di panel validasi): hanya saat fokusId/fokusSeq
  // BERGANTI selama kanvas terbuka (bukan saat dibuka), disesuaikan saat render.
  const kunciFokus = `${fokusId ?? ""}#${fokusSeq ?? 0}`;
  const [kunciFokusLama, setKunciFokusLama] = useState(kunciFokus);
  if (kunciFokus !== kunciFokusLama) {
    setKunciFokusLama(kunciFokus);
    const e = fokusId ? dokumen.elemen.find((x) => x.id === fokusId) : undefined;
    if (e) setPermintaan((p) => ({ preset: "fokus", kotak: gabungKotak([batasElemen(e)])!, seq: p.seq + 1, transisi: true }));
  }

  const ubahAlat = (ubah: Partial<StateAlat3D>) => {
    if (ubah.ukur === false) setTitikUkur(TITIK_KOSONG); // ganti alat → hasil ukur hilang
    setAlat((a) => ({ ...a, ...ubah }));
  };
  const tambahTitikUkur = useCallback((p: Vek3) => setTitikUkur((lama) => (lama.length >= 2 ? [p] : [...lama, p])), []);

  // Esc: hapus hasil ukur (lalu matikan alat Ukur). Fase capture agar Esc builder
  // (batal pilih) tidak ikut jalan selagi masih ada hasil ukur.
  const adaTitik = titikUkur.length > 0;
  useEffect(() => {
    if (!alat.ukur) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      if (adaTitik) {
        ev.stopPropagation();
        setTitikUkur(TITIK_KOSONG);
      } else setAlat((a) => ({ ...a, ukur: false }));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [alat.ukur, adaTitik]);

  return (
    <div
      className="relative h-full w-full bg-gradient-to-b from-sky-100 to-slate-100 dark:from-slate-900 dark:to-slate-950"
      style={{ cursor: alat.ukur ? "crosshair" : hoverId ? "pointer" : undefined }}
      onPointerDown={(ev) => {
        awalPointer.current = { x: ev.clientX, y: ev.clientY };
      }}
    >
      <Canvas
        // Render berkelanjutan HANYA saat animasi aliran menyala (spec §7 "Kinerja").
        frameloop={alat.aliran ? "always" : "demand"}
        dpr={[1, 2]}
        camera={{ fov: FOV, near: 0.05, far: 10000, position: [0, 40, 40] }}
        gl={{ antialias: true }}
        onCreated={({ gl }) => {
          // Alat potongan: clipping plane per material (buatSumberDaya().aturPotongan).
          gl.localClippingEnabled = true;
          setKanvasGl(gl.domElement);
        }}
        onPointerMissed={(ev) => {
          if (ukurRef.current) return; // klik alat Ukur tidak mengubah seleksi
          const a = awalPointer.current;
          if (a && Math.hypot(ev.clientX - a.x, ev.clientY - a.y) > BATAS_GESER_PX) return;
          onPilihRef.current(null, null);
        }}
      >
        <IsiAdegan
          {...props}
          onPilihRef={onPilihRef}
          ukurRef={ukurRef}
          hoverId={hoverId}
          setHoverId={setHoverId}
          hudRef={hudRef}
          alat={alat}
          permintaan={permintaan}
          jangkauan={Math.max(kotakSeluruh.w, kotakSeluruh.h, 5)}
          titikUkur={titikUkur}
          onTitikUkur={tambahTitikUkur}
          tampilIceCan={tampilIceCan}
        />
      </Canvas>
      {!tampilIceCan && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md border bg-background/90 px-2 py-1 text-xs text-muted-foreground shadow-sm">
          Ice can tidak ditampilkan: terlalu banyak ({jumlahIceCan.toLocaleString("id-ID")})
        </div>
      )}
      <BilahAlat3D
        alat={alat}
        onUbah={ubahAlat}
        onKamera={mintaKamera}
        adaTerpilih={terpilihTampil.length > 0}
        kotakAdegan={kotakSeluruh}
        jumlahTitikUkur={titikUkur.length}
        lapisanTampil={lapisanTampil}
        onUbahLapisan={onUbahLapisan}
        elemen={dokumen.elemen}
      />
      <HudUtara ref={hudRef} awal={dokumen.kanvas.utaraDerajat} />
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
  ukurRef: { current: boolean };
  hoverId: string | null;
  setHoverId: (f: (id: string | null) => string | null) => void;
  hudRef: { current: HudHandle | null };
  alat: StateAlat3D;
  permintaan: PermintaanKamera;
  /** Ukuran terbesar adegan (m) — batas jarak kamera. */
  jangkauan: number;
  titikUkur: readonly Vek3[];
  onTitikUkur: (p: Vek3) => void;
  tampilIceCan: boolean;
}

function IsiAdegan({ dokumen, terpilihIds, lapisanTampil, peringatan, onPilihRef, ukurRef, hoverId, setHoverId, hudRef, alat, permintaan, jangkauan, titikUkur, onTitikUkur, tampilIceCan }: IsiAdeganProps) {
  // Sumber daya dibuat sekali per kanvas dan dibuang saat kanvas ditutup.
  // Aman untuk StrictMode (dev): unmount simulasi menjalankan cleanup → sd
  // dibuang, lalu mount simulasi menjalankan efek lagi dengan state yang SAMA.
  // Efek mendeteksi sd.dibuang dan membuat sumber daya baru (render ulang
  // seluruh konsumen konteks + TerapkanAlat menerapkan ulang x-ray/potongan),
  // jadi pohon hidup tidak pernah memakai material yang sudah dibuang atau
  // material berwarna yang tidak terdaftar di cache (luput clipping/x-ray).
  const [sd, setSd] = useState(buatSumberDaya);
  useEffect(() => {
    if (sd.dibuang) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- pemulihan setelah unmount simulasi StrictMode; terjadi paling banyak sekali
      setSd(buatSumberDaya());
      return;
    }
    return () => sd.buang();
  }, [sd]);

  const elemenTampil = useMemo(() => dokumen.elemen.filter((e) => lapisanTampil.has(lapisanElemen(e))), [dokumen.elemen, lapisanTampil]);
  const byId = useMemo(() => new Map(dokumen.elemen.map((e) => [e.id, e])), [dokumen.elemen]);
  const daftarPintu = useMemo(() => elemenTampil.filter((e): e is PintuElemen => e.tipe === "pintu"), [elemenTampil]);
  const derekRendah = useMemo(() => derekTerlaluRendah(peringatan), [peringatan]);

  const onKlik = useCallback(
    (elemenId: string, kolomId: string | null, ev: ThreeEvent<MouseEvent>) => {
      if (ev.delta > BATAS_GESER_PX) return; // kamera diputar, bukan klik
      if (ukurRef.current) return; // klik alat Ukur tidak mengubah seleksi
      onPilihRef.current(elemenId, kolomId);
    },
    [onPilihRef, ukurRef]
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

  // Outline kuning: elemen (dan elemen terkait) yang terkena peringatan teknik, di lapisan tampil.
  const sorotPeringatan = useMemo(() => {
    const ids = new Set<string>();
    for (const g of peringatan) {
      if (g.elemenId) ids.add(g.elemenId);
      for (const id of g.elemenTerkaitIds ?? []) ids.add(id);
    }
    return elemenTampil.filter((e) => ids.has(e.id)).slice(0, MAKS_SOROT_PERINGATAN);
  }, [peringatan, elemenTampil]);

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
          aliran={e.tipe === "jalur" && alat.aliran}
          tampilIceCan={e.tipe !== "bak" || tampilIceCan}
          onKlik={onKlik}
          onHover={onHover}
        />
      ))}
      {sorotPeringatan.map((e) => {
        const b = batasElemen(e);
        return <TepiKotak key={`peringatan:${e.id}`} kotak={b.kotak} zBawah={b.zBawah} zAtas={b.zAtas} jenis="peringatan" />;
      })}
      {sorot.map(({ e, jenis }) => (
        <Sorotan key={`${jenis}:${e.id}`} e={e} jenis={jenis} />
      ))}
      <TerapkanAlat xray={alat.xray} potongan={alat.potongan} posisiPotongan={alat.posisiPotongan} />
      {alat.aliran && <AnimasiAliran />}
      {alat.ukur && <AlatUkur titik={titikUkur} onTitik={onTitikUkur} />}
      <Kamera permintaan={permintaan} jangkauan={jangkauan} utaraDerajat={dokumen.kanvas.utaraDerajat} hudRef={hudRef} />
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

/**
 * Kamera + CameraControls. Preset "atas" memakai kamera ORTOGRAFIS (drei
 * OrthographicCamera makeDefault; dilepas → kamera perspektif kanvas kembali).
 * drei membuat ulang CameraControls saat kamera bawaan berganti, jadi
 * permintaan baru diterapkan setelah kontrol memegang kamera yang sesuai.
 */
function Kamera({ permintaan, jangkauan, utaraDerajat, hudRef }: { permintaan: PermintaanKamera; jangkauan: number; utaraDerajat: number; hudRef: { current: HudHandle | null } }) {
  const ref = useRef<CameraControls>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const orto = permintaan.preset === "atas";
  const diterapkan = useRef(-1);
  const kameraTerakhir = useRef<typeof camera | null>(null);

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

  useEffect(() => {
    perbaruiHud();
  }, [perbaruiHud]);

  // Terapkan permintaan (awal = isometrik ke seluruh adegan, sekali saat kanvas dibuka).
  // Perubahan dokumen tidak memindahkan kamera; hanya permintaan baru (seq).
  useEffect(() => {
    const c = ref.current;
    if (!c || diterapkan.current === permintaan.seq) return;
    const kameraOrto = (camera as KameraOrto).isOrthographicCamera === true;
    if (kameraOrto !== orto || c.camera !== camera) return; // tunggu kamera & kontrol berganti
    const gantiKamera = kameraTerakhir.current !== null && kameraTerakhir.current !== camera;
    kameraTerakhir.current = camera;
    diterapkan.current = permintaan.seq;
    const { posisi, target } = posisiPreset(permintaan.preset, permintaan.kotak, { fovDerajat: FOV, aspek: size.width / Math.max(size.height, 1) });
    const jarak = Math.hypot(posisi[0] - target[0], posisi[1] - target[1], posisi[2] - target[2]);
    c.minDistance = 0.5;
    c.maxDistance = Math.max(jangkauan * 4, jarak * 1.5);
    const transisi = permintaan.transisi && !gantiKamera;
    void c.setLookAt(...posisi, ...target, transisi);
    if (orto) void c.zoomTo(zoomOrtografis(permintaan.kotak, size.width, size.height), transisi);
  }, [permintaan, camera, orto, size.width, size.height, jangkauan]);

  return (
    <>
      {orto && <OrthographicCamera makeDefault near={0.05} far={10000} />}
      <CameraControls ref={ref} makeDefault onUpdate={perbaruiHud} />
    </>
  );
}
