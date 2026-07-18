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
import { formatRupiah } from "@/lib/format";
import { useIsMobile } from "@/hooks/use-mobile";
import type { SalesTrendMonthPoint } from "@/lib/queries/sales";

interface ChartDatum {
  name: string;
  mobileName: string;
  Netto: number;
  SO: number;
  SOQty: number;
  DO: number;
  DOQty: number;
  SI: number;
  SIQty: number;
}

const DO_LINE_COLOR = "oklch(0.62 0.2 35)";
// Month strings ("YYYY-MM") parse as UTC midnight — format with an explicit
// UTC timeZone so a host running in a positive-UTC-offset timezone doesn't
// silently shift the displayed month back by one, same class of bug as the
// SQL DATE-parameter issue documented in sales-overview.ts.
const monthFormatter = new Intl.DateTimeFormat("id-ID", { month: "short", year: "numeric", timeZone: "UTC" });
const mobileMonthFormatter = new Intl.DateTimeFormat("id-ID", { month: "short", year: "2-digit", timeZone: "UTC" });

function StaticLegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block size-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartDatum }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;

  return (
    <div className="rounded-md border border-border bg-popover p-2.5 text-xs text-popover-foreground shadow-lg">
      <p className="mb-1.5 font-medium">{d.name}</p>
      <p className="mb-1.5 font-display font-semibold tabular-nums text-primary">{formatRupiah(d.Netto)}</p>
      <div className="flex flex-col gap-0.5 text-muted-foreground">
        <span>{d.SO.toLocaleString("id-ID")} SO &mdash; {d.SOQty.toLocaleString("id-ID")} kantong</span>
        <span>{d.DO.toLocaleString("id-ID")} DO &mdash; {d.DOQty.toLocaleString("id-ID")} kantong</span>
        <span>{d.SI.toLocaleString("id-ID")} SI &mdash; {d.SIQty.toLocaleString("id-ID")} kantong</span>
      </div>
    </div>
  );
}

// Identical Bar + Line series to SalesTrendChart's — kept as a local copy
// rather than a shared import since recharts inspects each child's type
// directly (a wrapper component in between breaks that), and the two charts'
// data keys line up exactly.
function seriesElements(chartData: ChartDatum[], skipLabelStep: number) {
  return [
    <Bar key="netto" yAxisId="nominal" dataKey="Netto" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />,
    <Line key="so" yAxisId="docs" type="monotone" dataKey="SO" stroke="var(--chart-3)" strokeWidth={3} dot={false} />,
    <Line
      key="do"
      yAxisId="docs"
      type="monotone"
      dataKey="DO"
      stroke={DO_LINE_COLOR}
      strokeWidth={3}
      dot={false}
      label={(props: { x?: string | number; y?: string | number; index?: number }) => {
        const { x, y, index } = props;
        if (x == null || y == null || index == null) return <g />;
        if (skipLabelStep > 1 && index % skipLabelStep !== 0) return <g />;
        const qty = chartData[index]?.DOQty ?? 0;
        return (
          <text x={Number(x)} y={Number(y) - 8} textAnchor="middle" fontSize={9} fill={DO_LINE_COLOR}>
            {qty.toLocaleString("id-ID")}
          </text>
        );
      }}
    />,
    <Line key="si" yAxisId="docs" type="monotone" dataKey="SI" stroke="var(--chart-4)" strokeWidth={3} dot={false} />,
  ];
}

export function SalesTrendChartMonthly({ data }: { data: SalesTrendMonthPoint[] }) {
  const isMobile = useIsMobile();

  const chartData: ChartDatum[] = data.map((d) => {
    const monthDate = new Date(`${d.Month}-01`);
    return {
      name: monthFormatter.format(monthDate),
      mobileName: mobileMonthFormatter.format(monthDate),
      Netto: d.NetSales,
      SO: d.SOCount,
      SOQty: d.SOQty,
      DO: d.DOCount,
      DOQty: d.DOQty,
      SI: d.SICount,
      SIQty: d.SIQty,
    };
  });

  if (isMobile) {
    const perMonthWidth = 56;
    const mobileWidth = Math.max(chartData.length * perMonthWidth, 320);

    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-3 px-1 text-[10px] text-muted-foreground">
          <StaticLegendSwatch color="var(--chart-1)" label="Netto" />
          <StaticLegendSwatch color="var(--chart-3)" label="SO" />
          <StaticLegendSwatch color={DO_LINE_COLOR} label="DO" />
          <StaticLegendSwatch color="var(--chart-4)" label="SI" />
        </div>
        <div className="-mx-2 overflow-x-auto px-2">
          <div style={{ width: mobileWidth }}>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={chartData} margin={{ top: 20, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                <XAxis dataKey="mobileName" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} interval={0} />
                <YAxis
                  yAxisId="nominal"
                  tick={{ fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                  width={30}
                  tickFormatter={(v) => new Intl.NumberFormat("id-ID", { notation: "compact" }).format(v)}
                />
                <YAxis yAxisId="docs" orientation="right" hide />
                <Tooltip content={<TrendTooltip />} />
                {seriesElements(chartData, 1)}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    );
  }

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
        {seriesElements(chartData, 1)}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
