"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Minus, Plus } from "lucide-react";
import { LiveCameraCaptureField } from "@/components/dashboard/live-camera-capture-field";
import { formatRupiah } from "@/lib/format";
import { getStopOrderItemsAction } from "@/app/driver-app/actions";
import type { KonfirKirimResult } from "@/components/driver-app/stop-flow";
import type { StopOrderItem } from "@/lib/queries/pengiriman-jadwal";

async function uploadDriverPhoto(jadwalDetailId: number, jenisFoto: string, file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("jadwalDetailId", String(jadwalDetailId));
  formData.append("jenisFoto", jenisFoto);
  const res = await fetch("/api/upload/driver-app", { method: "POST", body: formData });
  const data = (await res.json()) as { path?: string; error?: string };
  if (!res.ok || !data.path) throw new Error(data.error ?? "Gagal mengunggah foto");
  return data.path;
}

export function KonfirKirimStep({ jadwalDetailId, onNext }: { jadwalDetailId: number; onNext: (result: KonfirKirimResult) => void }) {
  const [items, setItems] = useState<StopOrderItem[]>([]);
  const [qtyDiterima, setQtyDiterima] = useState<Record<string, number>>({});
  const [returFotoFiles, setReturFotoFiles] = useState<Record<string, File>>({});
  const [fotoPengirimanFile, setFotoPengirimanFile] = useState<File | null>(null);
  const [fotoMuatanFile, setFotoMuatanFile] = useState<File | null>(null);
  const [tanpaPembayaran, setTanpaPembayaran] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStopOrderItemsAction(jadwalDetailId).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setItems(result.data);
      setQtyDiterima(Object.fromEntries(result.data.map((item) => [item.SalesOrderDetailID, item.Qty])));
    });
    return () => {
      cancelled = true;
    };
  }, [jadwalDetailId]);

  const totalHarga = items.reduce((sum, item) => sum + (qtyDiterima[item.SalesOrderDetailID] ?? item.Qty) * item.Price, 0);

  function adjustQty(id: string, delta: number, max: number) {
    setQtyDiterima((prev) => {
      const next = Math.max(0, Math.min(max, (prev[id] ?? max) + delta));
      return { ...prev, [id]: next };
    });
  }

  async function handleSubmit() {
    if (!fotoPengirimanFile || !fotoMuatanFile) {
      setError("Foto bukti pengiriman dan bukti muatan wajib diisi.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const [fotoBuktiPengirimanUrl, fotoBuktiMuatanUrl] = await Promise.all([
        uploadDriverPhoto(jadwalDetailId, "bukti-pengiriman", fotoPengirimanFile),
        uploadDriverPhoto(jadwalDetailId, "bukti-muatan", fotoMuatanFile),
      ]);
      const resultItems = await Promise.all(
        items.map(async (item) => {
          const returFile = returFotoFiles[item.SalesOrderDetailID];
          const fotoReturUrl = returFile ? await uploadDriverPhoto(jadwalDetailId, `retur-${item.SalesOrderDetailID}`, returFile) : null;
          return {
            salesOrderDetailId: item.SalesOrderDetailID,
            qtyDiterima: qtyDiterima[item.SalesOrderDetailID] ?? item.Qty,
            fotoReturUrl,
          };
        })
      );
      onNext({ items: resultItems, fotoBuktiPengirimanUrl, fotoBuktiMuatanUrl, tanpaPembayaran });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah foto.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p className="p-4 text-sm text-muted-foreground">Memuat...</p>;

  return (
    <div className="flex flex-col gap-4 p-4 pb-24">
      <h1 className="font-display text-lg font-semibold">Konfirmasi Pengiriman</h1>

      <div>
        <p className="mb-2 text-sm font-medium">Bukti Pengiriman</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="h-32">
            <LiveCameraCaptureField
              label="Bukti Pengiriman"
              photoUrl={fotoPengirimanFile ? URL.createObjectURL(fotoPengirimanFile) : null}
              size="main"
              active
              onCapture={setFotoPengirimanFile}
            />
          </div>
          <div className="h-32">
            <LiveCameraCaptureField
              label="Bukti Muatan"
              photoUrl={fotoMuatanFile ? URL.createObjectURL(fotoMuatanFile) : null}
              size="main"
              active
              onCapture={setFotoMuatanFile}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">Konfirmasi Muatan</p>
        {items.map((item) => {
          const current = qtyDiterima[item.SalesOrderDetailID] ?? item.Qty;
          const retur = item.Qty - current;
          return (
            <div key={item.SalesOrderDetailID} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{item.Name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatRupiah(item.Price)} &times; {item.Qty}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="icon" className="size-7" onClick={() => adjustQty(item.SalesOrderDetailID, -1, item.Qty)}>
                    <Minus className="size-3.5" />
                  </Button>
                  <span className="w-8 text-center text-sm">{current}</span>
                  <Button variant="outline" size="icon" className="size-7" onClick={() => adjustQty(item.SalesOrderDetailID, 1, item.Qty)}>
                    <Plus className="size-3.5" />
                  </Button>
                </div>
              </div>
              {retur > 0 && (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-destructive/5 p-2">
                  <p className="text-xs text-destructive">Retur: {retur}</p>
                  <div className="h-14 w-14">
                    <LiveCameraCaptureField
                      label="Foto Retur"
                      photoUrl={returFotoFiles[item.SalesOrderDetailID] ? URL.createObjectURL(returFotoFiles[item.SalesOrderDetailID]) : null}
                      size="main"
                      active
                      onCapture={(file) => setReturFotoFiles((prev) => ({ ...prev, [item.SalesOrderDetailID]: file }))}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <span className="text-sm font-medium">Total Harga</span>
        <span className="text-sm font-semibold">{formatRupiah(totalHarga)}</span>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <div>
          <p className="text-sm font-medium">Tanpa Pembayaran</p>
          <p className="text-xs text-muted-foreground">Lewati penagihan</p>
        </div>
        <input
          type="checkbox"
          className="accent-primary"
          checked={tanpaPembayaran}
          onChange={(e) => setTanpaPembayaran(e.target.checked)}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button className="w-full" disabled={submitting} onClick={handleSubmit}>
        {submitting ? "Mengunggah..." : "Lanjut"}
      </Button>
    </div>
  );
}
