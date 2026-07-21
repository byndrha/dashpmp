import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { WilayahDeliverySummary } from "@/lib/queries/delivery";

export function WilayahDeliveryPanel({
  data,
  collapsed,
}: {
  data: WilayahDeliverySummary[];
  collapsed: boolean;
}) {
  const grandTotal = data.reduce((sum, w) => sum + w.TotalKantong, 0);
  const grandTotalToday = data.reduce((sum, w) => sum + w.TotalKantongHariIni, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Pengiriman per Wilayah</CardTitle>
        <CardDescription>Kantong terkirim (DO) tiap wilayah — total periode filter dan hari ini.</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Belum ada pengiriman pada periode ini.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
              <div>
                <p className="text-[11px] text-muted-foreground">Total Periode</p>
                <p className="font-display text-sm font-semibold tabular-nums">
                  {grandTotal.toLocaleString("id-ID")} kantong
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground">Hari Ini</p>
                <p className="font-display text-sm font-semibold tabular-nums text-primary">
                  {grandTotalToday.toLocaleString("id-ID")} kantong
                </p>
              </div>
            </div>

            {/* Compact tile grid instead of a tall row-per-wilayah list. @container
                here scopes @sm below to THIS panel's own column width (it sits
                in a 50/50 row next to Kartu Transaksi) — without it, @sm would
                resolve to the ancestor @container/dashboard-main's full width
                instead of this half-column. Hidden in Ringkas mode — the
                summary bar above stays, this per-wilayah breakdown is the
                "Detail" part. */}
            {!collapsed && (
              <div className="@container">
                <div className="grid grid-cols-2 gap-2 @sm:grid-cols-3">
                  {data.map((w, i) => (
                    <div
                      key={w.Wilayah}
                      className={cn(
                        "rounded-lg border p-2.5",
                        i === 0 ? "border-primary/30 bg-primary/5" : "border-border bg-card/50"
                      )}
                    >
                      <p className="truncate text-xs font-medium text-muted-foreground">{w.Wilayah}</p>
                      <p className="mt-1 font-display text-sm font-semibold tabular-nums">
                        {w.TotalKantong.toLocaleString("id-ID")}
                      </p>
                      <p className="text-[10px] tabular-nums text-muted-foreground">
                        Hari ini: {w.TotalKantongHariIni.toLocaleString("id-ID")}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
