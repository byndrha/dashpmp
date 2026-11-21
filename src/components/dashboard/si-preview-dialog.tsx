"use client";

// Pratinjau Sales Invoice dalam popup — memuat halaman tagihan publik
// /mkesindo/invoice/[token] di iframe (boleh: middleware memasang
// X-Frame-Options SAMEORIGIN), plus tombol buka di tab baru dan bagikan.
// Tautan bertoken itu memang dirancang untuk dibagikan ke mitra (lihat
// komentar SalesOrderListRow.SalesReturnId), jadi Bagikan aman.
import { useState } from "react";
import { ExternalLink, Share2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface SiPreviewTarget {
  token: string;
  customerName: string;
  voucherNo: string;
}

function IsiPratinjau({ target }: { target: SiPreviewTarget }) {
  const [dimuat, setDimuat] = useState(false);
  const path = `/mkesindo/invoice/${target.token}`;

  async function bagikan() {
    const url = new URL(path, window.location.origin).toString();
    const judul = `Tagihan ${target.customerName}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: judul, text: `${judul} (${target.voucherNo})`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success("Tautan tagihan disalin.");
    } catch (e) {
      // Pengguna menutup lembar bagikan — bukan galat.
      if (e instanceof DOMException && e.name === "AbortError") return;
      toast.error("Gagal membagikan tautan.");
    }
  }

  return (
    <>
      <DialogHeader className="pr-8">
        <DialogTitle>Sales Invoice — {target.customerName}</DialogTitle>
        <DialogDescription>{target.voucherNo}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<a href={path} target="_blank" rel="noopener noreferrer" />}
        >
          <ExternalLink className="size-3.5" />
          Buka di tab baru
        </Button>
        <Button variant="outline" size="sm" onClick={bagikan}>
          <Share2 className="size-3.5" />
          Bagikan
        </Button>
      </div>
      <div className="relative h-[70vh] overflow-hidden rounded-lg border bg-background">
        {!dimuat && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Memuat tagihan...
          </div>
        )}
        <iframe
          src={path}
          title={`Sales Invoice ${target.voucherNo}`}
          className="size-full"
          onLoad={() => setDimuat(true)}
        />
      </div>
    </>
  );
}

export function SiPreviewDialog({
  target,
  onOpenChange,
}: {
  target: SiPreviewTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {/* key: setiap SI baru memulai ulang status "memuat" */}
        {target && <IsiPratinjau key={target.token} target={target} />}
      </DialogContent>
    </Dialog>
  );
}
