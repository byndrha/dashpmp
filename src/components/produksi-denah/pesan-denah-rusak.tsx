// Pesan untuk baris denah tersimpan yang tidak bisa dibaca (DenahRusak).
// Tanpa detail internal — detailnya ada di log server.

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PESAN_DENAH_RUSAK, type KodeProduksi } from "@/lib/produksi-denah";

/** `kode` diisi dari builder: tampilkan tautan kembali ke halaman Produksi. */
export function PesanDenahRusak({ kode }: { kode?: KodeProduksi }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">Produksi</h1>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-amber-500" />
            <CardTitle>{PESAN_DENAH_RUSAK}</CardTitle>
          </div>
          <CardDescription>
            Denah tidak bisa ditampilkan maupun diubah sampai data diperbaiki, agar denah lama tidak tertimpa.
          </CardDescription>
        </CardHeader>
        {kode && (
          <CardContent>
            <Button variant="outline" nativeButton={false} render={<Link href={`/${kode}/produksi`} />}>
              Kembali ke Produksi
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
