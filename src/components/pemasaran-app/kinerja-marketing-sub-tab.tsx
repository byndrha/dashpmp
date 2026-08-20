"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Star, Loader2, Users, ArrowUp, ArrowDown, Search, List } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatRupiah } from "@/lib/format";
import {
  getKinerjaMarketingAction,
  getKinerjaMarketingTrendAction,
  getVisitLogDetailAction,
  saveVisitLogAction,
} from "@/app/mkesindo/pemasaran-app/actions";
import type { KinerjaMarketingData } from "@/app/mkesindo/pemasaran-app/actions";
import type { MarketingPerformanceTrendData } from "@/lib/queries/marketing-performance-trend";
import type { PangsaPasarTrendData } from "@/lib/queries/pangsa-pasar-trend";
import { MatriksPerformaTable, PangsaPasarTable, TrendExpandButton } from "@/components/dashboard/marketing-trend-tables";

function formatQty(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

// dayIndex -> calendar date, same convention as marketing-performance.ts's
// DailyQty indexing (index 0 = rangeStartISO, index N = rangeStartISO + N
// days) — mirrors the private addDaysISO in marketing-performance-panel.tsx,
// duplicated locally since that one isn't exported.
function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDateLong(dateISO: string): string {
  return `${dateISO.slice(8, 10)}/${dateISO.slice(5, 7)}/${dateISO.slice(0, 4)}`;
}

// Per-day quantity box for a mitra's roster card — ported from desktop's
// MitraDayCell (marketing-performance-panel.tsx), but opens a Dialog instead
// of a Popover (mobile's existing pattern, per log-kunjungan-sub-tab.tsx) and
// shows a filled background instead of a corner dot when hasEntry is true
// (narrow w-12 box has no room for both a legible dot and the qty/delta
// text). Delta color/arrow convention matches MitraDayCell exactly: positive
// = primary + up-arrow, negative = destructive + down-arrow, zero = muted
// with no arrow, no-prior-day = an em-dash. isPast also mirrors MitraDayCell
// (show "-" and suppress the delta for a day that hasn't happened yet,
// since `windowIndices` is the last N indices of the *configured* period,
// which can extend past today) — additionally disabled/non-clickable here,
// since there's no point opening a visit-log dialog for a future day.
function DayBox({
  dateISO,
  qty,
  prevQty,
  isPast,
  hasEntry,
  onOpen,
}: {
  dateISO: string;
  qty: number;
  prevQty: number | null;
  isPast: boolean;
  hasEntry: boolean;
  onOpen: () => void;
}) {
  const delta = isPast && prevQty != null ? qty - prevQty : null;
  const dayLabel = dateISO.slice(8, 10);
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!isPast}
      title={isPast ? "Klik untuk catat kunjungan" : "Belum terjadi"}
      className={cn(
        "flex w-12 shrink-0 flex-col items-center gap-0.5 rounded px-1.5 py-1 text-[11px] tabular-nums transition-colors disabled:cursor-default disabled:opacity-60",
        hasEntry ? "bg-primary/15" : "bg-muted"
      )}
    >
      <span className="text-[9px] text-muted-foreground">{dayLabel}</span>
      <span className="font-medium">{isPast ? formatQty(qty) : "-"}</span>
      {delta != null ? (
        <span
          className={cn(
            "flex items-center gap-0.5 text-[9px]",
            delta > 0 && "text-primary",
            delta < 0 && "text-destructive",
            delta === 0 && "text-muted-foreground/50"
          )}
        >
          {delta > 0 && <ArrowUp className="size-2.5 shrink-0" />}
          {delta < 0 && <ArrowDown className="size-2.5 shrink-0" />}
          {delta > 0 ? `+${formatQty(delta)}` : formatQty(delta)}
        </span>
      ) : (
        <span className="text-[9px] text-muted-foreground/30">&mdash;</span>
      )}
    </button>
  );
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
  const [data, setData] = useState<KinerjaMarketingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNoo, setShowNoo] = useState(false);
  // Both default open (matches today's always-shown behavior) — the toggle
  // just lets the rep collapse whichever section they aren't using, same
  // mechanism as showNoo above.
  const [showPrioritas, setShowPrioritas] = useState(true);
  const [showSemuaMitra, setShowSemuaMitra] = useState(true);
  const [search, setSearch] = useState("");
  const [wilayahFilter, setWilayahFilter] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState<5 | 7 | 30>(5);

  const [trend, setTrend] = useState<{ performance: MarketingPerformanceTrendData; pangsaPasar: PangsaPasarTrendData } | null>(null);
  const [trendExpanded, setTrendExpanded] = useState(false);
  const [trendPending, startTrendTransition] = useTransition();

  // Hasil Kunjungan dialog for a clicked mitra+date DayBox. Keyed per
  // `${businessPartnerId}|${dateISO}` (many boxes per card, unlike
  // log-kunjungan-sub-tab.tsx's one-dialog-per-mitra-for-today).
  const [activeDay, setActiveDay] = useState<{ businessPartnerId: string; mitraName: string; dateISO: string } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [hasilKunjungan, setHasilKunjungan] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  // Read fresh after an await so a save/fetch for a day the user has since
  // closed the dialog for (or clicked a different box on) can't paint stale
  // state over the wrong dialog — same guard pattern as
  // log-kunjungan-sub-tab.tsx's editingIdRef, keyed per mitra+date here.
  const activeKeyRef = useRef<string | null>(null);
  const [savePending, startSaveTransition] = useTransition();
  const [hasEntry, setHasEntry] = useState<Set<string>>(new Set());

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

  function openDay(businessPartnerId: string, mitraName: string, dateISO: string) {
    const key = `${businessPartnerId}|${dateISO}`;
    activeKeyRef.current = key;
    setActiveDay({ businessPartnerId, mitraName, dateISO });
    setHasilKunjungan("");
    setSaveError(null);
    setDetailError(null);
    setDetailLoading(true);
    getVisitLogDetailAction(businessPartnerId, dateISO).then((result) => {
      if (activeKeyRef.current !== key) return; // dialog moved on while this was in flight
      setDetailLoading(false);
      if (!result.success) {
        setDetailError(result.error);
        return;
      }
      if (result.data) {
        setHasilKunjungan(result.data.HasilKunjungan ?? "");
        setHasEntry((prev) => new Set(prev).add(key));
      }
    });
  }

  function closeDay() {
    activeKeyRef.current = null;
    setActiveDay(null);
    setDetailError(null);
    setSaveError(null);
  }

  function handleSaveVisitLog(formData: FormData) {
    if (!activeDay) return;
    const { businessPartnerId, dateISO } = activeDay;
    const key = `${businessPartnerId}|${dateISO}`;
    const note = String(formData.get("note") ?? "").trim();
    setSaveError(null);
    startSaveTransition(async () => {
      const result = await saveVisitLogAction({ businessPartnerId, dateISO, hasilKunjungan: note || null });
      // Dialog may have closed or moved to a different mitra+date while this
      // save was in flight — only touch state if it's still showing the
      // mitra+date this request was actually for.
      if (activeKeyRef.current !== key) return;
      if (!result.success) {
        setSaveError(result.error);
        return;
      }
      setHasEntry((prev) => new Set(prev).add(key));
      closeDay();
    });
  }

  const ownMitraId = data?.cells[0]?.MarketingUserID;
  const roster = useMemo(() => (ownMitraId && data ? (data.allMitraByMarketing[ownMitraId] ?? []) : []), [ownMitraId, data]);

  const todayISO = data?.todayISO ?? "";
  const currentMonthStartISO = todayISO ? `${todayISO.slice(0, 7)}-01` : "";

  // Distinct Wilayah values across the caller's own roster, for the filter
  // dropdown below — client-side only, not a separate query (unlike the
  // dedicated WilayahSelect used by mitra create/edit forms, which resolves
  // real official region codes).
  const wilayahOptions = useMemo(
    () => [...new Set(roster.map((m) => m.Wilayah).filter((w): w is string => !!w))].sort(),
    [roster]
  );

  // search/wilayahFilter apply on top of every bucket below (name substring
  // match case-insensitive, Wilayah exact match) — inlined into each
  // `.filter()` chain rather than a shared predicate so useMemo's own
  // dependency arrays stay the source of truth (matches this file's existing
  // style; no new abstraction).
  const searchLower = search.trim().toLowerCase();

  // 3-way split, replacing the old existing/NOO split now that
  // IsPriorityOverride/IsCrossWilayahProposal live directly on each roster
  // row (Task 3): Prioritas wins over both other buckets (no double-listing
  // — both other filters explicitly exclude it), Semua Mitra is the
  // JoinDate-based "existing" collapse minus Prioritas and cross-wilayah
  // mitra, and Mitra NOO now also picks up cross-wilayah mitra regardless of
  // JoinDate (a cross-wilayah Pengajuan owner counts as NOO every month it's
  // resolved into this scope, same rule marketing-performance-trend.ts's
  // isNoo applies historically).
  const prioritasRoster = useMemo(
    () =>
      roster
        .filter((m) => m.IsPriorityOverride)
        .filter((m) => (!searchLower || m.Name.toLowerCase().includes(searchLower)) && (!wilayahFilter || m.Wilayah === wilayahFilter))
        .sort((a, b) => (b.Capacity ?? 0) - (a.Capacity ?? 0)),
    [roster, searchLower, wilayahFilter]
  );
  const semuaMitraRoster = useMemo(
    () =>
      roster
        .filter(
          (m) =>
            !m.IsPriorityOverride &&
            !m.IsCrossWilayahProposal &&
            (!m.JoinDate || new Date(m.JoinDate).getTime() < new Date(currentMonthStartISO).getTime())
        )
        .filter((m) => (!searchLower || m.Name.toLowerCase().includes(searchLower)) && (!wilayahFilter || m.Wilayah === wilayahFilter))
        .sort((a, b) => (b.Capacity ?? 0) - (a.Capacity ?? 0)),
    [roster, currentMonthStartISO, searchLower, wilayahFilter]
  );
  const nooRoster = useMemo(
    () =>
      roster
        .filter(
          (m) =>
            !m.IsPriorityOverride &&
            (m.IsCrossWilayahProposal || (!!m.JoinDate && new Date(m.JoinDate).getTime() >= new Date(currentMonthStartISO).getTime()))
        )
        .filter((m) => (!searchLower || m.Name.toLowerCase().includes(searchLower)) && (!wilayahFilter || m.Wilayah === wilayahFilter))
        .sort((a, b) => (b.Capacity ?? 0) - (a.Capacity ?? 0)),
    [roster, currentMonthStartISO, searchLower, wilayahFilter]
  );

  if (error) return <p className="p-4 text-sm text-destructive">{error}</p>;
  if (!data) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // windowDays (5/7/30, from the date-range control below) is capped to
  // data.periodDays — the configured Kinerja Marketing period defaults to a
  // full calendar month (getMarketingPeriodSetting()'s DEFAULT_SETTING is
  // periodDays: 31), so the 30-day option is already covered without
  // widening the query window; Math.min just protects against a shorter
  // admin-configured period.
  const windowSize = Math.min(windowDays, data.periodDays);
  const windowIndices = Array.from({ length: windowSize }, (_, i) => data.periodDays - windowSize + i);
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
              {m.Harga != null && <p className="text-xs text-muted-foreground">Harga {formatRupiah(m.Harga)}</p>}
            </div>
            <div className="flex shrink-0 flex-col items-end leading-none">
              <span className="text-lg font-semibold tabular-nums">{formatQty(total)}</span>
              <span className="text-[10px] text-muted-foreground">kantong</span>
            </div>
          </div>
          <div className="flex gap-1.5 overflow-x-auto">
            {windowIndices.map((i) => {
              const dateISO = addDaysISO(data!.rangeStartISO, i);
              return (
                <DayBox
                  key={i}
                  dateISO={dateISO}
                  qty={daily[i] ?? 0}
                  prevQty={i > 0 ? (daily[i - 1] ?? 0) : null}
                  isPast={dateISO <= todayISO}
                  hasEntry={hasEntry.has(`${m.BusinessPartnerID}|${dateISO}`)}
                  onOpen={() => openDay(m.BusinessPartnerID, m.Name, dateISO)}
                />
              );
            })}
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

      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cari nama mitra..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Select value={wilayahFilter ?? "all"} onValueChange={(v) => setWilayahFilter(v === "all" ? null : (v as string))}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Wilayah" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Wilayah</SelectItem>
              {wilayahOptions.map((w) => (
                <SelectItem key={w} value={w}>
                  {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex gap-1">
            {([5, 7, 30] as const).map((d) => (
              <Button
                key={d}
                type="button"
                size="sm"
                variant={windowDays === d ? "default" : "outline"}
                className="h-8 px-2.5 text-xs"
                onClick={() => setWindowDays(d)}
              >
                {d} Hari
              </Button>
            ))}
          </div>
        </div>
      </div>

      {prioritasRoster.length > 0 && (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-fit gap-1 px-1 text-xs text-muted-foreground"
            onClick={() => setShowPrioritas((v) => !v)}
          >
            <Star className={cn("size-3.5", showPrioritas && "fill-warning text-warning")} />
            {showPrioritas ? "Sembunyikan" : "Tampilkan"} {prioritasRoster.length} Mitra Prioritas
          </Button>
          {showPrioritas && prioritasRoster.map((m) => <RosterCard key={m.BusinessPartnerID} m={m} />)}
        </div>
      )}

      {semuaMitraRoster.length > 0 && (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-fit gap-1 px-1 text-xs text-muted-foreground"
            onClick={() => setShowSemuaMitra((v) => !v)}
          >
            <List className={cn("size-3.5", showSemuaMitra && "text-primary")} />
            {showSemuaMitra ? "Sembunyikan" : "Tampilkan"} {semuaMitraRoster.length} Semua Mitra
          </Button>
          {showSemuaMitra && semuaMitraRoster.map((m) => <RosterCard key={m.BusinessPartnerID} m={m} />)}
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

      <Dialog open={activeDay != null} onOpenChange={(open) => !open && closeDay()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Hasil Kunjungan — {activeDay?.mitraName}
              {activeDay ? `, ${formatDateLong(activeDay.dateISO)}` : ""}
            </DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Memuat...
            </div>
          ) : detailError ? (
            <p className="text-xs text-destructive">{detailError}</p>
          ) : (
            <form action={handleSaveVisitLog} className="flex flex-col gap-3">
              <Label htmlFor="note" className="sr-only">
                Hasil Kunjungan
              </Label>
              <Textarea
                id="note"
                name="note"
                rows={4}
                defaultValue={hasilKunjungan}
                placeholder="Catat hasil kunjungan ke mitra ini..."
              />
              {saveError && <p className="text-xs text-destructive">{saveError}</p>}
              <DialogFooter>
                <Button type="submit" disabled={savePending}>
                  {savePending ? "Menyimpan..." : "Simpan"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
