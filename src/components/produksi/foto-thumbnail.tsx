"use client";

import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";

// Sama seperti FotoThumbnail lokal di produksi-app/kualitas-view.tsx (pola
// klik-untuk-preview yang sama, foto disajikan langsung dari
// public/uploads) -- diekstrak jadi komponen sendiri di sini karena
// riwayat-produksi.tsx (Server Component) butuh potongan interaktif kecil
// ini tanpa harus menjadikan seluruh file "use client". Ukurannya dibuat
// dapat diatur (bukan hardcode 80px) supaya bisa lebih kecil di baris
// riwayat yang ringkas, sesuai permintaan user 2026-09-19.
export function FotoThumbnail({ path, alt, size = 48 }: { path: string | null; alt: string; size?: number }) {
  if (!path) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded border border-dashed border-border bg-muted text-center text-[8px] leading-tight text-muted-foreground"
        style={{ width: size, height: size }}
      >
        Tidak ada foto
      </div>
    );
  }
  return (
    <Dialog>
      <DialogTrigger
        type="button"
        className="block shrink-0 cursor-zoom-in rounded focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- served from public/uploads, not a static build asset */}
        <img src={path} alt={alt} className="rounded object-cover" style={{ width: size, height: size }} />
      </DialogTrigger>
      <DialogContent className="max-w-3xl p-2 sm:p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- served from public/uploads, not a static build asset */}
        <img src={path} alt={alt} className="max-h-[80vh] w-full rounded object-contain" />
      </DialogContent>
    </Dialog>
  );
}
