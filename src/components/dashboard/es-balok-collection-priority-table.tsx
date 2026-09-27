"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Target } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/dashboard/pagination";
import { ExportXlsxButton } from "@/components/dashboard/export-xlsx-button";
import { formatRupiah, formatDate, formatDateWib, formatDays } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SEGMENTASI_OPTIONS, type Segmentasi } from "@/lib/segmentasi-mitra";
import type { XlsxColumn } from "@/lib/export-xlsx";
import type { EsBalokPriorityRow } from "@/lib/queries/piutang-priority-es-balok";
import type { EsBalokPiutangStatus } from "@/lib/queries/piutang-invoice-outstanding";

const PAGE_SIZE = 9;

// EsBalokPriorityRow's full field set. rows is already the complete,
// unfiltered set -- the headline/rest split below is a display-priority
// concern (every row shows up somewhere, either in headline or across
// rest's pages), not a user filter, so nothing needs to be honored/ignored
// here the way Kartu Transaksi's own search filter does.
const EXPORT_COLUMNS: XlsxColumn[] = [
  { header: "Agen", key: "agenNama", width: 26 },
  { header: "Segmentasi", key: "segmentasi", width: 16 },
  { header: "Piutang Berjalan", key: "piutangBerjalan", type: "number", width: 14 },
  { header: "Hari Terlambat Maks", key: "maxDaysOverdue", type: "number", width: 14 },
  { header: "Target Nominal", key: "targetAmount", type: "number", width: 14 },
  { header: "Target Tanggal", key: "targetDate", type: "text", width: 14 },
  { header: "Catatan Target", key: "targetNote", width: 24 },
  { header: "Status", key: "status", type: "text", width: 12 },
  { header: "Target Aktif", key: "isTarget", type: "text", width: 12 },
];

const STATUS_BADGE: Record<EsBalokPiutangStatus, string> = {
  Sehat: "bg-primary/15 text-primary",
  Perhatian: "bg-warning/15 text-warning",
  Kritis: "bg-destructive/15 text-destructive",
};

function segmentasiLabel(value: Segmentasi | null): string | null {
  if (!value) return null;
  return SEGMENTASI_OPTIONS.find((s) => s.value === value)?.label ?? null;
}

function PriorityCard({
  row,
  onEdit,
}: {
  row: EsBalokPriorityRow;
  onEdit: (row: EsBalokPriorityRow) => void;
}) {
  const segLabel = segmentasiLabel(row.segmentasi);

  return (
    <Card className="py-3">
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{row.agenNama}</p>
            <Badge variant={segLabel ? "secondary" : "outline"} className="mt-1 h-5 px-1.5 text-[10px]">
              {segLabel ?? "Belum Ditentukan"}
            </Badge>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={cn("rounded px-2 py-0.5 text-[11px] font-medium", STATUS_BADGE[row.status])}>
              {row.status}
            </span>
            <Button variant="ghost" size="icon" className="size-7" onClick={() => onEdit(row)}>
              <Target className="size-3.5" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 border-t pt-2 text-xs sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground">Piutang Berjalan</p>
            <p className="tabular-nums font-medium text-warning">{formatRupiah(row.piutangBerjalan)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Hari Terlambat Maks</p>
            <p className="tabular-nums font-medium">{formatDays(row.maxDaysOverdue)}</p>
          </div>
        </div>

        {row.targetAmount != null && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              Target {formatRupiah(row.targetAmount)}
              {row.targetDate ? ` · ${formatDate(row.targetDate)}` : ""}
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t pt-2 text-[11px] text-muted-foreground">
          <span>Terakhir Pesan {row.terakhirPesan ? formatDateWib(row.terakhirPesan) : "-"}</span>
          <span>Terakhir Bayar {row.terakhirBayar ? formatDateWib(row.terakhirBayar) : "-"}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export function EsBalokCollectionPriorityTable({
  rows,
  onSetTarget,
  onRemoveTarget,
}: {
  rows: EsBalokPriorityRow[];
  onSetTarget: (
    agenId: string,
    input: { targetDate: string | null; targetAmount: number | null; note: string | null }
  ) => Promise<{ success: true } | { success: false; error: string }>;
  onRemoveTarget: (agenId: string) => Promise<{ success: true } | { success: false; error: string }>;
}) {
  const [editing, setEditing] = useState<EsBalokPriorityRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Tracks which row's dialog is currently open, read fresh (not via a
  // closed-over `editing` reference) inside the async handlers below -- a
  // save/remove request in flight for row A whose dialog got dismissed (or
  // replaced by row B's dialog) before the response arrives must not paint
  // A's stale error over B's now-open dialog. Kept in a ref rather than
  // state because it's read for a same-tick comparison after an await, not
  // rendered.
  const editingIdRef = useRef<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [page, setPage] = useState(1);

  const headline = useMemo(() => {
    const targeted = rows.filter((r) => r.isTarget);
    const others = rows
      .filter((r) => !r.isTarget && (r.status === "Kritis" || r.status === "Perhatian"))
      .slice(0, 5);
    return [...targeted, ...others].sort((a, b) => b.piutangBerjalan - a.piutangBerjalan);
  }, [rows]);

  const headlineIds = useMemo(() => new Set(headline.map((r) => r.agenId)), [headline]);
  const rest = useMemo(() => rows.filter((r) => !headlineIds.has(r.agenId)), [rows, headlineIds]);

  const exportRows = useMemo(
    () =>
      rows.map((r) => ({
        agenNama: r.agenNama,
        segmentasi: segmentasiLabel(r.segmentasi) ?? "",
        piutangBerjalan: r.piutangBerjalan,
        maxDaysOverdue: r.maxDaysOverdue,
        targetAmount: r.targetAmount,
        targetDate: r.targetDate ? formatDate(r.targetDate) : "",
        targetNote: r.targetNote ?? "",
        status: r.status,
        isTarget: r.isTarget ? "Ya" : "Tidak",
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

  function openEditor(row: EsBalokPriorityRow) {
    editingIdRef.current = row.agenId;
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
    const targetId = editing.agenId;
    const targetDate = formData.get("targetDate") as string;
    const targetAmount = formData.get("targetAmount") as string;
    const note = formData.get("note") as string;

    setError(null);
    startTransition(async () => {
      const result = await onSetTarget(targetId, {
        targetDate: targetDate || null,
        targetAmount: targetAmount ? Number(targetAmount) : null,
        note: note || null,
      });
      // The dialog may have moved on to a different row (or closed) while
      // this request was in flight -- only touch state if it's still
      // showing the row this request was actually for.
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
    const targetId = editing.agenId;
    setError(null);
    startTransition(async () => {
      const result = await onRemoveTarget(targetId);
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
          <CardTitle className="font-display">Prioritas Pemulihan Agen</CardTitle>
          <CardDescription>
            Target dari manajemen, ditambah Agen dengan piutang terbesar berstatus Perhatian/Kritis.
          </CardDescription>
        </div>
        <ExportXlsxButton
          filename="prioritas-pemulihan-es-balok"
          sheetName="Prioritas Pemulihan"
          columns={EXPORT_COLUMNS}
          rows={exportRows}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {headline.map((r) => (
            <PriorityCard key={r.agenId} row={r} onEdit={openEditor} />
          ))}
          {headline.length === 0 && (
            <p className="col-span-full py-4 text-center text-sm text-muted-foreground">
              Tidak ada piutang yang perlu diprioritaskan.
            </p>
          )}
        </div>

        {rest.length > 0 && (
          <>
            <p className="text-xs font-medium text-muted-foreground">Agen lainnya dengan piutang berjalan</p>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {pageRows.map((r) => (
                <PriorityCard key={r.agenId} row={r} onEdit={openEditor} />
              ))}
            </div>
            <Pagination page={page} pageCount={pageCount} onChange={setPage} />
          </>
        )}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Target Pelunasan &mdash; {editing?.agenNama}</DialogTitle>
            <DialogDescription>
              Tandai Agen ini sebagai target pemulihan piutang dari manajemen.
            </DialogDescription>
          </DialogHeader>
          <form action={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="targetDate">Tanggal Target Lunas</Label>
              <Input
                id="targetDate"
                name="targetDate"
                type="date"
                defaultValue={editing?.targetDate ? new Date(editing.targetDate).toISOString().slice(0, 10) : ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="targetAmount">Nominal Target (Rp)</Label>
              <Input
                id="targetAmount"
                name="targetAmount"
                type="number"
                min={0}
                defaultValue={editing?.targetAmount ?? ""}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="note">Catatan</Label>
              <Input id="note" name="note" defaultValue={editing?.targetNote ?? ""} />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <DialogFooter className="gap-2 sm:justify-between">
              {editing?.isTarget && (
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
