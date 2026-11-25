"use client";

// Tampilan "Log Pergerakan" Validasi Rute — berbaur DI DALAM daftar tujuan:
// masalah per mitra tampil di kartunya (MasalahTujuanBaris), catatan
// perjalanan disisipkan di antara kartu (BarisCatatan), urutan kunjungan
// aktual di atas daftar (BarisUrutan). Analisisnya: src/lib/analisis-jejak.ts.
// Klik baris → peta melompat ke titiknya (lewat onPilih).

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kompas } from "@/components/icons/kompas";
import {
  ArrowDownUp,
  ArrowRight,
  CircleAlert,
  Gauge,
  MapPinOff,
  Route,
  SignalLow,
  Timer,
  TriangleAlert,
  Truck,
  Warehouse,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { formatTime } from "@/lib/format";
import { formatJarakM, type BerhentiTerklasifikasi, type JenisBerhenti, type TujuanRute } from "@/lib/klasifikasi-berhenti";
import { ARAH_MATA_ANGIN, type CatatanPerjalanan, type MasalahTujuan } from "@/lib/analisis-jejak";

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
        ? `${formatJarakM(b.jarakRencanaM)} dari rute rencana`
        : "Di luar rute rencana";
  }
}

// Angka jarak sebagai chip kecil, mis. "singgah [437 m]".
function ChipJarak({ m, kira = false }: { m: number; kira?: boolean }) {
  return (
    <span className="rounded bg-foreground/10 px-1 py-px font-medium text-foreground tabular-nums">
      {kira ? "±" : ""}
      {formatJarakM(m)}
    </span>
  );
}

// Versi berchip dari keteranganBerhenti (yang string dipakai popup peta).
function KeteranganBerhentiChip({ b }: { b: BerhentiTerklasifikasi }) {
  switch (b.jenis) {
    case "bongkar":
      return (
        <>
          #{b.tujuan?.nomor} {b.tujuan?.nama} {b.jarakTujuanM != null && <ChipJarak m={b.jarakTujuanM} kira />}
        </>
      );
    case "di_jalur":
      return b.tujuan && b.jarakTujuanM != null ? (
        <>
          Di jalur rute · <ChipJarak m={b.jarakTujuanM} /> dari #{b.tujuan.nomor} {b.tujuan.nama}
        </>
      ) : (
        <>Di jalur rute</>
      );
    case "menyimpang":
      return b.jarakRencanaM != null ? (
        <>
          <ChipJarak m={b.jarakRencanaM} /> dari rute rencana
        </>
      ) : (
        <>Di luar rute rencana</>
      );
    default:
      return <>{keteranganBerhenti(b)}</>;
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
// Latarnya rona warna jenis di atas alas popover yang hampir padat, supaya
// teks tetap terbaca walau panel daftar tujuan transparan di atas peta.
function Baris({
  warna,
  ikon: Ikon,
  waktu,
  label,
  children,
  onClick,
  padat = false,
  chip,
}: {
  warna: string;
  ikon: ComponentType<{ className?: string; style?: React.CSSProperties }> | null;
  waktu?: ReactNode;
  label: ReactNode;
  // Chip tindakan di samping label (mis. "Validasi ulang").
  chip?: string;
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
      style={{
        borderColor: `${warna}80`,
        background: `linear-gradient(${warna}1a, ${warna}1a), color-mix(in oklab, var(--popover) 88%, transparent)`,
      }}
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
          {chip && (
            <span
              className="rounded-full px-1.5 py-px text-[10px] font-semibold leading-tight text-white"
              style={{ background: warna }}
            >
              {chip}
            </span>
          )}
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
          chip="Validasi ulang"
          onClick={() => onPilih({ lat: m.kandidat.lat, lng: m.kandidat.lng, mulai: m.kandidat.mulai })}
        >
          <span className="inline-flex flex-wrap items-center gap-x-1">
            <Truck className="size-3 shrink-0" aria-label="Armada" />
            singgah <ChipJarak m={m.jarakM} />
            <Kompas
              className="size-3.5 shrink-0"
              style={{ transform: `rotate(${Math.max(0, ARAH_MATA_ANGIN.indexOf(m.arah)) * 45}deg)` }}
              aria-hidden
            />
            {m.arah} dari pin
            {m.lintasM != null && (
              <span>
                · melintas <ChipJarak m={m.lintasM} kira />
              </span>
            )}
          </span>
        </Baris>
      );
    case "pin_di_pabrik":
      return (
        <Baris padat warna="#d97706" ikon={Warehouse} label="Titik mitra di area pabrik">
          Pin hanya <ChipJarak m={m.jarakM} kira /> dari pabrik — bongkar tidak bisa dibedakan dari aktivitas pabrik. Kemungkinan pin
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
          Lewat <ChipJarak m={m.jarakM} kira /> dari titik tanpa singgah ≥2 menit.
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
          Armada tidak pernah mendekati titik ini (terdekat <ChipJarak m={m.jarakM} />
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
          <span className="line-clamp-2">
            <KeteranganBerhentiChip b={b} />
          </span>
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
          Menempuh <ChipJarak m={c.tempuhM} />, terjauh <ChipJarak m={c.maksM} /> dari rute
          {c.singgah.length === 1 && (
            <>
              {" "}
              · singgah {jam(c.singgah[0].mulai)} · {c.singgah[0].menit} mnt
            </>
          )}
          {c.singgah.length > 1 && (
            <>
              {" "}
              · <TooltipSinggah singgah={c.singgah} />
            </>
          )}
          {menuju && (
            <>
              {" "}
              · <Truck className="inline size-3 align-[-2px]" aria-label="Armada" />{" "}
              <ArrowRight className="inline size-3 align-[-2px]" aria-label="menuju" /> {nomorTujuan(c.menujuDrop)}
            </>
          )}
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

// Singgah lebih dari sekali dalam satu catatan: ringkas jadi chip "N×",
// rinciannya (jam, lama, lokasi) di tooltip.
function TooltipSinggah({ singgah }: { singgah: BerhentiTerklasifikasi[] }) {
  const totalMenit = singgah.reduce((s, b) => s + b.menit, 0);
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span />}
        className="cursor-help underline decoration-dotted underline-offset-2"
      >
        singgah <span className="rounded bg-foreground/10 px-1 py-px font-medium text-foreground tabular-nums">{singgah.length}×</span>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-80">
        <p className="font-semibold text-foreground">
          Singgah {singgah.length}× · total {totalMenit} mnt
        </p>
        <ul className="flex flex-col gap-1">
          {singgah.map((b) => (
            <li key={b.mulai} className="flex items-start gap-1.5">
              <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: WARNA_JENIS_BERHENTI[b.jenis] }} />
              <span>
                <span className="font-semibold tabular-nums">
                  {rentang(b.mulai, b.selesai)} · {b.menit} mnt
                </span>
                <span className="block text-muted-foreground">{keteranganBerhenti(b)}</span>
              </span>
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

export function BarisUrutan({ urutan }: { urutan: TujuanRute[] }) {
  return (
    <Baris warna="#0284c7" ikon={ArrowDownUp} label="Urutan kunjungan berbeda dari rencana">
      Aktual: {urutan.map((t) => `#${t.nomor}`).join(" → ")}
    </Baris>
  );
}
