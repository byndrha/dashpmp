"use client";

import {
  Bar,
  ComposedChart,
  Line,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDate, formatRupiah } from "@/lib/format";
import type { SalesTrendPoint } from "@/lib/queries/sales";

interface ChartDatum {
  name: string;
  Netto: number;
  SO: number;
  SOQty: number;
  DO: number;
  DOQty: number;
  SI: number;
  SIQty: number;
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartDatum }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;

  return (
    <div className="rounded-md border border-border bg-popover p-2.5 text-xs text-popover-foreground shadow-lg">
      <p className="mb-1.5 font-medium">{d.name}</p>
      <p className="mb-1.5 font-display font-semibold tabular-nums text-primary">{formatRupiah(d.Netto)}</p>
      <div className="flex flex-col gap-0.5 text-muted-foreground">
        <span>SO &mdash; {d.SO.toLocaleString("id-ID")} dok &middot; {d.SOQty.toLocaleString("id-ID")} kantong</span>
        <span>DO &mdash; {d.DO.toLocaleString("id-ID")} dok &middot; {d.DOQty.toLocaleString("id-ID")} kantong</span>
        <span>SI &mdash; {d.SI.toLocaleString("id-ID")} dok &middot; {d.SIQty.toLocaleString("id-ID")} kantong</span>
      </div>
    </div>
  );
}

export function SalesTrendChart({ data }: { data: SalesTrendPoint[] }) {
  const chartData: ChartDatum[] = data.map((d) => ({
    name: formatDate(d.TransDate),
    Netto: d.NetSales,
    SO: d.SOCount,
    SOQty: d.SOQty,
    DO: d.DOCount,
    DOQty: d.DOQty,
    SI: d.SICount,
    SIQty: d.SIQty,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={chartData} margin={{ top: 20, right: 8, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis
          yAxisId="nominal"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => new Intl.NumberFormat("id-ID", { notation: "compact" }).format(v)}
        />
        <YAxis yAxisId="docs" orientation="right" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip content={<TrendTooltip />} />
        <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }} />
        <Bar yAxisId="nominal" dataKey="Netto" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
        <Line yAxisId="docs" type="monotone" dataKey="SO" stroke="var(--chart-3)" strokeWidth={3} dot={false} />
        <Line
          yAxisId="docs"
          type="monotone"
          dataKey="DO"
          // Dedicated color, deliberately not --chart-2: at similar lightness
          // to the Netto bar's --chart-1 (both ~0.75-0.8), the DO line all
          // but disappeared against the bars. This is darker and more
          // saturated for contrast against the light teal fill.
          stroke="oklch(0.62 0.2 35)"
          strokeWidth={3}
          dot={false}
          // Always-on qty label for DO specifically (not just on hover) —
          // the other series stay hover-only via the tooltip.
          label={(props: { x?: string | number; y?: string | number; index?: number }) => {
            const { x, y, index } = props;
            if (x == null || y == null || index == null) return <g />;
            const qty = chartData[index]?.DOQty ?? 0;
            return (
              <text x={Number(x)} y={Number(y) - 8} textAnchor="middle" fontSize={9} fill="oklch(0.62 0.2 35)">
                {qty.toLocaleString("id-ID")}
              </text>
            );
          }}
        />
        <Line yAxisId="docs" type="monotone" dataKey="SI" stroke="var(--chart-4)" strokeWidth={3} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
