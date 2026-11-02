"use client";

// Alat Mode 3D Replika (spec v2 §7 "Alat 3D"). HANYA dimuat lewat
// adegan-3d.tsx (chunk dinamis) — file ini mengimpor three secara statis.
//
// - BilahAlat3D (DOM, di atas viewport): preset kamera, X-ray beton,
//   potongan + slider, Ukur, Aliran, Lapisan.
// - TerapkanAlat / AnimasiAliran / AlatUkur (di dalam <Canvas>): menerapkan
//   state bilah ke sumber daya terpusat (buatSumberDaya) dan adegan.
//
// Semua state alat bersifat sementara (per kanvas) dan TIDAK PERNAH mengubah
// DenahDokumen.

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html, Line } from "@react-three/drei";
import { Raycaster, Vector2, type Material, type Mesh, type Object3D } from "three";
import { Box, Crosshair, Eye, Move3d, Ruler, Scissors, Square, Waves, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DenahElemen, Lapisan } from "@/lib/produksi-denah";
import { formatMeter } from "@/components/produksi-denah/format";
import { MenuLapisan } from "@/components/produksi-denah/menu-lapisan";
import { hasilUkur3D, rentangPotongan, type Kotak3D, type ModePotongan, type PresetKamera } from "./kamera";
import { PANJANG_PITA_ALIRAN_M, useSumberDaya } from "./elemen-3d";
import type { Vek3 } from "./koordinat";

export interface StateAlat3D {
  xray: boolean;
  potongan: ModePotongan;
  /** Posisi bidang potong (m): elevasi untuk horizontal, x/y denah untuk vertikal. */
  posisiPotongan: number;
  ukur: boolean;
  aliran: boolean;
}

export const ALAT_3D_AWAL: StateAlat3D = { xray: false, potongan: "tidak", posisiPotongan: 1, ukur: false, aliran: false };

/** Elevasi awal potongan horizontal (spec: "mis. potong di +1,0 m"). */
const POTONG_HORIZONTAL_AWAL_M = 1;
/** Kecepatan pita aliran (m/detik). */
const KECEPATAN_ALIRAN_M = 0.8;
const BATAS_GESER_PX = 4;

const LABEL_POTONGAN: Record<ModePotongan, string> = {
  tidak: "Tidak",
  horizontal: "Horizontal",
  x: "Vertikal-X",
  y: "Vertikal-Y",
};

/** Posisi awal slider saat mode potongan dipilih. */
export function posisiAwalPotongan(mode: ModePotongan, kotak: Kotak3D): number {
  if (mode === "tidak") return 0;
  const { min, maks } = rentangPotongan(mode, kotak);
  if (mode === "horizontal") return Math.min(Math.max(POTONG_HORIZONTAL_AWAL_M, min), maks);
  return (min + maks) / 2;
}

// ---------- Bilah alat (DOM) ----------

function TombolAlat({ ikon: Ikon, label, judul, aktif, disabled, onClick }: { ikon: LucideIcon; label: string; judul: string; aktif?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={judul}
      aria-pressed={aktif}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5",
        aktif ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      <Ikon />
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}

const Pemisah = () => <div className="mx-0.5 h-5 w-px bg-border" aria-hidden />;

export function BilahAlat3D({
  alat,
  onUbah,
  onKamera,
  adaTerpilih,
  kotakAdegan,
  jumlahTitikUkur,
  lapisanTampil,
  onUbahLapisan,
  elemen,
}: {
  alat: StateAlat3D;
  onUbah: (ubah: Partial<StateAlat3D>) => void;
  onKamera: (preset: PresetKamera) => void;
  adaTerpilih: boolean;
  kotakAdegan: Kotak3D;
  jumlahTitikUkur: number;
  lapisanTampil: ReadonlySet<Lapisan>;
  onUbahLapisan: (l: Lapisan, tampil: boolean) => void;
  elemen: readonly DenahElemen[];
}) {
  const rentang = alat.potongan === "tidak" ? null : rentangPotongan(alat.potongan, kotakAdegan);
  return (
    <div className="pointer-events-none absolute top-3 left-3 z-10 flex max-w-[calc(100%-7rem)] flex-col items-start gap-1.5">
      <div role="toolbar" aria-label="Alat 3D" className="pointer-events-auto flex flex-wrap items-center gap-0.5 rounded-lg border bg-background/95 p-1 shadow-sm backdrop-blur">
        <TombolAlat ikon={Box} label="Isometrik" judul="Kamera isometrik" onClick={() => onKamera("iso")} />
        <TombolAlat ikon={Square} label="Atas" judul="Kamera atas (ortografis)" onClick={() => onKamera("atas")} />
        <TombolAlat ikon={Move3d} label="Depan" judul="Kamera depan (dari selatan denah)" onClick={() => onKamera("depan")} />
        <TombolAlat ikon={Crosshair} label="Fokus" judul={adaTerpilih ? "Fokus ke elemen terpilih" : "Pilih elemen dulu untuk fokus"} disabled={!adaTerpilih} onClick={() => onKamera("fokus")} />
        <Pemisah />
        <TombolAlat ikon={Eye} label="X-ray" judul="X-ray beton: pelat, dinding, beton & cangkang bak transparan" aktif={alat.xray} onClick={() => onUbah({ xray: !alat.xray })} />
        <label className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground" title="Bidang potong (section)">
          <Scissors className="size-3.5" />
          <span className="sr-only">Potongan</span>
          <select
            value={alat.potongan}
            onChange={(ev) => {
              const mode = ev.target.value as ModePotongan;
              onUbah({ potongan: mode, posisiPotongan: posisiAwalPotongan(mode, kotakAdegan) });
            }}
            className={cn("h-6 rounded border bg-background px-1 text-xs text-foreground", alat.potongan !== "tidak" && "border-primary")}
          >
            {(Object.keys(LABEL_POTONGAN) as ModePotongan[]).map((m) => (
              <option key={m} value={m}>
                {m === "tidak" ? "Potongan: Tidak" : LABEL_POTONGAN[m]}
              </option>
            ))}
          </select>
        </label>
        <TombolAlat ikon={Ruler} label="Ukur" judul="Ukur: klik dua titik permukaan (Esc untuk menghapus)" aktif={alat.ukur} onClick={() => onUbah({ ukur: !alat.ukur })} />
        <TombolAlat ikon={Waves} label="Aliran" judul="Animasi aliran pada jalur (arah sesuai urutan titik)" aktif={alat.aliran} onClick={() => onUbah({ aliran: !alat.aliran })} />
        <Pemisah />
        <MenuLapisan tampil={lapisanTampil} onUbah={onUbahLapisan} elemen={elemen} />
      </div>
      {rentang && (
        <div className="pointer-events-auto flex items-center gap-2 rounded-lg border bg-background/95 px-2 py-1 text-xs shadow-sm backdrop-blur">
          <span className="text-muted-foreground">{alat.potongan === "horizontal" ? "Potong di elevasi" : alat.potongan === "x" ? "Potong di x" : "Potong di y"}</span>
          <input
            type="range"
            aria-label="Posisi bidang potong"
            min={rentang.min}
            max={rentang.maks}
            step={0.05}
            value={alat.posisiPotongan}
            onChange={(ev) => onUbah({ posisiPotongan: Number(ev.target.value) })}
            className="w-36 accent-primary sm:w-48"
          />
          <span className="w-16 text-right font-medium tabular-nums">{formatMeter(alat.posisiPotongan)}</span>
        </div>
      )}
      {alat.ukur && (
        <div className="pointer-events-none rounded-md bg-background/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm">
          {jumlahTitikUkur === 0 ? "Klik titik pertama pada permukaan benda." : jumlahTitikUkur === 1 ? "Klik titik kedua." : "Klik lagi untuk ukuran baru · Esc menghapus."}
        </div>
      )}
    </div>
  );
}

// ---------- Di dalam Canvas ----------

/** Menerapkan X-ray & potongan ke material terpusat. */
export function TerapkanAlat({ xray, potongan, posisiPotongan }: Pick<StateAlat3D, "xray" | "potongan" | "posisiPotongan">) {
  const sd = useSumberDaya();
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    sd.aturXray(xray);
    invalidate();
  }, [sd, xray, invalidate]);
  useEffect(() => {
    sd.aturPotongan(potongan, posisiPotongan);
    invalidate();
  }, [sd, potongan, posisiPotongan, invalidate]);
  // Kanvas ditutup dengan alat menyala: material dibuang bersama sumber daya, tidak perlu dipulihkan.
  return null;
}

/** Menggeser tekstur pita aliran tiap frame (dirender hanya saat aliran menyala; frameloop "always"). */
export function AnimasiAliran() {
  const sd = useSumberDaya();
  useFrame((_, dt) => {
    sd.majukanAliran((Math.min(dt, 0.1) * KECEPATAN_ALIRAN_M) / PANJANG_PITA_ALIRAN_M);
  });
  return null;
}

function terlihat(o: Object3D | null): boolean {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/**
 * Alat Ukur: dua klik pada permukaan (raycast sendiri ke seluruh adegan,
 * mengabaikan bagian terpotong & beton x-ray) → garis + label. Hasil disimpan
 * induk (sementara) agar Esc / ganti alat bisa menghapusnya.
 */
export function AlatUkur({ titik, onTitik }: { titik: readonly Vek3[]; onTitik: (p: Vek3) => void }) {
  const sd = useSumberDaya();
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  const onTitikRef = useRef(onTitik);
  useEffect(() => {
    onTitikRef.current = onTitik;
  });

  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    let awal: { x: number; y: number } | null = null;
    const turun = (ev: PointerEvent) => {
      awal = ev.button === 0 ? { x: ev.clientX, y: ev.clientY } : null;
    };
    const naik = (ev: PointerEvent) => {
      const a = awal;
      awal = null;
      if (!a || ev.button !== 0 || Math.hypot(ev.clientX - a.x, ev.clientY - a.y) > BATAS_GESER_PX) return;
      const r = el.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      const { camera, scene } = get();
      raycaster.setFromCamera(ndc, camera);
      for (const h of raycaster.intersectObjects(scene.children, true)) {
        const m = h.object as Mesh;
        if (!m.isMesh || !terlihat(m)) continue;
        if (sd.terpotong(h.point) || sd.tembusXray(m.material as Material)) continue;
        onTitikRef.current([h.point.x, h.point.y, h.point.z]);
        return;
      }
    };
    el.addEventListener("pointerdown", turun);
    el.addEventListener("pointerup", naik);
    return () => {
      el.removeEventListener("pointerdown", turun);
      el.removeEventListener("pointerup", naik);
    };
  }, [gl, get, sd]);

  const hasil = useMemo(() => (titik.length === 2 ? hasilUkur3D(titik[0], titik[1]) : null), [titik]);
  const tengah: Vek3 | null = titik.length === 2 ? [(titik[0][0] + titik[1][0]) / 2, (titik[0][1] + titik[1][1]) / 2, (titik[0][2] + titik[1][2]) / 2] : null;

  return (
    <group>
      {titik.map((p, i) => (
        <mesh key={i} geometry={sd.geo.bola} position={p} scale={0.12} renderOrder={11} raycast={() => null}>
          <meshBasicMaterial color="#e11d48" depthTest={false} transparent />
        </mesh>
      ))}
      {titik.length === 2 && <Line points={[titik[0], titik[1]]} color="#e11d48" lineWidth={2.5} depthTest={false} transparent renderOrder={11} raycast={() => null} />}
      {hasil && tengah && (
        <Html position={tengah} center zIndexRange={[40, 30]} pointerEvents="none">
          <div className="pointer-events-none whitespace-nowrap rounded-md border border-rose-500/50 bg-background/95 px-2 py-1 text-xs shadow">
            <div className="font-semibold tabular-nums text-foreground">{formatMeter(hasil.jarak)}</div>
            <div className="text-[10px] tabular-nums text-muted-foreground">
              Δ horizontal {formatMeter(hasil.horizontal)} · Δ tinggi {formatMeter(hasil.tinggi)}
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}
