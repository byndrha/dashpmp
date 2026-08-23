"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { reportTerkendalaAction } from "@/app/mkesindo/driver-app/actions";
import { ALASAN_TERKENDALA_OPTIONS } from "@/lib/terkendala-options";

// Same sentinel-string fix as kendala-dialog.tsx's/istirahat-dialog.tsx's
// Select — Base UI's Select must be controlled from its very first render.
const UNSET = "__unset__";

export function TerkendalaDialog({
  open,
  onOpenChange,
  jadwalDetailId,
  onReported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jadwalDetailId: number;
  onReported: () => void;
}) {
  const [alasan, setAlasan] = useState<string>(UNSET);
  const [lainnyaText, setLainnyaText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    setError(null);
    if (alasan === UNSET) {
      setError("Pilih alasan terlebih dahulu.");
      return;
    }
    const finalAlasan = alasan === "Lainnya" ? lainnyaText.trim() : alasan;
    if (!finalAlasan) {
      setError("Isi alasan.");
      return;
    }
    startTransition(async () => {
      const result = await reportTerkendalaAction(jadwalDetailId, finalAlasan);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setAlasan(UNSET);
      setLainnyaText("");
      onOpenChange(false);
      onReported();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pengiriman Terkendala</DialogTitle>
          <DialogDescription>Tujuan ini akan tetap ada di daftar, dipindah ke urutan terakhir.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label className="sr-only">Alasan</Label>
          <Select value={alasan} onValueChange={(v) => setAlasan(v ?? UNSET)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Pilih alasan" />
            </SelectTrigger>
            <SelectContent>
              {ALASAN_TERKENDALA_OPTIONS.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {alasan === "Lainnya" && (
          <Input placeholder="Sebutkan alasan..." value={lainnyaText} onChange={(e) => setLainnyaText(e.target.value)} />
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button className="w-full" variant="destructive" disabled={pending} onClick={handleSubmit}>
            {pending ? "Melaporkan..." : "Laporkan Pengiriman Terkendala"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
