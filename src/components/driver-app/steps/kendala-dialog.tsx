"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { reportKendalaAction } from "@/app/mkesindo/driver-app/actions";
import { JENIS_KENDALA_OPTIONS, type JenisKendala } from "@/lib/kendala-options";

// Base UI's Select must be controlled from its very first render — a value
// of `undefined` (e.g. from `jenisKendala ?? undefined`) starts it
// uncontrolled, and switching to a real string once picked throws "A
// component is changing the uncontrolled value state of Select to be
// controlled." Same sentinel-string fix already used by
// ubah-pemesanan-dialog.tsx's Select.
const UNSET = "__unset__";

export function KendalaDialog({
  open,
  onOpenChange,
  jadwalId,
  jadwalDetailId,
  onReported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jadwalId: number;
  jadwalDetailId: number;
  onReported: () => void;
}) {
  const [jenisKendala, setJenisKendala] = useState<string>(UNSET);
  const [hubungiTeknisi, setHubungiTeknisi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    setError(null);
    if (jenisKendala === UNSET) {
      setError("Pilih jenis kendala terlebih dahulu.");
      return;
    }
    startTransition(async () => {
      const result = await reportKendalaAction(jadwalId, jadwalDetailId, jenisKendala as JenisKendala, hubungiTeknisi);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setJenisKendala(UNSET);
      setHubungiTeknisi(false);
      onOpenChange(false);
      onReported();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Laporkan Kendala</DialogTitle>
          <DialogDescription>Pengiriman ini akan ditandai bermasalah sampai kendala teratasi.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label className="sr-only">Jenis kendala</Label>
          <Select value={jenisKendala} onValueChange={(v) => setJenisKendala(v ?? UNSET)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Pilih jenis kendala" />
            </SelectTrigger>
            {/* No open/close animation on this dropdown — explicit request.
                !important since data-open:/data-closed: are the same
                specificity as the shared component's own animate-in/
                animate-out rules and would otherwise lose depending on
                Tailwind's generated class order. */}
            <SelectContent className="data-open:!animate-none data-closed:!animate-none">
              {JENIS_KENDALA_OPTIONS.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            checked={hubungiTeknisi}
            onChange={(e) => setHubungiTeknisi(e.target.checked)}
          />
          Hubungi Teknisi
        </label>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button className="w-full" variant="destructive" disabled={pending} onClick={handleSubmit}>
            {pending ? "Mengirim..." : "Konfirmasi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
