"use client";

import { useEffect, useRef, useState } from "react";
import { Grid2x2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { WAREHOUSE_ZONES } from "@/components/produksi/warehouse-layout";
import { WarehouseCell } from "@/components/produksi/warehouse-cell";
import { TambahProduksiDialog } from "@/components/produksi-app/tambah-produksi-dialog";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";
import type { MesinRow } from "@/lib/queries/produksi-mesin";

export function WarehouseView({
  posisi,
  mesinList,
  onAfterTambah,
}: {
  posisi: PalletPosisiRow[];
  mesinList: MesinRow[];
  onAfterTambah: () => void;
}) {
  const [selected, setSelected] = useState<PalletPosisiRow | null>(null);
  const [dialogPosisi, setDialogPosisi] = useState<PalletPosisiRow | null>(null);
  // Default view is Utara, not the first zone in WAREHOUSE_ZONES (Selatan)
  // — Utara is where the sliding door / most active traffic is, per user
  // request.
  const [activeZone, setActiveZone] = useState<string>("U");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const byKode = new Map(posisi.map((p) => [p.Kode, p]));

  // Jump (no smooth animation) to the Utara panel on first mount, since the
  // scroller otherwise always starts at scrollLeft=0 (Selatan) regardless
  // of `activeZone`'s initial value.
  useEffect(() => {
    panelRefs.current["U"]?.scrollIntoView({ inline: "start", block: "nearest" });
  }, []);

  function scrollToZone(zoneId: string) {
    setActiveZone(zoneId);
    panelRefs.current[zoneId]?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }

  function handleCellClick(row: PalletPosisiRow | undefined) {
    if (!row) return;
    if (row.BatchIDAktif == null) {
      setDialogPosisi(row);
    } else {
      setSelected(row);
    }
  }

  // Keeps the Selatan/Tengah/Utara tab highlight in sync when the user
  // swipes manually (not just when they tap a tab) — finds whichever
  // panel's horizontal center is closest to the scroller's own center.
  function handleScroll() {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const centerX = scrollerRect.left + scrollerRect.width / 2;
    let closest = WAREHOUSE_ZONES[0].id;
    let closestDist = Infinity;
    for (const zone of WAREHOUSE_ZONES) {
      const el = panelRefs.current[zone.id];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const dist = Math.abs(rect.left + rect.width / 2 - centerX);
      if (dist < closestDist) {
        closestDist = dist;
        closest = zone.id;
      }
    }
    setActiveZone(closest);
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex gap-1 border-b border-border">
        {WAREHOUSE_ZONES.map((zone) => (
          <button
            key={zone.id}
            type="button"
            onClick={() => scrollToZone(zone.id)}
            className={cn(
              "flex-1 border-b-2 py-2 text-sm font-medium",
              activeZone === zone.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
            )}
          >
            {zone.label}
          </button>
        ))}
      </div>

      <div ref={scrollerRef} onScroll={handleScroll} className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2">
        {WAREHOUSE_ZONES.map((zone) => (
          <div
            key={zone.id}
            ref={(el) => {
              panelRefs.current[zone.id] = el;
            }}
            className="flex w-[88%] shrink-0 snap-start flex-col gap-1 rounded-lg border border-border p-3"
          >
            {zone.grup.map((g) => (
              <div key={g.id} className="flex flex-col gap-1">
                {g.rows.map((row, i) => (
                  <div key={i} className="flex gap-2">
                    {row.map((kode) => (
                      <WarehouseCell key={kode} kode={kode} row={byKode.get(kode)} onClick={handleCellClick} />
                    ))}
                  </div>
                ))}
                {g.dividerAfter && (
                  <div className="flex items-center gap-2 text-center text-[11px] text-muted-foreground">
                    <span className="flex-1 border-t border-dashed border-border" />
                    <span>{g.dividerAfter}</span>
                    <span className="flex-1 border-t border-dashed border-border" />
                    {g.dividerAfter.includes("Jendela") && (
                      <span
                        title="Jendela"
                        className="flex size-5 shrink-0 items-center justify-center rounded-sm border border-border bg-muted text-muted-foreground"
                      >
                        <Grid2x2 className="size-3" />
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
            {zone.showPintuGeser && (
              <p className="mt-2 rounded-md bg-muted py-1 text-center text-xs font-medium">Pintu Geser</p>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 text-[11px]">
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm bg-red-600" /> Paling lama
        </span>
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm bg-amber-500" /> Menengah
        </span>
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm bg-emerald-600" /> Baru
        </span>
        <span className="flex items-center gap-1">
          <span className="size-3 rounded-sm bg-muted" /> Kosong — ketuk untuk tambah produksi
        </span>
      </div>

      {selected && (
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="font-semibold">Pallet {selected.Kode}</p>
          <p className="text-muted-foreground">Mesin: {selected.MesinNama ?? "-"}</p>
          {selected.TanggalLabel != null && (
            <p className="text-muted-foreground">
              Tanggal &amp; Shift Produksi:{" "}
              {new Date(selected.TanggalLabel).toLocaleDateString("id-ID", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
              {" — Shift "}
              {selected.Shift}
              {selected.JamPanen && ` — Jam Panen ${selected.JamPanen}`}
            </p>
          )}
          <p className="text-muted-foreground">
            Sisa: {selected.SisaQty10KG ?? 0} kantong 10kg, {selected.SisaQty5KG ?? 0} kantong 5kg
          </p>
        </div>
      )}

      <TambahProduksiDialog
        open={dialogPosisi != null}
        onOpenChange={(open) => !open && setDialogPosisi(null)}
        posisi={dialogPosisi}
        mesinList={mesinList}
        onSaved={() => {
          setDialogPosisi(null);
          onAfterTambah();
        }}
      />
    </div>
  );
}
