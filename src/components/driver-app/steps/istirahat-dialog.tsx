"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { startIstirahatAction } from "@/app/mkesindo/driver-app/actions";
import { KETERANGAN_ISTIRAHAT_OPTIONS } from "@/lib/istirahat-options";

// Same sentinel-string fix as kendala-dialog.tsx's Select — Base UI's Select
// must be controlled from its very first render.
const UNSET = "__unset__";

export function IstirahatDialog({
  open,
  onOpenChange,
  jadwalId,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jadwalId: number;
  onStarted: (istirahat: { istirahatId: number; keterangan: string; waktuMulai: string }) => void;
}) {
  const [keterangan, setKeterangan] = useState<string>(UNSET);
  const [lainnyaText, setLainnyaText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    setError(null);
    if (keterangan === UNSET) {
      setError("Pilih keterangan istirahat terlebih dahulu.");
      return;
    }
    const finalKeterangan = keterangan === "Lainnya" ? lainnyaText.trim() : keterangan;
    if (!finalKeterangan) {
      setError("Isi keterangan istirahat.");
      return;
    }
    startTransition(async () => {
      const result = await startIstirahatAction(jadwalId, finalKeterangan);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setKeterangan(UNSET);
      setLainnyaText("");
      onOpenChange(false);
      onStarted({ istirahatId: result.data, keterangan: finalKeterangan, waktuMulai: new Date().toISOString() });
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mulai Istirahat</DialogTitle>
          <DialogDescription>Aplikasi akan terkunci sampai Anda menekan &quot;Selesai Istirahat&quot;.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label className="sr-only">Keterangan</Label>
          <Select value={keterangan} onValueChange={(v) => setKeterangan(v ?? UNSET)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Pilih keterangan" />
            </SelectTrigger>
            <SelectContent>
              {KETERANGAN_ISTIRAHAT_OPTIONS.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {keterangan === "Lainnya" && (
          <Input
            placeholder="Sebutkan keterangan..."
            value={lainnyaText}
            onChange={(e) => setLainnyaText(e.target.value)}
          />
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button className="w-full" disabled={pending} onClick={handleSubmit}>
            {pending ? "Memulai..." : "Mulai Istirahat"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
