"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import { TimProduksiRoster } from "@/components/produksi-app/tim-produksi-roster";
import { QtyRecapCard, KerusakanCard, StafOperasionalSelect, TimBertugasSelect } from "@/components/produksi-app/aktivitas-produksi-view";
import type { AktivitasShiftInfo, QtyRecap, SusunanTimRow } from "@/lib/queries/aktivitas-produksi";
import type { StafOperasionalOption } from "@/lib/queries/akun";
import type { TimRow } from "@/lib/queries/tim-produksi";
import { getAktivitasDetailAction } from "@/app/mkesindo/produksi/actions";

type Detail = {
  current: AktivitasShiftInfo;
  qty: QtyRecap;
  susunanTim: SusunanTimRow[];
  kepalaNama: string | null;
  wakilKepalaNama: string | null;
};

function UbahAktivitasDialog({
  row,
  stafOperasionalOptions,
  timList,
  onOpenChange,
}: {
  row: AktivitasShiftInfo;
  stafOperasionalOptions: StafOperasionalOption[];
  timList: TimRow[];
  onOpenChange: (open: boolean) => void;
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

  function refetchDetail() {
    // Re-fetch this dialog's own detail (qty/kehadiran/kerusakan change
    // together) after each individual field save. Do NOT call the outer
    // onChanged prop here — that resets the whole tab's aktivitasProduksi
    // state to null (see refreshAktivitasProduksi in produksi-tab-shell.tsx),
    // which unmounts this dialog's own parent subtree and closes it before
    // the user can see the refreshed data or edit a second field. The outer
    // refresh instead happens once, when the dialog actually closes (see
    // RiwayatAktivitasProduksi's onOpenChange below).
    getAktivitasDetailAction(row.tanggalUsaha, row.shift).then((result) => {
      if (result.success) setDetail(result.data);
    });
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
                <CardTitle className="text-sm">Tim Bertugas</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <TimBertugasSelect tanggalUsaha={row.tanggalUsaha} shift={row.shift} timId={detail.current.timId} timList={timList} onChanged={refetchDetail} />
              </CardContent>
            </Card>
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
                  onChanged={refetchDetail}
                />
              </CardContent>
            </Card>
            <TimProduksiRoster
              tanggalUsaha={row.tanggalUsaha}
              shift={row.shift}
              susunanTim={detail.susunanTim}
              kepalaAkunId={detail.current.kepalaAkunId}
              kepalaNama={detail.kepalaNama}
              kepalaHadir={detail.current.kepalaHadir}
              wakilKepalaAkunId={detail.current.wakilKepalaAkunId}
              wakilKepalaNama={detail.wakilKepalaNama}
              wakilHadir={detail.current.wakilHadir}
              canEdit
              onChanged={refetchDetail}
            />
            <QtyRecapCard
              qty={detail.qty}
              jumlahHadir={
                (detail.current.kepalaAkunId != null && detail.current.kepalaHadir ? 1 : 0) +
                (detail.current.wakilKepalaAkunId != null && detail.current.wakilHadir ? 1 : 0) +
                detail.susunanTim.length
              }
            />
            <KerusakanCard tanggalUsaha={row.tanggalUsaha} shift={row.shift} current={detail.current} onSaved={refetchDetail} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function RiwayatAktivitasProduksi({
  riwayat,
  stafOperasionalOptions,
  timList,
  onChanged,
}: {
  riwayat: AktivitasShiftInfo[];
  stafOperasionalOptions: StafOperasionalOption[];
  timList: TimRow[];
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
          timList={timList}
          onOpenChange={(open) => {
            if (open) return;
            // Close the dialog first (this local state update is what
            // actually matters to the still-mounted dialog); only then
            // trigger the outer refresh, which resets the whole tab's
            // aktivitasProduksi state to null in produksi-tab-shell.tsx.
            // Doing this on close (not on every field save) means the
            // dialog is already meant to go away by the time its parent
            // subtree gets unmounted/remounted.
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}
