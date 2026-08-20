"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatDate, formatRupiah, formatTime } from "@/lib/format";
import { getStopDeliveryProofAction } from "@/app/mkesindo/(dashboard)/delivery/actions";
import type { StopDeliveryProof, DriverStopRow } from "@/lib/queries/pengiriman-jadwal";

// Popup opened from the checkmark that replaces a completed stop's print
// icon in RouteValidationDialog — everything confirmStopDelivery (the
// driver-app's "Konfirmasi Penerima"/"Selesai Pembayaran" flow) wrote for
// that one stop, read back via getStopDeliveryProofAction.
export function StopDeliveryProofDialog({
  detail,
  onOpenChange,
}: {
  // Null closes the dialog — same open-via-prop convention
  // RouteValidationDialog itself uses (open={jadwalId != null}).
  detail: DriverStopRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [proof, setProof] = useState<StopDeliveryProof | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!detail) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProof(null);
      return;
    }
    setLoading(true);
    getStopDeliveryProofAction(detail.JadwalDetailID).then((p) => {
      setProof(p);
      setLoading(false);
    });
  }, [detail]);

  return (
    <Dialog open={detail != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bukti Pengiriman{detail ? ` — ${detail.CustomerName}` : ""}</DialogTitle>
          <DialogDescription className="sr-only">
            Foto bukti, kuantitas diterima, retur, pembayaran, dan tanda tangan konfirmasi penerima.
          </DialogDescription>
        </DialogHeader>

        {loading && <p className="py-6 text-center text-sm text-muted-foreground">Memuat...</p>}
        {!loading && !proof && (
          <p className="py-6 text-center text-sm text-muted-foreground">Data bukti pengiriman tidak ditemukan.</p>
        )}

        {!loading && proof && (
          <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto text-sm">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {proof.jamTiba && <span>Tiba {formatTime(proof.jamTiba)}</span>}
              <span>
                Selesai {formatTime(proof.jamSelesai)} · {formatDate(proof.jamSelesai)}
              </span>
            </div>

            {proof.fotoBuktiUrls.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Foto Bukti Pengiriman</p>
                <div className="grid grid-cols-3 gap-2">
                  {proof.fotoBuktiUrls.map((url, i) => (
                    <a
                      key={url + i}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="block aspect-square overflow-hidden rounded-md border"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- served from Google Drive via a proxy path, not a static build asset */}
                      <img src={url} alt={`Bukti pengiriman ${i + 1}`} className="h-full w-full object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {proof.items.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Kuantitas Diterima</p>
                <div className="flex flex-col divide-y rounded-md border">
                  {proof.items.map((item) => (
                    <div key={item.itemId} className="flex flex-col gap-1 px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{item.name}</span>
                        <span className="tabular-nums">
                          {item.qtyDiterima} / {item.qtyDimuat}
                        </span>
                      </div>
                      {item.qtyRetur > 0 && (
                        <div className="flex flex-col gap-1 rounded bg-destructive/5 p-1.5 text-xs text-destructive">
                          <span>
                            Retur {item.qtyRetur}
                            {item.keteranganRetur ? ` — ${item.keteranganRetur}` : ""}
                          </span>
                          {item.fotoReturUrl && (
                            <a href={item.fotoReturUrl} target="_blank" rel="noreferrer" className="underline">
                              Lihat foto retur
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between rounded-md border px-2.5 py-2">
              <span className="text-xs font-medium text-muted-foreground">Pembayaran</span>
              {proof.tanpaPembayaran ? (
                <span className="text-xs">Tanpa Pembayaran (ditagih kemudian)</span>
              ) : proof.payment ? (
                <span className="text-xs font-medium">Tunai — {formatRupiah(proof.payment.amount)}</span>
              ) : (
                <span className="text-xs text-muted-foreground">Belum ada pembayaran tercatat</span>
              )}
            </div>

            {proof.salesReturnId && <p className="text-xs text-muted-foreground">No. Retur: {proof.salesReturnId}</p>}

            {proof.tandaTanganUrl && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Tanda Tangan Konfirmasi Penerima</p>
                <div className="overflow-hidden rounded-md border bg-white p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- served from Google Drive via a proxy path, not a static build asset */}
                  <img src={proof.tandaTanganUrl} alt="Tanda tangan konfirmasi penerima" className="h-24 w-full object-contain" />
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
