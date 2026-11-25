"use client";

// Tampilan "Log Pergerakan" Validasi Rute — berbaur DI DALAM daftar tujuan:
// masalah per mitra tampil di kartunya (MasalahTujuanBaris), catatan
// perjalanan disisipkan di antara kartu (BarisCatatan), urutan kunjungan
// aktual di atas daftar (BarisUrutan). Analisisnya: src/lib/analisis-jejak.ts.
// Klik baris → peta melompat ke titiknya (lewat onPilih).

import { ArrowDownUp, CircleAlert, Gauge, MapPinOff, Route, SignalLow, Timer, TriangleAlert, Warehouse } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { formatTime } from "@/lib/format";
import { formatJarakM, type BerhentiTerklasifikasi, type JenisBerhenti, type TujuanRute } from "@/lib/klasifikasi-berhenti";
import type { CatatanPerjalanan, MasalahTujuan } from "@/lib/analisis-jejak";

export const WARNA_JENIS_BERHENTI: Record<JenisBerhenti, string> = {
  bongkar: "#059669",
  pabrik: "#64748b",
  di_jalur: "#d97706",
  menyimpang: "#dc2626",
};
export const LABEL_JENIS_BERHENTI: Record<JenisBerhenti, string> = {
  bongkar: "Bongkar",
  pabrik: "Di pabrik",
  di_jalur: "Berhenti di jalur",
  menyimpang: "Di luar rute",
};
// Singgah yang diduga lokasi drop sebenarnya sebuah mitra.
export const WARNA_KANDIDAT_DROP = "#7c3aed";
export const WARNA_KELUAR_JALUR = "#dc2626";

export function keteranganBerhenti(b: BerhentiTerklasifikasi): string {
  switch (b.jenis) {
    case "bongkar":
      return `#${b.tujuan?.nomor} ${b.tujuan?.nama}${b.jarakTujuanM != null ? ` (±${formatJarakM(b.jarakTujuanM)})` : ""}`;
    case "pabrik":
      return "Area pabrik";
    case "di_jalur":
      return b.tujuan && b.jarakTujuanM != null
        ? `Di jalur rute · ${formatJarakM(b.jarakTujuanM)} dari #${b.tujuan.nomor} ${b.tujuan.nama}`
        : "Di jalur rute";
    case "menyimpang":
      return b.jarakRencanaM != null
        ? `${formatJarakM(b.jarakRencanaM)} dari rute rencana — periksa aktivitas armada`
        : "Di luar rute rencana — periksa aktivitas armada";
  }
}

// Sasaran lompatan peta saat baris diklik.
export interface FokusPeta {
  lat: number;
  lng: number;
  // Buka popup singgah (dicocokkan lewat `mulai`) atau penanda mitra.
  mulai?: string;
  tujuanId?: number;
}

const jam = (iso: string) => formatTime(iso);
const rentang = (a: string, b: string) => `${jam(a)}–${jam(b)}`;

// Kerangka satu baris catatan (bergaris putus-putus, berwarna sesuai jenis).
function Baris({
  warna,
  ikon: Ikon,
  waktu,
  label,
  children,
  onClick,
  padat = false,
}: {
  warna: string;
  ikon: ComponentType<{ className?: string; style?: React.CSSProperties }> | null;
  waktu?: ReactNode;
  label: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  // Di dalam kartu mitra: tanpa bingkai luar sendiri yang tebal.
  padat?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={onClick ? "Tampilkan di peta" : undefined}
      className={`flex w-full items-start gap-2 rounded-lg border border-dashed text-left text-[11px] transition-colors enabled:hover:brightness-110 ${
        padat ? "mt-1 px-2 py-1" : "px-2.5 py-1.5"
      }`}
      style={{ borderColor: `${warna}80`, background: `${warna}14` }}
    >
      {Ikon ? (
        <Ikon className="mt-0.5 size-3.5 shrink-0" style={{ color: warna }} />
      ) : (
        <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: warna }} />
      )}
      <span className="flex min-w-0 flex-col">
        <span className="flex flex-wrap items-center gap-x-1.5">
          {waktu && <span className="font-semibold tabular-nums">{waktu}</span>}
          <span className="font-semibold" style={{ color: warna }}>
            {label}
          </span>
        </span>
        {children && <span className="text-muted-foreground">{children}</span>}
      </span>
    </button>
  );
}

// ---- Masalah di kartu mitra.
export function MasalahTujuanBaris({ m, onPilih }: { m: MasalahTujuan; onPilih: (f: FokusPeta) => void }) {
  switch (m.jenis) {
    case "drop_meleset":
      return (
        <Baris
          padat
          warna={WARNA_KANDIDAT_DROP}
          ikon={MapPinOff}
          waktu={`${rentang(m.kandidat.mulai, m.kandidat.selesai)} · ${m.kandidat.menit} mnt`}
          label="Titik drop diragukan"
          onClick={() => onPilih({ lat: m.kandidat.lat, lng: m.kandidat.lng, mulai: m.kandidat.mulai })}
        >
          Armada singgah {formatJarakM(m.jarakM)} ke arah {m.arah} dari pin
          {m.lintasM != null ? `, hanya melintas ±${formatJarakM(m.lintasM)} dari pin` : ""}. Kemungkinan lokasi drop sebenarnya —
          perbarui titik mitra.
        </Baris>
      );
    case "pin_di_pabrik":
      return (
        <Baris padat warna="#d97706" ikon={Warehouse} label="Titik mitra di area pabrik">
          Pin hanya ±{formatJarakM(m.jarakM)} dari pabrik — bongkar tidak bisa dibedakan dari aktivitas pabrik. Kemungkinan pin
          salah.
        </Baris>
      );
    case "hanya_melintas":
      return (
        <Baris
          padat
          warna="#d97706"
          ikon={Route}
          waktu={m.waktu ? jam(m.waktu) : undefined}
          label="Hanya melintas"
          onClick={() => onPilih({ lat: m.lat, lng: m.lng })}
        >
          Lewat ±{formatJarakM(m.jarakM)} dari titik tanpa singgah ≥2 menit — pastikan es benar diantar.
        </Baris>
      );
    case "tidak_didatangi":
      return (
        <Baris
          padat
          warna={WARNA_KELUAR_JALUR}
          ikon={CircleAlert}
          label="Tidak didatangi"
          onClick={() => onPilih({ lat: m.lat, lng: m.lng })}
        >
          Armada tidak pernah mendekati titik ini (terdekat {formatJarakM(m.jarakM)}
          {m.waktu ? `, ${jam(m.waktu)}` : ""}).
        </Baris>
      );
    case "bongkar_lama":
      return (
        <Baris padat warna="#d97706" ikon={Timer} label={`Singgah lama · ${m.menit} mnt`}>
          Jauh di atas waktu bongkar biasa — periksa aktivitas di lokasi.
        </Baris>
      );
  }
}

// ---- Catatan perjalanan di antara kartu.
const nomorTujuan = (ts: TujuanRute[]) => ts.map((t) => `#${t.nomor} ${t.nama}`).join(", ");

export function BarisCatatan({ c, onPilih }: { c: CatatanPerjalanan; onPilih: (f: FokusPeta) => void }) {
  switch (c.jenis) {
    case "berhenti": {
      const b = c.b;
      return (
        <Baris
          warna={WARNA_JENIS_BERHENTI[b.jenis]}
          ikon={b.jenis === "menyimpang" ? TriangleAlert : null}
          waktu={
            <>
              {rentang(b.mulai, b.selesai)} <span className="font-normal text-muted-foreground">{b.menit} mnt</span>
            </>
          }
          label={LABEL_JENIS_BERHENTI[b.jenis]}
          onClick={() => onPilih({ lat: b.lat, lng: b.lng, mulai: b.mulai })}
        >
          <span className="line-clamp-2">{keteranganBerhenti(b)}</span>
        </Baris>
      );
    }
    case "keluar_jalur": {
      const menuju = c.menujuDrop.length > 0;
      return (
        <Baris
          warna={menuju ? WARNA_KANDIDAT_DROP : WARNA_KELUAR_JALUR}
          ikon={Route}
          waktu={
            <>
              {rentang(c.mulai, c.selesai)} <span className="font-normal text-muted-foreground">{c.menit} mnt</span>
            </>
          }
          label="Keluar jalur rencana"
          onClick={() => onPilih({ lat: c.lat, lng: c.lng })}
        >
          Menempuh {formatJarakM(c.tempuhM)}, terjauh {formatJarakM(c.maksM)} dari rute
          {c.singgah.length > 0 &&
            ` · singgah ${c.singgah.length}× (${c.singgah.map((s) => `${jam(s.mulai)} ${s.menit} mnt`).join(", ")})`}
          {menuju ? ` · menuju dugaan lokasi drop ${nomorTujuan(c.menujuDrop)}` : " — periksa aktivitas armada"}
        </Baris>
      );
    }
    case "sinyal_hilang":
      return (
        <Baris
          warna="#64748b"
          ikon={SignalLow}
          waktu={
            <>
              {rentang(c.mulai, c.selesai)} <span className="font-normal text-muted-foreground">{c.menit} mnt</span>
            </>
          }
          label="Sinyal GPS terputus"
          onClick={() => onPilih({ lat: c.lat, lng: c.lng })}
        >
          Tanpa titik GPS, lalu muncul lagi {formatJarakM(c.lompatM)} dari posisi terakhir.
        </Baris>
      );
    case "ngebut":
      return (
        <Baris
          warna="#ea580c"
          ikon={Gauge}
          waktu={c.mulai === c.selesai ? jam(c.mulai) : rentang(c.mulai, c.selesai)}
          label={`Melaju ${c.maksKmj} km/j`}
          onClick={() => onPilih({ lat: c.lat, lng: c.lng })}
        >
          Kecepatan tinggi untuk armada bermuatan.
        </Baris>
      );
  }
}

export function BarisUrutan({ urutan }: { urutan: TujuanRute[] }) {
  return (
    <Baris warna="#0284c7" ikon={ArrowDownUp} label="Urutan kunjungan berbeda dari rencana">
      Aktual: {urutan.map((t) => `#${t.nomor}`).join(" → ")}
    </Baris>
  );
}
