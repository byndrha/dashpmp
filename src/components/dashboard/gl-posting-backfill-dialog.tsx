"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatRupiah } from "@/lib/format";
import type { BacklogPreview, BacklogPostResult } from "@/lib/queries/gl-posting-backfill";
import type { ActionResult } from "@/lib/action-result";

interface Props {
  tanggal: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPreview: (tanggal: string) => Promise<ActionResult<BacklogPreview>>;
  onPost: (tanggal: string) => Promise<ActionResult<BacklogPostResult>>;
  onSelesai: () => void;
}

export function GLPostingBackfillDialog({ tanggal, open, onOpenChange, onPreview, onPost, onSelesai }: Props) {
  const [preview, setPreview] = useState<BacklogPreview | null>(null);
  const [hasil, setHasil] = useState<BacklogPostResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Terpisah dari `pending` (yang juga menutupi loading preview) supaya
  // pesan "ini bisa lama" HANYA tampil saat proses posting sungguhan
  // berjalan, bukan saat memuat preview (yang cepat).
  const [posting, setPosting] = useState(false);
  const [pending, startTransition] = useTransition();

  function muatPreview() {
    setError(null);
    setPreview(null);
    setHasil(null);
    startTransition(async () => {
      const result = await onPreview(tanggal);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setPreview(result.data);
    });
  }

  // GLPostingBackfillDialog dirender kondisional oleh parent
  // ({tanggalDiproses && <...open={true} />}) -- jadi komponen ini SELALU
  // fresh-mount tepat saat dialognya terbuka (unmount total saat ditutup).
  // Radix Dialog's onOpenChange HANYA terpicu saat Radix sendiri yang minta
  // ubah state (Escape, klik backdrop, trigger internal) -- BUKAN saat prop
  // `open` diberikan `true` dari luar sejak awal mount, jadi memuat preview
  // dari situ tidak pernah jalan. Pola yang benar: muat data dari efek saat
  // mount, sama seperti kode-ambil-alih-button.tsx (bedanya komponen itu
  // tetap ter-mount lintas buka/tutup jadi butuh guard `if (open)`; di sini
  // tidak perlu karena seluruh komponen ini hanya eksis selagi terbuka).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    muatPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
  }

  function konfirmasiPosting() {
    setError(null);
    setPosting(true);
    startTransition(async () => {
      try {
        // onPost bisa berjalan berpuluh detik sampai belasan menit untuk
        // tanggal dengan backlog besar (lihat catatan di dialog di bawah) --
        // dibungkus try/catch karena fetch/Server Action call SEBESAR ini
        // punya risiko nyata putus koneksi/timeout proxy di tengah jalan,
        // beda dengan action-action lain di app ini yang biasanya selesai
        // sub-detik. Kegagalan action-nya SENDIRI (validasi, dsb) sudah
        // ditangani lewat result.success -- ini menangani kegagalan
        // PEMANGGILANNYA (network drop, dsb) yang tidak pernah sampai
        // menghasilkan `result` sama sekali.
        const result = await onPost(tanggal);
        if (!result.success) {
          setError(result.error);
          return;
        }
        setHasil(result.data);
        onSelesai();
      } catch {
        setError(
          "Koneksi terputus sebelum proses selesai. Ini AMAN -- klik Proses lagi untuk tanggal yang sama, sisa backlog yang belum ter-posting akan otomatis diproses (yang sudah berhasil tidak akan diulang)."
        );
      } finally {
        setPosting(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Proses Posting GL -- {tanggal}</DialogTitle>
          <DialogDescription>Posting manual backlog SalesInvoice/DeliveryOrder untuk tanggal ini.</DialogDescription>
        </DialogHeader>

        {pending && !preview && !hasil && !posting && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Memuat preview...
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {hasil && (
          <div className="flex flex-col gap-2 text-sm">
            <p className="font-medium">Selesai: {hasil.jumlahPosted} berhasil, {hasil.jumlahGagal} gagal.</p>
            {hasil.hasilPerDokumen
              .filter((h) => h.status === "GAGAL")
              .map((h) => (
                <p key={`${h.docType}-${h.voucherNo}`} className="text-xs text-destructive">
                  {h.voucherNo} ({h.docType}): {h.alasan}
                </p>
              ))}
            <Button size="sm" onClick={() => onOpenChange(false)}>
              Tutup
            </Button>
          </div>
        )}

        {preview && !hasil && (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              <b>{preview.postable.length}</b> dokumen akan diposting, <b>{preview.skipped.length}</b> dilewati.
            </p>
            <div className="flex flex-col gap-1">
              {preview.totalPerAkun.map((t) => (
                <div key={t.accountNo} className="flex justify-between text-xs">
                  <span>{t.accountNo}</span>
                  <span className="tabular-nums">
                    D {formatRupiah(t.debit)} / K {formatRupiah(t.credit)}
                  </span>
                </div>
              ))}
            </div>
            {preview.skipped.length > 0 && (
              <div className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded border border-border p-2 text-xs text-muted-foreground">
                {preview.skipped.map((s) => (
                  <p key={`${s.docType}-${s.voucherNo}`}>
                    {s.voucherNo} ({s.docType}): {s.alasan}
                  </p>
                ))}
              </div>
            )}

            {!posting && (
              <div className="rounded-lg border border-border bg-card/50 p-3 text-xs text-muted-foreground">
                Proses ini bisa memakan waktu beberapa menit untuk tanggal dengan backlog besar (150+ dokumen
                bisa memakan lebih dari 10 menit). Anda boleh menutup dialog ini kapan saja -- sisa backlog
                akan otomatis terdeteksi lagi saat Anda klik Proses berikutnya, tidak ada risiko dobel-posting.
              </div>
            )}

            {posting && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card/50 p-3 text-xs text-muted-foreground">
                <Loader2 className="size-4 shrink-0 animate-spin" />
                Sedang memproses, ini bisa memakan waktu beberapa menit -- jangan tutup tab ini. Kalau
                terputus, tidak apa-apa: klik Proses lagi nanti dan sisa backlog akan otomatis dilanjutkan.
              </div>
            )}

            <Button size="sm" disabled={pending || preview.postable.length === 0} onClick={konfirmasiPosting}>
              {posting ? "Memproses..." : "Posting Sekarang"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
