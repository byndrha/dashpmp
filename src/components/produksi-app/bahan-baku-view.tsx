"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  JENIS_BARANG_LABEL,
  toBundle,
  JENIS_BARANG_UNIT_BUNDLE,
  type JenisBarang,
} from "@/lib/stok-bahan-baku-shared";
import type { StokBahanBakuRow, CurrentShiftInfo } from "@/lib/queries/stok-bahan-baku";
import { upsertProduksiStokAction } from "@/app/mkesindo/produksi/actions";

function formatQty(n: number, jenis: JenisBarang): string {
  return `${n.toLocaleString("id-ID")} lembar (${toBundle(n)} ${JENIS_BARANG_UNIT_BUNDLE[jenis]})`;
}

function ProduksiStokCard({ jenis, row, onSaved }: { jenis: JenisBarang; row: StokBahanBakuRow; onSaved: () => void }) {
  const [dipakai, setDipakai] = useState(String(row.stokDipakaiProduksi));
  const [rusak, setRusak] = useState(String(row.stokRusakProduksi));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await upsertProduksiStokAction({
        tanggalUsaha: row.tanggalUsaha,
        shift: row.shift,
        jenisBarang: jenis,
        stokDipakaiProduksi: Number(dipakai) || 0,
        stokRusakProduksi: Number(rusak) || 0,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">{JENIS_BARANG_LABEL[jenis]}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="rounded-md border bg-muted/30 p-2 text-xs">
          <p className="text-muted-foreground">Masuk Inventori Operasional (shift ini)</p>
          <p className="font-medium">{row.operasionalAkunId ? formatQty(row.stokMasukInventoriOperasional, jenis) : "Belum diisi Staf Operasional"}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`dipakai-${jenis}`}>Dipakai</Label>
          <Input id={`dipakai-${jenis}`} type="number" min={0} value={dipakai} onChange={(e) => setDipakai(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`rusak-${jenis}`}>Rusak</Label>
          <Input id={`rusak-${jenis}`} type="number" min={0} value={rusak} onChange={(e) => setRusak(e.target.value)} />
        </div>
        <div className="rounded-md border bg-muted/30 p-2 text-xs">
          <p className="text-muted-foreground">Sisa Inventori Operasional</p>
          <p className="font-medium">{formatQty(row.sisaInventoriAkhir, jenis)}</p>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button size="sm" className="w-fit" disabled={pending} onClick={handleSave}>
          {pending ? "Menyimpan..." : "Simpan"}
        </Button>
      </CardContent>
    </Card>
  );
}

export function BahanBakuView({
  current,
  rows,
  onAfterSimpan,
}: {
  current: CurrentShiftInfo;
  rows: StokBahanBakuRow[];
  onAfterSimpan: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold text-muted-foreground">
        {current.tanggalUsaha} — {current.shiftLabel}
      </h2>
      <div className="flex flex-col gap-4">
        {rows.map((row) => (
          <ProduksiStokCard key={row.jenisBarang} jenis={row.jenisBarang} row={row} onSaved={onAfterSimpan} />
        ))}
      </div>
    </div>
  );
}
