"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FotoThumbnail } from "@/components/produksi/foto-thumbnail";
import { formatDate, formatTime } from "@/lib/format";
import { getVisitLogHistoryForMitraAction, type VisitLogHistoryEntry } from "@/app/mkesindo/pemasaran-app/actions";

function formatDateLong(dateISO: string): string {
  return `${dateISO.slice(8, 10)}/${dateISO.slice(5, 7)}/${dateISO.slice(0, 4)}`;
}

export function RiwayatKunjunganDialog({
  businessPartnerId,
  mitraName,
  onOpenChange,
}: {
  businessPartnerId: string | null;
  mitraName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [entries, setEntries] = useState<VisitLogHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessPartnerId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntries(null);
      setError(null);
      return;
    }
    let cancelled = false;
    getVisitLogHistoryForMitraAction(businessPartnerId).then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
      setEntries(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [businessPartnerId]);

  return (
    <Dialog open={businessPartnerId != null} onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Riwayat Kunjungan — {mitraName}</DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : !entries ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Memuat...
          </div>
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Belum ada riwayat kunjungan.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {entries.map((e) => (
              <div key={e.LogID} className="rounded-md border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{formatDateLong(e.LogDate)}</p>
                  {e.IsTerverifikasi && (
                    <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      <CheckCircle2 className="size-3" /> Terverifikasi
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground">{e.HasilKunjungan}</p>
                {e.IsTerverifikasi && (e.FotoTampakDepanPath || e.FotoPenagihanPath) && (
                  <div className="mt-2 flex gap-2">
                    <FotoThumbnail path={e.FotoTampakDepanPath} alt="Tampak depan" size={64} />
                    <FotoThumbnail path={e.FotoPenagihanPath} alt="Penagihan/penawaran" size={64} />
                  </div>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Dicatat oleh: {e.dicatatOlehNama}
                  {e.IsTerverifikasi && e.VerifiedAt ? ` · Diverifikasi ${formatDate(e.VerifiedAt)} ${formatTime(e.VerifiedAt)}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
