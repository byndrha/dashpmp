"use client";

import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RekMapRow } from "@/lib/queries/produksi-bak-pmpersada";
import { TAHAP_LABEL, formatUsia } from "./produksi-lib";

export function RekDetailDialog({
  rek,
  isAdmin,
  onClose,
  onIsiAirBaru,
  onSetBabonan,
  onSetMaintenance,
  onOverrideTahap,
  onKoreksiBatch,
}: {
  rek: RekMapRow;
  isAdmin: boolean;
  onClose: () => void;
  onIsiAirBaru: (jenisEs: "BK" | "BB", jumlahCan: number) => Promise<{ success: boolean; error?: string }>;
  onSetBabonan: () => Promise<{ success: boolean; error?: string }>;
  onSetMaintenance: () => Promise<{ success: boolean; error?: string }>;
  onOverrideTahap?: (tahap: "MULAI" | "KRISTAL" | "SIAP" | "JADI") => Promise<{ success: boolean; error?: string }>;
  onKoreksiBatch?: (jenisEs: "BK" | "BB", jumlahCan: number) => Promise<{ success: boolean; error?: string }>;
}) {
  const [jenisEs, setJenisEs] = useState<"BK" | "BB">(rek.JenisEs ?? "BK");
  const [jumlahCan, setJumlahCan] = useState(String(rek.JumlahCan ?? 36));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ success: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.success) {
        setError(result.error ?? "Gagal menyimpan.");
        return;
      }
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {rek.BakNama} — Rek {rek.NomorRek}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status</span>
            <span className="font-medium">{TAHAP_LABEL[rek.Tahap]}</span>
          </div>
          {rek.BatchID != null && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Jenis / Jumlah</span>
                <span className="font-medium">
                  {rek.JenisEs} ({rek.JumlahCan} Can)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Usia</span>
                <span className="font-mono font-medium">{formatUsia(rek.UsiaJam)}</span>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-muted-foreground">Isi Air Baru (mulai siklus baru)</p>
          <div className="flex gap-2">
            <select
              value={jenisEs}
              onChange={(e) => setJenisEs(e.target.value as "BK" | "BB")}
              className="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            >
              <option value="BK">BK (36 Can)</option>
              <option value="BB">BB (18 Can)</option>
            </select>
            <Input type="number" value={jumlahCan} onChange={(e) => setJumlahCan(e.target.value)} className="flex-1" />
          </div>
          <Button disabled={pending} onClick={() => run(() => onIsiAirBaru(jenisEs, Number(jumlahCan)))}>
            Isi Air Baru
          </Button>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={pending} onClick={() => run(onSetBabonan)}>
            Set Babonan
          </Button>
          <Button variant="outline" className="flex-1" disabled={pending} onClick={() => run(onSetMaintenance)}>
            Set Maintenance
          </Button>
        </div>

        {isAdmin && onOverrideTahap && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <p className="text-xs font-semibold text-amber-600">Override Tahap (Admin)</p>
            <div className="grid grid-cols-2 gap-2">
              {(["MULAI", "KRISTAL", "SIAP", "JADI"] as const).map((t) => (
                <Button key={t} size="sm" variant="secondary" disabled={pending} onClick={() => run(() => onOverrideTahap(t))}>
                  {TAHAP_LABEL[t]}
                </Button>
              ))}
            </div>
          </div>
        )}

        {isAdmin && onKoreksiBatch && rek.BatchID != null && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => onKoreksiBatch(jenisEs, Number(jumlahCan)))}>
            Simpan Koreksi Jenis/Jumlah Can
          </Button>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
