import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { WilayahDeliverySummary } from "@/lib/queries/delivery";

export function WilayahDeliveryPanel({
  data,
  collapsed,
  onWilayahClick,
}: {
  data: WilayahDeliverySummary[];
  collapsed: boolean;
  onWilayahClick?: (wilayah: string) => void;
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
                <p className="text-[11px] text-muted-foreground">Total Periode Terpilih</p>
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
                    <button
                      key={w.Wilayah}
                      type="button"
                      onClick={() => onWilayahClick?.(w.Wilayah)}
                      className={cn(
                        "relative rounded-lg border p-2.5 pb-6 text-left transition-colors",
                        i === 0 ? "border-primary/30 bg-primary/5" : "border-border bg-card/50",
                        onWilayahClick && "hover:border-primary/40 hover:bg-primary/10"
                      )}
                    >
                      {/* Top row: wilayah name (left) + % ketercapaian target (top-right). */}
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 truncate text-xs font-medium text-muted-foreground">{w.Wilayah}</p>
                        <p
                          className={cn(
                            "shrink-0 text-xs font-semibold tabular-nums",
                            w.PctAchievement != null && w.PctAchievement >= 100 && "text-primary"
                          )}
                        >
                          {w.PctAchievement != null ? `${w.PctAchievement.toFixed(0)}%` : "-"}
                        </p>
                      </div>

                      {/* Divider spanning the full tile width, right below the
                          name/% row (edge-to-edge via negative margin to
                          offset the button's own padding). */}
                      <div className="-mx-2.5 my-1.5 border-t" />

                      {/* Middle row: "Hari ini:" label above its number (left)
                          paired with the period total, vertically centered
                          on the right. */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[9px] text-muted-foreground">Hari ini:</p>
                          <p className="text-sm font-semibold tabular-nums">
                            {w.TotalKantongHariIni.toLocaleString("id-ID")}
                          </p>
                        </div>
                        <p className="shrink-0 font-display text-sm font-semibold tabular-nums">
                          {w.TotalKantong.toLocaleString("id-ID")}
                        </p>
                      </div>

                      {/* Bottom row: target harian (left) paired with target periode (right). */}
                      <div className="mt-1 flex items-end justify-between gap-2">
                        <p className="text-[10px] tabular-nums text-muted-foreground">
                          Target: {w.TargetHarian != null ? w.TargetHarian.toLocaleString("id-ID") : "-"}
                        </p>
                        <p className="text-[10px] tabular-nums text-muted-foreground">
                          Target {w.TargetPeriode != null ? w.TargetPeriode.toLocaleString("id-ID") : "-"}
                        </p>
                      </div>
                      <ArrowRight className="absolute bottom-2 right-2 size-3.5 text-muted-foreground" />
                    </button>
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
