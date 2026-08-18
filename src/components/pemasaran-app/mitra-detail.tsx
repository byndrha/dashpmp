"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { MitraRow } from "@/lib/queries/mitra";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

export function MitraDetail({ mitra }: { mitra: MitraRow }) {
  const router = useRouter();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="font-display text-base font-semibold">{mitra.Name}</h1>
        </div>
        <Badge variant="outline">{mitra.IsSuspended ? "Nonaktif" : "Aktif"}</Badge>
      </header>

      <div className="flex flex-col gap-1 p-4">
        <Row label="No. Telepon" value={mitra.Kontak ?? "-"} />
        <Row label="Jenis Usaha" value={mitra.PartnerType} />
        <Row label="Wilayah" value={mitra.Wilayah ?? "-"} />
        <Row label="Kecamatan" value={mitra.Kecamatan ?? "-"} />
        <Row label="Alamat" value={mitra.Alamat ?? "-"} />
        <Row label="Kantong/Hari" value={mitra.Capacity != null ? String(mitra.Capacity) : "Belum diisi"} />
        <Row label="Kompetitor" value={mitra.Kompetitor ?? "-"} />
      </div>

      <div className="mt-auto p-4">
        <Button render={<Link href={`/mkesindo/pemasaran-app/mitra/${mitra.BusinessPartnerID}/edit`} />} className="w-full gap-1.5">
          <Pencil className="size-4" /> Edit Data Mitra
        </Button>
      </div>
    </div>
  );
}
