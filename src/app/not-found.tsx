import type { Metadata } from "next";
import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Halaman tidak ditemukan" };

// 404 global: dipakai untuk alamat yang tidak ada di mana pun. "/" tetap
// dialihkan middleware sesuai jenis akun, jadi tombol ini aman untuk semua.
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center bg-background p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-300">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Compass className="size-6" />
        </span>
        <div className="flex flex-col gap-1.5">
          <p className="font-display text-4xl font-bold tabular-nums text-muted-foreground/60">404</p>
          <h1 className="font-display text-xl font-semibold">Halaman tidak ditemukan</h1>
          <p className="text-sm text-muted-foreground">
            Alamat ini tidak ada atau sudah dipindahkan. Periksa kembali tautannya, atau kembali ke halaman utama.
          </p>
        </div>
        <Button nativeButton={false} render={<Link href="/" />}>
          Ke halaman utama
        </Button>
      </div>
    </main>
  );
}
