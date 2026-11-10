"use client";

// Can satu rek digambar sebagai baris-baris horizontal (patahBaris: 18 can per baris,
// label rentang "1–18", baris lanjutan diberi ↳).
// Dipakai lembar rek aplikasi HP (mode "lihat"), formulir panen (mode
// "panen": ketuk bersiklus biasa → Babonan ◆ → Pecah ✕ → biasa) dan
// formulir Tandai/Buang Babonan, Tandai rusak, Perbaiki, Isi Air sebagian,
// muat Babonan (mode "pilih": ketuk = pilih/lepas). Slot di luar `boleh`
// dinonaktifkan (diredupkan, tidak bisa diketuk). Mode "lihat": ketuk can
// menampilkan keterangannya di bawah grid (layar sentuh tidak punya hover/title).

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  kodePosisi,
  PATAH_BARIS_CAN,
  patahBaris,
  type KeadaanCan,
  type KeadaanRek,
  type Tahap,
} from "@/lib/produksi-operasional";
import { WARNA_CAN, warnaCan } from "./warna-tahap";

export type TandaPanen = "babonan" | "pecah";

interface PropsDasar {
  can: KeadaanCan[];
  rek: Pick<KeadaanRek, "kodeBak" | "nomor" | "orientasiCan">;
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

const SIKLUS: Record<"biasa" | TandaPanen, "biasa" | TandaPanen> = {
  biasa: "babonan",
  babonan: "pecah",
  pecah: "biasa",
};
const LABEL_PANEN: Record<"biasa" | TandaPanen, string> = {
  biasa: "dimuat",
  babonan: "Babonan",
  pecah: "Pecah",
};

function keteranganCan(c: KeadaanCan, rek: PropsDasar["rek"]): string {
  const w = warnaCan(c);
  return `${kodePosisi(rek.kodeBak, rek.nomor, c.slot)} · ${w.label}${
    c.pct !== null ? ` ${c.pct}%` : ""
  }`;
}

export function GridCan(props: PropsGridCan) {
  const { can, rek, className } = props;
  const baris = patahBaris(can.length);
  const tinggiSel = rek.orientasiCan === "tegak" ? "h-9" : "h-7";
  const [info, setInfo] = useState<number | null>(null);
  const canInfo =
    props.mode === "lihat" && info !== null
      ? can.find((c) => c.slot === info) ?? null
      : null;

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

  const grid = (
    <div
      className={cn("flex flex-col gap-1", props.mode !== "lihat" && className)}
      role="group"
      aria-label={`Susunan ${can.length} can`}
    >
      {baris.map(({ dari, sampai }, idx) => (
        <div key={dari} className="flex items-center gap-1.5">
          <span className="w-11 shrink-0 text-[10px] leading-none text-muted-foreground tabular-nums">
            {idx > 0 && <span aria-hidden>↳ </span>}
            {dari}–{sampai}
          </span>
          <div
            className="grid min-w-0 flex-1 gap-1"
            style={{
              gridTemplateColumns: `repeat(${PATAH_BARIS_CAN}, minmax(0, 1fr))`,
            }}
          >
            {can.slice(dari - 1, sampai).map((c) => {
              if (props.mode === "lihat") {
                const w = warnaCan(c);
                const ket = keteranganCan(c, rek);
                return (
                  <button
                    key={c.slot}
                    type="button"
                    title={ket}
                    aria-label={ket}
                    aria-pressed={info === c.slot}
                    onClick={() =>
                      setInfo((i) => (i === c.slot ? null : c.slot))
                    }
                    className={cn(
                      tinggiSel,
                      "flex items-center justify-center rounded-[4px] border text-[11px] leading-none font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      w.sel,
                      w.teks,
                      info === c.slot &&
                        "ring-2 ring-foreground ring-offset-1 ring-offset-background"
                    )}
                  >
                    {w.simbol}
                  </button>
                );
              }

              const aktif = props.boleh.has(c.slot);
              const dis = !aktif || props.disabled;
              let w = warnaCan(c);
              let terpilih = false;
              const kode = kodePosisi(rek.kodeBak, rek.nomor, c.slot);
              let label = `${kode}: ${w.label}`;
              let ditekan: boolean | undefined;
              if (props.mode === "panen" && aktif) {
                const t = props.pilihan.get(c.slot);
                if (t) w = WARNA_CAN[t];
                label = `${kode}: ${LABEL_PANEN[t ?? "biasa"]}`;
                ditekan = t !== undefined;
              } else if (props.mode === "pilih" && aktif) {
                terpilih = props.pilihan.has(c.slot);
                label = `${kode}: ${w.label}${
                  terpilih ? ", dipilih" : ""
                }`;
                ditekan = terpilih;
              }
              return (
                <button
                  key={c.slot}
                  type="button"
                  disabled={dis}
                  onClick={() => ketuk(c.slot)}
                  aria-pressed={ditekan}
                  aria-label={label}
                  className={cn(
                    tinggiSel,
                    "relative flex items-center justify-center rounded-[4px] border text-xs leading-none font-bold transition-transform active:scale-90",
                    w.sel,
                    w.teks,
                    !aktif && "opacity-25",
                    terpilih &&
                      "ring-2 ring-foreground ring-offset-1 ring-offset-background"
                  )}
                >
                  {terpilih ? (
                    <Check className="size-3.5 drop-shadow" strokeWidth={3.5} />
                  ) : (
                    w.simbol
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  if (props.mode !== "lihat") return grid;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {grid}
      <p
        className="min-h-4 text-[11px] leading-4 text-muted-foreground tabular-nums"
        aria-live="polite"
      >
        {canInfo
          ? keteranganCan(canInfo, rek)
          : "Ketuk can untuk melihat keterangannya."}
      </p>
    </div>
  );
}

/** Urutan pil gradasi: Isian → Solidifikasi → Kristalisasi → Siap → Matang → Jaga (Babonan). */
const URUTAN_PIL: { kunci: Tahap | "babonan"; teks: string }[] = [
  { kunci: "air", teks: "Isian" },
  { kunci: "mulai", teks: "Solidifikasi" },
  { kunci: "kristal", teks: "Kristalisasi" },
  { kunci: "siap", teks: "Siap" },
  { kunci: "jadi", teks: "Matang" },
  { kunci: "babonan", teks: "Jaga" },
];

/**
 * Legenda warna can: satu pil gradasi tahap (Isian … Jaga, ujung bulat saling
 * menimpa) di atas baris kecil untuk pecah/rusak/kosong.
 */
export function LegendaCan({ className }: { className?: string }) {
  const lain = ["pecah", "rusak", "kosong"] as const;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {/* Tanpa garis tepi: ujung bulat segmen berikutnya menimpa ujung segmen
          sebelumnya (tumpang tindih ≥ jari-jari) sehingga tak ada celah/garis. */}
      <ol
        className="flex w-full items-stretch"
        aria-label={`Tahap can: ${URUTAN_PIL.map((p) => p.teks).join(", ")}`}
      >
        {URUTAN_PIL.map(({ kunci, teks }, i) => {
          const w = WARNA_CAN[kunci];
          const akhir = i === URUTAN_PIL.length - 1;
          return (
            <li
              key={kunci}
              style={{ zIndex: i }}
              className={cn(
                "relative flex min-w-0 flex-auto items-center justify-center rounded-full py-[5px] text-[10px] leading-[12px] font-bold whitespace-nowrap",
                i === 0 ? "pl-2.5" : "-ml-[11px] pl-2",
                akhir ? "pr-2" : "pr-[13px]",
                w.sel,
                w.teks
              )}
            >
              {teks}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {lain.map((k) => {
          const w = WARNA_CAN[k];
          return (
            <span key={k} className="flex items-center gap-1">
              <span
                className={cn(
                  "inline-flex size-3.5 items-center justify-center rounded-[3px] border text-[8px] font-bold",
                  w.sel,
                  w.teks
                )}
              >
                {w.simbol}
              </span>
              {w.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
