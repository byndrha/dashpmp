"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
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

// Edits a single past Riwayat row's Produksi-owned fields
// (stokDipakaiProduksi/stokRusakProduksi) only — the Operasional-owned
// fields (Masuk Gudang/Masuk Inventori) stay read-only here, exactly like
// they're read-only on ProduksiStokCard above. Same upsertProduksiStok MERGE
// keying as the current-shift form, just targeting the row's own
// tanggalUsaha/shift instead of always "today".
function UbahRiwayatProduksiDialog({
  row,
  onOpenChange,
  onSaved,
}: {
  row: StokBahanBakuRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [dipakai, setDipakai] = useState("");
  const [rusak, setRusak] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Identifies which row is CURRENTLY showing, resynced (in an effect, not
  // during render) whenever the `row` prop changes, so a stale response
  // can't paint over whichever row is now open (same guard as the
  // dashboard's UbahRiwayatDialog).
  const rowKeyRef = useRef<string | null>(null);

  useEffect(() => {
    rowKeyRef.current = row ? `${row.tanggalUsaha}-${row.shift}-${row.jenisBarang}` : null;
    if (!row) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDipakai(String(row.stokDipakaiProduksi));
    setRusak(String(row.stokRusakProduksi));
    setError(null);
  }, [row]);

  function handleSave() {
    if (!row) return;
    const rowKey = `${row.tanggalUsaha}-${row.shift}-${row.jenisBarang}`;
    setError(null);
    startTransition(async () => {
      const result = await upsertProduksiStokAction({
        tanggalUsaha: row.tanggalUsaha,
        shift: row.shift,
        jenisBarang: row.jenisBarang,
        stokDipakaiProduksi: Number(dipakai) || 0,
        stokRusakProduksi: Number(rusak) || 0,
      });
      if (rowKeyRef.current !== rowKey) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      onSaved();
    });
  }

  return (
    <Dialog open={row != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Ubah Riwayat</DialogTitle>
        </DialogHeader>

        {row && (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border bg-muted/30 p-3 text-xs">
              <p className="font-medium">{JENIS_BARANG_LABEL[row.jenisBarang]}</p>
              <p className="text-muted-foreground">
                {formatDate(row.tanggalUsaha)} — Shift {row.shift}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ubah-riwayat-produksi-dipakai">Dipakai</Label>
              <Input id="ubah-riwayat-produksi-dipakai" type="number" min={0} value={dipakai} onChange={(e) => setDipakai(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ubah-riwayat-produksi-rusak">Rusak</Label>
              <Input id="ubah-riwayat-produksi-rusak" type="number" min={0} value={rusak} onChange={(e) => setRusak(e.target.value)} />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          <Button disabled={!row || pending} onClick={handleSave}>
            {pending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Compact card-per-row layout for Riwayat — mobile-first, consistent with
// how the rest of produksi-app renders lists (see KualitasCard). "Ubah" is
// always visible: this whole tab is already gated to Staf Produksi via
// requireProduksi()/requireProduksiView(), there's no separate view-vs-edit
// split on this side.
function RiwayatCard({ row, onUbah }: { row: StokBahanBakuRow; onUbah: () => void }) {
  return (
    <div className="rounded-lg border p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{JENIS_BARANG_LABEL[row.jenisBarang]}</p>
          <p className="text-xs text-muted-foreground">
            {formatDate(row.tanggalUsaha)} — Shift {row.shift}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onUbah}>
          Ubah
        </Button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-muted-foreground">Dipakai</p>
          <p className="font-medium">{row.stokDipakaiProduksi.toLocaleString("id-ID")}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Rusak</p>
          <p className="font-medium">{row.stokRusakProduksi.toLocaleString("id-ID")}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Sisa Inventori</p>
          <p className="font-medium">{formatQty(row.sisaInventoriAkhir, row.jenisBarang)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Sisa Gudang</p>
          <p className="font-medium">{formatQty(row.sisaGudangAkhir, row.jenisBarang)}</p>
        </div>
      </div>
    </div>
  );
}

export function BahanBakuView({
  current,
  rows,
  history,
  onAfterSimpan,
}: {
  current: CurrentShiftInfo;
  rows: StokBahanBakuRow[];
  history: StokBahanBakuRow[];
  onAfterSimpan: () => void;
}) {
  const [editingRow, setEditingRow] = useState<StokBahanBakuRow | null>(null);

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

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Riwayat</h2>
        {history.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Belum ada data.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {history.map((row) => (
              <RiwayatCard
                key={`${row.tanggalUsaha}-${row.shift}-${row.jenisBarang}`}
                row={row}
                onUbah={() => setEditingRow(row)}
              />
            ))}
          </div>
        )}
      </div>

      <UbahRiwayatProduksiDialog
        row={editingRow}
        onOpenChange={(open) => {
          if (!open) setEditingRow(null);
        }}
        onSaved={onAfterSimpan}
      />
    </div>
  );
}
