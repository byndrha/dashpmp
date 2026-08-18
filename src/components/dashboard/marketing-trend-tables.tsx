"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Anatomy {
  general: number;
  bagQtyActual: number;
  bagQtyTarget: number;
  pct: number | null;
}

function formatQty(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

function formatMonthLabel(monthStartISO: string): string {
  return new Date(monthStartISO).toLocaleDateString("id-ID", { month: "short", year: "numeric", timeZone: "UTC" });
}

function AnatomyCell({ anatomy }: { anatomy: Anatomy }) {
  return (
    <div className="flex flex-col items-center gap-0.5 text-[11px] tabular-nums">
      <span className="font-semibold">{formatQty(anatomy.general)} outlet</span>
      <span className="text-muted-foreground">
        {formatQty(anatomy.bagQtyActual)}/{formatQty(anatomy.bagQtyTarget)}
      </span>
      <span className={cn(anatomy.pct != null && anatomy.pct >= 100 && "font-medium text-primary")}>
        {anatomy.pct != null ? `${anatomy.pct.toFixed(0)}%` : "-"}
      </span>
    </div>
  );
}

// "Matriks Performa Marketing" (spec §5) — Existing/NOO/Total rows x one
// column per month. Used both for the company-wide combined figures and,
// with per-marketing data, inside each MarketingCard.
export function MatriksPerformaTable({
  months,
  existing,
  noo,
  total,
  title,
}: {
  months: string[];
  existing: Anatomy[];
  noo: Anatomy[];
  total: Anatomy[];
  title: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-collapse text-xs">
        <thead>
          <tr className="border-b">
            <th className="p-2 text-left font-medium text-muted-foreground">{title}</th>
            {months.map((m) => (
              <th key={m} className="p-2 text-center font-medium text-muted-foreground">
                {formatMonthLabel(m)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b">
            <td className="p-2 font-medium">Existing</td>
            {existing.map((a, i) => (
              <td key={months[i]} className="p-2">
                <AnatomyCell anatomy={a} />
              </td>
            ))}
          </tr>
          <tr className="border-b">
            <td className="p-2 font-medium">NOO</td>
            {noo.map((a, i) => (
              <td key={months[i]} className="p-2">
                <AnatomyCell anatomy={a} />
              </td>
            ))}
          </tr>
          <tr>
            <td className="p-2 font-semibold">Total</td>
            {total.map((a, i) => (
              <td key={months[i]} className="p-2">
                <AnatomyCell anatomy={a} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

interface PangsaPasarMonthLike {
  monthStartISO: string;
  agen: number;
  rpa: number;
  outlet: number;
  total: number;
  agenPct: number | null;
  rpaPct: number | null;
  outletPct: number | null;
  lost: number;
}

// "Pangsa Pasar & Kontribusi Internal" (spec §6) — one row per month.
export function PangsaPasarTable({ rows }: { rows: PangsaPasarMonthLike[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] border-collapse text-xs">
        <thead>
          <tr className="border-b">
            <th className="p-2 text-left font-medium text-muted-foreground">Bulan</th>
            <th className="p-2 text-center font-medium text-muted-foreground">Agen</th>
            <th className="p-2 text-center font-medium text-muted-foreground">RPA</th>
            <th className="p-2 text-center font-medium text-muted-foreground">Outlet</th>
            <th className="p-2 text-center font-medium text-muted-foreground">Total</th>
            <th className="p-2 text-center font-medium text-muted-foreground">Lost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.monthStartISO} className="border-b last:border-0">
              <td className="p-2 font-medium">{formatMonthLabel(r.monthStartISO)}</td>
              <td className="p-2 text-center tabular-nums">
                {formatQty(r.agen)}
                {r.agenPct != null && <span className="ml-1 text-[10px] text-muted-foreground">({r.agenPct.toFixed(0)}%)</span>}
              </td>
              <td className="p-2 text-center tabular-nums">
                {formatQty(r.rpa)}
                {r.rpaPct != null && <span className="ml-1 text-[10px] text-muted-foreground">({r.rpaPct.toFixed(0)}%)</span>}
              </td>
              <td className="p-2 text-center tabular-nums">
                {formatQty(r.outlet)}
                {r.outletPct != null && <span className="ml-1 text-[10px] text-muted-foreground">({r.outletPct.toFixed(0)}%)</span>}
              </td>
              <td className="p-2 text-center font-semibold tabular-nums">{formatQty(r.total)}</td>
              <td className={cn("p-2 text-center font-medium tabular-nums", r.lost > 0 && "text-primary", r.lost < 0 && "text-destructive")}>
                {r.lost > 0 ? `+${formatQty(r.lost)}` : formatQty(r.lost)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TrendExpandButton({ expanded, onToggle, pending }: { expanded: boolean; onToggle: () => void; pending: boolean }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onToggle} disabled={pending}>
      {pending ? "Memuat..." : expanded ? "Tampilkan 3 bulan" : "Tampilkan 12 bulan"}
    </Button>
  );
}
