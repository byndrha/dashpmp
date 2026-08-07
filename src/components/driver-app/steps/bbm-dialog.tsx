"use client";

import { useMemo, useState, useTransition } from "react";
import { Fuel } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRupiah } from "@/lib/format";
import { recordMasukSpbuAction, updateFuelLogAction } from "@/app/driver-app/actions";
import type { BbmContext } from "@/components/driver-app/stop-flow";

export function BbmDialog({
  open,
  onOpenChange,
  jadwalId,
  bbmContext,
  onLogged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jadwalId: number;
  bbmContext: BbmContext;
  onLogged?: () => void;
}) {
  const [bbmId, setBbmId] = useState<number | null>(null);
  const [masukSpbuPending, startMasukSpbu] = useTransition();
  const [liter, setLiter] = useState("");
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Quota liters this Jadwal's Armada should need for its route — the
  // split between "nominal asli" (within quota) and "nominal ekstra"
  // (beyond it) that the user asked for. Any missing input (route distance
  // not yet set on a Draft Jadwal, or Armada never configured with a
  // consumption/price rate) falls back to treating the whole fill-up as
  // "asli" rather than blocking the screen.
  const kuotaLiter =
    bbmContext.jarakKM != null && bbmContext.konsumsiBBM != null ? bbmContext.jarakKM * bbmContext.konsumsiBBM : null;
  const hargaPerLiter = bbmContext.biayaBBMPerLiter ?? 0;

  const { literNum, literAsli, literEkstra, nominalAsli, nominalEkstra } = useMemo(() => {
    const n = Number(liter) || 0;
    const asli = kuotaLiter != null ? Math.min(n, kuotaLiter) : n;
    const ekstra = kuotaLiter != null ? Math.max(0, n - kuotaLiter) : 0;
    return { literNum: n, literAsli: asli, literEkstra: ekstra, nominalAsli: asli * hargaPerLiter, nominalEkstra: ekstra * hargaPerLiter };
  }, [liter, kuotaLiter, hargaPerLiter]);

  function handleMasukSpbu() {
    setError(null);
    startMasukSpbu(async () => {
      const result = await recordMasukSpbuAction(jadwalId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setBbmId(result.data);
    });
  }

  function handleSubmit() {
    if (!bbmId) return;
    setError(null);
    if (!(literNum > 0)) {
      setError("Masukkan jumlah liter yang valid.");
      return;
    }
    startSaving(async () => {
      const result = await updateFuelLogAction(bbmId, literNum, nominalAsli, nominalEkstra);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setBbmId(null);
      setLiter("");
      onOpenChange(false);
      onLogged?.();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Catat Isi BBM</DialogTitle>
        </DialogHeader>

        {!bbmId ? (
          <Button className="w-full" disabled={masukSpbuPending} onClick={handleMasukSpbu}>
            <Fuel className="size-4" />
            {masukSpbuPending ? "Memproses..." : "Masuk SPBU"}
          </Button>
        ) : (
          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Sudah masuk SPBU — isi jumlah liter di bawah.</p>
        )}

        {bbmContext.qrMyPertaminaPath && (
          <div className="flex flex-col items-center gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- uploaded path, not a static build asset */}
            <img src={bbmContext.qrMyPertaminaPath} alt="QR MyPertamina" className="size-40 rounded-lg border border-border object-contain" />
            <p className="text-[11px] text-muted-foreground">Pindai QR MyPertamina saat mengisi BBM</p>
          </div>
        )}

        {bbmId && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bbm-liter">Jumlah (liter)</Label>
              <Input
                id="bbm-liter"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.1"
                value={liter}
                onChange={(e) => setLiter(e.target.value)}
                placeholder="Contoh: 50"
              />
            </div>
            {literNum > 0 && (
              <div className="flex flex-col gap-1 rounded-md border border-border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Nominal Asli ({literAsli.toFixed(1)} L)</span>
                  <span className="font-medium">{formatRupiah(nominalAsli)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Nominal Ekstra ({literEkstra.toFixed(1)} L)</span>
                  <span className={literEkstra > 0 ? "font-medium text-destructive" : "font-medium"}>{formatRupiah(nominalEkstra)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between border-t border-border pt-1">
                  <span className="font-medium">Total</span>
                  <span className="font-semibold">{formatRupiah(nominalAsli + nominalEkstra)}</span>
                </div>
                {kuotaLiter == null && (
                  <p className="text-[11px] text-muted-foreground">
                    Kuota liter belum bisa dihitung (jarak atau konsumsi BBM armada belum tersedia) — seluruh isi dianggap nominal asli.
                  </p>
                )}
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" disabled={saving} onClick={handleSubmit}>
              {saving ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        )}

        {!bbmId && error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
