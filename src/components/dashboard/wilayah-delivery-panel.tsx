import { ArrowRight, EqualApproximately, Star } from "lucide-react";
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
  // Sum of every wilayah's own Target/Hari — was a fixed company-wide figure
  // (4000) set by management; now derived from data per explicit request.
  const targetPerHariTotal = data.reduce((sum, w) => sum + (w.TargetHarian ?? 0), 0);
  const deviasiPonorogo = ponorogo?.TargetHarian != null ? targetPerHariTotal - ponorogo.TargetHarian : null;

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
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground">Hari Ini</p>
                <p className="font-display text-sm font-semibold tabular-nums text-primary">
                  {grandTotalToday.toLocaleString("id-ID")} kantong
                </p>
                {/* Compact, in-panel instead of a separate box — Target here
                    is the sum of every wilayah's own Target/Hari; the
                    deviation is specifically Ponorogo's own gap against
                    that total, starred to match Ponorogo's marker elsewhere
                    in this panel. */}
                <p className="mt-1 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
                  Target {targetPerHariTotal.toLocaleString("id-ID")}
                  <span className="mx-1">·</span>
                  <Star className="mb-0.5 inline size-2.5 shrink-0 fill-primary text-primary" /> Deviasi{" "}
                  {deviasiPonorogo != null ? deviasiPonorogo.toLocaleString("id-ID") : "-"}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Total Periode Terpilih</p>
                <p className="font-display text-sm font-semibold tabular-nums">
                  {grandTotal.toLocaleString("id-ID")} kantong
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
                        "rounded-lg border p-2.5 text-left transition-colors",
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

                      {/* Middle row: "Hari ini:"/"Kemarin:" labels above their
                          numbers (left) paired with the period total,
                          vertically centered on the right. A vertical divider
                          separates the day figures from "periode terpilih" so
                          they read as distinct figures instead of running
                          together. */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="min-w-0">
                            <p className="text-[9px] text-muted-foreground">Hari ini:</p>
                            <p className="text-sm font-semibold tabular-nums">
                              {w.TotalKantongHariIni.toLocaleString("id-ID")}
                            </p>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[9px] text-muted-foreground">Kemarin:</p>
                            <p className="text-sm font-semibold tabular-nums text-muted-foreground">
                              {w.TotalKantongKemarinIni.toLocaleString("id-ID")}
                            </p>
                          </div>
                        </div>
                        <div className="h-6 shrink-0 border-l" />
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

                      {/* Bottom row: actual average delivered per day (left,
                          "Rata-rata:" label replaced with an icon to keep it
                          compact) paired with the arrow (right) — directly
                          under "Target periode" above it, and sejajar
                          (same row) with Rata-rata, instead of pinned to the
                          tile's bottom-right corner. */}
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <p className="flex items-center gap-1 text-[10px] tabular-nums text-muted-foreground">
                          <EqualApproximately className="size-3 shrink-0" />
                          {w.AvgPerHari.toLocaleString("id-ID", { maximumFractionDigits: 1 })}/hari
                        </p>
                        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Kontribusi per wilayah terhadap total (100%) — beda konsep dari
                %Pencapaian Target di tile atas. Selalu tampil (tidak ikut
                collapsed) karena ini ringkasan level-panel, sama seperti kotak
                Total di atas. Satu baris yang bisa di-scroll horizontal
                (bukan grid yang wrap) supaya jumlah wilayah berapa pun (saat
                ini bisa sampai 9) tidak pernah membuat lebih dari 1 baris
                atau saling tumpang tindih pada layar sempit — eksplisit per
                permintaan. */}
            <div className="flex flex-col gap-1.5 border-t pt-2.5">
              <p className="text-[10px] text-muted-foreground">
                Kontribusi Wilayah — <span className="font-medium">Harian</span> |{" "}
                <span className="font-medium">Periode Terpilih</span>
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {sortedData.map((w) => {
                  const pctHarian = grandTotalToday > 0 ? (w.TotalKantongHariIni / grandTotalToday) * 100 : 0;
                  const pctPeriode = grandTotal > 0 ? (w.TotalKantong / grandTotal) * 100 : 0;
                  return (
                    <div
                      key={w.Wilayah}
                      className="flex shrink-0 flex-col items-center gap-1 rounded-md border border-border bg-card/50 px-2 py-1.5"
                    >
                      <p className="max-w-20 truncate text-[10px] font-medium text-muted-foreground">{w.Wilayah}</p>
                      <p className="whitespace-nowrap text-xs font-semibold tabular-nums">
                        {pctHarian.toFixed(0)}%<span className="mx-1 font-normal text-muted-foreground">|</span>
                        {pctPeriode.toFixed(0)}%
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
