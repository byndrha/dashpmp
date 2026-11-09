"use client";

// "Tugas sekarang" (spec slot can §4): urutan dari tugasSekarang() di server —
// panen (FIFO tertua), isi air (paling lama kosong), Babonan lama. Tombol aksi
// langsung di baris: Panen membuka formulir panen, Isi Air = SATU ketukan
// (semua slot kosong tak rusak, tanpa layar konfirmasi), Babonan → lembar rek.

import { useState } from "react";
import { ChevronRight, CircleCheck, Droplets } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { KeadaanRek, Tugas } from "@/lib/produksi-operasional";
import { formatUsiaRingkas, singkatVarian, WARNA_TAHAP } from "../warna-tahap";

const BATAS_AWAL = 8;

export function DaftarTugas({
  tugas,
  keadaan,
  sekarang,
  sibuk,
  onPanen,
  onIsiAir,
  onBuka,
}: {
  tugas: Tugas[];
  keadaan: Map<string, KeadaanRek>;
  sekarang: string;
  sibuk: boolean;
  onPanen: (kolomId: string) => void;
  onIsiAir: (rek: KeadaanRek) => void;
  onBuka: (kolomId: string) => void;
}) {
  const [semua, setSemua] = useState(false);
  const tampil = semua ? tugas : tugas.slice(0, BATAS_AWAL);
  const now = sekarang ? Date.parse(sekarang) : null;

  return (
    <section className="flex flex-col">
      <h2 className="px-3 pt-3 pb-1.5 text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
        Tugas sekarang {tugas.length > 0 && <span className="tabular-nums">({tugas.length})</span>}
      </h2>
      {tugas.length === 0 ? (
        <p className="mx-3 flex items-center gap-2 rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
          <CircleCheck className="size-4 text-green-600" /> Tidak ada tugas di bak ini.
        </p>
      ) : (
        <ul className="divide-y border-y">
          {tampil.map((t) => {
            const rek = keadaan.get(t.kolomId);
            if (!rek) return null;
            const usia = now === null ? 0 : Math.max(0, Math.floor((now - Date.parse(t.sejak)) / 60_000));
            return (
              <li key={`${t.jenis}:${t.kolomId}`} className="flex min-h-12 items-center gap-2 px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => onBuka(t.kolomId)}
                  className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
                >
                  <span className="w-14 shrink-0 text-sm font-bold">Rek {rek.nomor}</span>
                  <span className="w-5 shrink-0 text-[10px] font-semibold text-muted-foreground">{singkatVarian(rek.varian)}</span>
                  <Keterangan tugas={t} rek={rek} usia={usia} />
                </button>
                {t.jenis === "panen" && (
                  <Button size="sm" className="h-9 min-w-20 shrink-0" disabled={sibuk} onClick={() => onPanen(t.kolomId)}>
                    Panen
                  </Button>
                )}
                {t.jenis === "isi-air" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 min-w-20 shrink-0 border-red-400 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950"
                    disabled={sibuk}
                    onClick={() => onIsiAir(rek)}
                  >
                    <Droplets className="size-4" /> Isi {rek.slotKosong.length}
                  </Button>
                )}
                {t.jenis === "babonan-lama" && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
              </li>
            );
          })}
        </ul>
      )}
      {tugas.length > BATAS_AWAL && (
        <button
          type="button"
          onClick={() => setSemua((s) => !s)}
          className="self-center py-2 text-xs font-medium text-primary"
        >
          {semua ? "Ringkas" : `Tampilkan semua (${tugas.length})`}
        </button>
      )}
    </section>
  );
}

function Keterangan({ tugas, rek, usia }: { tugas: Tugas; rek: KeadaanRek; usia: number }) {
  if (tugas.jenis === "panen") {
    const w = rek.tahap ? WARNA_TAHAP[rek.tahap] : WARNA_TAHAP.siap;
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-xs">
        <span className={cn("rounded px-1.5 py-0.5 font-bold tabular-nums", w.latar, w.teks)}>{tugas.pct ?? rek.pct}%</span>
        <span className="text-muted-foreground tabular-nums">{formatUsiaRingkas(usia)}</span>
      </span>
    );
  }
  if (tugas.jenis === "isi-air") {
    return (
      <span className="min-w-0 truncate text-xs text-muted-foreground">
        kosong {rek.slotKosong.length} can{usia > 0 && ` · ${formatUsiaRingkas(usia)}`}
      </span>
    );
  }
  return (
    <span className="min-w-0 truncate text-xs font-semibold text-orange-700 dark:text-orange-300">
      ◆ Babonan {rek.babonan} · {formatUsiaRingkas(usia)}
    </span>
  );
}
