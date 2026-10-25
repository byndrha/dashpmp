"use client";

// Penampil denah (read-only): DenahKanvas mode "lihat" + panel detail bak.
// Klik bak/kolom membuka panel samping berisi daftar kolom, mesin, durasi
// beku, dan kolom per panen.

import { useEffect, useMemo, useRef, useState } from "react";
import { DenahKanvas } from "@/components/produksi-denah/denah-kanvas";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BakElemen, DenahDokumen, MesinElemen } from "@/lib/produksi-denah";

const angka = new Intl.NumberFormat("id-ID");
const NAMA_VARIAN = { kecil: "Kecil", besar: "Besar" } as const;

export function DenahPenampil({ dokumen }: { dokumen: DenahDokumen }) {
  const [bakId, setBakId] = useState<string | null>(null);
  const [kolomId, setKolomId] = useState<string | null>(null);

  const bak = useMemo(
    () => (bakId ? (dokumen.elemen.find((e): e is BakElemen => e.tipe === "bak" && e.id === bakId) ?? null) : null),
    [dokumen.elemen, bakId]
  );
  const terpilihIds = useMemo(() => new Set(bakId ? [bakId] : []), [bakId]);
  const kolomTerpilihIds = useMemo(() => new Set(kolomId ? [kolomId] : []), [kolomId]);

  return (
    <div className="flex flex-col gap-2">
      <Legenda />
      <DenahKanvas
        dokumen={dokumen}
        mode="lihat"
        terpilihIds={terpilihIds}
        kolomTerpilihIds={kolomTerpilihIds}
        className="h-[65vh] min-h-[360px]"
        onPilihElemen={(id) => {
          const e = id ? dokumen.elemen.find((x) => x.id === id) : null;
          setBakId(e?.tipe === "bak" ? e.id : null);
          setKolomId(null);
        }}
        onPilihKolom={(bid, kid) => {
          setBakId(bid);
          setKolomId(kid);
        }}
      />
      <Sheet
        open={!!bak}
        onOpenChange={(buka) => {
          if (!buka) {
            setBakId(null);
            setKolomId(null);
          }
        }}
      >
        <SheetContent side="right" className="w-full gap-0 data-[side=right]:sm:max-w-xl">
          {bak && <DetailBak bak={bak} dokumen={dokumen} kolomId={kolomId} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Legenda() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm bg-sky-300/80 dark:bg-sky-700/70" /> Kecil
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm bg-amber-300/85 dark:bg-amber-600/70" /> Besar
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm bg-[repeating-linear-gradient(45deg,var(--muted-foreground)_0_1px,var(--muted)_1px_4px)] opacity-80" /> Nonaktif
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-4 border-t-2 border-dashed border-violet-500" /> Mesin
      </span>
    </div>
  );
}

function DetailBak({ bak, dokumen, kolomId }: { bak: BakElemen; dokumen: DenahDokumen; kolomId: string | null }) {
  const barisRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    barisRef.current?.scrollIntoView({ block: "center" });
  }, [kolomId]);

  const kolom = useMemo(() => [...bak.kolom].sort((a, b) => a.nomor - b.nomor), [bak.kolom]);
  const mesin = bak.mesinIds
    .map((id) => dokumen.elemen.find((e): e is MesinElemen => e.tipe === "mesin" && e.id === id))
    .filter((m): m is MesinElemen => !!m);
  const aktif = bak.kolom.filter((k) => !k.nonaktif);
  const iceCan = (v: "kecil" | "besar") => aktif.filter((k) => k.varian === v).reduce((s, k) => s + k.jumlahIceCan, 0);

  return (
    <>
      <SheetHeader className="border-b pr-12">
        <SheetTitle>{bak.nama}</SheetTitle>
        <SheetDescription>
          {angka.format(bak.kolom.length)} kolom ({angka.format(aktif.length)} aktif) · orientasi {bak.orientasiKolom}
        </SheetDescription>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-b p-4 text-sm">
          <Info label="Ice can Kecil">{angka.format(iceCan("kecil"))}</Info>
          <Info label="Ice can Besar">{angka.format(iceCan("besar"))}</Info>
          <Info label="Durasi beku Kecil">{angka.format(bak.durasiBekuJam.kecil)} jam</Info>
          <Info label="Durasi beku Besar">{angka.format(bak.durasiBekuJam.besar)} jam</Info>
          <Info label="Kolom per panen">{angka.format(bak.kolomPerPanen)}</Info>
          <Info label="Varian bawaan">{NAMA_VARIAN[bak.varianBawaan]}</Info>
          <div className="col-span-2">
            <dt className="text-xs text-muted-foreground">Mesin</dt>
            <dd className="mt-1 flex flex-col gap-1">
              {mesin.length === 0 && <span className="text-muted-foreground">Belum ada mesin terhubung</span>}
              {mesin.map((m) => (
                <span key={m.id}>
                  <span className="font-medium">{m.nama}</span>
                  <span className="text-muted-foreground">
                    {[m.jenis, m.kapasitas].filter(Boolean).length > 0 && ` — ${[m.jenis, m.kapasitas].filter(Boolean).join(", ")}`}
                  </span>
                </span>
              ))}
            </dd>
          </div>
          {bak.catatan.trim() && (
            <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">Catatan</dt>
              <dd className="mt-1 whitespace-pre-wrap">{bak.catatan}</dd>
            </div>
          )}
        </dl>
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-popover">
            <TableRow>
              <TableHead className="w-12">No.</TableHead>
              <TableHead>Varian</TableHead>
              <TableHead className="text-right">Ice can</TableHead>
              <TableHead className="pl-4">Ukuran</TableHead>
              <TableHead>Catatan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {kolom.map((k) => (
              <TableRow
                key={k.id}
                ref={k.id === kolomId ? barisRef : undefined}
                className={cn(k.id === kolomId && "bg-primary/10", k.nonaktif && "text-muted-foreground")}
              >
                <TableCell className="font-medium tabular-nums">{k.nomor}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    <span className={cn("size-2.5 rounded-sm", k.varian === "kecil" ? "bg-sky-400 dark:bg-sky-600" : "bg-amber-400 dark:bg-amber-500")} />
                    {NAMA_VARIAN[k.varian]}
                    {k.nonaktif && <Badge variant="outline">Nonaktif</Badge>}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{angka.format(k.jumlahIceCan)}</TableCell>
                <TableCell className="pl-4">{k.ukuranIceCan?.trim() || "—"}</TableCell>
                <TableCell className="max-w-48 truncate" title={k.catatan || undefined}>
                  {k.catatan?.trim() || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium tabular-nums">{children}</dd>
    </div>
  );
}
