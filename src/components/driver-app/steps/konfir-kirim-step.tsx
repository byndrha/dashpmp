"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Minus, Plus, MapPin, MessageSquare } from "lucide-react";
import { LiveCameraCaptureField } from "@/components/dashboard/live-camera-capture-field";
import { MultiPhotoCaptureField } from "@/components/driver-app/multi-photo-capture-field";
import { formatRupiah } from "@/lib/format";
import { getStopOrderItemsAction } from "@/app/driver-app/actions";
import type { KonfirKirimResult } from "@/components/driver-app/stop-flow";
import type { DriverStopRow, StopOrderItem } from "@/lib/queries/pengiriman-jadwal";

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

export function KonfirKirimStep({
  jadwalDetailId,
  stop,
  onNext,
}: {
  jadwalDetailId: number;
  // Mitra info shown at the top of this screen (DO number, wilayah,
  // kecamatan) — previously this screen had no context about which stop
  // it belonged to beyond the bare ID.
  stop: DriverStopRow;
  onNext: (result: KonfirKirimResult) => void;
}) {
  const [items, setItems] = useState<StopOrderItem[]>([]);
  const [qtyDiterima, setQtyDiterima] = useState<Record<string, number>>({});
  const [returFotoFiles, setReturFotoFiles] = useState<Record<string, File>>({});
  const [keteranganRetur, setKeteranganRetur] = useState<Record<string, string>>({});
  const [returKeteranganOpen, setReturKeteranganOpen] = useState<string | null>(null);
  const [fotoBuktiFiles, setFotoBuktiFiles] = useState<File[]>([]);
  const [activeReturSlot, setActiveReturSlot] = useState<string | null>(null);
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
    if (fotoBuktiFiles.length === 0) {
      setError("Foto bukti pengiriman wajib diisi, minimal 1 foto.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const fotoBuktiUrls = await Promise.all(
        fotoBuktiFiles.map((file, i) => uploadDriverPhoto(jadwalDetailId, `bukti-pengiriman-${i + 1}`, file))
      );
      const resultItems = await Promise.all(
        items.map(async (item) => {
          const returFile = returFotoFiles[item.SalesOrderDetailID];
          const fotoReturUrl = returFile ? await uploadDriverPhoto(jadwalDetailId, `retur-${item.SalesOrderDetailID}`, returFile) : null;
          return {
            salesOrderDetailId: item.SalesOrderDetailID,
            qtyDiterima: qtyDiterima[item.SalesOrderDetailID] ?? item.Qty,
            fotoReturUrl,
            keteranganRetur: keteranganRetur[item.SalesOrderDetailID]?.trim() || null,
          };
        })
      );
      onNext({ items: resultItems, fotoBuktiUrls, tanpaPembayaran });
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

      <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">{stop.CustomerName}</p>
        <p className="text-xs text-muted-foreground">{stop.DeliveryOrderID ?? stop.SalesOrderID}</p>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="size-3 shrink-0" />
          <span>
            {stop.Wilayah} {stop.Kecamatan ? `| ${stop.Kecamatan}` : ""}
          </span>
        </div>
        {stop.Alamat && <p className="text-xs text-muted-foreground">{stop.Alamat}</p>}
      </div>

      <MultiPhotoCaptureField label="Bukti Pengiriman" files={fotoBuktiFiles} onChange={setFotoBuktiFiles} />

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
                <div className="mt-2 flex flex-col gap-2 rounded-md bg-destructive/5 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-destructive">Retur: {retur}</p>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => setReturKeteranganOpen((prev) => (prev === item.SalesOrderDetailID ? null : item.SalesOrderDetailID))}
                      >
                        <MessageSquare className="size-3" />
                        Keterangan
                      </Button>
                      <div className="relative h-14 w-14">
                        <LiveCameraCaptureField
                          label="Foto Retur"
                          photoUrl={null}
                          size="main"
                          active={activeReturSlot === item.SalesOrderDetailID}
                          disabled={activeReturSlot !== item.SalesOrderDetailID}
                          onCapture={(file) => {
                            setReturFotoFiles((prev) => ({ ...prev, [item.SalesOrderDetailID]: file }));
                            setActiveReturSlot(null);
                          }}
                        />
                        {activeReturSlot !== item.SalesOrderDetailID && (
                          <button
                            type="button"
                            aria-label="Foto Retur"
                            onClick={() => setActiveReturSlot(item.SalesOrderDetailID)}
                            className="absolute inset-0 cursor-pointer"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                  {returKeteranganOpen === item.SalesOrderDetailID && (
                    <textarea
                      className="w-full rounded-md border border-input bg-background p-2 text-xs"
                      rows={2}
                      placeholder="Alasan retur..."
                      value={keteranganRetur[item.SalesOrderDetailID] ?? ""}
                      onChange={(e) => setKeteranganRetur((prev) => ({ ...prev, [item.SalesOrderDetailID]: e.target.value }))}
                    />
                  )}
                  {returKeteranganOpen !== item.SalesOrderDetailID && keteranganRetur[item.SalesOrderDetailID] && (
                    <p className="text-xs text-muted-foreground">{keteranganRetur[item.SalesOrderDetailID]}</p>
                  )}
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
