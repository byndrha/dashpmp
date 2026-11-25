"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, EqualApproximately, Info, Star, Target } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

// Wilayah tanpa aktivitas sama sekali (periode, hari ini, kemarin, dan
// target semuanya 0 — mis. "Tidak Diketahui" yang sudah bersih) tidak
// ditampilkan. Wilayah bertarget tapi belum bertransaksi TETAP tampil:
// itu justru informasi.
function adaIsi(w: WilayahDeliverySummary): boolean {
  return w.TotalKantong > 0 || w.TotalKantongHariIni > 0 || w.TotalKantongKemarinIni > 0 || (w.TargetHarian ?? 0) > 0;
}

const angka = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 0 });

// Satu angka di dalam KotakRingkas; dipisah garis vertikal dari tetangganya.
function Statistik({
  label,
  nilai,
  sub,
  aksen = false,
}: {
  label: ReactNode;
  nilai: string;
  sub?: string;
  aksen?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 border-l pl-3 first:border-l-0 first:pl-0">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("font-display text-base font-semibold whitespace-nowrap tabular-nums", aksen && "text-primary")}>
        {nilai}
      </p>
      {sub && <p className="truncate text-[10px] text-muted-foreground tabular-nums">{sub}</p>}
    </div>
  );
}

// Warna segmen komposisi mengikuti urutan tampil wilayah (prioritas), jadi
// satu wilayah selalu berwarna sama di bilah Hari Ini maupun Periode.
const WARNA_KOMPOSISI = [
  "bg-primary",
  "bg-primary/80",
  "bg-primary/65",
  "bg-primary/50",
  "bg-primary/40",
  "bg-primary/30",
  "bg-primary/22",
  "bg-primary/15",
];

// Porsi tiap wilayah dari total, sebagai satu bilah bertumpuk + legenda.
// Wilayah bernilai 0 tidak ditampilkan; lebih dari 8 wilayah → sisanya
// digabung jadi "Lainnya".
function BilahKomposisi({ items, total }: { items: { nama: string; nilai: number }[]; total: number }) {
  if (total <= 0) {
    return <p className="text-[10px] text-muted-foreground">Belum ada kiriman untuk dibagi per wilayah.</p>;
  }
  const utama = items.slice(0, WARNA_KOMPOSISI.length).map((it, idx) => ({ ...it, warna: WARNA_KOMPOSISI[idx] }));
  const sisa = items.slice(WARNA_KOMPOSISI.length).reduce((sum, it) => sum + it.nilai, 0);
  const segmen = [...utama, { nama: "Lainnya", nilai: sisa, warna: "bg-muted-foreground/40" }].filter(
    (sg) => sg.nilai > 0
  );
  const persen = (n: number) => ((n / total) * 100).toFixed(0);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-2 gap-px overflow-hidden rounded-full bg-muted">
        {segmen.map((sg) => (
          <div
            key={sg.nama}
            className={cn("h-full", sg.warna)}
            style={{ flexGrow: sg.nilai, flexBasis: 0 }}
            title={`${sg.nama}: ${angka(sg.nilai)} kantong (${persen(sg.nilai)}%)`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] text-muted-foreground tabular-nums">
        {segmen.map((sg) => (
          <span key={sg.nama} className="inline-flex items-center gap-1">
            <span className={cn("size-1.5 shrink-0 rounded-full", sg.warna)} />
            {sg.nama} <span className="font-medium text-foreground">{persen(sg.nilai)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function KotakRingkas({ judul, bawah, children }: { judul?: string; bawah?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col justify-center gap-2 rounded-lg border bg-card/60 px-3 py-2">
      {judul && <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{judul}</p>}
      <div className="flex gap-3">{children}</div>
      {bawah && <div className="border-t pt-2">{bawah}</div>}
    </div>
  );
}

export function WilayahDeliveryPanel({
  data,
  onWilayahClick,
}: {
  data: WilayahDeliverySummary[];
  onWilayahClick?: (wilayah: string) => void;
}) {
  const [ringkas, setRingkas] = useState(false);
  const tampil = sortByPriority(data.filter(adaIsi));

  const totalPeriode = data.reduce((sum, w) => sum + w.TotalKantong, 0);
  const totalHariIni = data.reduce((sum, w) => sum + w.TotalKantongHariIni, 0);
  const totalKemarin = data.reduce((sum, w) => sum + w.TotalKantongKemarinIni, 0);
  const targetPeriode = data.reduce((sum, w) => sum + (w.TargetPeriode ?? 0), 0);
  const pctCapai = targetPeriode > 0 ? (totalPeriode / targetPeriode) * 100 : null;
  // Sum of every wilayah's own Target/Hari — was a fixed company-wide figure
  // (4000) set by management; now derived from data per explicit request.
  const targetPerHariTotal = data.reduce((sum, w) => sum + (w.TargetHarian ?? 0), 0);
  const ponorogo = data.find((w) => w.Wilayah === "Ponorogo");
  const deviasiPonorogo = ponorogo?.TargetHarian != null ? targetPerHariTotal - ponorogo.TargetHarian : null;

  const exportRows = sortByPriority(data).map((w) => ({
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
          <CardDescription>
            Kantong terkirim (DO) tiap wilayah. Klik wilayah untuk menyaring panel di bawah.
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setRingkas((v) => !v)} aria-expanded={!ringkas}>
            <ChevronDown className={cn("size-3.5 transition-transform", ringkas && "-rotate-90")} />
            {ringkas ? "Tampilkan wilayah" : "Ringkas"}
          </Button>
          <ExportXlsxButton
            filename="pengiriman-per-wilayah"
            sheetName="Pengiriman per Wilayah"
            columns={EXPORT_COLUMNS}
            rows={exportRows}
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Belum ada pengiriman pada periode ini.</p>
        ) : (
          <>
            {/* Ringkasan seluruh wilayah: kotak Harian (hari ini + target,
                kemarin + deviasi) dan kotak Periode (total, target, tercapai). */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <KotakRingkas
                bawah={
                  <BilahKomposisi
                    items={tampil.map((w) => ({
                      nama: w.Wilayah,
                      nilai: w.TotalKantongHariIni,
                    }))}
                    total={totalHariIni}
                  />
                }
              >
                <Statistik
                  label="Capaian Target Hari Ini"
                  nilai={`${angka(totalHariIni)} dari ${angka(targetPerHariTotal)}/hari`}
                  aksen
                />
                <Statistik label="Kemarin" nilai={`${angka(totalKemarin)} kantong`} />
                {deviasiPonorogo != null && (
                  <Statistik
                    label={
                      <Tooltip>
                        <TooltipTrigger render={<span className="inline-flex cursor-help items-center gap-1" />}>
                          <Star className="size-2.5 fill-primary text-primary" />
                          Deviasi
                          <Info className="size-3" />
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="w-64 max-w-64 gap-2 p-3">
                          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                            <Star className="size-3 fill-primary text-primary" />
                            Deviasi
                          </p>
                          <p className="text-muted-foreground">
                            Target harian yang harus dipenuhi wilayah selain Ponorogo.
                          </p>
                          <div className="flex w-full flex-col gap-1 rounded-md bg-muted/60 px-2.5 py-2 tabular-nums">
                            <p className="flex justify-between gap-3">
                              <span className="text-muted-foreground">Target semua wilayah</span>
                              <span className="font-medium text-foreground">{angka(targetPerHariTotal)}</span>
                            </p>
                            <p className="flex justify-between gap-3">
                              <span className="text-muted-foreground">Target Ponorogo</span>
                              <span className="font-medium text-foreground">
                                − {angka(ponorogo?.TargetHarian ?? 0)}
                              </span>
                            </p>
                            <p className="mt-0.5 flex justify-between gap-3 border-t border-border pt-1">
                              <span className="font-semibold text-foreground">Deviasi</span>
                              <span className="font-semibold text-primary">{angka(deviasiPonorogo)}/hari</span>
                            </p>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    }
                    nilai={`${angka(deviasiPonorogo)}/hari`}
                  />
                )}
              </KotakRingkas>
              <KotakRingkas
                bawah={
                  <BilahKomposisi
                    items={tampil.map((w) => ({
                      nama: w.Wilayah,
                      nilai: w.TotalKantong,
                    }))}
                    total={totalPeriode}
                  />
                }
              >
                <Statistik label="Total Periode" nilai={`${angka(totalPeriode)} kantong`} />
                <Statistik label="Target Periode" nilai={`${angka(targetPeriode)} kantong`} />
                <Statistik
                  label="Tercapai"
                  nilai={pctCapai != null ? `${pctCapai.toFixed(0)}%` : "-"}
                  aksen={pctCapai != null && pctCapai >= 100}
                />
              </KotakRingkas>
            </div>

            {!ringkas && (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">
                {tampil.map((w) => {
                  const pct = w.PctAchievement;
                  const utama = w.Wilayah === "Ponorogo";
                  return (
                    <button
                      key={w.Wilayah}
                      type="button"
                      onClick={() => onWilayahClick?.(w.Wilayah)}
                      className={cn(
                        "rounded-lg border px-2.5 pt-2 pb-2 text-left transition-colors",
                        utama ? "border-primary/30 bg-primary/5" : "bg-card/50",
                        onWilayahClick && "hover:border-primary/40 hover:bg-primary/10"
                      )}
                    >
                      {/* Satu angka utama per wilayah:
                          ★ nama
                          bilah capaian              | % tercapai
                          Hari ini 100               | (◎ 1.849/hari)
                          ≈ rata-rata/hari           | ‹ kemarin */}
                      {/* Tiap baris flex sendiri (bukan grid bersama) supaya
                          panjang bilah hanya dipotong chip %-nya, tidak ikut
                          menyempit karena chip target yang lebih lebar. */}
                      <div className="flex flex-col gap-1.5">
                        <p className="flex min-w-0 items-center gap-1 text-sm leading-tight font-semibold">
                          {utama && <Star className="size-3 shrink-0 fill-primary text-primary" />}
                          <span className="truncate">{w.Wilayah}</span>
                        </p>

                        <div className="flex items-center gap-2">
                          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                pct != null && pct >= 100 ? "bg-primary" : "bg-primary/60"
                              )}
                              style={{ width: `${Math.min(100, pct ?? 0)}%` }}
                            />
                          </div>
                          <span
                            className={cn(
                              "w-10 shrink-0 rounded text-center text-[11px] leading-4 font-semibold tabular-nums",
                              pct == null
                                ? "bg-muted text-muted-foreground"
                                : pct >= 100
                                ? "bg-primary/15 text-primary"
                                : "bg-muted text-foreground"
                            )}
                            title={`Ketercapaian target periode: ${angka(w.TotalKantong)} dari ${
                              w.TargetPeriode != null ? angka(w.TargetPeriode) : "-"
                            } kantong`}
                          >
                            {pct != null ? `${pct.toFixed(0)}%` : "-"}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <p className="flex items-baseline gap-1 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">
                            Hari ini
                            <span className="text-sm leading-none font-semibold text-foreground">
                              {angka(w.TotalKantongHariIni)}
                            </span>
                          </p>
                          <span
                            className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted px-1.5 text-[10px] leading-4 whitespace-nowrap text-muted-foreground tabular-nums"
                            title="Target harian"
                          >
                            <Target className="size-3 shrink-0" />
                            {w.TargetHarian != null ? `${angka(w.TargetHarian)}/hari` : "-"}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-2 border-t pt-1">
                          <span
                            className="inline-flex items-center gap-0.5 text-[10px] whitespace-nowrap text-muted-foreground tabular-nums"
                            title="Rata-rata terkirim per hari"
                          >
                            <EqualApproximately className="size-3 shrink-0" />
                            {angka(w.AvgPerHari)}/hari
                          </span>
                          <span
                            className="inline-flex items-center gap-0.5 text-[10px] whitespace-nowrap text-muted-foreground tabular-nums"
                            title="Kemarin"
                          >
                            <ChevronLeft className="size-3 shrink-0" />
                            {angka(w.TotalKantongKemarinIni)}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
