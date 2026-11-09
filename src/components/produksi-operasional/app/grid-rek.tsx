"use client";

import { Snowflake, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BakElemen } from "@/lib/produksi-denah";
import type { KeadaanRek, Tahap } from "@/lib/produksi-operasional";
import { formatUsia, RENTANG_TAHAP, singkatVarian, WARNA_TAHAP, warnaRek } from "../warna-tahap";

/** Kolom bak dalam urutan tampil: nomor naik untuk "maju", turun untuk "mundur". */
export function urutKolom(bak: BakElemen): BakElemen["kolom"] {
  const l = [...bak.kolom].sort((a, b) => a.nomor - b.nomor);
  return bak.arahNomor === "mundur" ? l.reverse() : l;
}

// Tab bak (urutan denah) + grid kartu rek (spec §7).
export function GridRek({
  daftarBak,
  bakAktifId,
  onPilihBak,
  keadaan,
  onPilihRek,
}: {
  daftarBak: BakElemen[];
  bakAktifId: string;
  onPilihBak: (id: string) => void;
  keadaan: Map<string, KeadaanRek>;
  onPilihRek: (kolomId: string) => void;
}) {
  const bak = daftarBak.find((b) => b.id === bakAktifId) ?? daftarBak[0];

  return (
    <div className="flex flex-col gap-3 pb-4">
      <div className="sticky top-0 z-10 flex gap-1.5 overflow-x-auto border-b bg-background px-3 py-2">
        {daftarBak.map((b) => {
          const aktif = b.id === bak.id;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onPilihBak(b.id)}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium",
                aktif ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground",
              )}
            >
              {b.nama.trim() || "Bak"}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-3 gap-2 px-3 min-[400px]:grid-cols-4">
        {urutKolom(bak).map((k) => {
          const r = keadaan.get(k.id);
          if (!r) return null;
          return <KartuRek key={k.id} rek={r} onKetuk={() => onPilihRek(k.id)} />;
        })}
      </div>

      <Legenda />
    </div>
  );
}

function KartuRek({ rek, onKetuk }: { rek: KeadaanRek; onKetuk: () => void }) {
  const w = warnaRek(rek.utama, rek.tahap);
  return (
    <button
      type="button"
      onClick={onKetuk}
      className={cn(
        "relative flex aspect-[4/5] flex-col justify-between rounded-xl border-2 p-2 text-left shadow-xs active:scale-95 transition-transform",
        w.latar,
        w.teks,
        rek.utama === "nonaktif" && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="text-xl leading-none font-bold">{rek.nomor}</span>
        <span className="text-[10px] font-semibold opacity-80">{singkatVarian(rek.varian)}</span>
      </div>

      <div className="flex flex-col gap-0.5">
        {rek.utama === "berisi" && rek.pct !== null ? (
          <>
            <span className="text-lg leading-none font-bold">{rek.pct}%</span>
            <span className="text-[10px] leading-tight opacity-80">
              {w.label}
              {rek.usiaMenit !== null && ` · ${formatUsia(rek.usiaMenit)}`}
            </span>
          </>
        ) : rek.utama === "maintenance" ? (
          <span className="flex items-center gap-1 text-[11px] font-semibold">
            <Wrench className="size-4" /> Maint.
          </span>
        ) : (
          <span className="text-[11px] font-semibold">{w.label}</span>
        )}
        {rek.babonan > 0 && rek.utama !== "babonan" && (
          <span className="mt-0.5 inline-flex w-fit items-center gap-0.5 rounded bg-amber-400 px-1 text-[10px] font-bold text-amber-950">
            <Snowflake className="size-3" /> Babonan {rek.babonan}
          </span>
        )}
        {rek.utama === "babonan" && <span className="text-[11px] font-bold">{rek.babonan} can</span>}
      </div>
    </button>
  );
}

const URUTAN_TAHAP: Tahap[] = ["air", "mulai", "kristal", "siap", "jadi"];

function Legenda() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 text-[11px] text-muted-foreground">
      {URUTAN_TAHAP.map((t) => (
        <span key={t} className="flex items-center gap-1">
          <span className={cn("inline-block size-3 rounded-sm border", WARNA_TAHAP[t].latar)} />
          {WARNA_TAHAP[t].label} {RENTANG_TAHAP[t]}
        </span>
      ))}
    </div>
  );
}
