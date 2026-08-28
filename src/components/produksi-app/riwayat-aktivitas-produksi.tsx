"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import { TimProduksiRoster } from "@/components/produksi-app/tim-produksi-roster";
import { QtyRecapCard, KerusakanCard, StafOperasionalSelect } from "@/components/produksi-app/aktivitas-produksi-view";
import type { AktivitasShiftInfo, QtyRecap } from "@/lib/queries/aktivitas-produksi";
import type { AnggotaTimRow } from "@/lib/queries/tim-produksi";
import type { StafOperasionalOption } from "@/lib/queries/akun";
import { getAktivitasDetailAction } from "@/app/mkesindo/produksi/actions";

type Detail = { current: AktivitasShiftInfo; qty: QtyRecap; kehadiran: number[]; timAnggota: AnggotaTimRow[] };

function UbahAktivitasDialog({
  row,
  stafOperasionalOptions,
  onOpenChange,
  onChanged,
}: {
  row: AktivitasShiftInfo;
  stafOperasionalOptions: StafOperasionalOption[];
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Reset display before the async fetch below, same pattern as UbahRiwayatDialog.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetail(null);
    setError(null);
    getAktivitasDetailAction(row.tanggalUsaha, row.shift).then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
      setDetail(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [row.tanggalUsaha, row.shift]);

  function handleDetailChanged() {
    // Re-fetch this dialog's own detail (qty/kehadiran/kerusakan change
    // together) — the parent Riwayat list's own data refreshes separately
    // via the outer onChanged callback.
    getAktivitasDetailAction(row.tanggalUsaha, row.shift).then((result) => {
      if (result.success) setDetail(result.data);
    });
    onChanged();
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ubah Aktivitas — {formatDate(row.tanggalUsaha)}</DialogTitle>
          <DialogDescription>{row.shiftLabel}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {!detail && !error && <p className="text-xs text-muted-foreground">Memuat...</p>}
        {detail && (
          <div className="flex flex-col gap-4">
            <Card size="sm">
              <CardHeader>
                <CardTitle className="text-sm">Staf Operasional Bertugas</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <StafOperasionalSelect
                  tanggalUsaha={row.tanggalUsaha}
                  shift={row.shift}
                  stafOperasionalAkunId={detail.current.stafOperasionalAkunId}
                  stafOperasionalOptions={stafOperasionalOptions}
                  onChanged={handleDetailChanged}
                />
              </CardContent>
            </Card>
            <TimProduksiRoster
              tanggalUsaha={row.tanggalUsaha}
              shift={row.shift}
              timAnggota={detail.timAnggota}
              kehadiran={detail.kehadiran}
              canEdit
              onChanged={handleDetailChanged}
            />
            <QtyRecapCard qty={detail.qty} jumlahHadir={detail.kehadiran.length} />
            <KerusakanCard tanggalUsaha={row.tanggalUsaha} shift={row.shift} current={detail.current} onSaved={handleDetailChanged} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RiwayatAktivitasProduksi({
  riwayat,
  stafOperasionalOptions,
  onChanged,
}: {
  riwayat: AktivitasShiftInfo[];
  stafOperasionalOptions: StafOperasionalOption[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<AktivitasShiftInfo | null>(null);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Riwayat</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {riwayat.map((r) => (
          <div key={`${r.tanggalUsaha}-${r.shift}`} className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs">
            <span>
              {formatDate(r.tanggalUsaha)} — {r.shiftLabel}
            </span>
            <Button size="sm" variant="outline" onClick={() => setEditing(r)}>
              Ubah
            </Button>
          </div>
        ))}
        {riwayat.length === 0 && <p className="text-xs text-muted-foreground">Belum ada riwayat.</p>}
      </CardContent>
      {editing && (
        <UbahAktivitasDialog
          row={editing}
          stafOperasionalOptions={stafOperasionalOptions}
          onOpenChange={(open) => !open && setEditing(null)}
          onChanged={onChanged}
        />
      )}
    </Card>
  );
}
