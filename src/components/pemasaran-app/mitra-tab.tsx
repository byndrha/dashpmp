"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Plus, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMitraListAction, getWilayahDeliveryAction } from "@/app/mkesindo/pemasaran-app/actions";
import type { MitraRow } from "@/lib/queries/mitra";
import type { PemasaranWilayahDeliveryRow } from "@/lib/queries/pemasaran-wilayah-delivery";

export function MitraTab() {
  const [mitra, setMitra] = useState<MitraRow[] | null>(null);
  const [wilayahStats, setWilayahStats] = useState<PemasaranWilayahDeliveryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"daftar" | "wilayah">("daftar");

  useEffect(() => {
    let cancelled = false;
    Promise.all([getMitraListAction(), getWilayahDeliveryAction()]).then(([mitraResult, wilayahResult]) => {
      if (cancelled) return;
      if (!mitraResult.success) {
        setError(mitraResult.error);
        return;
      }
      setMitra(mitraResult.data);
      if (!wilayahResult.success) {
        setError(wilayahResult.error);
        return;
      }
      setWilayahStats(wilayahResult.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!mitra) return [];
    const q = search.trim().toLowerCase();
    if (!q) return mitra;
    return mitra.filter((m) => m.Name.toLowerCase().includes(q));
  }, [mitra, search]);

  const mitraCountByWilayah = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of mitra ?? []) {
      if (!m.Wilayah) continue;
      map.set(m.Wilayah, (map.get(m.Wilayah) ?? 0) + 1);
    }
    return map;
  }, [mitra]);

  if (error) return <p className="p-4 text-sm text-destructive">{error}</p>;
  if (!mitra) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{mitra.length} mitra terdaftar</p>
        <Button size="sm" render={<Link href="/mkesindo/pemasaran-app/pengajuan/baru" />} className="gap-1.5">
          <Plus className="size-3.5" /> Ajukan Mitra
        </Button>
      </div>

      <div className="flex gap-1.5">
        <Button size="sm" variant={view === "daftar" ? "default" : "outline"} onClick={() => setView("daftar")}>
          Daftar Mitra
        </Button>
        <Button size="sm" variant={view === "wilayah" ? "default" : "outline"} onClick={() => setView("wilayah")}>
          Peta Wilayah
        </Button>
      </div>

      {view === "daftar" ? (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Cari nama mitra..." className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {filtered.map((m) => (
            <Card key={m.BusinessPartnerID}>
              <CardContent className="p-3">
                <Link href={`/mkesindo/pemasaran-app/mitra/${m.BusinessPartnerID}`} className="flex flex-col gap-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">{m.Name}</p>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {m.PartnerType}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {m.Kontak ?? "-"} · {m.Wilayah ?? "-"}
                    {m.Kecamatan ? ` - ${m.Kecamatan}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">{m.Capacity ?? 0} kantong/hari</p>
                </Link>
              </CardContent>
            </Card>
          ))}
        </>
      ) : (
        (wilayahStats ?? []).map((w) => (
          <Card key={w.Wilayah}>
            <CardContent className="flex items-center justify-between p-3">
              <p className="font-medium">{w.Wilayah}</p>
              <p className="text-sm tabular-nums text-muted-foreground">{mitraCountByWilayah.get(w.Wilayah) ?? 0} mitra</p>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
