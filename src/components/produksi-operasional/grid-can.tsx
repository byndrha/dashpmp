"use client";

// Grid can satu rek sesuai susunan fisik (SUSUNAN_CAN: BK 12 × 3, BB 9 × 2).
// Dipakai lembar rek aplikasi HP (mode "lihat"), formulir panen (mode
// "panen": ketuk bersiklus biasa → Babonan ◆ → Pecah ✕ → biasa) dan
// formulir Tandai/Buang Babonan, Tandai rusak, Perbaiki, Isi Air sebagian,
// muat Babonan (mode "pilih": ketuk = pilih/lepas). Slot di luar `boleh`
// dinonaktifkan (diredupkan, tidak bisa diketuk).

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Varian } from "@/lib/produksi-denah";
import { SUSUNAN_CAN, type KeadaanCan, type Tahap } from "@/lib/produksi-operasional";
import { WARNA_CAN, warnaCan } from "./warna-tahap";

export type TandaPanen = "babonan" | "pecah";

interface PropsDasar {
  can: KeadaanCan[];
  varian: Varian;
  className?: string;
}

export type PropsGridCan =
  | (PropsDasar & { mode: "lihat" })
  | (PropsDasar & {
      mode: "pilih";
      boleh: ReadonlySet<number>;
      pilihan: ReadonlySet<number>;
      onUbah: (pilihan: Set<number>) => void;
      disabled?: boolean;
    })
  | (PropsDasar & {
      mode: "panen";
      boleh: ReadonlySet<number>;
      /** Slot yang ditandai; slot boleh yang tidak ada di sini = biasa (dimuat). */
      pilihan: ReadonlyMap<number, TandaPanen>;
      onUbah: (pilihan: Map<number, TandaPanen>) => void;
      disabled?: boolean;
    });

const SIKLUS: Record<"biasa" | TandaPanen, "biasa" | TandaPanen> = { biasa: "babonan", babonan: "pecah", pecah: "biasa" };

export function GridCan(props: PropsGridCan) {
  const { can, varian, className } = props;
  const kolom = SUSUNAN_CAN[varian].kolom;

  function ketuk(slot: number) {
    if (props.mode === "pilih") {
      const baru = new Set(props.pilihan);
      if (baru.has(slot)) baru.delete(slot);
      else baru.add(slot);
      props.onUbah(baru);
    } else if (props.mode === "panen") {
      const baru = new Map(props.pilihan);
      const berikut = SIKLUS[baru.get(slot) ?? "biasa"];
      if (berikut === "biasa") baru.delete(slot);
      else baru.set(slot, berikut);
      props.onUbah(baru);
    }
  }

  return (
    <div
      className={cn("grid gap-1", className)}
      style={{ gridTemplateColumns: `repeat(${kolom}, minmax(0, 1fr))` }}
      role={props.mode === "lihat" ? "img" : "group"}
      aria-label={`Susunan ${can.length} can`}
    >
      {can.map((c) => {
        if (props.mode === "lihat") {
          const w = warnaCan(c);
          return (
            <div
              key={c.slot}
              title={`Slot ${c.slot}: ${w.label}${c.pct !== null ? ` ${c.pct}%` : ""}`}
              className={cn("flex aspect-square items-center justify-center rounded-[4px] border text-[11px] leading-none font-bold", w.sel, w.teks)}
            >
              {w.simbol}
            </div>
          );
        }

        const aktif = props.boleh.has(c.slot);
        const dis = !aktif || props.disabled;
        let w = warnaCan(c);
        let terpilih = false;
        if (props.mode === "panen" && aktif) {
          const t = props.pilihan.get(c.slot);
          if (t) w = WARNA_CAN[t];
        } else if (props.mode === "pilih" && aktif) {
          terpilih = props.pilihan.has(c.slot);
        }
        return (
          <button
            key={c.slot}
            type="button"
            disabled={dis}
            onClick={() => ketuk(c.slot)}
            aria-pressed={props.mode === "pilih" ? terpilih : undefined}
            aria-label={`Slot ${c.slot}: ${w.label}${terpilih ? ", dipilih" : ""}`}
            className={cn(
              "relative flex aspect-square min-h-6 items-center justify-center rounded-[4px] border text-xs leading-none font-bold transition-transform active:scale-90",
              w.sel,
              w.teks,
              !aktif && "opacity-25",
              terpilih && "ring-2 ring-foreground ring-offset-1 ring-offset-background",
            )}
          >
            {terpilih ? <Check className="size-3.5 drop-shadow" strokeWidth={3.5} /> : w.simbol}
          </button>
        );
      })}
    </div>
  );
}

const URUTAN_TAHAP: Tahap[] = ["air", "mulai", "kristal", "siap", "jadi"];

/** Legenda warna can (tahap + Babonan/pecah/rusak/kosong). */
export function LegendaCan({ className }: { className?: string }) {
  const kunci = [...URUTAN_TAHAP, "babonan", "pecah", "rusak", "kosong"] as const;
  return (
    <div className={cn("flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground", className)}>
      {kunci.map((k) => {
        const w = WARNA_CAN[k];
        return (
          <span key={k} className="flex items-center gap-1">
            <span className={cn("inline-flex size-3.5 items-center justify-center rounded-[3px] border text-[8px] font-bold", w.sel, w.teks)}>
              {w.simbol}
            </span>
            {w.label}
          </span>
        );
      })}
    </div>
  );
}
