import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AksesDitolakPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center">
      <ShieldAlert className="size-10 text-muted-foreground" />
      <h1 className="font-display text-lg font-semibold">Akses Ditolak</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Akun Anda tidak memiliki izin untuk membuka modul ini. Hubungi Super Administrator jika
        Anda seharusnya memiliki akses.
      </p>
      <Button render={<Link href="/" />} className="mt-2">
        Kembali ke Beranda
      </Button>
    </div>
  );
}
