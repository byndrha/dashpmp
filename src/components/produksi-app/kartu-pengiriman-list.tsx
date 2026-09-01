"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { produksiSelesaiMuatManualAction, getJadwalDetailForProduksiAction } from "@/app/mkesindo/produksi/actions";
import type { ActionResult } from "@/lib/action-result";
import type { DraftJadwalForProduksi, SelesaiMuatJadwalForProduksi } from "@/lib/queries/produksi-muatan";
import type { JadwalDetailRow } from "@/lib/queries/pengiriman-jadwal";

// Reused for both the Pengiriman tab (current + future period) and the
// Riwayat tab (previous periods) — same Mulai Muat -> Alokasi -> Selesai
// Muat flow either way, just fed a different pre-filtered list and a
// different "Sudah Selesai Muat" fetcher, since a backlogged card is fully
// actionable, not a frozen read-only record.
export function KartuPengirimanList({
  initialJadwal,
  fetchSelesaiList,
  emptyMessage = "Tidak ada Kartu Pengiriman yang perlu diisi muatan saat ini.",
  onAfterMuat,
}: {
  initialJadwal: DraftJadwalForProduksi[];
  fetchSelesaiList: () => Promise<ActionResult<SelesaiMuatJadwalForProduksi[]>>;
  emptyMessage?: string;
  onAfterMuat: () => void;
}) {
  const [jadwalList, setJadwalList] = useState(initialJadwal);
  const [quickJadwal, setQuickJadwal] = useState<DraftJadwalForProduksi | null>(null);
  const [selesaiList, setSelesaiList] = useState<SelesaiMuatJadwalForProduksi[] | null>(null);

  function refreshSelesaiList() {
    fetchSelesaiList().then((result) => {
      if (result.success) setSelesaiList(result.data);
    });
  }

  useEffect(() => {
    refreshSelesaiList();
    // Only ever meant to fire once on mount — fetchSelesaiList is a stable
    // action reference for this component instance's whole lifetime (the
    // Pengiriman and Riwayat tabs each mount their own instance with a
    // different, but never-changing, action prop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleQuickDone(jadwalId: number) {
    setJadwalList((prev) => prev.filter((j) => j.JadwalID !== jadwalId));
    setQuickJadwal(null);
    refreshSelesaiList();
    onAfterMuat();
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {jadwalList.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        jadwalList.map((jadwal) => (
          <div key={jadwal.JadwalID} className="relative rounded-lg border border-border p-3">
            <div className="block w-full pr-24 text-left">
              <p className="font-semibold">{jadwal.ArmadaNama}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(jadwal.JamJadwal).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                {" • "}
                {new Date(jadwal.JamJadwal).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
              </p>
              <p className="mt-1 text-sm">
                Dibutuhkan: {jadwal.Qty10KGDibutuhkan} kantong 10kg, {jadwal.Qty5KGDibutuhkan} kantong 5kg
              </p>
            </div>
            <div className="absolute right-3 top-3 flex flex-col items-end gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setQuickJadwal(jadwal)}
              >
                Selesai Muat
              </Button>
              {jadwal.JamMulaiMuat != null && (
                <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600">
                  Sedang dimuat
                </span>
              )}
            </div>
          </div>
        ))
      )}

      {selesaiList != null && selesaiList.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-sm font-medium text-muted-foreground">Sudah Selesai Muat</p>
          {selesaiList.map((jadwal) => (
            <div key={jadwal.JadwalID} className="rounded-lg border border-border bg-muted/20 p-3">
              <p className="font-medium">{jadwal.ArmadaNama}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(jadwal.JamSelesaiMuat).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                {" • "}
                {new Date(jadwal.JamSelesaiMuat).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {jadwal.Qty10KG} kantong 10kg
                {jadwal.Qty5KGDimuat != null && `, ${jadwal.Qty5KGDimuat} kantong 5kg dimuat`}
              </p>
            </div>
          ))}
        </div>
      )}

      <QuickSelesaiDialog
        jadwal={quickJadwal}
        onClose={() => setQuickJadwal(null)}
        onDone={() => quickJadwal && handleQuickDone(quickJadwal.JadwalID)}
      />
    </div>
  );
}

// Quick "Selesai Muat" path fired from the card's top-right button — same
// Ya/Tidak destination-confirmation UX as AlokasiScreen's dialog below, but
// skips the Stok Es allocation screen entirely (produksiSelesaiMuatManualAction
// touches no pallet stock).
function QuickSelesaiDialog({
  jadwal,
  onClose,
  onDone,
}: {
  jadwal: DraftJadwalForProduksi | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [detail, setDetail] = useState<{ jadwalId: number; rows: JadwalDetailRow[] } | null>(null);
  const [fetchError, setFetchError] = useState<{ jadwalId: number; message: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!jadwal) return;
    let cancelled = false;
    getJadwalDetailForProduksiAction(jadwal.JadwalID).then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setFetchError({ jadwalId: jadwal.JadwalID, message: result.error });
        return;
      }
      setDetail({ jadwalId: jadwal.JadwalID, rows: result.data });
    });
    return () => {
      cancelled = true;
    };
  }, [jadwal]);

  const rows = jadwal && detail?.jadwalId === jadwal.JadwalID ? detail.rows : null;
  const loading = jadwal != null && rows === null && fetchError?.jadwalId !== jadwal.JadwalID;
  const error = submitError ?? (jadwal && fetchError?.jadwalId === jadwal.JadwalID ? fetchError.message : null);

  function handleYa() {
    if (!jadwal) return;
    startTransition(async () => {
      const result = await produksiSelesaiMuatManualAction(jadwal.JadwalID);
      if (!result.success) {
        setSubmitError(result.error);
        return;
      }
      onDone();
    });
  }

  return (
    <Dialog open={jadwal != null} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Selesai Muat — {jadwal?.ArmadaNama}</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          <p className="text-sm text-muted-foreground">
            Muatan akan dikunci dan Surat Jalan/Invoice diterbitkan tanpa mencatat pallet Stok Es, untuk tujuan berikut:
          </p>
          {loading && <p className="text-sm text-muted-foreground">Memuat...</p>}
          {rows?.map((d) => (
            <div key={d.JadwalDetailID} className="rounded-md border border-border p-2 text-sm">
              <p className="font-medium">{d.CustomerName}</p>
              <p className="text-xs text-muted-foreground">
                {d.Qty10KG} kantong 10kg, {d.Qty5KG} kantong 5kg
              </p>
            </div>
          ))}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={pending} onClick={onClose}>
            Tidak
          </Button>
          <Button disabled={pending || loading} onClick={handleYa}>
            {pending ? "Memproses..." : "Ya, Selesai Muat"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
