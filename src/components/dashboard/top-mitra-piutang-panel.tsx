"use client";

import { useMemo, useState, useTransition } from "react";
import { NotebookPen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatRupiah, formatDays, formatPercentPoints, formatQty, formatDate } from "@/lib/format";
import type { TopMitraPiutangRow } from "@/lib/queries/top-mitra-piutang";
import type { PiutangStatus } from "@/lib/queries/aging";
import { setMitraNoteAction } from "@/app/(dashboard)/aging/actions";

const STATUS_BADGE_VARIANT: Record<PiutangStatus, string> = {
  Sehat: "border-primary/30 bg-primary/5 text-primary",
  Perhatian: "border-warning/30 bg-warning/5 text-warning",
  Kritis: "border-destructive/30 bg-destructive/5 text-destructive",
};

const TOP_N = 10;

// Null Omzet (never paid anything, ratio otherwise ÷0) ranks *highest*, not
// last — same convention as getTopMitraPiutang()'s server-side ratioRank().
function ratioRank(r: TopMitraPiutangRow): number {
  return r.RasioPiutangPct ?? Infinity;
}

// Card instead of a wide table row — a table here needed 9 columns and
// forced horizontal scrolling to reach Catatan at the far right. A card lets
// the metrics wrap onto their own grid and puts Catatan right under the
// mitra's name, no scrolling needed.
function MitraCard({ row, onEditNote }: { row: TopMitraPiutangRow; onEditNote: (row: TopMitraPiutangRow) => void }) {
  return (
    <Card className="py-3">
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{row.CustomerName}</p>
            <p className="truncate text-xs text-muted-foreground">{row.Wilayah}</p>
          </div>
          <Badge variant="outline" className={cn("shrink-0 text-[10px]", STATUS_BADGE_VARIANT[row.Status])}>
            {row.Status}
          </Badge>
        </div>

        <button
          type="button"
          onClick={() => onEditNote(row)}
          className="flex items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-primary"
        >
          <NotebookPen className="size-3.5 shrink-0" />
          {row.TargetNote ? <span className="truncate">{row.TargetNote}</span> : <span>Tambah catatan</span>}
        </button>

        <div className="grid grid-cols-2 gap-2 border-t pt-2 text-xs sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground">Nominal Piutang</p>
            <p className="tabular-nums font-medium text-primary">{formatRupiah(row.NominalPiutang)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Outstanding Day</p>
            <p className="tabular-nums font-medium">{formatDays(row.OutstandingDay)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Rasio Piutang</p>
            <p className="tabular-nums font-medium">
              {row.RasioPiutangPct != null ? formatPercentPoints(row.RasioPiutangPct) : "-"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">AVG DO/Hari</p>
            <p className="tabular-nums font-medium">{formatQty(row.AvgDOPerHari)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">DO Terakhir</p>
            <p className="tabular-nums font-medium">{row.DOTerakhir ? formatDate(row.DOTerakhir) : "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Terakhir Bayar</p>
            <p className="tabular-nums font-medium">
              {row.TerakhirPembayaran ? formatDate(row.TerakhirPembayaran) : "-"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// `rows` already contains the top 10 for EVERY Wilayah (see
// getTopMitraPiutang()) — filtering here is just a slice, so switching the
// Wilayah filter always yields a full 10 rows (top 10 *within* that
// Wilayah) instead of shrinking down a pre-filtered global top 10.
export function TopMitraPiutangPanel({ rows }: { rows: TopMitraPiutangRow[] }) {
  const [wilayahFilter, setWilayahFilter] = useState("all");
  const [editingNote, setEditingNote] = useState<TopMitraPiutangRow | null>(null);
  const [pending, startTransition] = useTransition();

  const wilayahOptions = useMemo(() => [...new Set(rows.map((r) => r.Wilayah))].sort(), [rows]);

  const visibleRows = useMemo(() => {
    const scoped = wilayahFilter === "all" ? rows : rows.filter((r) => r.Wilayah === wilayahFilter);
    return [...scoped].sort((a, b) => ratioRank(b) - ratioRank(a)).slice(0, TOP_N);
  }, [rows, wilayahFilter]);

  function handleSaveNote(formData: FormData) {
    if (!editingNote) return;
    const note = String(formData.get("note") ?? "").trim();
    startTransition(async () => {
      await setMitraNoteAction({ businessPartnerId: editingNote.BusinessPartnerID, note: note || null });
      setEditingNote(null);
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="font-display">Top 10 Keseluruhan Mitra</CardTitle>
            <CardDescription>
              10 mitra dengan rasio piutang tertinggi, beserta pola pembayaran &amp; pengambilannya.
            </CardDescription>
          </div>
          <Select value={wilayahFilter} onValueChange={(v) => setWilayahFilter(v ?? "all")}>
            <SelectTrigger className="w-44" aria-label="Wilayah">
              <SelectValue>{(v: string) => (v === "all" ? "Semua Wilayah" : v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Wilayah</SelectItem>
              {wilayahOptions.map((w) => (
                <SelectItem key={w} value={w}>
                  {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {visibleRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Belum ada mitra dengan piutang berjalan.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {visibleRows.map((r) => (
              <MitraCard key={r.BusinessPartnerID} row={r} onEditNote={setEditingNote} />
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={!!editingNote} onOpenChange={(open) => !open && setEditingNote(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Catatan &mdash; {editingNote?.CustomerName}</DialogTitle>
            <DialogDescription>
              Catatan bebas untuk mitra ini, terlihat oleh siapa saja yang membuka modul Piutang.
            </DialogDescription>
          </DialogHeader>
          <form action={handleSaveNote} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="note" className="sr-only">
                Catatan
              </Label>
              <Textarea id="note" name="note" rows={4} defaultValue={editingNote?.TargetNote ?? ""} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? "Menyimpan..." : "Simpan Catatan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
