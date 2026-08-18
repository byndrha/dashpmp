"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Star, Loader2, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getKinerjaMarketingAction, getKinerjaMarketingTrendAction } from "@/app/mkesindo/pemasaran-app/actions";
import type { MarketingPerformanceData } from "@/lib/queries/marketing-performance";
import type { MarketingPerformanceTrendData } from "@/lib/queries/marketing-performance-trend";
import type { PangsaPasarTrendData } from "@/lib/queries/pangsa-pasar-trend";
import { MatriksPerformaTable, PangsaPasarTable, TrendExpandButton } from "@/components/dashboard/marketing-trend-tables";

function formatQty(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

function SummaryCard({ label, general, actual, target }: { label: string; general: number; actual: number; target: number }) {
  const pct = target > 0 ? (actual / target) * 100 : null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-0.5 p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-display text-lg font-semibold tabular-nums">{formatQty(general)} outlet</p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {formatQty(actual)}/{formatQty(target)} kantong{pct != null ? ` (${pct.toFixed(0)}%)` : ""}
        </p>
      </CardContent>
    </Card>
  );
}

export function KinerjaMarketingSubTab() {
  const [data, setData] = useState<MarketingPerformanceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNoo, setShowNoo] = useState(false);

  const [trend, setTrend] = useState<{ performance: MarketingPerformanceTrendData; pangsaPasar: PangsaPasarTrendData } | null>(null);
  const [trendExpanded, setTrendExpanded] = useState(false);
  const [trendPending, startTrendTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getKinerjaMarketingAction().then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
      setData(result.data);
    });
    getKinerjaMarketingTrendAction(3).then((result) => {
      if (cancelled || !result.success) return;
      setTrend(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleTrendToggle() {
    const nextMonthsBack: 3 | 12 = trendExpanded ? 3 : 12;
    startTrendTransition(async () => {
      const result = await getKinerjaMarketingTrendAction(nextMonthsBack);
      if (result.success) {
        setTrend(result.data);
        setTrendExpanded(!trendExpanded);
      }
    });
  }

  const ownMitraId = data?.cells[0]?.MarketingUserID;
  const roster = useMemo(() => (ownMitraId && data ? (data.allMitraByMarketing[ownMitraId] ?? []) : []), [ownMitraId, data]);

  const todayISO = data?.todayISO ?? "";
  const currentMonthStartISO = todayISO ? `${todayISO.slice(0, 7)}-01` : "";
  const existingRoster = useMemo(
    () =>
      roster
        .filter((m) => !m.JoinDate || new Date(m.JoinDate).getTime() < new Date(currentMonthStartISO).getTime())
        .sort((a, b) => (b.Capacity ?? 0) - (a.Capacity ?? 0)),
    [roster, currentMonthStartISO]
  );
  const nooRoster = useMemo(
    () =>
      roster
        .filter((m) => !!m.JoinDate && new Date(m.JoinDate).getTime() >= new Date(currentMonthStartISO).getTime())
        .sort((a, b) => (b.Capacity ?? 0) - (a.Capacity ?? 0)),
    [roster, currentMonthStartISO]
  );

  if (error) return <p className="p-4 text-sm text-destructive">{error}</p>;
  if (!data) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const windowSize = Math.min(5, data.periodDays);
  const last5 = Array.from({ length: windowSize }, (_, i) => data.periodDays - windowSize + i);
  const ownTrendRow = trend?.performance.rows[0];
  const ownPangsaPasarRow = trend?.pangsaPasar.rows[0];
  const currentMonth = ownTrendRow?.months[ownTrendRow.months.length - 1];

  function RosterCard({ m }: { m: (typeof roster)[number] }) {
    const daily = data!.mitraDailyQty[m.BusinessPartnerID] ?? [];
    const total = daily.reduce((s, q) => s + q, 0);
    return (
      <Card key={m.BusinessPartnerID}>
        <CardContent className="flex flex-col gap-1.5 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="flex items-center gap-1 text-sm font-medium">
                {(m.Capacity ?? 0) > 0 && <Star className="size-3 fill-warning text-warning" />}
                {m.Name}
              </p>
              <p className="text-xs text-muted-foreground">
                {m.Wilayah}
                {m.Kecamatan ? ` - ${m.Kecamatan}` : ""} · Target {formatQty(m.Capacity ?? 0)}/hari
              </p>
            </div>
            <p className="shrink-0 tabular-nums font-medium">{formatQty(total)} kantong</p>
          </div>
          <div className="flex gap-1.5">
            {last5.map((i) => (
              <span key={i} className="rounded bg-muted px-2 py-0.5 text-[11px] tabular-nums">
                {formatQty(daily[i] ?? 0)}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {currentMonth && (
        <div className="grid grid-cols-3 gap-2">
          <SummaryCard label="Existing" general={currentMonth.existing.general} actual={currentMonth.existing.bagQtyActual} target={currentMonth.existing.bagQtyTarget} />
          <SummaryCard label="NOO" general={currentMonth.noo.general} actual={currentMonth.noo.bagQtyActual} target={currentMonth.noo.bagQtyTarget} />
          <SummaryCard label="Total" general={currentMonth.total.general} actual={currentMonth.total.bagQtyActual} target={currentMonth.total.bagQtyTarget} />
        </div>
      )}

      {existingRoster.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="px-1 text-xs font-semibold text-muted-foreground">Existing</p>
          {existingRoster.map((m) => (
            <RosterCard key={m.BusinessPartnerID} m={m} />
          ))}
        </div>
      )}

      {nooRoster.length > 0 && (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-fit gap-1 px-1 text-xs text-muted-foreground"
            onClick={() => setShowNoo((v) => !v)}
          >
            <Users className={cn("size-3.5", showNoo && "text-primary")} />
            {showNoo ? "Sembunyikan" : "Tampilkan"} {nooRoster.length} mitra NOO bulan ini
          </Button>
          {showNoo && nooRoster.map((m) => <RosterCard key={m.BusinessPartnerID} m={m} />)}
        </div>
      )}

      {ownTrendRow && (
        <div className="flex flex-col gap-2 rounded-lg border p-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">Matriks Performa</p>
            <TrendExpandButton expanded={trendExpanded} onToggle={handleTrendToggle} pending={trendPending} />
          </div>
          <MatriksPerformaTable
            months={ownTrendRow.months.map((m) => m.monthStartISO)}
            existing={ownTrendRow.months.map((m) => m.existing)}
            noo={ownTrendRow.months.map((m) => m.noo)}
            total={ownTrendRow.months.map((m) => m.total)}
            title="Bulan"
          />
          {ownPangsaPasarRow && (
            <>
              <p className="text-xs font-semibold">Pangsa Pasar &amp; Kontribusi Internal</p>
              <PangsaPasarTable rows={ownPangsaPasarRow.months} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
