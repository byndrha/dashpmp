"use client";

import { useState } from "react";
import { ChevronRight, Loader2, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getKonteksCatatMeterAction } from "@/app/listrik-actions";
import { jamLabel, type PengaturanListrik } from "@/lib/listrik";
import { CatatMeterDialog } from "./catat-meter-dialog";

// Pintu masuk Catat Meter PLN di aplikasi produksi (Es Kristal & Es Balok).
// Konteks (kode perusahaan + pengaturan meter) baru diambil saat ditekan,
// jadi kartu ini tidak menambah beban muat awal aplikasi.
export function KartuCatatMeter({
  kode = null,
  ringkas = false,
  className,
}: {
  kode?: string | null;
  ringkas?: boolean;
  className?: string;
}) {
  const [konteks, setKonteks] = useState<{
    kode: string;
    pengaturan: PengaturanListrik;
  } | null>(null);
  const [buka, setBuka] = useState(false);
  const [memuat, setMemuat] = useState(false);

  async function mulai() {
    if (konteks) return setBuka(true);
    setMemuat(true);
    const r = await getKonteksCatatMeterAction(kode);
    setMemuat(false);
    if (!r.success) return toast.error(r.error);
    setKonteks(r.data);
    setBuka(true);
  }

  const jam = konteks
    ? `${jamLabel(konteks.pengaturan.jamWbpMulai)} & ${jamLabel(
        konteks.pengaturan.jamWbpSelesai
      )}`
    : "17.00 & 22.00";

  return (
    <>
      <button
        type="button"
        onClick={mulai}
        disabled={memuat}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border bg-card text-left shadow-xs transition-colors hover:bg-muted/40 active:scale-[0.99]",
          ringkas ? "px-3 py-2" : "px-4 py-3",
          className
        )}
      >
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning",
            ringkas ? "size-8" : "size-10"
          )}
        >
          {memuat ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Zap className="size-5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Catat Meter PLN</span>
          <span className="block truncate text-xs text-muted-foreground">
            Foto & stand meter · wajib pukul {jam}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {konteks && (
        <CatatMeterDialog
          kode={konteks.kode}
          pengaturan={konteks.pengaturan}
          open={buka}
          onOpenChange={setBuka}
        />
      )}
    </>
  );
}
