"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  getWarehouseMapAction,
  produksiStartMuatAction,
  produksiSelesaiMuatAction,
  produksiSelesaiMuatManualAction,
  getJadwalDetailForProduksiAction,
  getSelesaiMuatJadwalForProduksiAction,
} from "@/app/mkesindo/produksi/actions";
import type { DraftJadwalForProduksi, SelesaiMuatJadwalForProduksi } from "@/lib/queries/produksi-muatan";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";
import type { JadwalDetailRow } from "@/lib/queries/pengiriman-jadwal";

export function KartuPengirimanList({
  initialJadwal,
  onAfterMuat,
}: {
  initialJadwal: DraftJadwalForProduksi[];
  onAfterMuat: () => void;
}) {
  const [jadwalList, setJadwalList] = useState(initialJadwal);
  const [selected, setSelected] = useState<DraftJadwalForProduksi | null>(null);
  const [quickJadwal, setQuickJadwal] = useState<DraftJadwalForProduksi | null>(null);
  const [selesaiList, setSelesaiList] = useState<SelesaiMuatJadwalForProduksi[] | null>(null);

  function refreshSelesaiList() {
    getSelesaiMuatJadwalForProduksiAction().then((result) => {
      if (result.success) setSelesaiList(result.data);
    });
  }

  useEffect(() => {
    refreshSelesaiList();
  }, []);

  function handleDone(jadwalId: number) {
    setJadwalList((prev) => prev.filter((j) => j.JadwalID !== jadwalId));
    setSelected(null);
    refreshSelesaiList();
    onAfterMuat();
  }

  function handleQuickDone(jadwalId: number) {
    setJadwalList((prev) => prev.filter((j) => j.JadwalID !== jadwalId));
    setQuickJadwal(null);
    refreshSelesaiList();
    onAfterMuat();
  }

  if (selected) {
    return (
      <IsiMuatanScreen
        jadwal={selected}
        onBack={() => setSelected(null)}
        onDone={() => handleDone(selected.JadwalID)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {jadwalList.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">
          Tidak ada Kartu Pengiriman yang perlu diisi muatan saat ini.
        </p>
      ) : (
        jadwalList.map((jadwal) => (
          <div key={jadwal.JadwalID} className="relative rounded-lg border border-border p-3">
            <button type="button" onClick={() => setSelected(jadwal)} className="block w-full pr-24 text-left">
              <p className="font-semibold">{jadwal.ArmadaNama}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(jadwal.JamJadwal).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                {" • "}
                {new Date(jadwal.JamJadwal).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
              </p>
              <p className="mt-1 text-sm">
                Dibutuhkan: {jadwal.Qty10KGDibutuhkan} kantong 10kg, {jadwal.Qty5KGDibutuhkan} kantong 5kg
              </p>
            </button>
            <div className="absolute right-3 top-3 flex flex-col items-end gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  setQuickJadwal(jadwal);
                }}
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
                {jadwal.Qty10KG} kantong 10kg, {jadwal.Qty5KG} kantong 5kg
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

// Step 1/2 gate: a Jadwal already resumed after backing out mid-flow skips
// straight to the alokasi screen (jadwal.JamMulaiMuat is already set), a
// fresh one shows the explicit "Mulai Muat" screen first.
function IsiMuatanScreen({
  jadwal,
  onBack,
  onDone,
}: {
  jadwal: DraftJadwalForProduksi;
  onBack: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"mulai" | "alokasi">(jadwal.JamMulaiMuat != null ? "alokasi" : "mulai");
  const [startError, setStartError] = useState<string | null>(null);
  const [startPending, startTransition] = useTransition();

  if (step === "mulai") {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Button variant="outline" size="sm" onClick={onBack} className="w-fit">
          Kembali
        </Button>
        <p className="font-semibold">{jadwal.ArmadaNama}</p>
        <p className="text-sm text-muted-foreground">
          {new Date(jadwal.JamJadwal).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
          {" • "}
          {new Date(jadwal.JamJadwal).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
        </p>
        <p className="text-sm">
          Dibutuhkan: {jadwal.Qty10KGDibutuhkan} kantong 10kg, {jadwal.Qty5KGDibutuhkan} kantong 5kg
        </p>
        {startError && <p className="text-sm text-destructive">{startError}</p>}
        <Button
          disabled={startPending}
          onClick={() => {
            setStartError(null);
            startTransition(async () => {
              const result = await produksiStartMuatAction(jadwal.JadwalID);
              if (!result.success) {
                setStartError(result.error);
                return;
              }
              setStep("alokasi");
            });
          }}
        >
          {startPending ? "Memproses..." : "Mulai Muat"}
        </Button>
      </div>
    );
  }

  return <AlokasiScreen jadwal={jadwal} onBack={onBack} onDone={onDone} />;
}

function AlokasiScreen({
  jadwal,
  onBack,
  onDone,
}: {
  jadwal: DraftJadwalForProduksi;
  onBack: () => void;
  onDone: () => void;
}) {
  const [posisi, setPosisi] = useState<PalletPosisiRow[] | null>(null);
  const [alokasi, setAlokasi] = useState<Record<number, { qty10: number; qty5: number }>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [confirmDetail, setConfirmDetail] = useState<JadwalDetailRow[] | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  useEffect(() => {
    getWarehouseMapAction().then((result) => {
      if (result.success) {
        setPosisi(
          result.data
            .filter((p) => p.BatchIDAktif != null)
            .sort((a, b) => new Date(a.TanggalProduksi ?? 0).getTime() - new Date(b.TanggalProduksi ?? 0).getTime())
        );
      }
    });
  }, []);

  const totalQty10 = Object.values(alokasi).reduce((sum, a) => sum + a.qty10, 0);
  const totalQty5 = Object.values(alokasi).reduce((sum, a) => sum + a.qty5, 0);
  const cukup = totalQty10 >= jadwal.Qty10KGDibutuhkan && totalQty5 >= jadwal.Qty5KGDibutuhkan;

  function setAmbil(posisiId: number, field: "qty10" | "qty5", value: number, max: number) {
    setAlokasi((prev) => ({
      ...prev,
      [posisiId]: {
        qty10: prev[posisiId]?.qty10 ?? 0,
        qty5: prev[posisiId]?.qty5 ?? 0,
        [field]: Math.min(Math.max(0, value), max),
      },
    }));
  }

  function handleAmbilSemua(row: PalletPosisiRow) {
    setAlokasi((prev) => ({ ...prev, [row.PosisiID]: { qty10: row.SisaQty10KG ?? 0, qty5: row.SisaQty5KG ?? 0 } }));
  }

  function buildAlokasiList() {
    if (!posisi) return [];
    return posisi
      .filter((row) => alokasi[row.PosisiID] && (alokasi[row.PosisiID].qty10 > 0 || alokasi[row.PosisiID].qty5 > 0))
      .map((row) => ({
        batchId: row.BatchIDAktif as number,
        qty10KG: alokasi[row.PosisiID].qty10,
        qty5KG: alokasi[row.PosisiID].qty5,
      }));
  }

  function handleOpenConfirm() {
    setError(null);
    setConfirmLoading(true);
    getJadwalDetailForProduksiAction(jadwal.JadwalID).then((result) => {
      setConfirmLoading(false);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setConfirmDetail(result.data);
    });
  }

  function handleConfirmYa() {
    const alokasiList = buildAlokasiList();
    startTransition(async () => {
      const result = await produksiSelesaiMuatAction({ jadwalId: jadwal.JadwalID, alokasi: alokasiList });
      if (!result.success) {
        setConfirmDetail(null);
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
      <p className="font-semibold">{jadwal.ArmadaNama}</p>
      <p className="text-sm text-muted-foreground">
        Dibutuhkan: {jadwal.Qty10KGDibutuhkan} kantong 10kg, {jadwal.Qty5KGDibutuhkan} kantong 5kg
      </p>
      <p className="text-sm">
        Sudah dialokasikan: {totalQty10} kantong 10kg, {totalQty5} kantong 5kg
      </p>

      {posisi === null ? (
        <p className="text-sm text-muted-foreground">Memuat data pallet...</p>
      ) : (
        <div className="flex flex-col gap-2">
          {posisi.map((row, index) => (
            <div
              key={row.PosisiID}
              className={index === 0 ? "rounded-lg border-2 border-amber-500 p-3" : "rounded-lg border border-border p-3"}
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  Pallet {row.Kode}
                  {index === 0 && <span className="ml-2 text-xs text-amber-600">Paling lama — ambil dulu</span>}
                </p>
                <Button size="sm" variant="outline" onClick={() => handleAmbilSemua(row)}>
                  Ambil semua sisa
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Sisa: {row.SisaQty10KG} kantong 10kg, {row.SisaQty5KG} kantong 5kg
              </p>
              <div className="mt-2 flex gap-2">
                <Input
                  type="number"
                  placeholder="Qty 10kg"
                  value={alokasi[row.PosisiID]?.qty10 ?? ""}
                  onChange={(e) => setAmbil(row.PosisiID, "qty10", Number(e.target.value), row.SisaQty10KG ?? 0)}
                />
                <Input
                  type="number"
                  placeholder="Qty 5kg"
                  value={alokasi[row.PosisiID]?.qty5 ?? ""}
                  onChange={(e) => setAmbil(row.PosisiID, "qty5", Number(e.target.value), row.SisaQty5KG ?? 0)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button disabled={!cukup || confirmLoading} onClick={handleOpenConfirm}>
        {confirmLoading ? "Memuat..." : "Konfirmasi Isi Muatan"}
      </Button>

      <Dialog open={confirmDetail != null} onOpenChange={(open) => !open && !pending && setConfirmDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Selesaikan Muat?</DialogTitle>
          </DialogHeader>
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            <p className="text-sm text-muted-foreground">
              Muatan akan dikunci dan Surat Jalan/Invoice diterbitkan untuk tujuan berikut:
            </p>
            {confirmDetail?.map((d) => (
              <div key={d.JadwalDetailID} className="rounded-md border border-border p-2 text-sm">
                <p className="font-medium">{d.CustomerName}</p>
                <p className="text-xs text-muted-foreground">
                  {d.Qty10KG} kantong 10kg, {d.Qty5KG} kantong 5kg
                </p>
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={pending} onClick={() => setConfirmDetail(null)}>
              Tidak
            </Button>
            <Button disabled={pending} onClick={handleConfirmYa}>
              {pending ? "Memproses..." : "Ya, Selesai Muat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
