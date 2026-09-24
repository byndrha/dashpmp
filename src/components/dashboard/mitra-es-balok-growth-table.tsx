import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { MitraGrowthRow, MitraGrowthCell } from "@/lib/queries/mitra-es-balok-growth";

const EMPTY_CELL: MitraGrowthCell = { total: 0, newThisMonth: 0, newLastMonth: 0 };

function addCell(a: MitraGrowthCell, b: MitraGrowthCell): MitraGrowthCell {
  return {
    total: a.total + b.total,
    newThisMonth: a.newThisMonth + b.newThisMonth,
    newLastMonth: a.newLastMonth + b.newLastMonth,
  };
}

function GrowthCell({ cell, bold }: { cell: MitraGrowthCell; bold?: boolean }) {
  const delta = cell.newThisMonth - cell.newLastMonth;
  return (
    <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:justify-end sm:gap-2">
      <span
        className={cn(
          "inline-flex min-w-9 items-center justify-center rounded-md border bg-secondary/50 px-2 py-0.5 tabular-nums",
          bold ? "font-semibold" : "text-foreground"
        )}
      >
        {cell.total}
      </span>
      <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
        {delta > 0 && <ArrowUp className="size-3 shrink-0 text-primary" />}
        {delta < 0 && <ArrowDown className="size-3 shrink-0 text-destructive" />}
        {delta === 0 && <Minus className="size-3 shrink-0 text-muted-foreground/40" />}
        <span>
          +{cell.newThisMonth} <span className="opacity-60">(lalu +{cell.newLastMonth})</span>
        </span>
      </span>
    </div>
  );
}

function GrowthHalfTable({ rows }: { rows: MitraGrowthRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Wilayah</TableHead>
          <TableHead className="text-right">Agen</TableHead>
          <TableHead className="text-right">Manufaktur</TableHead>
          <TableHead className="text-right">Pesisir</TableHead>
          <TableHead className="text-right">Belum Ditentukan</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.wilayah}>
            <TableCell className="font-medium">{r.wilayah}</TableCell>
            <TableCell>
              <GrowthCell cell={r.agen} />
            </TableCell>
            <TableCell>
              <GrowthCell cell={r.manufaktur} />
            </TableCell>
            <TableCell>
              <GrowthCell cell={r.pesisir} />
            </TableCell>
            <TableCell>
              <GrowthCell cell={r.belumDitentukan} />
            </TableCell>
            <TableCell>
              <GrowthCell cell={r.total} bold />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// "Bulan ini"/"bulan lalu" here read PMP_Agen.ModifiedDate as a join-date
// proxy -- see mitra-es-balok-growth.ts's getMitraGrowthByWilayah for why
// that column is a known-imperfect signal (any edit re-stamps it, so a
// years-old mitra can misreport as newly joined after a routine edit).
// Accepted trade-off, user decision 2026-09-24.
export function MitraEsBalokGrowthTable({ rows }: { rows: MitraGrowthRow[] }) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Belum ada data Mitra.</p>;
  }

  const grandTotal = rows.reduce(
    (acc, r) => ({
      agen: addCell(acc.agen, r.agen),
      manufaktur: addCell(acc.manufaktur, r.manufaktur),
      pesisir: addCell(acc.pesisir, r.pesisir),
      belumDitentukan: addCell(acc.belumDitentukan, r.belumDitentukan),
      total: addCell(acc.total, r.total),
    }),
    { agen: EMPTY_CELL, manufaktur: EMPTY_CELL, pesisir: EMPTY_CELL, belumDitentukan: EMPTY_CELL, total: EMPTY_CELL }
  );

  const mid = Math.ceil(rows.length / 2);
  const left = rows.slice(0, mid);
  const right = rows.slice(mid);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-x-4 gap-y-2 lg:grid-cols-2">
        <GrowthHalfTable rows={left} />
        {right.length > 0 && <GrowthHalfTable rows={right} />}
      </div>

      <Table>
        <TableBody>
          <TableRow className="bg-muted/50">
            <TableCell className="font-semibold">Total Keseluruhan</TableCell>
            <TableCell>
              <GrowthCell cell={grandTotal.agen} bold />
            </TableCell>
            <TableCell>
              <GrowthCell cell={grandTotal.manufaktur} bold />
            </TableCell>
            <TableCell>
              <GrowthCell cell={grandTotal.pesisir} bold />
            </TableCell>
            <TableCell>
              <GrowthCell cell={grandTotal.belumDitentukan} bold />
            </TableCell>
            <TableCell>
              <GrowthCell cell={grandTotal.total} bold />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
