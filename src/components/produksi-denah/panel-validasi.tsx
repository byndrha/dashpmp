"use client";

// Panel validasi Builder Denah: hasil validasiDenah() langsung + penolakan
// terakhir dari server (kolom berisi es). Klik galat = pilih & pusatkan.

import { memo } from "react";
import { CircleCheck, Snowflake, TriangleAlert, X } from "lucide-react";
import type { DenahElemen, GalatDenah } from "@/lib/produksi-denah";
import { NAMA_TIPE } from "@/components/produksi-denah/builder-state";

export const PanelValidasi = memo(function PanelValidasi({
  galat,
  galatServer,
  elemen,
  onFokus,
  onTutupServer,
}: {
  galat: GalatDenah[];
  galatServer: GalatDenah[] | null;
  elemen: DenahElemen[];
  onFokus: (g: GalatDenah) => void;
  onTutupServer: () => void;
}) {
  const byId = new Map(elemen.map((e) => [e.id, e]));
  return (
    <div className="flex flex-col gap-3">
      {galatServer && galatServer.length > 0 && (
        <section className="rounded-md border border-destructive/40 bg-destructive/5 p-2">
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
              <Snowflake className="size-3.5" /> Ditolak server: {galatServer.length} kolom masih berisi es
            </div>
            <button type="button" onClick={onTutupServer} className="text-muted-foreground hover:text-foreground" aria-label="Tutup">
              <X className="size-3.5" />
            </button>
          </div>
          <p className="mb-1.5 text-[11px] text-muted-foreground">Kembalikan perubahan pada kolom bertanda merah (Ctrl+Z), lalu simpan lagi.</p>
          <DaftarGalat galat={galatServer} byId={byId} onFokus={onFokus} />
        </section>
      )}

      {galat.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-2 text-xs text-emerald-700 dark:text-emerald-300">
          <CircleCheck className="size-4" /> Denah valid — siap disimpan.
        </div>
      ) : (
        <section>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
            <TriangleAlert className="size-3.5" /> {galat.length} masalah harus diperbaiki sebelum menyimpan
          </div>
          <DaftarGalat galat={galat} byId={byId} onFokus={onFokus} />
        </section>
      )}
    </div>
  );
});

function DaftarGalat({ galat, byId, onFokus }: { galat: GalatDenah[]; byId: Map<string, DenahElemen>; onFokus: (g: GalatDenah) => void }) {
  return (
    <ul className="flex flex-col gap-1">
      {galat.map((g, i) => {
        const e = g.elemenId ? byId.get(g.elemenId) : undefined;
        return (
          <li key={`${g.elemenId ?? ""}-${g.kolomId ?? ""}-${i}`}>
            <button
              type="button"
              onClick={() => onFokus(g)}
              disabled={!e}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-left text-xs transition-colors hover:border-primary/50 hover:bg-muted disabled:cursor-default disabled:hover:bg-background"
            >
              {e && <span className="mr-1 rounded bg-muted px-1 text-[9px] font-semibold uppercase">{NAMA_TIPE[e.tipe]}</span>}
              {g.pesan}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
