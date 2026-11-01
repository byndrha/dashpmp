"use client";

// Menu "Lapisan" (centang per lapisan) — dipakai bilah atas builder dan
// penampil denah. State-nya dari useLapisanTampil (per pengguna, localStorage).

import { useMemo } from "react";
import { Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { lapisanElemen, type DenahElemen, type Lapisan } from "@/lib/produksi-denah";
import { DAFTAR_LAPISAN } from "@/components/produksi-denah/lapisan";

export function MenuLapisan({
  tampil,
  onUbah,
  elemen,
  label = false,
}: {
  tampil: ReadonlySet<Lapisan>;
  onUbah: (l: Lapisan, tampil: boolean) => void;
  /** Bila diisi, jumlah elemen per lapisan ditampilkan. */
  elemen?: readonly DenahElemen[];
  /** Tampilkan teks "Lapisan" di samping ikon. */
  label?: boolean;
}) {
  const jumlah = useMemo(() => {
    const m = new Map<Lapisan, number>();
    for (const e of elemen ?? []) {
      const l = lapisanElemen(e);
      m.set(l, (m.get(l) ?? 0) + 1);
    }
    return m;
  }, [elemen]);
  const tersembunyi = DAFTAR_LAPISAN.length - DAFTAR_LAPISAN.filter((l) => tampil.has(l.id)).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size={label ? "sm" : "icon-sm"}
            title={tersembunyi ? `Lapisan (${tersembunyi} disembunyikan)` : "Lapisan"}
            aria-label="Lapisan"
            className="relative"
          />
        }
      >
        <Layers />
        {label && <span>Lapisan</span>}
        {tersembunyi > 0 && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-amber-500" aria-hidden />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="px-1.5 py-1 text-xs font-medium text-muted-foreground">Lapisan yang tampil</div>
        {DAFTAR_LAPISAN.map((l) => (
          <DropdownMenuCheckboxItem key={l.id} checked={tampil.has(l.id)} onCheckedChange={(c) => onUbah(l.id, c)}>
            <span className="flex min-w-0 flex-col">
              <span className="flex items-baseline gap-1.5">
                {l.label}
                {elemen && <span className="text-[10px] text-muted-foreground tabular-nums">{jumlah.get(l.id) ?? 0}</span>}
              </span>
              <span className="truncate text-[10px] text-muted-foreground">{l.petunjuk}</span>
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
