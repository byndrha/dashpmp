"use client";

// Grafik tren Penjualan Es Balok — padanan SalesTrendChart /
// SalesTrendChartMonthly (Es Kristal). Batang = nominal, garis = balok
// kecil & balok besar terjual. Tooltip menampilkan jumlah pesanan, dan untuk
// mode bulanan juga Pendapatan GL (angka resmi pembukuan) sebagai pembanding.
import { Bar, ComposedChart, Line, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatRupiah } from "@/lib/format";
import { useNarrowContainer } from "@/hooks/use-narrow-container";
import type { TrenBalokPoint } from "@/lib/queries/penjualan-es-balok";

const NARROW_THRESHOLD = 560;
const BESAR_COLOR = "oklch(0.62 0.2 35)";

interface ChartDatum {
  name: string;
  mobileName: string;
  Nominal: number;
  BalokKecil: number;
  BalokBesar: number;
  dokumen: number;
  pendapatanGL?: number;
}

const dayFmt = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dayMobileFmt = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("id-ID", { month: "short", year: "numeric", timeZone: "UTC" });
const monthMobileFmt = new Intl.DateTimeFormat("id-ID", { month: "short", year: "2-digit", timeZone: "UTC" });
const compact = new Intl.NumberFormat("id-ID", { notation: "compact" });

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block size-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function TrenTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartDatum }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-popover p-2.5 text-xs text-popover-foreground shadow-lg">
      <p className="mb-1.5 font-medium">{d.name}</p>
      <p className="mb-1.5 font-display font-semibold tabular-nums text-primary">{formatRupiah(d.Nominal)}</p>
      <div className="flex flex-col gap-0.5 text-muted-foreground">
        <span>{d.BalokKecil.toLocaleString("id-ID")} balok kecil</span>
        <span>{d.BalokBesar.toLocaleString("id-ID")} balok besar</span>
        <span>{d.dokumen.toLocaleString("id-ID")} pesanan</span>
        {d.pendapatanGL != null && <span>Pendapatan GL: {formatRupiah(d.pendapatanGL)}</span>}
      </div>
    </div>
  );
}

function series(showBesar: boolean) {
  const els = [
    <Bar key="nominal" yAxisId="nominal" dataKey="Nominal" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />,
    <Line key="kecil" yAxisId="qty" type="monotone" dataKey="BalokKecil" name="Balok Kecil" stroke="var(--chart-3)" strokeWidth={3} dot={false} />,
  ];
  if (showBesar) {
    els.push(
      <Line key="besar" yAxisId="qty" type="monotone" dataKey="BalokBesar" name="Balok Besar" stroke={BESAR_COLOR} strokeWidth={3} dot={false} />
    );
  }
  return els;
}

export function PenjualanBalokTrenChart({ data, mode }: { data: TrenBalokPoint[]; mode: "harian" | "bulanan" }) {
  const [containerRef, narrow] = useNarrowContainer<HTMLDivElement>(NARROW_THRESHOLD);

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada data pada rentang ini.</p>;
  }

  const chartData: ChartDatum[] = data.map((p) => {
    const date = new Date(mode === "harian" ? `${p.key}T00:00:00Z` : `${p.key}-01T00:00:00Z`);
    return {
      name: mode === "harian" ? dayFmt.format(date) : monthFmt.format(date),
      mobileName: mode === "harian" ? dayMobileFmt.format(date) : monthMobileFmt.format(date),
      Nominal: p.nominal,
      BalokKecil: p.qtyKecil,
      BalokBesar: p.qtyBesar,
      dokumen: p.dokumen,
      pendapatanGL: p.pendapatanGL,
    };
  });
  // PMPakis hanya menjual balok kecil — garis balok besar disembunyikan bila selalu 0.
  const showBesar = data.some((p) => p.qtyBesar !== 0);

  if (narrow) {
    const width = Math.max(chartData.length * (mode === "harian" ? 46 : 56), 320);
    return (
      <div ref={containerRef} className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-3 px-1 text-[10px] text-muted-foreground">
          <Swatch color="var(--chart-1)" label="Nominal" />
          <Swatch color="var(--chart-3)" label="Balok Kecil" />
          {showBesar && <Swatch color={BESAR_COLOR} label="Balok Besar" />}
        </div>
        <div className="-mx-2 overflow-x-auto px-2">
          <div style={{ width }}>
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
                  tickFormatter={(v) => compact.format(v)}
                />
                <YAxis yAxisId="qty" orientation="right" hide />
                <Tooltip content={<TrenTooltip />} />
                {series(showBesar)}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef}>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chartData} margin={{ top: 20, right: 8, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis
            yAxisId="nominal"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => compact.format(v)}
          />
          <YAxis yAxisId="qty" orientation="right" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip content={<TrenTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }} />
          {series(showBesar)}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
