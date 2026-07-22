"use client";

import { useMemo, useState, useTransition } from "react";
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
import { formatRupiah, formatDate, formatQty, formatDays, formatPercentPoints } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CollectionPriorityRow } from "@/lib/queries/collection-priority";
import type { PiutangStatus } from "@/lib/queries/aging";
import { saveCollectionTargetAction, removeCollectionTargetAction } from "@/app/(dashboard)/aging/actions";

const PAGE_SIZE = 9;

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
          <span>Terakhir Pesan {row.TerakhirPesan ? formatDate(row.TerakhirPesan) : "-"}</span>
          <span>Terakhir Bayar {row.TerakhirBayar ? formatDate(row.TerakhirBayar) : "-"}</span>
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

  const [prevRows, setPrevRows] = useState(rows);
  if (rows !== prevRows) {
    setPrevRows(rows);
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(rest.length / PAGE_SIZE));
  const pageRows = rest.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleSubmit(formData: FormData) {
    if (!editing) return;
    const targetDate = formData.get("targetDate") as string;
    const targetAmount = formData.get("targetAmount") as string;
    const note = formData.get("note") as string;

    startTransition(async () => {
      await saveCollectionTargetAction({
        businessPartnerId: editing.BusinessPartnerID,
        targetDate: targetDate || null,
        targetAmount: targetAmount ? Number(targetAmount) : null,
        note: note || null,
      });
      setEditing(null);
    });
  }

  function handleRemove() {
    if (!editing) return;
    startTransition(async () => {
      await removeCollectionTargetAction(editing.BusinessPartnerID);
      setEditing(null);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Prioritas Pemulihan Mitra</CardTitle>
        <CardDescription>
          Target dari manajemen, ditambah mitra dengan piutang terbesar berstatus Perhatian/Kritis.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          {headline.map((r) => (
            <PriorityCard key={r.BusinessPartnerID} row={r} onEdit={setEditing} />
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
                <PriorityCard key={r.BusinessPartnerID} row={r} onEdit={setEditing} />
              ))}
            </div>
            <Pagination page={page} pageCount={pageCount} onChange={setPage} />
          </>
        )}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
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
