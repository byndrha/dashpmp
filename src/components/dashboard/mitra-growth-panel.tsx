import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { CollapsibleCard } from "@/components/dashboard/collapsible-card";
import { cn } from "@/lib/utils";
import type { MitraGrowthRow, MitraGrowthCell } from "@/lib/queries/mitra-growth";

const EMPTY_CELL: MitraGrowthCell = { total: 0, newThisMonth: 0, newLastMonth: 0 };

function addCell(a: MitraGrowthCell, b: MitraGrowthCell): MitraGrowthCell {
  return {
    total: a.total + b.total,
    newThisMonth: a.newThisMonth + b.newThisMonth,
    newLastMonth: a.newLastMonth + b.newLastMonth,
  };
}

// Total (cumulative, as of today) shown large, with the new-this-month vs
// new-last-month pair underneath plus a trend arrow on the delta — both
// readings ("berapa total" and "perkembangan penambahan") visible at once.
function GrowthCell({ cell, bold }: { cell: MitraGrowthCell; bold?: boolean }) {
  const delta = cell.newThisMonth - cell.newLastMonth;
  return (
    <div className="flex flex-col items-end gap-1">
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

export function MitraGrowthPanel({ rows }: { rows: MitraGrowthRow[] }) {
  const grandTotal = rows.reduce(
    (acc, r) => ({
      agen: addCell(acc.agen, r.agen),
      retail: addCell(acc.retail, r.retail),
      takeaway: addCell(acc.takeaway, r.takeaway),
      rpa: addCell(acc.rpa, r.rpa),
      total: addCell(acc.total, r.total),
    }),
    { agen: EMPTY_CELL, retail: EMPTY_CELL, takeaway: EMPTY_CELL, rpa: EMPTY_CELL, total: EMPTY_CELL }
  );

  return (
    <CollapsibleCard
      title="Perkembangan Mitra per Wilayah"
      description="Total mitra per wilayah & tipe, dengan mitra baru bulan ini (vs bulan lalu) di bawahnya."
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Belum ada data mitra.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Wilayah</TableHead>
              <TableHead className="text-right">Agen</TableHead>
              <TableHead className="text-right">Retail</TableHead>
              <TableHead className="text-right">TakeAway</TableHead>
              <TableHead className="text-right">RPA</TableHead>
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
                  <GrowthCell cell={r.retail} />
                </TableCell>
                <TableCell>
                  <GrowthCell cell={r.takeaway} />
                </TableCell>
                <TableCell>
                  <GrowthCell cell={r.rpa} />
                </TableCell>
                <TableCell>
                  <GrowthCell cell={r.total} bold />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-semibold">Total Keseluruhan</TableCell>
              <TableCell>
                <GrowthCell cell={grandTotal.agen} bold />
              </TableCell>
              <TableCell>
                <GrowthCell cell={grandTotal.retail} bold />
              </TableCell>
              <TableCell>
                <GrowthCell cell={grandTotal.takeaway} bold />
              </TableCell>
              <TableCell>
                <GrowthCell cell={grandTotal.rpa} bold />
              </TableCell>
              <TableCell>
                <GrowthCell cell={grandTotal.total} bold />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </CollapsibleCard>
  );
}
