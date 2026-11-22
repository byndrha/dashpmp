"use client";

// Tampilan galat bersama untuk error.tsx semua dashboard. Pesan teknis
// disembunyikan di balik "Detail teknis" (tetap bisa disalin untuk laporan),
// dengan dua jalan keluar yang jelas: coba lagi, atau kembali ke Beranda.
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, Home, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function GalatHalaman({
  error,
  reset,
  berandaHref,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  berandaHref: string;
}) {
  const [detail, setDetail] = useState(false);
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-300">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <AlertTriangle className="size-6" />
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-xl font-semibold">Halaman gagal dimuat</h1>
          <p className="text-sm text-muted-foreground">
            Biasanya karena koneksi ke database sedang lambat atau terputus. Coba muat ulang; bila terus
            terjadi, laporkan beserta detail teknis di bawah.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={reset} className="gap-1.5">
            <RotateCcw className="size-4" />
            Coba lagi
          </Button>
          <Button variant="outline" className="gap-1.5" nativeButton={false} render={<Link href={berandaHref} />}>
            <Home className="size-4" />
            Kembali ke Beranda
          </Button>
        </div>
        <button
          type="button"
          onClick={() => setDetail((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          aria-expanded={detail}
        >
          Detail teknis
          <ChevronDown className={cn("size-3.5 transition-transform", detail && "rotate-180")} />
        </button>
        {detail && (
          <p className="w-full select-all break-words rounded-lg bg-muted p-3 text-left font-mono text-xs text-muted-foreground">
            {error.message || "Tidak ada pesan galat."}
            {error.digest && <span className="mt-1 block">Kode: {error.digest}</span>}
          </p>
        )}
      </div>
    </div>
  );
}
