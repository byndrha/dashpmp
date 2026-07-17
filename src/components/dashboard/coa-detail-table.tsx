"use client";

import { useState, useTransition } from "react";
import { PiggyBank } from "lucide-react";
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
import { formatRupiah, formatPercentPoints } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { COADetailRow, COAKategori } from "@/lib/queries/keuangan-detail";
import { saveCOABudgetAction } from "@/app/(dashboard)/pnl/actions";

const KATEGORI_ORDER: COAKategori[] = [
  "Pendapatan",
  "HPP",
  "Beban Operasional",
  "Pendapatan/Beban Lain",
  "Adjustment/Pajak",
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
    <div className="flex flex-col gap-4">
      {grouped.map((g) => (
        <Card key={g.kategori}>
          <CardHeader>
            <CardTitle className="font-display text-base">{g.kategori}</CardTitle>
            <CardDescription>Rincian akun (APBP vs realisasi periode berjalan).</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto px-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Akun</TableHead>
                    <TableHead className="text-right">APBP</TableHead>
                    <TableHead className="text-right">Realisasi</TableHead>
                    <TableHead className="text-right">% Kategori</TableHead>
                    <TableHead className="text-right">% Anggaran</TableHead>
                    <TableHead className="text-right">Proyeksi Akhir Bulan</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.rows.map((r) => (
                    <TableRow key={r.ChartOfAccountID}>
                      <TableCell>
                        <p className="font-medium">{r.AccountName}</p>
                        <p className="font-data text-xs text-muted-foreground">{r.AccountNo}</p>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {r.BudgetAmount != null ? formatRupiah(r.BudgetAmount) : "-"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatRupiah(r.Realisasi)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatPercentPoints(r.RealisasiPercent)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          r.BudgetPercent != null && r.BudgetPercent > 100 && "text-destructive"
                        )}
                      >
                        {r.BudgetPercent != null ? formatPercentPoints(r.BudgetPercent) : "-"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatRupiah(r.ProyeksiAkhirBulan)}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditing(r)}>
                          <PiggyBank className="size-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
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
