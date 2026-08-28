"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Target, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Pagination } from "@/components/dashboard/pagination";
import { ExportXlsxButton } from "@/components/dashboard/export-xlsx-button";
import { formatRupiah, formatDate, formatDateWib, formatQty, formatDays, formatPercentPoints } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { XlsxColumn } from "@/lib/export-xlsx";
import type { CollectionPriorityRow } from "@/lib/queries/collection-priority";
import type { PiutangStatus } from "@/lib/queries/aging";
import { saveCollectionTargetAction, removeCollectionTargetAction } from "@/app/mkesindo/(dashboard)/aging/actions";

const PAGE_SIZE = 9;

// Full CollectionPriorityRow field set. rows is already the complete,
// unfiltered set — the headline/rest split below is a display-priority
// concern (every row shows up somewhere, either in headline or across
// rest's pages), not a user filter, so nothing needs to be honored/ignored
// here the way Kartu Transaksi's own search filter does.
const EXPORT_COLUMNS: XlsxColumn[] = [
  { header: "ID Mitra", key: "businessPartnerId", type: "text", width: 12 },
  { header: "Mitra", key: "customerName", width: 26 },
  { header: "Tipe", key: "partnerType", width: 12 },
  { header: "Wilayah", key: "wilayah", width: 16 },
  { header: "Kecamatan", key: "kecamatan", width: 16 },
  { header: "Piutang Awal", key: "piutangAwal", type: "number", width: 14 },
  { header: "Piutang Berjalan", key: "piutangBerjalan", type: "number", width: 14 },
  { header: "Hari Terlambat Maks", key: "maxDaysOverdue", type: "number", width: 14 },
  { header: "Target Nominal", key: "targetAmount", type: "number", width: 14 },
  { header: "Target Tanggal", key: "targetDate", type: "text", width: 14 },
  { header: "Catatan Target", key: "targetNote", width: 24 },
  { header: "Rata-rata Qty/Hari", key: "avgQtyPerOrderDay", type: "number", width: 14 },
  { header: "Terakhir Pesan", key: "terakhirPesan", type: "text", width: 14 },
  { header: "Terakhir Bayar", key: "terakhirBayar", type: "text", width: 14 },
  { header: "Omzet", key: "omzet", type: "number", width: 14 },
  { header: "Status", key: "status", type: "text", width: 12 },
  { header: "Tren", key: "tren", type: "text", width: 10 },
  { header: "Rotasi (Hari)", key: "rotasi", type: "number", width: 12 },
  { header: "Target Aktif", key: "isTarget", type: "text", width: 12 },
];

const STATUS_BADGE: Record<PiutangStatus, string> = {
  Sehat: "bg-primary/15 text-primary",
  Perhatian: "bg-warning/15 text-warning",
  Kritis: "bg-destructive/15 text-destructive",
};

function progress(row: CollectionPriorityRow): number | null {
  if (row.TargetAmount == null || row.PiutangAwal <= row.TargetAmount) return null;
  const pct = ((row.PiutangAwal - row.PiutangBerjalan) / (row.PiutangAwal - row.TargetAmount)) * 100;
  return Math.max(0, Math.min(100, pct));
}

function ratio(row: CollectionPriorityRow): number | null {
  if (!row.Omzet) return null;
  return (row.PiutangBerjalan / row.Omzet) * 100;
}

function TrenIcon({ tren }: { tren: CollectionPriorityRow["Tren"] }) {
  if (tren === "Naik") return <TrendingUp className="size-3.5 text-primary" />;
  if (tren === "Turun") return <TrendingDown className="size-3.5 text-destructive" />;
  return <Minus className="size-3.5 text-muted-foreground" />;
}

function PriorityCard({ row, onEdit }: { row: CollectionPriorityRow; onEdit: (row: CollectionPriorityRow) => void }) {
  const prog = progress(row);
  const rat = ratio(row);

  return (
    <Card className="py-3">
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{row.CustomerName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.PartnerType} &middot; {row.Wilayah}
              {row.Kecamatan ? ` · ${row.Kecamatan}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={cn("rounded px-2 py-0.5 text-[11px] font-medium", STATUS_BADGE[row.Status])}>
              {row.Status}
            </span>
            <Button variant="ghost" size="icon" className="size-7" onClick={() => onEdit(row)}>
              <Target className="size-3.5" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 border-t pt-2 text-xs sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">Piutang Awal</p>
            <p className="tabular-nums font-medium">{formatRupiah(row.PiutangAwal)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Piutang Berjalan</p>
            <p className="tabular-nums font-medium text-warning">{formatRupiah(row.PiutangBerjalan)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Rasio</p>
            <p className="tabular-nums font-medium">{rat != null ? formatPercentPoints(rat) : "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Omzet</p>
            <p className="tabular-nums font-medium">{formatRupiah(row.Omzet)}</p>
          </div>
        </div>

        {row.TargetAmount != null && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              Target {formatRupiah(row.TargetAmount)}
              {row.TargetDate ? ` · ${formatDate(row.TargetDate)}` : ""}
            </span>
            {prog != null && (
              <div className="flex flex-1 items-center gap-1.5">
                <div className="h-1.5 flex-1 rounded-full bg-secondary">
                  <div className="h-1.5 rounded-full bg-primary" style={{ width: `${prog}%` }} />
                </div>
                <span className="tabular-nums text-muted-foreground">{prog.toFixed(0)}%</span>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t pt-2 text-[11px] text-muted-foreground">
          <span>Rata² Pesan {formatQty(row.AvgQtyPerOrderDay)}</span>
          <span>Terakhir Pesan {row.TerakhirPesan ? formatDateWib(row.TerakhirPesan) : "-"}</span>
          <span>Terakhir Bayar {row.TerakhirBayar ? formatDateWib(row.TerakhirBayar) : "-"}</span>
          <span>Rotasi {formatDays(row.Rotasi)}</span>
          <span className="inline-flex items-center gap-1">
            Tren <TrenIcon tren={row.Tren} />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export function CollectionPriorityTable({ rows }: { rows: CollectionPriorityRow[] }) {
  const [editing, setEditing] = useState<CollectionPriorityRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Tracks which row's dialog is currently open, read fresh (not via a
  // closed-over `editing` reference) inside the async handlers below — a
  // save/remove request in flight for row A whose dialog got dismissed (or
  // replaced by row B's dialog) before the response arrives must not paint
  // A's stale error over B's now-open dialog. Kept in a ref rather than
  // state because it's read for a same-tick comparison after an await, not
  // rendered.
  const editingIdRef = useRef<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [page, setPage] = useState(1);

  const headline = useMemo(() => {
    const targeted = rows.filter((r) => r.IsTarget);
    const others = rows
      .filter((r) => !r.IsTarget && (r.Status === "Kritis" || r.Status === "Perhatian"))
      .slice(0, 5);
    return [...targeted, ...others].sort((a, b) => b.PiutangBerjalan - a.PiutangBerjalan);
  }, [rows]);

  const headlineIds = useMemo(() => new Set(headline.map((r) => r.BusinessPartnerID)), [headline]);
  const rest = useMemo(() => rows.filter((r) => !headlineIds.has(r.BusinessPartnerID)), [rows, headlineIds]);

  const exportRows = useMemo(
    () =>
      rows.map((r) => ({
        businessPartnerId: r.BusinessPartnerID,
        customerName: r.CustomerName,
        partnerType: r.PartnerType,
        wilayah: r.Wilayah,
        kecamatan: r.Kecamatan ?? "",
        piutangAwal: r.PiutangAwal,
        piutangBerjalan: r.PiutangBerjalan,
        maxDaysOverdue: r.MaxDaysOverdue,
        targetAmount: r.TargetAmount,
        targetDate: r.TargetDate ? formatDate(r.TargetDate) : "",
        targetNote: r.TargetNote ?? "",
        avgQtyPerOrderDay: r.AvgQtyPerOrderDay,
        terakhirPesan: r.TerakhirPesan ? formatDateWib(r.TerakhirPesan) : "",
        terakhirBayar: r.TerakhirBayar ? formatDateWib(r.TerakhirBayar) : "",
        omzet: r.Omzet,
        status: r.Status,
        tren: r.Tren,
        rotasi: r.Rotasi,
        isTarget: r.IsTarget ? "Ya" : "Tidak",
      })),
    [rows]
  );

  const [prevRows, setPrevRows] = useState(rows);
  if (rows !== prevRows) {
    setPrevRows(rows);
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(rest.length / PAGE_SIZE));
  const pageRows = rest.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function openEditor(row: CollectionPriorityRow) {
    editingIdRef.current = row.BusinessPartnerID;
    setError(null);
    setEditing(row);
  }

  function closeEditor() {
    editingIdRef.current = null;
    setEditing(null);
    setError(null);
  }

  function handleSubmit(formData: FormData) {
    if (!editing) return;
    const targetId = editing.BusinessPartnerID;
    const targetDate = formData.get("targetDate") as string;
    const targetAmount = formData.get("targetAmount") as string;
    const note = formData.get("note") as string;

    setError(null);
    startTransition(async () => {
      const result = await saveCollectionTargetAction({
        businessPartnerId: targetId,
        targetDate: targetDate || null,
        targetAmount: targetAmount ? Number(targetAmount) : null,
        note: note || null,
      });
      // The dialog may have moved on to a different row (or closed) while
      // this request was in flight — only touch state if it's still showing
      // the row this request was actually for.
      if (editingIdRef.current !== targetId) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
      closeEditor();
    });
  }

  function handleRemove() {
    if (!editing) return;
    const targetId = editing.BusinessPartnerID;
    setError(null);
    startTransition(async () => {
      const result = await removeCollectionTargetAction(targetId);
      if (editingIdRef.current !== targetId) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
      closeEditor();
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="font-display">Prioritas Pemulihan Mitra</CardTitle>
          <CardDescription>
            Target dari manajemen, ditambah mitra dengan piutang terbesar berstatus Perhatian/Kritis.
          </CardDescription>
        </div>
        <ExportXlsxButton
          filename="prioritas-pemulihan"
          sheetName="Prioritas Pemulihan"
          columns={EXPORT_COLUMNS}
          rows={exportRows}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {headline.map((r) => (
            <PriorityCard key={r.BusinessPartnerID} row={r} onEdit={openEditor} />
          ))}
          {headline.length === 0 && (
            <p className="col-span-full py-4 text-center text-sm text-muted-foreground">
              Tidak ada piutang yang perlu diprioritaskan.
            </p>
          )}
        </div>

        {rest.length > 0 && (
          <>
            <p className="text-xs font-medium text-muted-foreground">Mitra lainnya dengan piutang berjalan</p>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {pageRows.map((r) => (
                <PriorityCard key={r.BusinessPartnerID} row={r} onEdit={openEditor} />
              ))}
            </div>
            <Pagination page={page} pageCount={pageCount} onChange={setPage} />
          </>
        )}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Target Pelunasan &mdash; {editing?.CustomerName}</DialogTitle>
            <DialogDescription>
              Tandai mitra ini sebagai target pemulihan piutang dari manajemen.
            </DialogDescription>
          </DialogHeader>
          <form action={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="targetDate">Tanggal Target Lunas</Label>
              <Input
                id="targetDate"
                name="targetDate"
                type="date"
                defaultValue={editing?.TargetDate ? new Date(editing.TargetDate).toISOString().slice(0, 10) : ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="targetAmount">Nominal Target (Rp)</Label>
              <Input
                id="targetAmount"
                name="targetAmount"
                type="number"
                min={0}
                defaultValue={editing?.TargetAmount ?? ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="note">Catatan</Label>
              <Input id="note" name="note" defaultValue={editing?.TargetNote ?? ""} />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <DialogFooter className="gap-2 sm:justify-between">
              {editing?.IsTarget && (
                <Button type="button" variant="destructive" onClick={handleRemove} disabled={pending}>
                  Hapus Target
                </Button>
              )}
              <Button type="submit" disabled={pending} className="ml-auto">
                {pending ? "Menyimpan..." : "Simpan Target"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
