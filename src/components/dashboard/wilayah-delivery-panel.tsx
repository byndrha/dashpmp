import { ArrowRight, Star } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ExportXlsxButton } from "@/components/dashboard/export-xlsx-button";
import { cn } from "@/lib/utils";
import type { XlsxColumn } from "@/lib/export-xlsx";
import type { WilayahDeliverySummary } from "@/lib/queries/delivery";

const EXPORT_COLUMNS: XlsxColumn[] = [
  { header: "Wilayah", key: "wilayah", width: 16 },
  { header: "Kantong 10KG", key: "qty10kg", type: "number", width: 13 },
  { header: "Kantong 5KG", key: "qty5kg", type: "number", width: 12 },
  { header: "Total Kantong", key: "totalKantong", type: "number", width: 13 },
  { header: "Kantong Hari Ini", key: "totalKantongHariIni", type: "number", width: 14 },
  { header: "Target/Hari", key: "targetHarian", type: "number", width: 11 },
  { header: "Target Periode", key: "targetPeriode", type: "number", width: 13 },
  { header: "% Pencapaian", key: "pctAchievement", type: "number", numFmt: "0.0%", width: 12 },
  { header: "Rata-rata/Hari", key: "avgPerHari", type: "number", numFmt: "#,##0.0", width: 13 },
];

// Priority display order for the tile grid — everything not listed here
// keeps its existing relative order (TotalKantong DESC, from
// getWilayahDeliverySummary()) and sorts after all of these, per explicit
// business request.
const WILAYAH_PRIORITY = ["Ponorogo", "Madiun", "Magetan", "Wonogiri", "Pacitan", "Trenggalek", "Ngawi"];

// Company-wide daily target across all wilayah, per explicit business
// request — not derived from data, a fixed figure set by management.
const TARGET_PER_HARI = 4000;

function sortByPriority(data: WilayahDeliverySummary[]): WilayahDeliverySummary[] {
  return [...data].sort((a, b) => {
    const ai = WILAYAH_PRIORITY.indexOf(a.Wilayah);
    const bi = WILAYAH_PRIORITY.indexOf(b.Wilayah);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return 0; // stable sort preserves the incoming TotalKantong-desc order
  });
}

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
  const sortedData = sortByPriority(data);
  const ponorogo = data.find((w) => w.Wilayah === "Ponorogo");
  const deviasiPonorogo = ponorogo?.TargetHarian != null ? TARGET_PER_HARI - ponorogo.TargetHarian : null;

  const exportRows = sortedData.map((w) => ({
    wilayah: w.Wilayah,
    qty10kg: w.Qty10KG,
    qty5kg: w.Qty5KG,
    totalKantong: w.TotalKantong,
    totalKantongHariIni: w.TotalKantongHariIni,
    targetHarian: w.TargetHarian,
    targetPeriode: w.TargetPeriode,
    pctAchievement: w.PctAchievement != null ? w.PctAchievement / 100 : null,
    avgPerHari: w.AvgPerHari,
  }));

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="font-display">Pengiriman per Wilayah</CardTitle>
          <CardDescription>Kantong terkirim (DO) tiap wilayah — total periode filter dan hari ini.</CardDescription>
        </div>
        <ExportXlsxButton
          filename="pengiriman-per-wilayah"
          sheetName="Pengiriman per Wilayah"
          columns={EXPORT_COLUMNS}
          rows={exportRows}
        />
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Belum ada pengiriman pada periode ini.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
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
                {/* Compact, in-panel instead of a separate box — TARGET_PER_HARI
                    is a fixed company-wide figure (not derived from data); the
                    deviation is specifically Ponorogo's own gap against it,
                    starred to match Ponorogo's marker elsewhere in this panel. */}
                <p className="mt-1 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
                  Target {TARGET_PER_HARI.toLocaleString("id-ID")}
                  <span className="mx-1">·</span>
                  <Star className="mb-0.5 inline size-2.5 shrink-0 fill-primary text-primary" /> Deviasi{" "}
                  {deviasiPonorogo != null ? deviasiPonorogo.toLocaleString("id-ID") : "-"}
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
                  {sortedData.map((w) => (
                    <button
                      key={w.Wilayah}
                      type="button"
                      onClick={() => onWilayahClick?.(w.Wilayah)}
                      className={cn(
                        "relative rounded-lg border p-2.5 pb-6 text-left transition-colors",
                        w.Wilayah === "Ponorogo" ? "border-primary/30 bg-primary/5" : "border-border bg-card/50",
                        onWilayahClick && "hover:border-primary/40 hover:bg-primary/10"
                      )}
                    >
                      {/* Top row: wilayah name (left, starred for Ponorogo) + %
                          ketercapaian target (top-right). */}
                      <div className="flex items-start justify-between gap-2">
                        <p className="flex min-w-0 items-center gap-1 truncate text-xs font-medium text-muted-foreground">
                          {w.Wilayah === "Ponorogo" && (
                            <Star className="size-3 shrink-0 fill-primary text-primary" />
                          )}
                          <span className="truncate">{w.Wilayah}</span>
                        </p>
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

                      {/* Target row: target harian (left) paired with target periode (right). */}
                      <div className="mt-1 flex items-end justify-between gap-2">
                        <p className="text-[10px] tabular-nums text-muted-foreground">
                          Target: {w.TargetHarian != null ? w.TargetHarian.toLocaleString("id-ID") : "-"}
                        </p>
                        <p className="text-[10px] tabular-nums text-muted-foreground">
                          Target {w.TargetPeriode != null ? w.TargetPeriode.toLocaleString("id-ID") : "-"}
                        </p>
                      </div>

                      {/* Bottom-left corner: actual average delivered per day
                          over the period (distinct from the capacity-based
                          Target above). */}
                      <p className="mt-1 text-[10px] tabular-nums text-muted-foreground">
                        Rata-rata: {w.AvgPerHari.toLocaleString("id-ID", { maximumFractionDigits: 1 })}/hari
                      </p>
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
