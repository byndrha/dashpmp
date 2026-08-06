"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { formatTime } from "@/lib/format";
import type { ArmadaConflictInfo } from "@/lib/queries/pengiriman-jadwal";

export function ArmadaConflictDialog({
  conflict,
  onConfirm,
  onCancel,
}: {
  conflict: ArmadaConflictInfo;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gabungkan dengan Kartu Pengiriman yang Sudah Ada?</DialogTitle>
          <DialogDescription>
            Sudah ada keberangkatan Draft untuk armada ini di sekitar jam {formatTime(conflict.jamJadwal)}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Kuantitas terpilih</span>
            <span className="tabular-nums">{conflict.candidateQty} kantong</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Sudah ada di Kartu Pengiriman</span>
            <span className="tabular-nums">{conflict.existingQty} kantong</span>
          </div>
          <div className="flex justify-between border-t pt-1 font-medium">
            <span>Total setelah gabung</span>
            <span className="tabular-nums">{conflict.combinedQty} kantong</span>
          </div>
          {conflict.wouldExceedCapacity && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Melebihi kapasitas maksimum armada ({conflict.kapasitasMaks} kantong).
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Batal
          </Button>
          <Button onClick={onConfirm} disabled={conflict.wouldExceedCapacity}>
            Gabungkan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
