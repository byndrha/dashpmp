"use client";

// "Semua rek" (spec slot can §4): satu baris rapat per rek — nomor, varian,
// strip can berwarna per slot, persen isian tertua, usia. Tetap terbaca
// untuk bak 66 rek. Ketuk baris → lembar rek.

import { Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BakElemen } from "@/lib/produksi-denah";
import { cocokFilterVarian, type FilterVarian, type KeadaanRek } from "@/lib/produksi-operasional";
import { StripCan } from "../strip-can";
import { formatUsiaRingkas, singkatVarian, WARNA_TAHAP } from "../warna-tahap";

/** Kolom bak dalam urutan tampil: nomor naik untuk "maju", turun untuk "mundur". */
export function urutKolom(bak: BakElemen): BakElemen["kolom"] {
  const l = [...bak.kolom].sort((a, b) => a.nomor - b.nomor);
  return bak.arahNomor === "mundur" ? l.reverse() : l;
}

export function DaftarRek({
  bak,
  keadaan,
  filter = "semua",
  onPilihRek,
}: {
  bak: BakElemen;
  keadaan: Map<string, KeadaanRek>;
  filter?: FilterVarian;
  onPilihRek: (kolomId: string) => void;
}) {
  // Skala strip: rek terbesar bak = lebar penuh, rek lebih kecil (BB) lebih pendek.
  let kapasitasMaks = 1;
  for (const k of bak.kolom) kapasitasMaks = Math.max(kapasitasMaks, keadaan.get(k.id)?.kapasitas ?? 0);
  return (
    <ul className="divide-y border-y">
      {urutKolom(bak).map((k) => {
        const r = keadaan.get(k.id);
        if (!r || !cocokFilterVarian(filter, r.varian)) return null;
        return (
          <li key={k.id}>
            <BarisRek rek={r} skala={r.kapasitas / kapasitasMaks} onKetuk={() => onPilihRek(k.id)} />
          </li>
        );
      })}
    </ul>
  );
}

function BarisRek({ rek, skala, onKetuk }: { rek: KeadaanRek; skala: number; onKetuk: () => void }) {
  const nonaktif = rek.utama === "nonaktif";
  return (
    <button
      type="button"
      onClick={onKetuk}
      className={cn(
        "flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left active:bg-muted",
        nonaktif && "opacity-50",
      )}
    >
      <span className="w-7 shrink-0 text-right text-base leading-none font-bold tabular-nums">{rek.nomor}</span>
      <span className="flex w-9 shrink-0 items-center gap-0.5 text-[10px] font-semibold text-muted-foreground">
        {singkatVarian(rek.varian)}
        <span aria-label={rek.orientasiCan === "tegak" ? "can tegak" : "can mendatar"} className="text-xs leading-none">
          {rek.orientasiCan === "tegak" ? "▯" : "▭"}
        </span>
      </span>
      <span className="flex min-w-0 flex-1">
        <StripCan can={rek.can} skala={skala} />
      </span>
      <span className="flex w-[4.5rem] shrink-0 flex-col items-end leading-tight">
        <Status rek={rek} />
      </span>
    </button>
  );
}

function Status({ rek }: { rek: KeadaanRek }) {
  if (rek.utama === "nonaktif") return <span className="text-[11px] text-muted-foreground">Nonaktif</span>;
  if (rek.utama === "maintenance") {
    return (
      <span className="flex items-center gap-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
        <Wrench className="size-3.5" /> Maint.
      </span>
    );
  }
  if (rek.pct !== null && rek.tahap) {
    const w = WARNA_TAHAP[rek.tahap];
    return (
      <>
        <span className={cn("rounded px-1 text-xs font-bold tabular-nums", w.latar, w.teks)}>{rek.pct}%</span>
        {rek.usiaMenit !== null && <span className="text-[10px] text-muted-foreground tabular-nums">{formatUsiaRingkas(rek.usiaMenit)}</span>}
      </>
    );
  }
  if (rek.babonan > 0) return <span className="text-xs font-bold text-orange-600 dark:text-orange-400">◆ {rek.babonan}</span>;
  return <span className="text-[11px] text-muted-foreground">Kosong</span>;
}
