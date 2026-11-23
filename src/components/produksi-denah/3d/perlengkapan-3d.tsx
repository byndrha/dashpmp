"use client";

// Model 3D perlengkapan area bak (PerlengkapanElemen) + Cooling Tower
// (TangkiElemen jenis "cooling-tower"). Prosedural dari primitif bersama di
// model-mesin-3d.tsx; sumbu lokal sama: X = w, Z = h, Y = tinggi, muka depan
// +Z. Acuan: foto area bak (pekerja berhelm & rompi, ice can tergeletak
// setelah melepas es, pipa leher angsa mengucurkan air), diagram pabrik es
// balok ("ice can filler", "can dump") dan foto cooling tower FRP bundar
// dari pengguna, 2026-11-23.
// HANYA dimuat lewat elemen-3d.tsx (bagian dari bundel 3D dinamis).
import type { ReactNode } from "react";
import {
  PRESET_PERLENGKAPAN,
  type ModelPerlengkapan,
  type PerlengkapanElemen,
  type TangkiElemen,
  type VarianPengisi,
} from "@/lib/produksi-denah";
import { useSumberDaya } from "./elemen-3d";
import { keThree } from "./koordinat";
import { B, K, S, T } from "./model-mesin-3d";

interface Ukuran {
  L: number;
  D: number;
  H: number;
}

/** Pengaturan nosel pengisi air (meter / derajat); tidak ada = otomatis. */
interface Nosel {
  datar?: number;
  serong?: number;
  sudut?: number;
}

/** Ice can kecil PMP: 19 × 19 × 119 cm — acuan bentuk can pada pengisi & penuang. */
const CAN = { sisi: 0.19, panjang: 1.19 };

// ---------------------------------------------------------------------------

function PengisiAir({ L, D, H, n, nosel }: Ukuran & { n: number; nosel?: Nosel }) {
  const { materi: m } = useSumberDaya();
  const tinggiBak = Math.min(0.22 * H, 0.6);
  const yBak = H - tinggiBak; // dasar bak air
  const yHeader = yBak - 0.12;
  // Ujung nosel: otomatis sedikit di atas bibir ice can, atau puncak lengkung − panjang nosel.
  const yUjung = nosel?.serong ? Math.max(yHeader + 0.16 - nosel.serong, 0.05) : Math.max(CAN.panjang + 0.12, H * 0.4);
  // Pipa induk tetap di z = 0,056·D (posisi awal); nosel = pipa induk + panjang mendatar.
  const zInduk = D * 0.056;
  const zNosel = nosel?.datar ? zInduk + nosel.datar : D * 0.28;
  const rPipa = Math.min(0.022, (L / Math.max(n, 1)) * 0.18);
  const jarak = (L * 0.94) / Math.max(n, 1);
  const x0 = -L * 0.47 + jarak / 2;
  return (
    <group>
      {/* Rangka: 4 tiang + balok atas + palang */}
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => <K key={`${sx}${sz}`} p={[sx * L * 0.47, yBak / 2, sz * D * 0.42]} s={[0.06, yBak, 0.06]} m={m.logam} />)
      )}
      {[-1, 1].map((sz) => (
        <K key={sz} p={[0, yBak - 0.03, sz * D * 0.42]} s={[L * 0.96, 0.06, 0.06]} m={m.logam} />
      ))}
      {[-1, 1].map((sx) => (
        <K key={sx} p={[sx * L * 0.47, yBak * 0.35, 0]} s={[0.05, 0.05, D * 0.84]} m={m.logam} />
      ))}
      {/* Bak air di atas */}
      <K p={[0, yBak + tinggiBak / 2, -D * 0.05]} s={[L * 0.98, tinggiBak, D * 0.8]} m={m.panelAbu} />
      <K p={[0, H - 0.01, -D * 0.05]} s={[L * 0.98, 0.02, D * 0.8]} m={m.airTangki} />
      {/* Pipa induk (header) di bawah bak, masuk dari ujung kiri */}
      <S p={[0, yHeader, zInduk]} r={Math.min(0.06, D * 0.07)} l={L * 0.96} sumbu="x" m={m.logam} />
      <S p={[-L * 0.49, yHeader, zInduk]} r={Math.min(0.08, D * 0.09)} l={0.05} sumbu="x" m={m.logamGelap} />
      {/* Deretan pipa leher angsa: naik dari header, melengkung ke depan, turun ke ice can — air mengucur */}
      {Array.from({ length: n }, (_, i) => {
        const x = x0 + i * jarak;
        const zA = zInduk;
        const yPuncak = yHeader + 0.16;
        return (
          <group key={i}>
            <S p={[x, (yHeader + yPuncak) / 2, zA]} r={rPipa} l={yPuncak - yHeader} m={m.logam} />
            <B p={[x, yPuncak, zA]} s={[rPipa * 2.2, rPipa * 2.2, rPipa * 2.2]} m={m.logam} />
            <S p={[x, yPuncak, (zA + zNosel) / 2]} r={rPipa} l={zNosel - zA} sumbu="z" m={m.logam} />
            <B p={[x, yPuncak, zNosel]} s={[rPipa * 2.2, rPipa * 2.2, rPipa * 2.2]} m={m.logam} />
            <S p={[x, (yPuncak + yUjung) / 2, zNosel]} r={rPipa} l={yPuncak - yUjung} m={m.logam} />
            {yUjung > CAN.panjang + 0.02 && <S p={[x, yUjung * 0.5 + CAN.panjang * 0.5, zNosel]} r={rPipa * 0.55} l={yUjung - CAN.panjang} m={m.airKucur} />}
          </group>
        );
      })}
    </group>
  );
}

/**
 * Pengisi tanpa kaki (foto area bak pengguna): pipa induk besar tergantung di
 * atas; tiap anak pipa keluar MENDATAR, menekuk, lalu turun SERONG ke ice can.
 * `kotak` = anak pipa keluar dari kotak/balok memanjang di depan pipa induk.
 * Sumbu lokal: X = sepanjang deretan, -Z = sisi pipa induk, +Z = sisi ice can.
 */
function PengisiPipa({ L, D, H, n, kotak, nosel }: Ukuran & { n: number; kotak: boolean; nosel?: Nosel }) {
  const { materi: m } = useSumberDaya();
  const rInduk = Math.min(0.13, D * 0.16);
  const gantung = Math.min(0.25, H * 0.08); // ruang batang penggantung di atas pipa induk
  const yInduk = H - gantung - rInduk;
  const zInduk = -D / 2 + rInduk + 0.02;
  const tKotak = Math.min(0.4, H * 0.16);
  const lKotak = Math.min(0.34, D * 0.32);
  const zKotak = zInduk + rInduk + lKotak / 2 + 0.03;
  // Titik keluar anak pipa: muka depan pipa induk, atau muka depan kotak.
  const yKeluar = kotak ? yInduk + rInduk - tKotak * 0.55 : yInduk;
  const zKeluar = kotak ? zKotak + lKotak / 2 : zInduk + rInduk * 0.8;
  const datar = nosel?.datar ?? Math.max(0.12, D * 0.16);
  const zSiku = zKeluar + datar;
  // Ruas serong: panjang & sudut dari pengaturan; yang kosong dihitung otomatis
  // (ujung sedikit di atas bibir ice can, menjangkau sisi depan kotak elemen).
  const sudutRad = nosel?.sudut !== undefined ? (nosel.sudut * Math.PI) / 180 : null;
  let yUjung: number;
  let zUjung: number;
  if (nosel?.serong) {
    const a = sudutRad ?? (55 * Math.PI) / 180;
    yUjung = yKeluar - Math.sin(a) * nosel.serong;
    zUjung = zSiku + Math.cos(a) * nosel.serong;
  } else if (sudutRad !== null) {
    yUjung = Math.max(CAN.panjang + 0.15, H * 0.35);
    zUjung = zSiku + Math.max(yKeluar - yUjung, 0.05) / Math.tan(Math.max(sudutRad, 0.09));
  } else {
    yUjung = Math.max(CAN.panjang + 0.15, H * 0.35);
    zUjung = Math.max(D / 2 - 0.04, zSiku + 0.1);
  }
  const dy = yUjung - yKeluar;
  const dz = zUjung - zSiku;
  const pjSerong = Math.hypot(dy, dz);
  const sudut = Math.atan2(dz, dy); // putar sumbu silinder (+Y) ke arah serong turun
  const jarak = (L * 0.94) / Math.max(n, 1);
  const x0 = -L * 0.47 + jarak / 2;
  const rAnak = Math.min(0.028, jarak * 0.22);
  const jumlahGantung = Math.max(2, Math.round(L / 2) + 1);
  return (
    <group>
      {/* Pipa induk + flens ujung + pipa masuk di ujung kiri */}
      <S p={[0, yInduk, zInduk]} r={rInduk} l={L} sumbu="x" m={m.logam} />
      {[-1, 1].map((sx) => (
        <S key={sx} p={[(sx * L) / 2, yInduk, zInduk]} r={rInduk * 1.25} l={0.04} sumbu="x" m={m.logamGelap} />
      ))}
      {/* Batang penggantung ke atas (rangka atap) */}
      {Array.from({ length: jumlahGantung }, (_, i) => {
        const x = -L / 2 + (i * L) / (jumlahGantung - 1);
        return <K key={i} p={[Math.max(-L / 2 + 0.05, Math.min(L / 2 - 0.05, x)), yInduk + (H - yInduk) / 2, zInduk]} s={[0.04, H - yInduk, 0.04]} m={m.logamGelap} />;
      })}
      {/* Kotak/balok memanjang (jenis kotak) + sambungan dari pipa induk */}
      {kotak && (
        <group>
          <K p={[0, yInduk + rInduk - tKotak / 2, zKotak]} s={[L * 0.98, tKotak, lKotak]} m={m.catBiru} />
          {Array.from({ length: jumlahGantung }, (_, i) => {
            const x = -L * 0.45 + (i * L * 0.9) / Math.max(jumlahGantung - 1, 1);
            return <S key={i} p={[x, yInduk, (zInduk + zKotak) / 2]} r={rInduk * 0.4} l={zKotak - zInduk} sumbu="z" m={m.logam} />;
          })}
        </group>
      )}
      {/* Anak pipa: mendatar → siku → serong turun; air mengucur dari ujungnya */}
      {Array.from({ length: n }, (_, i) => {
        const x = x0 + i * jarak;
        return (
          <group key={i}>
            <S p={[x, yKeluar, (zKeluar + zSiku) / 2]} r={rAnak} l={zSiku - zKeluar} sumbu="z" m={m.logam} />
            <B p={[x, yKeluar, zSiku]} s={[rAnak * 2.3, rAnak * 2.3, rAnak * 2.3]} m={m.logam} />
            <group position={[x, (yKeluar + yUjung) / 2, (zSiku + zUjung) / 2]} rotation={[sudut, 0, 0]}>
              <S p={[0, 0, 0]} r={rAnak} l={pjSerong} m={m.logam} />
            </group>
            {yUjung > CAN.panjang + 0.02 && <S p={[x, (yUjung + CAN.panjang) / 2, zUjung]} r={rAnak * 0.55} l={yUjung - CAN.panjang} m={m.airKucur} />}
          </group>
        );
      })}
    </group>
  );
}

function Penuang({ L, D, H, n }: Ukuran & { n: number }) {
  const { materi: m } = useSumberDaya();
  const miring = 0.22; // rad (~12,6°), turun ke arah depan (+Z)
  const yMeja = Math.max(H * 0.55, 0.3);
  const lebarMeja = D * 0.9;
  const jarak = (L * 0.94) / Math.max(n, 1);
  const sisiCan = Math.min(CAN.sisi, jarak * 0.92);
  const pjCan = Math.min(CAN.panjang, lebarMeja * 0.75);
  return (
    <group>
      {/* Kaki: belakang lebih tinggi dari depan */}
      {[-1, 1].map((sx) => (
        <group key={sx}>
          <K p={[sx * L * 0.46, (yMeja + Math.sin(miring) * lebarMeja * 0.45) / 2, -lebarMeja * 0.42]} s={[0.07, yMeja + Math.sin(miring) * lebarMeja * 0.45, 0.07]} m={m.logam} />
          <K p={[sx * L * 0.46, (yMeja - Math.sin(miring) * lebarMeja * 0.45) / 2, lebarMeja * 0.42]} s={[0.07, Math.max(yMeja - Math.sin(miring) * lebarMeja * 0.45, 0.05), 0.07]} m={m.logam} />
        </group>
      ))}
      <K p={[0, 0.03, 0]} s={[L * 0.96, 0.06, 0.08]} m={m.logam} />
      {/* Meja miring + rek (kerangka) + ice can tergeletak + es meluncur keluar */}
      <group position={[0, yMeja, 0]} rotation={[miring, 0, 0]}>
        <K p={[0, -0.03, 0]} s={[L * 0.96, 0.04, lebarMeja]} m={m.logamGelap} />
        {[-1, 1].map((sz) => (
          <K key={sz} p={[0, sisiCan + 0.03, sz * pjCan * 0.35]} s={[L * 0.95, 0.05, 0.06]} m={m.logam} />
        ))}
        {Array.from({ length: n }, (_, i) => {
          const x = -L * 0.47 + jarak / 2 + i * jarak;
          const keluar = (i % 3) * 0.12 + 0.18; // es tidak keluar serempak
          return (
            <group key={i}>
              <K p={[x, sisiCan / 2, -lebarMeja * 0.45 + pjCan / 2]} s={[sisiCan, sisiCan, pjCan]} m={m.iceCan} />
              <K p={[x, sisiCan / 2, -lebarMeja * 0.45 + pjCan + keluar - pjCan * 0.4]} s={[sisiCan * 0.86, sisiCan * 0.86, pjCan * 0.8]} m={m.esBalok} />
            </group>
          );
        })}
      </group>
    </group>
  );
}

function Pekerja({ H }: Ukuran) {
  const { materi: m } = useSumberDaya();
  const s = H / 1.7; // skala terhadap orang 1,70 m
  return (
    <group scale={[s, s, s]}>
      {/* Sepatu bot kuning + kaki */}
      {[-1, 1].map((k) => (
        <group key={k}>
          <K p={[k * 0.09, 0.14, 0.02]} s={[0.11, 0.28, 0.2]} m={m.kuning} />
          <S p={[k * 0.09, 0.55, 0]} r={0.065} l={0.56} m={m.celana} />
        </group>
      ))}
      {/* Badan: kaos abu + rompi oranye bergaris */}
      <K p={[0, 1.08, 0]} s={[0.36, 0.56, 0.22]} m={m.bajuAbu} />
      <K p={[0, 1.06, 0.005]} s={[0.38, 0.44, 0.235]} m={m.rompi} />
      <K p={[0, 0.96, 0.124]} s={[0.39, 0.04, 0.004]} m={m.kuning} />
      {/* Lengan (satu terulur ke depan memegang alat) */}
      <group position={[-0.24, 1.3, 0]} rotation={[0.25, 0, 0.12]}>
        <S p={[0, -0.27, 0]} r={0.05} l={0.54} m={m.bajuAbu} />
      </group>
      <group position={[0.24, 1.3, 0]} rotation={[-0.9, 0, -0.1]}>
        <S p={[0, -0.27, 0]} r={0.05} l={0.54} m={m.bajuAbu} />
        <B p={[0, -0.56, 0]} s={[0.09, 0.09, 0.09]} m={m.logamGelap} />
      </group>
      {/* Kepala + helm kuning */}
      <B p={[0, 1.5, 0]} s={[0.2, 0.23, 0.21]} m={m.kulit} />
      <B p={[0, 1.58, 0]} s={[0.25, 0.17, 0.26]} m={m.kuning} />
      <K p={[0, 1.555, 0.11]} s={[0.22, 0.015, 0.08]} m={m.kuning} />
    </group>
  );
}

const MODEL: Record<ModelPerlengkapan, (u: Ukuran & { n: number; varian?: VarianPengisi; nosel?: Nosel }) => ReactNode> = {
  // Tanpa varian = "berkaki" (bentuk awal) agar denah lama tidak berubah.
  "pengisi-air": (u) => (u.varian === "pipa" || u.varian === "kotak" ? <PengisiPipa {...u} kotak={u.varian === "kotak"} /> : <PengisiAir {...u} />),
  penuang: (u) => <Penuang {...u} />,
  pekerja: (u) => <Pekerja {...u} />,
};

export function Perlengkapan3D({ e }: { e: PerlengkapanElemen }) {
  const u: Ukuran = { L: Math.max(e.w, 0.05), D: Math.max(e.h, 0.05), H: Math.max(e.tinggiM, 0.05) };
  const n = Math.max(1, Math.min(e.jumlah ?? PRESET_PERLENGKAPAN[e.model].jumlah ?? 1, 200));
  const gambar = MODEL[e.model] ?? MODEL["pengisi-air"];
  return (
    <group position={keThree(e.x + e.w / 2, e.y + e.h / 2, e.elevasiM)} rotation={[0, (-e.rotasi * Math.PI) / 180, 0]}>
      {gambar({ ...u, n, varian: e.varian, nosel: { datar: e.noselDatarM, serong: e.noselSerongM, sudut: e.noselSudut } })}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Cooling tower FRP bundar (tangki jenis "cooling-tower"): kolam di atas kaki,
// tiang penyangga, badan bawah menggembung + bahu, badan atas, kipas & motor
// di puncak, tangga samping, dua flens masuk/keluar di depan kolam.

export function CoolingTower3D({ t }: { t: TangkiElemen }) {
  const { materi: m } = useSumberDaya();
  const L = Math.max(t.w, 0.2);
  const D = Math.max(t.h, 0.2);
  const H = Math.max(t.tinggiM, 0.3);
  const R = Math.min(L, D) / 2;
  const yKolam = 0.1 * H;
  const tKolam = 0.09 * H;
  const yBadan = 0.3 * H;
  const yBahu = 0.6 * H;
  const yAtas = 0.9 * H;
  const rBawah = R * 0.84;
  const rAtas = R * 0.62;
  return (
    <group position={keThree(t.x + t.w / 2, t.y + t.h / 2, t.elevasiM)} rotation={[0, (-t.rotasi * Math.PI) / 180, 0]}>
      {/* Kaki kolam */}
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return <K key={i} p={[Math.cos(a) * R * 0.78, yKolam / 2, Math.sin(a) * R * 0.78]} s={[R * 0.14, yKolam, R * 0.14]} m={m.frp} />;
      })}
      {/* Kolam bawah + bibir */}
      <S p={[0, yKolam + tKolam / 2, 0]} r={R * 0.98} l={tKolam} m={m.frp} />
      <S p={[0, yKolam + tKolam, 0]} r={R} l={0.03} m={m.frp} />
      {/* Tiang penyangga badan */}
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        return <K key={i} p={[Math.cos(a) * rBawah * 0.97, (yKolam + tKolam + yBadan) / 2, Math.sin(a) * rBawah * 0.97]} s={[0.04, yBadan - yKolam - tKolam, 0.04]} m={m.logam} />;
      })}
      {/* Badan bawah + cincin dasar, bahu, badan atas, bibir puncak */}
      <S p={[0, yBadan + 0.02, 0]} r={rBawah * 1.02} l={0.04} m={m.frp} />
      <S p={[0, (yBadan + yBahu) / 2, 0]} r={rBawah} l={yBahu - yBadan} m={m.frp} />
      <B p={[0, yBahu, 0]} s={[rBawah * 2, (yAtas - yBahu) * 0.9, rBawah * 2]} m={m.frp} />
      <S p={[0, (yBahu + yAtas) / 2, 0]} r={rAtas} l={yAtas - yBahu} m={m.frp} />
      <S p={[0, yAtas, 0]} r={rAtas * 1.04} l={0.04} m={m.frp} />
      {/* Rusuk tegak badan bawah */}
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return (
          <K key={i} p={[Math.cos(a) * rBawah, (yBadan + yBahu) / 2, Math.sin(a) * rBawah]} s={[0.03, yBahu - yBadan, 0.03]} m={m.frpTua} />
        );
      })}
      {/* Kipas: dudukan + motor di puncak */}
      <K p={[0, yAtas + 0.03, 0]} s={[rAtas * 1.4, 0.04, 0.08]} m={m.logam} />
      <S p={[0, yAtas + (H - yAtas) * 0.55, 0]} r={Math.min(R * 0.1, 0.18)} l={(H - yAtas) * 0.9} m={m.tabungAbuTua} />
      {/* Tangga di sisi kanan (+X) */}
      {[-1, 1].map((sz) => (
        <K key={sz} p={[R * 1.02, (yKolam + H) / 2, sz * 0.2]} s={[0.03, H - yKolam, 0.03]} m={m.logam} />
      ))}
      {Array.from({ length: Math.max(3, Math.floor((H - yKolam) / 0.3)) }, (_, i) => (
        <K key={i} p={[R * 1.02, yKolam + 0.2 + i * 0.3, 0]} s={[0.03, 0.025, 0.4]} m={m.logam} />
      ))}
      {/* Dua flens masuk/keluar di depan kolam */}
      {[-1, 1].map((sx) => (
        <group key={sx}>
          <S p={[sx * R * 0.18, yKolam + tKolam / 2, R * 0.98]} r={Math.min(tKolam * 0.35, 0.12)} l={0.14} sumbu="z" m={m.frpTua} />
          <T p={[sx * R * 0.18, yKolam + tKolam / 2, R * 1.06]} r={Math.min(tKolam * 0.35, 0.12)} sumbu="z" m={m.logam} />
        </group>
      ))}
    </group>
  );
}
