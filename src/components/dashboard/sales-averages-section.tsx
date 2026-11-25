import { TrendPill } from "@/components/dashboard/sales-chips";
import { formatRupiah } from "@/lib/format";
import type { SalesAverages } from "@/lib/queries/sales-overview";

function AverageRow({
  label,
  thisMonthValue,
  lastMonthValue,
  percent,
}: {
  label: string;
  thisMonthValue: string;
  lastMonthValue: string;
  percent: number | null;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-2 gap-y-1">
      <span className="whitespace-nowrap text-[11px] font-medium tabular-nums text-foreground">{thisMonthValue}</span>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <TrendPill percent={percent} />
      <span className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">{lastMonthValue}</span>
    </div>
  );
}

// Selalu terbuka (permintaan user 2026-11-25 — dulu bisa diciutkan).
export function SalesAveragesSection({ averages }: { averages: SalesAverages }) {
  return (
    <div className="border-t pt-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Rata-rata Bulan Ini vs Bulan Lalu
      </p>
      <div className="-mx-1 mt-2 overflow-x-auto px-1">
        <div className="flex min-w-max flex-col gap-1.5">
          <AverageRow
            label="Kantong Terkirim / Hari"
            thisMonthValue={Math.round(averages.AvgKantongPerHariThisMonth).toLocaleString("id-ID")}
            lastMonthValue={Math.round(averages.AvgKantongPerHariLastMonth).toLocaleString("id-ID")}
            percent={averages.AvgKantongPerHariPctChange}
          />
          <AverageRow
            label="Harga Jual 10KG"
            thisMonthValue={formatRupiah(averages.AvgHarga10KGThisMonth)}
            lastMonthValue={formatRupiah(averages.AvgHarga10KGLastMonth)}
            percent={averages.AvgHarga10KGPctChange}
          />
          <AverageRow
            label="Harga Jual 5KG"
            thisMonthValue={formatRupiah(averages.AvgHarga5KGThisMonth)}
            lastMonthValue={formatRupiah(averages.AvgHarga5KGLastMonth)}
            percent={averages.AvgHarga5KGPctChange}
          />
        </div>
      </div>
    </div>
  );
}
