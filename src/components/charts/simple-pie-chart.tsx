"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatRupiah } from "@/lib/format";

export interface PieDatum {
  name: string;
  value: number;
}

const COLORS = [
  "var(--chart-2)",
  "var(--chart-5)",
  "var(--chart-1)",
  "var(--chart-3)",
  "var(--chart-4)",
];

export function SimplePieChart({ data }: { data: PieDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) => formatRupiah(Number(value))}
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            color: "var(--popover-foreground)",
            fontSize: 12,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
