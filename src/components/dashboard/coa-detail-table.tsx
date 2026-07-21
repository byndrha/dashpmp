"use client";

import { useState, useTransition } from "react";
import { ChevronDown, PiggyBank } from "lucide-react";
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
import { formatRupiah, formatPercentPoints } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { COADetailRow, COAKategori } from "@/lib/queries/keuangan-detail";
import { COA_KATEGORI_LABEL } from "@/lib/coa-labels";
import { saveCOABudgetAction } from "@/app/(dashboard)/pnl/actions";

const KATEGORI_ORDER: COAKategori[] = [
  "Pendapatan",
  "HPP",
  "BiayaTetap",
  "BebanOperasional",
  "PenghasilanLainnya",
  "Adjustment",
  "BebanLainnya",
];

export function COADetailTable({
  rows,
  year,
  month,
}: {
  rows: COADetailRow[];
  year: number;
  month: number;
}) {
  const [editing, setEditing] = useState<COADetailRow | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    if (!editing) return;
    const amount = Number(formData.get("amount"));
    startTransition(async () => {
      await saveCOABudgetAction({ chartOfAccountId: editing.ChartOfAccountID, year, month, amount });
      setEditing(null);
    });
  }

  const grouped = KATEGORI_ORDER.map((kategori) => ({
    kategori,
    rows: rows.filter((r) => r.Kategori === kategori),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="flex flex-col gap-3">
      {grouped.map((g) => (
        // Native <details>/<summary> — collapsed by default, no extra state
        // needed alongside the edit-dialog state this component already has.
        <details
          key={g.kategori}
          className="group overflow-hidden rounded-xl bg-card text-sm text-card-foreground ring-1 ring-foreground/10 shadow-md"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-3 [&::-webkit-details-marker]:hidden">
            <span className="font-display text-sm font-medium">
              {COA_KATEGORI_LABEL[g.kategori]}{" "}
              <span className="font-normal text-muted-foreground">({g.rows.length} akun)</span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="overflow-x-auto px-3 pb-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-7 px-1.5 text-[10px]">Akun</TableHead>
                  <TableHead className="h-7 px-1.5 text-right text-[10px]">APBP</TableHead>
                  <TableHead className="h-7 px-1.5 text-right text-[10px]">Realisasi</TableHead>
                  <TableHead className="h-7 px-1.5 text-right text-[10px]">%Kat</TableHead>
                  <TableHead className="h-7 px-1.5 text-right text-[10px]">%Ang</TableHead>
                  <TableHead className="h-7 px-1.5 text-right text-[10px]">Proyeksi</TableHead>
                  <TableHead className="h-7 w-6 px-1"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.rows.map((r) => (
                  <TableRow key={r.ChartOfAccountID}>
                    <TableCell className="px-1.5 py-1.5">
                      <p className="text-xs font-medium leading-tight">{r.AccountName}</p>
                      <p className="font-data text-[10px] leading-tight text-muted-foreground">{r.AccountNo}</p>
                    </TableCell>
                    <TableCell className="px-1.5 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                      {r.BudgetAmount != null ? formatRupiah(r.BudgetAmount) : "-"}
                    </TableCell>
                    <TableCell className="px-1.5 py-1.5 text-right text-xs font-medium tabular-nums">
                      {formatRupiah(r.Realisasi)}
                    </TableCell>
                    <TableCell className="px-1.5 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                      {formatPercentPoints(r.RealisasiPercent)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "px-1.5 py-1.5 text-right text-xs tabular-nums",
                        r.BudgetPercent != null && r.BudgetPercent > 100 && "text-destructive"
                      )}
                    >
                      {r.BudgetPercent != null ? formatPercentPoints(r.BudgetPercent) : "-"}
                    </TableCell>
                    <TableCell className="px-1.5 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                      {formatRupiah(r.ProyeksiAkhirBulan)}
                    </TableCell>
                    <TableCell className="px-1 py-1.5">
                      <Button variant="ghost" size="icon" className="size-6" onClick={() => setEditing(r)}>
                        <PiggyBank className="size-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </details>
      ))}

      {grouped.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada mutasi akun pada periode ini.</p>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anggaran &mdash; {editing?.AccountName}</DialogTitle>
            <DialogDescription>
              Set nominal Anggaran (APBP) untuk akun ini pada bulan berjalan.
            </DialogDescription>
          </DialogHeader>
          <form action={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="amount">Nominal Anggaran (Rp)</Label>
              <Input
                id="amount"
                name="amount"
                type="number"
                min={0}
                defaultValue={editing?.BudgetAmount ?? ""}
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending} className="ml-auto">
                {pending ? "Menyimpan..." : "Simpan Anggaran"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
