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

const tooltipStyle = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  color: "var(--popover-foreground)",
  fontSize: 12,
};

export function SalesTrendChart({ data }: { data: SalesTrendPoint[] }) {
  const chartData = data.map((d) => ({
    name: formatDate(d.TransDate),
    Netto: d.NetSales,
    SO: d.SOCount,
    DO: d.DOCount,
    SI: d.SICount,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
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
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name) => (name === "Netto" ? formatRupiah(Number(value)) : value)}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }} />
        <Bar yAxisId="nominal" dataKey="Netto" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
        <Line yAxisId="docs" type="monotone" dataKey="SO" stroke="var(--chart-3)" strokeWidth={2} dot={false} />
        <Line yAxisId="docs" type="monotone" dataKey="DO" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
        <Line yAxisId="docs" type="monotone" dataKey="SI" stroke="var(--chart-4)" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
