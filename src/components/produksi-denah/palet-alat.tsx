"use client";

// Palet alat Builder Denah (kiri layar).

import { memo, type ComponentType } from "react";
import { BrickWall, Columns3, DoorOpen, Fan, Hand, MousePointer2, MoveHorizontal, SquareDashed, Type } from "lucide-react";
import { cn } from "@/lib/utils";
import { HURUF_ALAT, type Alat } from "@/components/produksi-denah/pintasan-keyboard";

const DAFTAR: { alat: Alat; label: string; ikon: ComponentType<{ className?: string }>; petunjuk: string }[] = [
  { alat: "pilih", label: "Pilih", ikon: MousePointer2, petunjuk: "Pilih, geser, ubah ukuran" },
  { alat: "geser", label: "Geser kanvas", ikon: Hand, petunjuk: "Geser tampilan (atau tahan Spasi)" },
  { alat: "bak", label: "Bak", ikon: Columns3, petunjuk: "Klik atau tarik kotak" },
  { alat: "mesin", label: "Mesin", ikon: Fan, petunjuk: "Klik atau tarik kotak" },
  { alat: "derek", label: "Derek", ikon: MoveHorizontal, petunjuk: "Tarik garis rel A → B" },
  { alat: "dinding", label: "Dinding", ikon: BrickWall, petunjuk: "Tarik garis dinding" },
  { alat: "pintu", label: "Pintu", ikon: DoorOpen, petunjuk: "Klik atau tarik kotak" },
  { alat: "area", label: "Area", ikon: SquareDashed, petunjuk: "Zona berlabel, tarik kotak" },
  { alat: "label", label: "Label", ikon: Type, petunjuk: "Teks bebas" },
];

export const PaletAlat = memo(function PaletAlat({ alat, onPilih }: { alat: Alat; onPilih: (a: Alat) => void }) {
  return (
    <nav aria-label="Alat" className="flex w-14 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r bg-background py-2">
      {DAFTAR.map((d, i) => {
        const Ikon = d.ikon;
        const aktif = alat === d.alat;
        return (
          <div key={d.alat} className="contents">
            {i === 2 && <div className="my-1 h-px w-8 bg-border" />}
            <button
              type="button"
              onClick={() => onPilih(d.alat)}
              title={`${d.label} (${HURUF_ALAT[d.alat]}) — ${d.petunjuk}`}
              aria-label={d.label}
              aria-pressed={aktif}
              className={cn(
                "group relative flex size-11 flex-col items-center justify-center gap-0.5 rounded-lg text-muted-foreground transition-all hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                aktif && "bg-primary text-primary-foreground shadow-md ring-2 ring-primary/30 hover:bg-primary hover:text-primary-foreground"
              )}
            >
              <Ikon className={cn("size-[18px] transition-transform", aktif ? "scale-110" : "group-hover:scale-110")} />
              <span className="text-[9px] leading-none">{d.label === "Geser kanvas" ? "Geser" : d.label}</span>
              <span
                className={cn(
                  "absolute top-0.5 right-1 font-mono text-[8px] leading-none",
                  aktif ? "text-primary-foreground/70" : "text-muted-foreground/60"
                )}
              >
                {HURUF_ALAT[d.alat]}
              </span>
            </button>
          </div>
        );
      })}
    </nav>
  );
});
