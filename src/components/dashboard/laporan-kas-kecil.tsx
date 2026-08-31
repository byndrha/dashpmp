"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import {
  upsertKasMasukAction,
  tambahPengeluaranAction,
  hapusPengeluaranAction,
  setSaldoAwalKasKecilAction,
} from "@/app/mkesindo/(dashboard)/laporan/actions";
import type { KasKecilShiftRow, CurrentShiftKasKecilInfo } from "@/lib/queries/kas-kecil";

function formatRupiah(n: number): string {
  return `Rp${n.toLocaleString("id-ID")}`;
}

function PengeluaranList({ row, canEdit, onChanged }: { row: KasKecilShiftRow; canEdit: boolean; onChanged: () => void }) {
  const [keterangan, setKeterangan] = useState("");
  const [nominal, setNominal] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleTambah() {
    if (!keterangan.trim()) {
      setError("Keterangan tidak boleh kosong.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await tambahPengeluaranAction(row.tanggalUsaha, row.shift, keterangan.trim(), Number(nominal) || 0);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setKeterangan("");
      setNominal("");
      onChanged();
    });
  }

  function handleHapus(pengeluaranId: number) {
    if (!confirm("Hapus rincian pengeluaran ini?")) return;
    startTransition(async () => {
      const result = await hapusPengeluaranAction(pengeluaranId);
      if (result.success) onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {row.pengeluaran.map((p) => (
        <div key={p.pengeluaranId} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm">
          <span className="flex-1">{p.keterangan}</span>
          <span className="tabular-nums font-medium">{formatRupiah(p.nominal)}</span>
          {canEdit && (
            <button
              type="button"
              onClick={() => handleHapus(p.pengeluaranId)}
              disabled={pending}
              className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      ))}
      {row.pengeluaran.length === 0 && <p className="text-xs text-muted-foreground">Belum ada pengeluaran.</p>}
      {canEdit && (
        <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border p-2">
          <Input placeholder="Keterangan" value={keterangan} onChange={(e) => setKeterangan(e.target.value)} disabled={pending} />
          <div className="flex gap-1.5">
            <Input type="number" min={0} placeholder="Nominal" value={nominal} onChange={(e) => setNominal(e.target.value)} disabled={pending} />
            <Button size="sm" disabled={pending} onClick={handleTambah}>
              <Plus className="size-4" /> Tambah
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}

function KasKecilCard({ row, canEdit, onChanged }: { row: KasKecilShiftRow; canEdit: boolean; onChanged: () => void }) {
  const [kasMasuk, setKasMasuk] = useState(String(row.kasMasuk));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKasMasuk(String(row.kasMasuk));
  }, [row.kasMasuk]);

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await upsertKasMasukAction(row.tanggalUsaha, row.shift, Number(kasMasuk) || 0);
      if (!result.success) {
        setError(result.error);
        return;
      }
      onChanged();
    });
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Kas Kecil</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-2 text-xs">
          <div>
            <p className="text-muted-foreground">Total Pengeluaran</p>
            <p className="font-medium">{formatRupiah(row.totalPengeluaran)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Saldo Akhir</p>
            <p className="font-medium">{formatRupiah(row.saldoAkhir)}</p>
          </div>
        </div>
        {canEdit ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`kas-masuk-${row.tanggalUsaha}-${row.shift}`}>Kas Masuk (Top-up shift ini)</Label>
            <div className="flex gap-1.5">
              <Input
                id={`kas-masuk-${row.tanggalUsaha}-${row.shift}`}
                type="number"
                min={0}
                value={kasMasuk}
                onChange={(e) => setKasMasuk(e.target.value)}
              />
              <Button size="sm" disabled={pending} onClick={handleSave}>
                {pending ? "Menyimpan..." : "Simpan"}
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        ) : (
          <div>
            <p className="text-xs text-muted-foreground">Kas Masuk</p>
            <p className="font-medium">{formatRupiah(row.kasMasuk)}</p>
          </div>
        )}
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Rincian Pengeluaran</p>
          <PengeluaranList row={row} canEdit={canEdit} onChanged={onChanged} />
        </div>
      </CardContent>
    </Card>
  );
}

function SaldoAwalDialogInline({ saldoAwal, onSaved }: { saldoAwal: number; onSaved: () => void }) {
  const [value, setValue] = useState(String(saldoAwal));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await setSaldoAwalKasKecilAction(Number(value) || 0);
      if (!result.success) {
        setError(result.error);
        return;
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
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Saldo Awal</Label>
          <Input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
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

export function LaporanKasKecil({
  canEdit,
  canEditSaldoAwal,
  current,
  initialRow,
  initialHistory,
  initialSaldoAwal,
  namaMap,
}: {
  canEdit: boolean;
  canEditSaldoAwal: boolean;
  current: CurrentShiftKasKecilInfo;
  initialRow: KasKecilShiftRow;
  initialHistory: KasKecilShiftRow[];
  initialSaldoAwal: number;
  namaMap: Record<number, string>;
}) {
  const router = useRouter();
  // Keyed by tanggalUsaha+shift, not the row object itself -- so after a
  // save triggers router.refresh(), the dialog derives fresh data from the
  // updated initialHistory prop instead of freezing on a stale snapshot
  // captured at click time (same pattern used for Tim Produksi's
  // peta-warehouse-desktop.tsx selectedPosisiId, this session's other plan).
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const editingRow = editingKey ? (initialHistory.find((r) => `${r.tanggalUsaha}-${r.shift}` === editingKey) ?? null) : null;

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
        <div className="grid grid-cols-1 gap-4 sm:max-w-md">
          <KasKecilCard row={initialRow} canEdit={canEdit} onChanged={handleChanged} />
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
                <TableHead className="text-right">Kas Masuk</TableHead>
                <TableHead className="text-right">Total Pengeluaran</TableHead>
                <TableHead>Rincian</TableHead>
                <TableHead className="text-right">Saldo Akhir</TableHead>
                <TableHead>Diisi Oleh</TableHead>
                {canEdit && <TableHead className="text-right">Aksi</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialHistory.map((r) => (
                <TableRow key={`${r.tanggalUsaha}-${r.shift}`}>
                  <TableCell>{formatDate(r.tanggalUsaha)}</TableCell>
                  <TableCell>Shift {r.shift}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRupiah(r.kasMasuk)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRupiah(r.totalPengeluaran)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.pengeluaran.length > 0 ? r.pengeluaran.map((p) => `${p.keterangan}: ${formatRupiah(p.nominal)}`).join(", ") : "-"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatRupiah(r.saldoAkhir)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.diisiOlehAkunId ? (namaMap[r.diisiOlehAkunId] ?? "?") : "Belum diisi"}</TableCell>
                  {canEdit && (
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setEditingKey(`${r.tanggalUsaha}-${r.shift}`)}>
                        Ubah
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {initialHistory.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canEdit ? 8 : 7} className="text-center text-muted-foreground py-8">
                    Belum ada data.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog
        open={editingRow != null}
        onOpenChange={(open) => {
          if (!open) setEditingKey(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Ubah Riwayat</DialogTitle>
          </DialogHeader>
          {editingRow && (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border bg-muted/30 p-3 text-xs">
                <p className="text-muted-foreground">
                  {formatDate(editingRow.tanggalUsaha)} — Shift {editingRow.shift}
                </p>
              </div>
              <KasKecilCard row={editingRow} canEdit={canEdit} onChanged={handleChanged} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
