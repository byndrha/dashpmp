"use client";

import { useMemo, useState, useTransition } from "react";
import { Target, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { formatRupiah, formatDate, formatQty, formatDays, formatPercentPoints } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CollectionPriorityRow } from "@/lib/queries/collection-priority";
import type { PiutangStatus } from "@/lib/queries/aging";
import { saveCollectionTargetAction, removeCollectionTargetAction } from "@/app/(dashboard)/aging/actions";

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

export function CollectionPriorityTable({ rows }: { rows: CollectionPriorityRow[] }) {
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<CollectionPriorityRow | null>(null);
  const [pending, startTransition] = useTransition();

  const { headline, rest } = useMemo(() => {
    const targeted = rows.filter((r) => r.IsTarget);
    const others = rows
      .filter((r) => !r.IsTarget && (r.Status === "Kritis" || r.Status === "Perhatian"))
      .slice(0, 5);
    const headlineIds = new Set([...targeted, ...others].map((r) => r.BusinessPartnerID));
    return {
      headline: [...targeted, ...others].sort((a, b) => b.PiutangBerjalan - a.PiutangBerjalan),
      rest: rows.filter((r) => !headlineIds.has(r.BusinessPartnerID)),
    };
  }, [rows]);

  const visibleRows = showAll ? [...headline, ...rest] : headline;

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
      <CardContent className="px-0">
        <div className="overflow-x-auto px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mitra</TableHead>
                <TableHead className="text-right">Piutang Awal</TableHead>
                <TableHead className="text-right">Piutang Berjalan</TableHead>
                <TableHead>Target Pelunasan</TableHead>
                <TableHead>Progres</TableHead>
                <TableHead className="text-right">Rata² Pesan</TableHead>
                <TableHead>Terakhir Pesan</TableHead>
                <TableHead>Terakhir Bayar</TableHead>
                <TableHead className="text-right">Rasio</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tren</TableHead>
                <TableHead className="text-right">Rotasi</TableHead>
                <TableHead className="text-right">Omzet</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((r) => {
                const prog = progress(r);
                const rat = ratio(r);
                return (
                  <TableRow key={r.BusinessPartnerID}>
                    <TableCell>
                      <p className="font-medium">{r.CustomerName}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.PartnerType} &middot; {r.Wilayah}
                        {r.Kecamatan ? ` · ${r.Kecamatan}` : ""}
                      </p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(r.PiutangAwal)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatRupiah(r.PiutangBerjalan)}
                    </TableCell>
                    <TableCell>
                      {r.TargetAmount != null ? (
                        <>
                          <p className="tabular-nums">{formatRupiah(r.TargetAmount)}</p>
                          {r.TargetDate && (
                            <p className="text-xs text-muted-foreground">{formatDate(r.TargetDate)}</p>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {prog != null ? (
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 w-16 rounded-full bg-secondary">
                            <div
                              className="h-1.5 rounded-full bg-primary"
                              style={{ width: `${prog}%` }}
                            />
                          </div>
                          <span className="text-xs tabular-nums text-muted-foreground">{prog.toFixed(0)}%</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatQty(r.AvgQtyPerOrderDay)}
                    </TableCell>
                    <TableCell className="text-xs">{r.TerakhirPesan ? formatDate(r.TerakhirPesan) : "-"}</TableCell>
                    <TableCell className="text-xs">{r.TerakhirBayar ? formatDate(r.TerakhirBayar) : "-"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {rat != null ? formatPercentPoints(rat) : "-"}
                    </TableCell>
                    <TableCell>
                      <span className={cn("rounded px-2 py-0.5 text-xs font-medium", STATUS_BADGE[r.Status])}>
                        {r.Status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <TrenIcon tren={r.Tren} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatDays(r.Rotasi)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatRupiah(r.Omzet)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditing(r)}>
                        <Target className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {visibleRows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={14} className="text-center text-muted-foreground py-8">
                    Tidak ada piutang yang perlu diprioritaskan.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {rest.length > 0 && (
          <div className="mt-3 flex justify-center px-6">
            <Button variant="outline" size="sm" onClick={() => setShowAll((v) => !v)}>
              {showAll ? (
                <>
                  Sembunyikan <ChevronUp className="size-3.5" />
                </>
              ) : (
                <>
                  Tampilkan {rest.length} mitra lainnya <ChevronDown className="size-3.5" />
                </>
              )}
            </Button>
          </div>
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
                defaultValue={editing?.TargetDate ? editing.TargetDate.slice(0, 10) : ""}
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
