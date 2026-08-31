"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { takeAwayMulaiMuatAction, takeAwaySelesaiMuatAction } from "@/app/mkesindo/produksi/actions";
import type { ActionResult } from "@/lib/action-result";
import type { TakeAwayMuatanPendingRow, TakeAwayMuatanSelesaiRow } from "@/lib/queries/takeaway-muatan";

const VARIANT_LABEL: Record<string, string> = { "5kg": "kantong 5kg", "10kg": "kantong 10kg" };

export function TakeAwayMuatanList({
  initialPending,
  fetchSelesaiList,
  onAfterMuat,
}: {
  initialPending: TakeAwayMuatanPendingRow[];
  fetchSelesaiList: () => Promise<ActionResult<TakeAwayMuatanSelesaiRow[]>>;
  onAfterMuat: () => void;
}) {
  const [pendingList, setPendingList] = useState(initialPending);
  const [selected, setSelected] = useState<TakeAwayMuatanPendingRow | null>(null);
  const [selesaiList, setSelesaiList] = useState<TakeAwayMuatanSelesaiRow[] | null>(null);

  function refreshSelesaiList() {
    fetchSelesaiList().then((result) => {
      if (result.success) setSelesaiList(result.data);
    });
  }

  useEffect(() => {
    refreshSelesaiList();
    // Only ever meant to fire once on mount — fetchSelesaiList is a stable
    // action reference for this component instance's whole lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDone(takeAwayMuatanId: number) {
    setPendingList((prev) => prev.filter((r) => r.takeAwayMuatanId !== takeAwayMuatanId));
    setSelected(null);
    refreshSelesaiList();
    onAfterMuat();
  }

  function handleMulaiMuatDone(takeAwayMuatanId: number) {
    const stamped = new Date();
    setPendingList((prev) => prev.map((r) => (r.takeAwayMuatanId === takeAwayMuatanId ? { ...r, jamMulaiMuat: stamped } : r)));
    setSelected((prev) => (prev && prev.takeAwayMuatanId === takeAwayMuatanId ? { ...prev, jamMulaiMuat: stamped } : prev));
  }

  if (selected) {
    return (
      <IsiMuatanScreen
        row={selected}
        onBack={() => setSelected(null)}
        onMulaiMuatDone={handleMulaiMuatDone}
        onDone={() => handleDone(selected.takeAwayMuatanId)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      <p className="text-sm font-medium text-muted-foreground">TakeAway — Menunggu/Sedang Dimuat</p>
      {pendingList.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">Tidak ada order TakeAway yang menunggu diproses.</p>
      ) : (
        pendingList.map((row) => (
          <button
            key={row.takeAwayMuatanId}
            type="button"
            onClick={() => setSelected(row)}
            className="relative rounded-lg border border-border p-3 text-left"
          >
            <p className="font-semibold">{row.customerName}</p>
            <p className="mt-1 text-sm">
              {row.qtyDipesan} {VARIANT_LABEL[row.variant] ?? row.variant}
            </p>
            {row.jamMulaiMuat != null && (
              <span className="absolute right-3 top-3 rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600">
                Sedang dimuat
              </span>
            )}
          </button>
        ))
      )}

      {selesaiList != null && selesaiList.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-sm font-medium text-muted-foreground">TakeAway — Baru Selesai</p>
          {selesaiList.map((row) => (
            <div key={row.takeAwayMuatanId} className="rounded-lg border border-border bg-muted/20 p-3">
              <p className="font-medium">{row.customerName}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(row.jamSelesaiMuat).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                {" • "}
                {new Date(row.jamSelesaiMuat).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {row.qtyDimuat} {VARIANT_LABEL[row.variant] ?? row.variant}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Step 1/2 gate: a row already resumed after backing out mid-flow skips
// straight to the confirmation screen (row.jamMulaiMuat is already set), a
// fresh one shows the explicit "Mulai Muat" screen first — same pattern as
// IsiMuatanScreen in kartu-pengiriman-list.tsx.
function IsiMuatanScreen({
  row,
  onBack,
  onMulaiMuatDone,
  onDone,
}: {
  row: TakeAwayMuatanPendingRow;
  onBack: () => void;
  onMulaiMuatDone: (takeAwayMuatanId: number) => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"mulai" | "konfirmasi">(row.jamMulaiMuat != null ? "konfirmasi" : "mulai");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (step === "mulai") {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Button variant="outline" size="sm" onClick={onBack} className="w-fit">
          Kembali
        </Button>
        <p className="font-semibold">{row.customerName}</p>
        <p className="text-sm">
          {row.qtyDipesan} {VARIANT_LABEL[row.variant] ?? row.variant}
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await takeAwayMulaiMuatAction(row.takeAwayMuatanId);
              if (!result.success) {
                setError(result.error);
                return;
              }
              onMulaiMuatDone(row.takeAwayMuatanId);
              setStep("konfirmasi");
            });
          }}
        >
          {pending ? "Memproses..." : "Mulai Muat"}
        </Button>
      </div>
    );
  }

  return <KonfirmasiScreen row={row} onBack={onBack} onDone={onDone} />;
}

function KonfirmasiScreen({
  row,
  onBack,
  onDone,
}: {
  row: TakeAwayMuatanPendingRow;
  onBack: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSelesai() {
    startTransition(async () => {
      const result = await takeAwaySelesaiMuatAction(row.takeAwayMuatanId);
      if (!result.success) {
        setConfirmOpen(false);
        setError(result.error);
        return;
      }
      onDone();
    });
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <Button variant="outline" size="sm" onClick={onBack} className="w-fit">
        Kembali
      </Button>
      <p className="font-semibold">{row.customerName}</p>
      <p className="text-sm">
        Qty dimuat: {row.qtyDipesan} {VARIANT_LABEL[row.variant] ?? row.variant} (sesuai pesanan)
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button disabled={pending} onClick={() => setConfirmOpen(true)}>
        Selesai Muat
      </Button>

      <Dialog open={confirmOpen} onOpenChange={(open) => !open && !pending && setConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Selesaikan Muat — {row.customerName}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Surat Jalan/Invoice akan diterbitkan dan masuk antrian cetak untuk {row.qtyDipesan}{" "}
            {VARIANT_LABEL[row.variant] ?? row.variant}.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={pending} onClick={() => setConfirmOpen(false)}>
              Tidak
            </Button>
            <Button disabled={pending} onClick={handleSelesai}>
              {pending ? "Memproses..." : "Ya, Selesai Muat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
