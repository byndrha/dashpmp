"use client";

// Model 3D detail per jenis mesin (MesinElemen.model), dibangun prosedural
// dari primitif bersama (kotak, silinder, bola, torus) di dalam kotak elemen:
// sumbu X lokal = w (panjang), Z lokal = h (lebar), Y = tinggiM. Muka depan
// mesin menghadap +Z lokal (sisi y besar di denah sebelum rotasi).
//
// Acuan bentuk (foto dari pengguna, 2026-11-23):
//   - Kompresor: Mycom 8WB 8 silinder torak — skid biru, blok kompresor
//     dengan tutup kepala silinder, katup hisap/buang menjulang (satu bertutup
//     kuning), kopling, motor listrik, panel pengukur 3 jarum, kotak kontrol abu.
//   - Kondensor: shell & tube mendatar, flens & tutup cembung di kedua ujung,
//     nosel atas, kaki pelana.
//   - Akumulator: bejana tegak di atas alas, dua pipa atas (dari evaporator,
//     ke kompresor).
// HANYA dimuat lewat elemen-3d.tsx (bagian dari bundel 3D dinamis).
import type { ReactNode } from "react";
import type { Material } from "three";
import type { MesinElemen, ModelMesin } from "@/lib/produksi-denah";
import { useSumberDaya } from "./elemen-3d";
import { keThree } from "./koordinat";

export type V3 = [number, number, number];

// Primitif tingkat modul (bukan dibuat per render) — identitas komponen
// stabil sehingga React tidak memasang ulang mesh tiap render.
export function K({ p, s, m }: { p: V3; s: V3; m: Material }) {
  const { geo } = useSumberDaya();
  return s.every((v) => v > 0) ? <mesh geometry={geo.kotak} material={m} position={p} scale={s} /> : null;
}

/** Silinder; sumbu "y" (tegak), "x" atau "z". */
export function S({ p, r, l, sumbu = "y", m }: { p: V3; r: number; l: number; sumbu?: "x" | "y" | "z"; m: Material }) {
  const { geo } = useSumberDaya();
  if (!(r > 0 && l > 0)) return null;
  return (
    <mesh
      geometry={geo.silinder}
      material={m}
      position={p}
      rotation={sumbu === "x" ? [0, 0, Math.PI / 2] : sumbu === "z" ? [Math.PI / 2, 0, 0] : [0, 0, 0]}
      scale={[r * 2, l, r * 2]}
    />
  );
}

export function B({ p, s, m }: { p: V3; s: V3; m: Material }) {
  const { geo } = useSumberDaya();
  return s.every((v) => v > 0) ? <mesh geometry={geo.bola} material={m} position={p} scale={s} /> : null;
}

/** Cincin (torus, jari-jari 1 di geometri) — bidang cincin tegak lurus sumbu. */
export function T({ p, r, sumbu = "y", m }: { p: V3; r: number; sumbu?: "x" | "y" | "z"; m: Material }) {
  const { geo } = useSumberDaya();
  if (!(r > 0)) return null;
  return (
    <mesh
      geometry={geo.torus}
      material={m}
      position={p}
      rotation={sumbu === "y" ? [Math.PI / 2, 0, 0] : sumbu === "x" ? [0, Math.PI / 2, 0] : [0, 0, 0]}
      scale={[r, r, r]}
    />
  );
}

interface Ukuran {
  L: number; // panjang (x lokal)
  D: number; // lebar (z lokal)
  H: number; // tinggi
}

// ---------------------------------------------------------------------------

function Kompresor({ L, D, H }: Ukuran) {
  const { materi: m } = useSumberDaya();
  const hs = Math.min(0.1 * H, 0.16); // tinggi skid
  const hb = 0.62 * H; // badan kompresor
  const xc = -0.26 * L; // pusat blok kompresor
  const wb = 0.42 * L;
  const atasBadan = hs + hb;
  const katupL = Math.max(H - atasBadan, 0.05);
  const rMotor = Math.min(0.36 * D, 0.24 * H);
  const yMotor = hs + rMotor + 0.03 * H;
  return (
    <group>
      {/* Skid baja kanal + balok kayu ganjal */}
      <K p={[0, hs / 2, 0]} s={[L * 0.98, hs, D * 0.92]} m={m.catBiruTua} />
      <K p={[-L * 0.42, hs * 0.25, 0]} s={[L * 0.07, hs * 0.5, D]} m={m.kayu} />
      <K p={[L * 0.42, hs * 0.25, 0]} s={[L * 0.07, hs * 0.5, D]} m={m.kayu} />
      {/* Blok kompresor (crankcase) */}
      <K p={[xc, hs + hb * 0.42, 0]} s={[wb, hb * 0.84, D * 0.78]} m={m.catBiru} />
      {/* Tutup kepala silinder (bank V) */}
      <S p={[xc, hs + hb * 0.9, -D * 0.17]} r={Math.min(D * 0.14, hb * 0.14)} l={wb * 0.92} sumbu="x" m={m.catBiru} />
      <S p={[xc, hs + hb * 0.9, D * 0.17]} r={Math.min(D * 0.14, hb * 0.14)} l={wb * 0.92} sumbu="x" m={m.catBiru} />
      {/* Tutup samping bermur (dua cakram di muka depan) */}
      <S p={[xc - wb * 0.2, hs + hb * 0.45, D * 0.4]} r={hb * 0.17} l={0.04} sumbu="z" m={m.catBiruTua} />
      <S p={[xc + wb * 0.2, hs + hb * 0.45, D * 0.4]} r={hb * 0.17} l={0.04} sumbu="z" m={m.catBiruTua} />
      <S p={[xc, hs + hb * 0.16, D * 0.4]} r={hb * 0.1} l={0.04} sumbu="z" m={m.catBiruTua} />
      {/* Katup hisap & buang menjulang, berflens; satu bertutup kuning */}
      {[
        { x: xc - wb * 0.36, z: -D * 0.12, tutup: m.catBiru },
        { x: xc + wb * 0.42, z: -D * 0.12, tutup: m.kuning },
      ].map((k, i) => (
        <group key={i}>
          <S p={[k.x, atasBadan + katupL * 0.45, k.z]} r={Math.min(D * 0.09, 0.09)} l={katupL * 0.9} m={m.catBiru} />
          <S p={[k.x, atasBadan + katupL * 0.25, k.z]} r={Math.min(D * 0.13, 0.13)} l={0.05} m={m.catBiruTua} />
          <B p={[k.x, atasBadan + katupL * 0.55, k.z]} s={[Math.min(D * 0.22, 0.22), katupL * 0.3, Math.min(D * 0.22, 0.22)]} m={m.catBiru} />
          <S p={[k.x, atasBadan + katupL * 0.95, k.z]} r={Math.min(D * 0.08, 0.08)} l={katupL * 0.12} m={k.tutup} />
        </group>
      ))}
      {/* Kopling (pelindung) */}
      <S p={[L * 0.0, yMotor, 0]} r={rMotor * 0.55} l={L * 0.1} sumbu="x" m={m.catBiruTua} />
      {/* Motor listrik + tutup ujung + kaki */}
      <S p={[L * 0.22, yMotor, 0]} r={rMotor} l={L * 0.3} sumbu="x" m={m.catBiru} />
      <B p={[L * 0.37, yMotor, 0]} s={[L * 0.05, rMotor * 1.9, rMotor * 1.9]} m={m.catBiruTua} />
      <K p={[L * 0.22, hs + 0.015 * H, 0]} s={[L * 0.26, 0.03 * H + 0.01, rMotor * 2.1]} m={m.catBiruTua} />
      {/* Panel pengukur 3 jarum di muka depan */}
      <K p={[L * 0.05, atasBadan - hb * 0.25, D * 0.42]} s={[L * 0.17, hb * 0.32, 0.03]} m={m.putih} />
      {[-1, 0, 1].map((i) => (
        <S key={i} p={[L * 0.05 + i * L * 0.05, atasBadan - hb * 0.2, D * 0.44]} r={Math.min(hb * 0.06, L * 0.02)} l={0.02} sumbu="z" m={m.logamGelap} />
      ))}
      {/* Kotak kontrol abu di ujung motor */}
      <K p={[L * 0.43, hs + H * 0.34, D * 0.25]} s={[L * 0.12, H * 0.42, D * 0.3]} m={m.panelAbu} />
    </group>
  );
}

function Kondensor({ L, D, H }: Ukuran) {
  const { materi: m } = useSumberDaya();
  const hn = Math.min(0.15 * H, 0.22); // tinggi nosel atas
  const r = Math.max(Math.min((D * 0.92) / 2, (H - hn) * 0.42), 0.05);
  const cy = H - hn - r;
  const panjangShell = L * 0.82;
  const ujung = panjangShell / 2;
  const dalamTutup = Math.min(L * 0.07, r * 0.7);
  return (
    <group>
      {/* Kaki pelana + pelat dasar */}
      {[-0.3, 0.3].map((f) => (
        <group key={f}>
          <K p={[L * f, cy / 2, 0]} s={[Math.min(0.18, L * 0.04), cy, r * 1.4]} m={m.tabungAbuTua} />
          <K p={[L * f, 0.015, 0]} s={[Math.min(0.32, L * 0.07), 0.03, r * 1.7]} m={m.tabungAbuTua} />
        </group>
      ))}
      {/* Badan tabung */}
      <S p={[0, cy, 0]} r={r} l={panjangShell} sumbu="x" m={m.tabungAbu} />
      {/* Flens + tutup cembung (bonnet) di kedua ujung */}
      {[-1, 1].map((sisi) => (
        <group key={sisi}>
          <S p={[sisi * ujung, cy, 0]} r={r * 1.1} l={Math.min(0.08, L * 0.015)} sumbu="x" m={m.tabungAbuTua} />
          <S p={[sisi * (ujung + dalamTutup * 0.35), cy, 0]} r={r * 0.98} l={dalamTutup * 0.7} sumbu="x" m={m.tabungAbu} />
          <B p={[sisi * (ujung + dalamTutup * 0.7), cy, 0]} s={[dalamTutup * 1.2, r * 1.9, r * 1.9]} m={m.tabungAbu} />
        </group>
      ))}
      {/* Nosel atas berflens (masuk gas, keluar cair di ujung berlawanan) */}
      {[-0.36, 0.36].map((f) => (
        <group key={f}>
          <S p={[L * f, cy + r + hn / 2 - 0.02, 0]} r={Math.min(r * 0.16, 0.08)} l={hn + 0.04} m={m.tabungAbu} />
          <S p={[L * f, H - 0.02, 0]} r={Math.min(r * 0.26, 0.13)} l={0.04} m={m.tabungAbuTua} />
        </group>
      ))}
      {/* Nosel kecil bawah (drain / keluar cair) */}
      {[-0.2, 0.42].map((f) => (
        <S key={f} p={[L * f, Math.max(cy - r - 0.05, 0.04), 0]} r={Math.min(r * 0.08, 0.04)} l={0.12} m={m.tabungAbuTua} />
      ))}
    </group>
  );
}

function Akumulator({ L, D, H }: Ukuran) {
  const { materi: m } = useSumberDaya();
  const r = Math.max(Math.min(L, D) * 0.3, 0.04);
  const hAlas = Math.min(0.08 * H, 0.15);
  const pipaAtas = Math.min(0.22 * H, 0.45);
  const yBawah = hAlas + r * 0.35;
  const yAtas = H - pipaAtas - r * 0.35;
  const tinggiShell = Math.max(yAtas - yBawah, 0.05);
  const rPipa = r * 0.2;
  return (
    <group>
      {/* Alas berkaki */}
      <K p={[0, hAlas * 0.75, 0]} s={[L * 0.9, hAlas * 0.5, D * 0.9]} m={m.putih} />
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => <K key={`${sx}${sz}`} p={[sx * L * 0.4, hAlas * 0.25, sz * D * 0.4]} s={[L * 0.1, hAlas * 0.5, D * 0.1]} m={m.putih} />)
      )}
      {/* Bejana tegak + tutup cembung atas/bawah */}
      <S p={[0, yBawah + tinggiShell / 2, 0]} r={r} l={tinggiShell} m={m.catBiru} />
      <B p={[0, yAtas, 0]} s={[r * 2, r * 0.7, r * 2]} m={m.catBiru} />
      <B p={[0, yBawah, 0]} s={[r * 2, r * 0.7, r * 2]} m={m.catBiru} />
      <S p={[0, yAtas + r * 0.38, 0]} r={rPipa * 0.6} l={r * 0.2} m={m.catBiruTua} />
      {/* Dua pipa atas: dari evaporator (kiri) & ke kompresor (kanan) */}
      {[-1, 1].map((sisi) => (
        <group key={sisi}>
          <S p={[sisi * r * 0.5, yAtas + pipaAtas / 2 + r * 0.1, 0]} r={rPipa} l={pipaAtas} m={m.catBiru} />
          <B p={[sisi * r * 0.5, H - rPipa, 0]} s={[rPipa * 2.4, rPipa * 2.4, rPipa * 2.4]} m={m.catBiruTua} />
        </group>
      ))}
      {/* Gelas penduga level di sisi depan */}
      <K p={[0, yBawah + tinggiShell * 0.5, r + 0.03]} s={[Math.min(0.04, r * 0.2), tinggiShell * 0.6, 0.03]} m={m.kaca} />
    </group>
  );
}

function Agitator({ L, D, H }: Ukuran) {
  const { materi: m } = useSumberDaya();
  const yDudukan = H * 0.72;
  const rMotor = Math.min(D * 0.28, H * 0.1);
  // Poros miring dari kotak roda gigi ke baling-baling di bawah.
  const atas: V3 = [L * 0.1, yDudukan, 0];
  const bawah: V3 = [L * 0.38, H * 0.08, 0];
  const dx = bawah[0] - atas[0];
  const dy = bawah[1] - atas[1];
  const panjang = Math.hypot(dx, dy);
  const sudut = Math.atan2(dx, -dy); // kemiringan dari tegak
  return (
    <group>
      {/* Dudukan di bibir bak */}
      <K p={[-L * 0.05, yDudukan - H * 0.03, 0]} s={[L * 0.7, H * 0.05, D * 0.85]} m={m.logamGelap} />
      <K p={[-L * 0.38, yDudukan / 2, 0]} s={[L * 0.08, yDudukan, D * 0.6]} m={m.logamGelap} />
      {/* Motor + kotak roda gigi */}
      <S p={[-L * 0.15, yDudukan + rMotor + 0.01, 0]} r={rMotor} l={L * 0.4} sumbu="x" m={m.catBiru} />
      <B p={[-L * 0.36, yDudukan + rMotor + 0.01, 0]} s={[L * 0.06, rMotor * 1.9, rMotor * 1.9]} m={m.catBiruTua} />
      <K p={[L * 0.1, yDudukan + rMotor * 0.9, 0]} s={[L * 0.16, rMotor * 2.2, D * 0.5]} m={m.catBiruTua} />
      {/* Poros miring + baling-baling 3 daun */}
      <group position={[(atas[0] + bawah[0]) / 2, (atas[1] + bawah[1]) / 2, 0]} rotation={[0, 0, sudut]}>
        <S p={[0, 0, 0]} r={Math.min(0.03, D * 0.05)} l={panjang} m={m.logam} />
      </group>
      <group position={bawah} rotation={[0, 0, sudut]}>
        <B p={[0, 0, 0]} s={[0.1, 0.12, 0.1]} m={m.logam} />
        {[0, 1, 2].map((i) => (
          <group key={i} rotation={[0, (i * 2 * Math.PI) / 3, 0]}>
            <K p={[Math.min(D * 0.22, 0.18), 0, 0]} s={[Math.min(D * 0.36, 0.3), 0.012, 0.09]} m={m.logam} />
          </group>
        ))}
      </group>
    </group>
  );
}

function KatupEkspansi({ L, D, H }: Ukuran) {
  const { materi: m } = useSumberDaya();
  const yPipa = H * 0.3;
  const rPipa = Math.min(D * 0.16, H * 0.1);
  return (
    <group>
      {/* Pipa masuk/keluar + flens */}
      <S p={[0, yPipa, 0]} r={rPipa} l={L} sumbu="x" m={m.logam} />
      {[-1, 1].map((s) => (
        <S key={s} p={[s * L * 0.3, yPipa, 0]} r={rPipa * 1.7} l={0.02} sumbu="x" m={m.logamGelap} />
      ))}
      {/* Badan katup + bonnet + roda tangan */}
      <B p={[0, yPipa, 0]} s={[L * 0.4, H * 0.42, D * 0.8]} m={m.logamGelap} />
      <S p={[0, yPipa + H * 0.32, 0]} r={Math.min(D * 0.16, L * 0.08)} l={H * 0.32} m={m.logam} />
      <K p={[0, H * 0.9, 0]} s={[0.02, H * 0.12, 0.02]} m={m.logam} />
      <T p={[0, H * 0.94, 0]} r={Math.min(D * 0.4, L * 0.25)} m={m.merah} />
    </group>
  );
}

function Pompa({ L, D, H }: Ukuran) {
  const { materi: m } = useSumberDaya();
  const hp = Math.min(0.08 * H, 0.08);
  const rKeong = Math.min(0.32 * H, D * 0.45);
  const yPoros = hp + rKeong + 0.02;
  const rMotor = Math.min(0.3 * H, D * 0.42);
  return (
    <group>
      <K p={[0, hp / 2, 0]} s={[L, hp, D]} m={m.catBiruTua} />
      {/* Rumah keong + hisap depan + buang ke atas */}
      <S p={[-L * 0.3, yPoros, 0]} r={rKeong} l={D * 0.42} sumbu="z" m={m.catBiru} />
      <S p={[-L * 0.42, yPoros, 0]} r={rKeong * 0.35} l={L * 0.16} sumbu="x" m={m.catBiru} />
      <S p={[-L * 0.3, yPoros + rKeong + (H - yPoros - rKeong) / 2, 0]} r={rKeong * 0.3} l={Math.max(H - yPoros - rKeong, 0.02)} m={m.catBiru} />
      <S p={[-L * 0.3, H - 0.015, 0]} r={rKeong * 0.45} l={0.03} m={m.catBiruTua} />
      {/* Kopling + motor + tutup kipas */}
      <S p={[-L * 0.08, yPoros, 0]} r={rMotor * 0.4} l={L * 0.12} sumbu="x" m={m.catBiruTua} />
      <S p={[L * 0.2, yPoros, 0]} r={rMotor} l={L * 0.42} sumbu="x" m={m.catBiru} />
      <B p={[L * 0.43, yPoros, 0]} s={[L * 0.07, rMotor * 1.9, rMotor * 1.9]} m={m.catBiruTua} />
    </group>
  );
}

function Panel({ L, D, H }: Ukuran) {
  const { materi: m } = useSumberDaya();
  const hp = Math.min(0.05 * H, 0.1);
  const pintu = L > 0.8 ? 2 : 1;
  return (
    <group>
      <K p={[0, hp / 2, 0]} s={[L, hp, D]} m={m.logamGelap} />
      <K p={[0, hp + (H - hp) / 2, 0]} s={[L, H - hp, D]} m={m.panelAbu} />
      {/* Garis pintu + pegangan */}
      {pintu === 2 && <K p={[0, hp + (H - hp) / 2, D / 2 + 0.003]} s={[0.008, (H - hp) * 0.94, 0.006]} m={m.logamGelap} />}
      {Array.from({ length: pintu }, (_, i) => {
        const x = pintu === 2 ? (i === 0 ? -0.06 : 0.06) : L * 0.38;
        return <K key={i} p={[x, hp + (H - hp) * 0.5, D / 2 + 0.012]} s={[0.02, 0.18, 0.02]} m={m.logamGelap} />;
      })}
      {/* Lampu indikator */}
      {[m.merah, m.kuning, m.hijau].map((mt, i) => (
        <S key={i} p={[-L * 0.25 + i * L * 0.12, H * 0.86, D / 2 + 0.01]} r={Math.min(0.025, L * 0.04)} l={0.02} sumbu="z" m={mt} />
      ))}
    </group>
  );
}

const MODEL: Record<ModelMesin, (u: Ukuran) => ReactNode> = {
  kompresor: (u) => <Kompresor {...u} />,
  kondensor: (u) => <Kondensor {...u} />,
  akumulator: (u) => <Akumulator {...u} />,
  agitator: (u) => <Agitator {...u} />,
  "katup-ekspansi": (u) => <KatupEkspansi {...u} />,
  pompa: (u) => <Pompa {...u} />,
  panel: (u) => <Panel {...u} />,
};

/**
 * Model detail satu mesin, diletakkan di pusat kotak elemen pada elevasinya
 * dan diputar searah rotasi 2D (SVG rotate searah jarum jam dengan y ke
 * bawah → di three = −θ terhadap sumbu Y, karena y denah = z three).
 */
export function ModelMesin3D({ e }: { e: MesinElemen & { model: ModelMesin } }) {
  const u: Ukuran = { L: Math.max(e.w, 0.05), D: Math.max(e.h, 0.05), H: Math.max(e.tinggiM, 0.05) };
  return (
    <group position={keThree(e.x + e.w / 2, e.y + e.h / 2, e.elevasiM)} rotation={[0, (-e.rotasi * Math.PI) / 180, 0]}>
      <group position={[0, 0, 0]}>{MODEL[e.model](u)}</group>
    </group>
  );
}
