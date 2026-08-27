"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import { upsertOperasionalStokAction, setSaldoAwalAction } from "@/app/mkesindo/(dashboard)/laporan/actions";
import type {
  StokBahanBakuRow,
  CurrentShiftInfo,
  SaldoAwalRow,
} from "@/lib/queries/stok-bahan-baku";
// Imported from the client-safe shared module, not "@/lib/queries/stok-bahan-baku"
// — that module also imports "@/lib/db" (mssql), and since ES module
// bundling pulls in a file's entire non-type import graph, a "use client"
// component importing even a single runtime value from it would drag
// mssql/pg (and their Node-only dependencies: net/tls/dns/fs/dgram) into
// the browser bundle. See stok-bahan-baku-shared.ts's header comment.
import {
  JENIS_BARANG_LIST,
  JENIS_BARANG_LABEL,
  JENIS_BARANG_UNIT_BUNDLE,
  toBundle,
  type JenisBarang,
} from "@/lib/stok-bahan-baku-shared";

function formatQty(n: number, jenis: JenisBarang): string {
  return `${n.toLocaleString("id-ID")} lembar (${toBundle(n)} ${JENIS_BARANG_UNIT_BUNDLE[jenis]})`;
}

function StokInputCard({
  jenis,
  row,
  canEdit,
  onSaved,
}: {
  jenis: JenisBarang;
  row: StokBahanBakuRow;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [masukGudang, setMasukGudang] = useState(String(row.stokMasukGudang));
  const [masukInventori, setMasukInventori] = useState(String(row.stokMasukInventoriOperasional));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await upsertOperasionalStokAction({
        tanggalUsaha: row.tanggalUsaha,
        shift: row.shift,
        jenisBarang: jenis,
        stokMasukGudang: Number(masukGudang) || 0,
        stokMasukInventoriOperasional: Number(masukInventori) || 0,
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
        <CardTitle className="font-display text-sm">{JENIS_BARANG_LABEL[jenis]}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-2 text-xs">
          <div>
            <p className="text-muted-foreground">Sisa Gudang</p>
            <p className="font-medium">{formatQty(row.sisaGudangAkhir, jenis)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Sisa Inventori Operasional</p>
            <p className="font-medium">{formatQty(row.sisaInventoriAkhir, jenis)}</p>
          </div>
        </div>
        {canEdit ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`masuk-gudang-${jenis}`}>Masuk Gudang (shift ini)</Label>
              <Input id={`masuk-gudang-${jenis}`} type="number" min={0} value={masukGudang} onChange={(e) => setMasukGudang(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`masuk-inventori-${jenis}`}>Masuk Inventori Operasional (shift ini)</Label>
              <Input id={`masuk-inventori-${jenis}`} type="number" min={0} value={masukInventori} onChange={(e) => setMasukInventori(e.target.value)} />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button size="sm" className="w-fit" disabled={pending} onClick={handleSave}>
              {pending ? "Menyimpan..." : "Simpan"}
            </Button>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-muted-foreground">Masuk Gudang</p>
              <p className="font-medium">{row.stokMasukGudang.toLocaleString("id-ID")}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Masuk Inventori Operasional</p>
              <p className="font-medium">{row.stokMasukInventoriOperasional.toLocaleString("id-ID")}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SaldoAwalDialogInline({ saldoAwal, onSaved }: { saldoAwal: SaldoAwalRow[]; onSaved: () => void }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(saldoAwal.map((s) => [s.jenisBarang, { gudang: String(s.saldoAwalGudang), inventori: String(s.saldoAwalInventoriOperasional) }]))
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function handleSave() {
    setError(null);
    startTransition(async () => {
      for (const jenis of JENIS_BARANG_LIST) {
        const v = values[jenis];
        const result = await setSaldoAwalAction(jenis, Number(v.gudang) || 0, Number(v.inventori) || 0);
        if (!result.success) {
          setError(result.error);
          return;
        }
      }
      setOpen(false);
      onSaved();
    });
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="w-fit" onClick={() => setOpen(true)}>
        Atur Saldo Awal
      </Button>
    );
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Saldo Awal (titik nol perhitungan)</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {JENIS_BARANG_LIST.map((jenis) => (
          <div key={jenis} className="grid grid-cols-3 items-end gap-2">
            <p className="text-xs text-muted-foreground">{JENIS_BARANG_LABEL[jenis]}</p>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Saldo Gudang</Label>
              <Input
                type="number"
                min={0}
                value={values[jenis].gudang}
                onChange={(e) => setValues((prev) => ({ ...prev, [jenis]: { ...prev[jenis], gudang: e.target.value } }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Saldo Inventori Operasional</Label>
              <Input
                type="number"
                min={0}
                value={values[jenis].inventori}
                onChange={(e) => setValues((prev) => ({ ...prev, [jenis]: { ...prev[jenis], inventori: e.target.value } }))}
              />
            </div>
          </div>
        ))}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button size="sm" disabled={pending} onClick={handleSave}>
            {pending ? "Menyimpan..." : "Simpan Saldo Awal"}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
            Batal
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// Edits a single past Riwayat row's Operasional-owned fields
// (stokMasukGudang/stokMasukInventoriOperasional) — same upsert action and
// fields as StokInputCard's current-shift form, just targeting that row's
// own tanggalUsaha/shift instead of always "today". The MERGE in
// upsertOperasionalStok keys on (TanggalUsaha, Shift, JenisBarang), so this
// correctly updates the historical row rather than creating a new one, and
// every later shift's displayed running balance recomputes automatically
// on the next read since balances are never stored (see getStokBahanBakuHistory).
function UbahRiwayatDialog({
  row,
  onOpenChange,
  onSaved,
}: {
  row: StokBahanBakuRow | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [masukGudang, setMasukGudang] = useState("");
  const [masukInventori, setMasukInventori] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Identifies which row is CURRENTLY showing, resynced (in an effect, not
  // during render) whenever the `row` prop changes — a stale-response guard
  // similar to UbahTanggalPemesananDialog's targetIdRef.
  const rowKeyRef = useRef<string | null>(null);

  useEffect(() => {
    rowKeyRef.current = row ? `${row.tanggalUsaha}-${row.shift}-${row.jenisBarang}` : null;
    if (!row) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMasukGudang(String(row.stokMasukGudang));
    setMasukInventori(String(row.stokMasukInventoriOperasional));
    setError(null);
  }, [row]);

  function handleSave() {
    if (!row) return;
    const rowKey = `${row.tanggalUsaha}-${row.shift}-${row.jenisBarang}`;
    setError(null);
    startTransition(async () => {
      const result = await upsertOperasionalStokAction({
        tanggalUsaha: row.tanggalUsaha,
        shift: row.shift,
        jenisBarang: row.jenisBarang,
        stokMasukGudang: Number(masukGudang) || 0,
        stokMasukInventoriOperasional: Number(masukInventori) || 0,
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
              <Label htmlFor="ubah-riwayat-masuk-gudang">Masuk Gudang</Label>
              <Input
                id="ubah-riwayat-masuk-gudang"
                type="number"
                min={0}
                value={masukGudang}
                onChange={(e) => setMasukGudang(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ubah-riwayat-masuk-inventori">Masuk Inventori Operasional</Label>
              <Input
                id="ubah-riwayat-masuk-inventori"
                type="number"
                min={0}
                value={masukInventori}
                onChange={(e) => setMasukInventori(e.target.value)}
              />
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

export function LaporanStokBahanBaku({
  canEdit,
  canEditSaldoAwal,
  current,
  initialCurrentRows,
  initialHistory,
  initialSaldoAwal,
  namaMap,
}: {
  canEdit: boolean;
  canEditSaldoAwal: boolean;
  current: CurrentShiftInfo;
  initialCurrentRows: StokBahanBakuRow[];
  initialHistory: StokBahanBakuRow[];
  initialSaldoAwal: SaldoAwalRow[];
  namaMap: Record<number, string>;
}) {
  const router = useRouter();
  const [editingRow, setEditingRow] = useState<StokBahanBakuRow | null>(null);
  // Any save (operasional input or saldo awal) changes running balances for
  // this AND every later shift (see Global Constraints — balances are
  // computed at read time), so a full server refetch via router.refresh()
  // is the correct response, not a local patch.
  function handleChanged() {
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Shift Berjalan — Tanggal Usaha {formatDate(current.tanggalUsaha)}, {current.shiftLabel}
          </h2>
          {canEditSaldoAwal && <SaldoAwalDialogInline saldoAwal={initialSaldoAwal} onSaved={handleChanged} />}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {initialCurrentRows.map((row) => (
            <StokInputCard key={row.jenisBarang} jenis={row.jenisBarang} row={row} canEdit={canEdit} onSaved={handleChanged} />
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Riwayat</h2>
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal Usaha</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Barang</TableHead>
                <TableHead className="text-right">Masuk Gudang</TableHead>
                <TableHead className="text-right">Masuk Inventori</TableHead>
                <TableHead className="text-right">Dipakai</TableHead>
                <TableHead className="text-right">Rusak</TableHead>
                <TableHead className="text-right">Sisa Gudang</TableHead>
                <TableHead className="text-right">Sisa Inventori</TableHead>
                <TableHead>Diisi Operasional</TableHead>
                <TableHead>Diisi Produksi</TableHead>
                {canEdit && <TableHead className="text-right">Aksi</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialHistory.map((r) => (
                <TableRow key={`${r.tanggalUsaha}-${r.shift}-${r.jenisBarang}`}>
                  <TableCell>{formatDate(r.tanggalUsaha)}</TableCell>
                  <TableCell>Shift {r.shift}</TableCell>
                  <TableCell>{JENIS_BARANG_LABEL[r.jenisBarang]}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.stokMasukGudang.toLocaleString("id-ID")}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.stokMasukInventoriOperasional.toLocaleString("id-ID")}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.stokDipakaiProduksi.toLocaleString("id-ID")}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.stokRusakProduksi.toLocaleString("id-ID")}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(r.sisaGudangAkhir, r.jenisBarang)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(r.sisaInventoriAkhir, r.jenisBarang)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.operasionalAkunId ? (namaMap[r.operasionalAkunId] ?? "?") : "Belum diisi"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.produksiAkunId ? (namaMap[r.produksiAkunId] ?? "?") : "Belum diisi"}</TableCell>
                  {canEdit && (
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setEditingRow(r)}>
                        Ubah
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {initialHistory.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canEdit ? 12 : 11} className="text-center text-muted-foreground py-8">
                    Belum ada data.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <UbahRiwayatDialog
        row={editingRow}
        onOpenChange={(open) => {
          if (!open) setEditingRow(null);
        }}
        onSaved={handleChanged}
      />
    </div>
  );
}
