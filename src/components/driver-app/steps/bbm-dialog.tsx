"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordFuelLogAction } from "@/app/driver-app/actions";

export function BbmDialog({
  open,
  onOpenChange,
  jadwalId,
  onLogged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jadwalId: number;
  onLogged?: () => void;
}) {
  const [liter, setLiter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit() {
    setError(null);
    const value = Number(liter);
    if (!(value > 0)) {
      setError("Masukkan jumlah liter yang valid.");
      return;
    }
    startTransition(async () => {
      const result = await recordFuelLogAction(jadwalId, value);
      if (!result.success) {
        setError(result.error);
        return;
      }
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
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button className="w-full" disabled={pending} onClick={handleSubmit}>
            {pending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
