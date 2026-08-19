"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUp,
  ArrowDown,
  Percent,
  Plus,
  Search,
  MessageCircle,
  Phone,
  Eye,
  EyeOff,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExportXlsxButton } from "@/components/dashboard/export-xlsx-button";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { XlsxColumn } from "@/lib/export-xlsx";
import type { MitraDOMonthly, MitraDORow } from "@/lib/queries/mitra-do";
import type { ContactType, MitraContactLogSummaryEntry } from "@/lib/queries/mitra-contact-log";
import { updateMitraCapacityAction } from "@/app/mkesindo/(dashboard)/mitra/actions";
import { getMitraContactLogAction, saveMitraContactLogAction } from "@/app/mkesindo/(dashboard)/transaksi/actions";

type SortMode = "target" | "persentase" | "terbanyak" | "tren" | "terbaru";

const SORT_OPTIONS: Record<SortMode, { label: string; icon: LucideIcon }> = {
  target: { label: "Target", icon: ArrowUp },
  persentase: { label: "Capaian", icon: Percent },
  terbanyak: { label: "Kuantitas", icon: ArrowUp },
  tren: { label: "Tren Terkini", icon: TrendingUp },
  terbaru: { label: "Mitra Terbaru", icon: Plus },
};

// Fixed width for the sticky-left info column, shared between the header
// spacer and every row's info block so the date columns line up exactly.
const INFO_COL_CLASS = "w-52 sm:w-56";
// Fixed width for each date column, shared between the header's per-date
// total cells and every row's DayChip so both line up exactly. Height is
// min-h (not fixed) on both — either can grow to fit an Angka Pemesanan
// readout line without breaking the shared width alignment.
const DAY_COL_WIDTH_CLASS = "w-12";

function formatQty(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Compares the sum of the latest 3 elapsed days against the 3 days before
// that — a simple period-over-period read on whether a mitra's pickups are
// trending up or down, not just their running total. Needs at least 6 days
// elapsed in the filtered range for a fair comparison; before that there's
// no "previous 3 days" window yet, so it reports flat rather than guessing.
function getTrend(dailyQty: number[], elapsedDays: number): { direction: "up" | "down" | "flat"; delta: number } {
  const latestStart = elapsedDays - 3;
  const prevStart = elapsedDays - 6;
  if (prevStart < 0) return { direction: "flat", delta: 0 };
  const latest = dailyQty.slice(latestStart, elapsedDays).reduce((sum, q) => sum + q, 0);
  const previous = dailyQty.slice(prevStart, latestStart).reduce((sum, q) => sum + q, 0);
  const delta = latest - previous;
  return { direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat", delta };
}

function TrendIcon({ direction }: { direction: "up" | "down" | "flat" }) {
  if (direction === "up") return <TrendingUp className="mt-0.5 inline-block size-3.5 text-primary" />;
  if (direction === "down") return <TrendingDown className="mt-0.5 inline-block size-3.5 text-destructive" />;
  return <Minus className="mt-0.5 inline-block size-3.5 text-muted-foreground/40" />;
}

// Narrator log for one mitra+date+channel — what a phone/chat follow-up
// turned up about a discrepancy between what was ordered and what actually
// shipped. Fetched lazily on open (one mitra, one date, both channels in a
// single call) rather than bundled into the page's initial load, which
// would mean a query per mitra per visible date — easily thousands of rows
// nobody's looking at yet.
//
// Every date column's log button gets the Hari ini/Besok tab switcher —
// "Hari ini" and "Besok" are relative to whichever date this particular
// button belongs to (dateISO), not to the real calendar today. Opening the
// log for 01/08 and picking "Besok" edits 02/08's own entry; the switcher
// exists purely as a convenience so a rep can log the next day's forecast
// without closing this popover and scrolling the day-strip to find that
// column. Writes still land on that date's own (BusinessPartnerID, LogDate,
// ContactType) row, so 02/08's own DayChip picks up the same value once the
// page's data refreshes — this popover doesn't "own" tomorrow's data any
// more than 02/08's own log button does.
function ContactLogButton({
  businessPartnerId,
  dateISO,
  contactType,
}: {
  businessPartnerId: string;
  dateISO: string;
  contactType: ContactType;
}) {
  const Icon = contactType === "Chat" ? MessageCircle : Phone;
  const router = useRouter();
  const besokISO = useMemo(() => addDaysISO(dateISO, 1), [dateISO]);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"hari-ini" | "besok">("hari-ini");
  const [loading, setLoading] = useState(false);
  const [hasEntry, setHasEntry] = useState(false);
  const [hasilPenawaran, setHasilPenawaran] = useState("");
  const [angkaPemesanan, setAngkaPemesanan] = useState("");
  const [alasanTidakSesuai, setAlasanTidakSesuai] = useState("");
  const [pending, startTransition] = useTransition();

  const activeDateISO = tab === "besok" ? besokISO : dateISO;

  function loadFor(targetDateISO: string) {
    setLoading(true);
    getMitraContactLogAction(businessPartnerId, targetDateISO)
      .then((result) => {
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        const found = result.data.find((e) => e.ContactType === contactType) ?? null;
        setHasEntry(!!found);
        setHasilPenawaran(found?.HasilPenawaran ?? "");
        setAngkaPemesanan(found?.AngkaPemesanan != null ? String(found.AngkaPemesanan) : "");
        setAlasanTidakSesuai(found?.AlasanTidakSesuai ?? "");
      })
      .finally(() => setLoading(false));
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setTab("hari-ini");
    loadFor(dateISO);
  }

  function handleTabChange(nextTab: "hari-ini" | "besok") {
    setTab(nextTab);
    loadFor(nextTab === "besok" ? besokISO : dateISO);
  }

  function handleSave() {
    startTransition(async () => {
      const result = await saveMitraContactLogAction({
        businessPartnerId,
        dateISO: activeDateISO,
        contactType,
        hasilPenawaran: hasilPenawaran.trim() || null,
        angkaPemesanan: angkaPemesanan.trim() ? Number(angkaPemesanan) : null,
        alasanTidakSesuai: alasanTidakSesuai.trim() || null,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setHasEntry(true);
      setOpen(false);
      // The "angka | %" readout under every DayChip's icons comes from a
      // page-level batch fetch (contactLogSummary), not this popover's own
      // state — refresh so a just-saved value shows up there immediately.
      router.refresh();
    });
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            title={contactType}
            className="rounded p-1 transition-colors hover:bg-muted"
          />
        }
      >
        <Icon className={cn("size-2.5", hasEntry ? "text-primary" : "text-muted-foreground/40")} />
      </PopoverTrigger>
      <PopoverContent className="w-64" align="center">
        <Tabs
          value={tab}
          onValueChange={(v) => typeof v === "string" && handleTabChange(v as "hari-ini" | "besok")}
          className="mb-2"
        >
          <TabsList className="w-full">
            <TabsTrigger value="hari-ini" className="flex-1 text-xs">
              Hari ini
            </TabsTrigger>
            <TabsTrigger value="besok" className="flex-1 text-xs">
              Besok
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="mb-2 text-xs font-medium">
          Log {contactType} &mdash; {activeDateISO.slice(8, 10)}/{activeDateISO.slice(5, 7)}/{activeDateISO.slice(0, 4)}
        </p>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Memuat...
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] text-muted-foreground">Hasil Penawaran Pemesanan</Label>
              <Textarea
                value={hasilPenawaran}
                onChange={(e) => setHasilPenawaran(e.target.value)}
                rows={2}
                className="text-xs"
                placeholder="Apa hasil penawaran ke mitra..."
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] text-muted-foreground">Angka Pemesanan</Label>
              <Input
                type="number"
                min={0}
                value={angkaPemesanan}
                onChange={(e) => setAngkaPemesanan(e.target.value)}
                className="h-8 text-xs"
                placeholder="Kantong"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] text-muted-foreground">
                Alasan Pengiriman Tidak Sesuai Pemesanan Awal
              </Label>
              <Textarea
                value={alasanTidakSesuai}
                onChange={(e) => setAlasanTidakSesuai(e.target.value)}
                rows={2}
                className="text-xs"
                placeholder="Opsional..."
              />
            </div>
            <Button size="sm" disabled={pending} onClick={handleSave} className="mt-1">
              {pending ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// The percentage is an achievement/variance read against the forecast: how
// much actually got delivered on THIS SAME DATE relative to what this log
// entry forecasted — e.g. forecast 60, 104 actually delivered that day ->
// 173% (over-delivered relative to the forecast), forecast 60, 30 delivered
// -> 50% (under-delivered). Only computed once the date has actually
// elapsed (a future date's "actual" is just 0 so far, not a real shortfall)
// and only when the forecast itself is a positive number.
//
// Solid warning-color background (not just colored text) so this badge
// stays legible sitting on top of DayChip's own hit/miss red or green tint
// — a translucent readout would otherwise blend into that background. The
// qty and percentage get their own visual gap (a hairline divider, not a
// literal "|" character glued between two numbers) so they read as two
// distinct values rather than one run-together string.
function PemesananBadge({
  angkaPemesanan,
  actualQtyForDate,
  dateHasElapsed,
}: {
  angkaPemesanan: number;
  actualQtyForDate: number;
  dateHasElapsed: boolean;
}) {
  const pct = dateHasElapsed && angkaPemesanan > 0 ? Math.round((actualQtyForDate / angkaPemesanan) * 100) : null;
  return (
    <span className="flex items-center gap-1 rounded bg-warning px-1 py-px text-warning-foreground">
      <span>{formatQty(angkaPemesanan)}</span>
      {pct != null && (
        <>
          <span className="h-2.5 w-px shrink-0 bg-warning-foreground/40" />
          <span>{pct}%</span>
        </>
      )}
    </span>
  );
}

// Right-border-only cells (no rounded chip look) so adjacent cells across
// every row in the list line up into continuous vertical divider lines,
// per-date, running from the header total row down through the whole list.
// Height is intentionally min-h (not fixed h-14, unlike the header's own
// per-date total cells) — a chip whose mitra+date has a saved Angka
// Pemesanan grows taller to fit its readout line(s), and the browser's own
// flex `align-items: stretch` (the default for the row's un-styled flex
// container) makes every other chip in that SAME mitra row stretch to
// match, so the per-date vertical divider lines stay continuous down the
// page — only the affected mitra's own row gets taller, not the whole grid.
function DayChip({
  businessPartnerId,
  dateISO,
  qty,
  prevQty,
  target,
  isPast,
  contactSummary,
}: {
  businessPartnerId: string;
  dateISO: string;
  qty: number;
  // The immediately preceding date's qty for this same mitra — null for the
  // very first date in the visible range (nothing to compare against) or
  // when the point of comparison itself hasn't happened yet.
  prevQty: number | null;
  target: number | null;
  isPast: boolean;
  contactSummary: { chat?: number; telepon?: number } | undefined;
}) {
  const state = !isPast ? "future" : target == null ? "neutral" : qty >= target ? "hit" : "miss";
  const day = Number(dateISO.slice(8, 10));
  // Only meaningful for a day that's actually elapsed and has a prior day to
  // compare against — a future placeholder cell or the range's first date
  // shows no arrow rather than a misleading flat/up/down guess.
  const change = isPast && prevQty != null ? (qty > prevQty ? "up" : qty < prevQty ? "down" : "flat") : null;
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col items-center justify-center gap-0.5 border-r py-1 text-[10px] tabular-nums",
        DAY_COL_WIDTH_CLASS,
        "min-h-14",
        state === "hit" && "bg-primary/10 text-primary",
        state === "miss" && "bg-destructive/10 text-destructive",
        state === "future" && "text-muted-foreground/50",
        state === "neutral" && "text-muted-foreground"
      )}
    >
      <span className="opacity-60">{day}</span>
      <span className="flex items-center gap-0.5 font-semibold">
        {isPast ? formatQty(qty) : "-"}
        {change === "up" && <ArrowUp className="size-2.5 shrink-0 text-primary" />}
        {change === "down" && <ArrowDown className="size-2.5 shrink-0 text-destructive" />}
      </span>
      <span className="flex items-center gap-0.5">
        <ContactLogButton businessPartnerId={businessPartnerId} dateISO={dateISO} contactType="Chat" />
        <ContactLogButton businessPartnerId={businessPartnerId} dateISO={dateISO} contactType="Telepon" />
      </span>
      {contactSummary && (contactSummary.chat != null || contactSummary.telepon != null) && (
        <span className="flex flex-col items-center gap-0.5 text-[8px] font-medium">
          {contactSummary.chat != null && (
            <PemesananBadge angkaPemesanan={contactSummary.chat} actualQtyForDate={qty} dateHasElapsed={isPast} />
          )}
          {contactSummary.telepon != null && (
            <PemesananBadge angkaPemesanan={contactSummary.telepon} actualQtyForDate={qty} dateHasElapsed={isPast} />
          )}
        </span>
      )}
    </div>
  );
}

// Small pill button doubling as the current daily-target display AND its
// own quick editor — click it, type a new value, Simpan. Writes straight to
// BusinessPartner.Capacity (the same column TargetHarian is read from) via
// a targeted single-field action, not the full mitra edit form.
function TargetButton({ businessPartnerId, target }: { businessPartnerId: string; target: number | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(target != null ? String(target) : "");
  const [pending, startTransition] = useTransition();

  function handleSave() {
    const trimmed = value.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed != null && (Number.isNaN(parsed) || parsed < 0)) {
      toast.error("Target harus berupa angka positif.");
      return;
    }
    startTransition(async () => {
      const result = await updateMitraCapacityAction(businessPartnerId, parsed);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Resets the draft to the current saved value each time it's
        // reopened — not derivable from render since this is a
        // user-editable field, and a stale draft from a prior open/cancel
        // shouldn't linger.
        if (next) setValue(target != null ? String(target) : "");
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            className="ml-auto flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium tabular-nums transition-colors hover:bg-muted"
          />
        }
      >
        <span className="size-2 shrink-0 rounded-full bg-primary" />
        {target != null ? formatQty(target) : "-"}
      </PopoverTrigger>
      <PopoverContent className="w-56" align="end">
        <p className="text-xs font-medium">Ubah Target Harian</p>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Kantong/hari"
            className="h-8 text-xs"
          />
          <Button size="sm" disabled={pending} onClick={handleSave}>
            {pending ? "..." : "Simpan"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Newest JoinDate first; mitra with no JoinDate on record (older
// ERP-imported rows this app didn't create) sort last rather than
// clumping at the top as a false "newest".
function compareJoinDateDesc(a: MitraDORow, b: MitraDORow): number {
  if (!a.JoinDate && !b.JoinDate) return 0;
  if (!a.JoinDate) return 1;
  if (!b.JoinDate) return -1;
  return new Date(b.JoinDate).getTime() - new Date(a.JoinDate).getTime();
}

// Highest PctAchievement first; mitra with no TargetHarian set (so no
// percentage can be computed) sort last rather than clumping at the top as
// a false "highest".
function comparePctAchievementDesc(a: MitraDORow, b: MitraDORow): number {
  if (a.PctAchievement == null && b.PctAchievement == null) return 0;
  if (a.PctAchievement == null) return 1;
  if (b.PctAchievement == null) return -1;
  return b.PctAchievement - a.PctAchievement;
}

// Highest TargetHarian first; mitra with no target set sort last rather
// than clumping at the top as a false "highest".
function compareTargetDesc(a: MitraDORow, b: MitraDORow): number {
  if (a.TargetHarian == null && b.TargetHarian == null) return 0;
  if (a.TargetHarian == null) return 1;
  if (b.TargetHarian == null) return -1;
  return b.TargetHarian - a.TargetHarian;
}

function MitraDOCard({
  m,
  dates,
  todayISO,
  elapsedDays,
  contactSummaryMap,
}: {
  m: MitraDORow;
  dates: string[];
  todayISO: string;
  elapsedDays: number;
  // Keyed `${BusinessPartnerID}|${dateISO}` — built once in MitraDOPanel from
  // the page's batch-fetched contactLogSummary, not per-card.
  contactSummaryMap: Map<string, { chat?: number; telepon?: number }>;
}) {
  const trend = getTrend(m.DailyQty, elapsedDays);
  // Average per elapsed day, not per every day in the visible range —
  // matches TargetHarian's own per-day meaning, and dividing by the full
  // range would understate the average for a range that isn't over yet.
  const avgQty = elapsedDays > 0 ? m.TotalQty / elapsedDays : null;
  return (
    <div className="flex items-stretch">
      {/* Sticky within the shared horizontal-scroll ancestor (not the page)
          — stays pinned to the left edge of the scroll viewport while the
          date columns to its right scroll underneath it. bg-card keeps
          scrolled-under cells from showing through. Total/%/trend paired
          on the right of each line (not a separate 4th line) to fit
          everything in this narrower fixed-width column. */}
      <div className={cn("sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-1 bg-card py-3 pr-3", INFO_COL_CLASS)}>
        <div className="flex items-start justify-between gap-1">
          <p className="flex min-w-0 items-center gap-1.5 font-medium">
            <span className="truncate">{m.Name}</span>
            <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">
              {m.PartnerType}
            </Badge>
          </p>
          <span className="shrink-0 text-xs font-semibold tabular-nums">{formatQty(m.TotalQty)}</span>
        </div>
        <div className="flex items-center justify-between gap-1 text-xs text-muted-foreground">
          <span className="truncate">
            {m.Wilayah}
            {m.Kecamatan ? ` | ${m.Kecamatan}` : ""}
            {m.MarketingNama ? ` · ${m.MarketingNama}` : ""}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {m.PctAchievement != null ? `${m.PctAchievement.toFixed(0)}%` : "-"}
            <TrendIcon direction={trend.direction} />
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-medium tabular-nums text-foreground">
            {m.HargaJual != null ? formatRupiah(m.HargaJual) : "-"}
          </span>
          <span className="truncate tabular-nums">&plusmn;{avgQty != null ? formatQty(avgQty) : "-"}</span>
          <TargetButton businessPartnerId={m.BusinessPartnerID} target={m.TargetHarian} />
        </div>
      </div>
      <div className="flex border-l">
        {dates.map((dateISO, i) => (
          <DayChip
            key={dateISO}
            businessPartnerId={m.BusinessPartnerID}
            dateISO={dateISO}
            qty={m.DailyQty[i]}
            prevQty={i > 0 ? m.DailyQty[i - 1] : null}
            target={m.TargetHarian}
            isPast={dateISO <= todayISO}
            contactSummary={contactSummaryMap.get(`${m.BusinessPartnerID}|${dateISO}`)}
          />
        ))}
      </div>
    </div>
  );
}

// Sentinel for "mitra with no Marketing assigned to their Wilayah/Kecamatan
// yet" — distinct from "all" (no filter applied), since null can't be a
// Select value.
const UNASSIGNED_MARKETING = "__unassigned__";

function matchesMarketingFilter(m: MitraDORow, marketingFilter: string): boolean {
  if (marketingFilter === "all") return true;
  if (marketingFilter === UNASSIGNED_MARKETING) return !m.MarketingNama;
  return m.MarketingNama === marketingFilter;
}

export function MitraDOPanel({
  data,
  contactLogSummary,
  wilayahFilter,
  onWilayahFilterChange,
  marketingFilter,
  onMarketingFilterChange,
}: {
  data: MitraDOMonthly;
  contactLogSummary: MitraContactLogSummaryEntry[];
  wilayahFilter: string;
  onWilayahFilterChange: (wilayah: string) => void;
  marketingFilter: string;
  onMarketingFilterChange: (marketing: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("target");
  const [search, setSearch] = useState("");
  const { active, inactive, daysInRange, rangeStartISO, todayISO } = data;
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);

  // Keyed `${BusinessPartnerID}|${LogDate}` -> per-channel Angka Pemesanan,
  // built once per contactLogSummary change rather than re-scanned per
  // mitra card.
  const contactSummaryMap = useMemo(() => {
    const map = new Map<string, { chat?: number; telepon?: number }>();
    for (const entry of contactLogSummary) {
      const key = `${entry.BusinessPartnerID}|${entry.LogDate}`;
      const existing = map.get(key) ?? {};
      if (entry.ContactType === "Chat") existing.chat = entry.AngkaPemesanan;
      else existing.telepon = entry.AngkaPemesanan;
      map.set(key, existing);
    }
    return map;
  }, [contactLogSummary]);

  const dates = useMemo(
    () => Array.from({ length: daysInRange }, (_, i) => addDaysISO(rangeStartISO, i)),
    [daysInRange, rangeStartISO]
  );

  // How many days of the visible range have elapsed (clamped to the range
  // itself) — feeds the "Tren 3 Hari Terakhir" sort, which needs a plain
  // count, not a date.
  const elapsedDays = useMemo(() => {
    const todayIndex = Math.round((new Date(todayISO).getTime() - new Date(rangeStartISO).getTime()) / 86400000);
    return Math.min(daysInRange, Math.max(0, todayIndex + 1));
  }, [todayISO, rangeStartISO, daysInRange]);

  const wilayahOptions = useMemo(
    () => [...new Set([...active, ...inactive].map((m) => m.Wilayah))].sort(),
    [active, inactive]
  );

  const marketingOptions = useMemo(
    () =>
      [...new Set([...active, ...inactive].map((m) => m.MarketingNama).filter((n): n is string => !!n))].sort(),
    [active, inactive]
  );

  const searchQuery = search.trim().toLowerCase();
  const filteredActive = useMemo(() => {
    const byWilayah = wilayahFilter === "all" ? active : active.filter((m) => m.Wilayah === wilayahFilter);
    const byMarketing = byWilayah.filter((m) => matchesMarketingFilter(m, marketingFilter));
    return searchQuery ? byMarketing.filter((m) => m.Name.toLowerCase().includes(searchQuery)) : byMarketing;
  }, [active, wilayahFilter, marketingFilter, searchQuery]);
  const filteredInactive = useMemo(() => {
    const byWilayah = wilayahFilter === "all" ? inactive : inactive.filter((m) => m.Wilayah === wilayahFilter);
    const byMarketing = byWilayah.filter((m) => matchesMarketingFilter(m, marketingFilter));
    return searchQuery ? byMarketing.filter((m) => m.Name.toLowerCase().includes(searchQuery)) : byMarketing;
  }, [inactive, wilayahFilter, marketingFilter, searchQuery]);

  // Reflects whatever the Wilayah filter currently shows, not the
  // unfiltered total — matches what the user is actually looking at.
  const totalKantong = useMemo(() => filteredActive.reduce((sum, m) => sum + m.TotalQty, 0), [filteredActive]);

  const totalPerDate = useMemo(() => {
    const totals = new Array(daysInRange).fill(0);
    for (const m of filteredActive) {
      for (let i = 0; i < daysInRange; i++) totals[i] += m.DailyQty[i];
    }
    return totals;
  }, [filteredActive, daysInRange]);

  // Per-date Angka Pemesanan summed across every CURRENTLY FILTERED mitra
  // (same filteredActive scope as totalPerDate above, not the unfiltered
  // contactLogSummary) — the header's own "akumulasi dari data keseluruhan
  // ... dari seluruh mitra" readout, one line per channel, same
  // formatPemesananLine shape as each mitra row's own readout.
  const totalPemesananPerDate = useMemo(() => {
    const dateIndex = new Map(dates.map((d, i) => [d, i]));
    const totals: { chat: number; telepon: number; hasChat: boolean; hasTelepon: boolean }[] = Array.from(
      { length: daysInRange },
      () => ({ chat: 0, telepon: 0, hasChat: false, hasTelepon: false })
    );
    const filteredIds = new Set(filteredActive.map((m) => m.BusinessPartnerID));
    for (const entry of contactLogSummary) {
      if (!filteredIds.has(entry.BusinessPartnerID)) continue;
      const i = dateIndex.get(entry.LogDate);
      if (i == null) continue;
      if (entry.ContactType === "Chat") {
        totals[i].chat += entry.AngkaPemesanan;
        totals[i].hasChat = true;
      } else {
        totals[i].telepon += entry.AngkaPemesanan;
        totals[i].hasTelepon = true;
      }
    }
    return totals;
  }, [contactLogSummary, filteredActive, dates, daysInRange]);

  // "Yang ditampilkan" = whatever's actually rendered below — filteredActive
  // plus filteredInactive only when that section is toggled open, same
  // source exportRows uses so the header stays consistent with both.
  const displayedMitra = useMemo(
    () => (showAll ? [...filteredActive, ...filteredInactive] : filteredActive),
    [showAll, filteredActive, filteredInactive]
  );
  const totalTargetDisplayed = useMemo(
    () => displayedMitra.reduce((sum, m) => sum + (m.TargetHarian ?? 0), 0),
    [displayedMitra]
  );

  // filteredActive already arrives sorted by TotalQty desc — only the
  // "Pengambilan Terbanyak" mode can skip re-sorting as a no-op.
  const sortedActive = useMemo(() => {
    if (sortMode === "terbanyak") return filteredActive;
    if (sortMode === "target") return [...filteredActive].sort(compareTargetDesc);
    if (sortMode === "persentase") return [...filteredActive].sort(comparePctAchievementDesc);
    if (sortMode === "terbaru") return [...filteredActive].sort(compareJoinDateDesc);
    return [...filteredActive].sort(
      (a, b) => getTrend(b.DailyQty, elapsedDays).delta - getTrend(a.DailyQty, elapsedDays).delta
    );
  }, [filteredActive, sortMode, elapsedDays]);

  // Export mirrors exactly what's currently on screen: the same
  // wilayah/marketing/search filters and sort order, plus the inactive
  // (no-transaction) mitra list only when "Tampilkan ... mitra tanpa
  // transaksi" is toggled on, since that's the only time they're visible.
  const exportRows = useMemo(() => {
    const rowsSource = showAll ? [...sortedActive, ...filteredInactive] : sortedActive;
    return rowsSource.map((m) => {
      const avgQty = elapsedDays > 0 ? m.TotalQty / elapsedDays : null;
      const row: Record<string, unknown> = {
        mitra: m.Name,
        tipe: m.PartnerType,
        wilayah: m.Wilayah,
        kecamatan: m.Kecamatan ?? "",
        marketing: m.MarketingNama ?? "",
        totalKantong: m.TotalQty,
        pctAchievement: m.PctAchievement != null ? m.PctAchievement / 100 : null,
        targetHarian: m.TargetHarian,
        rataRata: avgQty,
        hargaJual: m.HargaJual,
      };
      dates.forEach((dateISO, i) => {
        row[dateISO] = m.DailyQty[i];
      });
      return row;
    });
  }, [sortedActive, filteredInactive, showAll, dates, elapsedDays]);

  const exportColumns: XlsxColumn[] = useMemo(
    () => [
      { header: "Mitra", key: "mitra", width: 28 },
      { header: "Tipe", key: "tipe", width: 12 },
      { header: "Wilayah", key: "wilayah", width: 16 },
      { header: "Kecamatan", key: "kecamatan", width: 16 },
      { header: "Marketing", key: "marketing", width: 16 },
      { header: "Total Kantong", key: "totalKantong", type: "number", width: 14 },
      { header: "% Pencapaian", key: "pctAchievement", type: "number", numFmt: "0.0%", width: 12 },
      { header: "Target Harian", key: "targetHarian", type: "number", width: 12 },
      { header: "Rata-rata/Hari", key: "rataRata", type: "number", numFmt: "#,##0.0", width: 13 },
      { header: "Harga Jual", key: "hargaJual", type: "number", numFmt: "#,##0", width: 12 },
      ...dates.map((dateISO): XlsxColumn => ({
        header: `${dateISO.slice(8, 10)}/${dateISO.slice(5, 7)}`,
        key: dateISO,
        type: "number",
        width: 8,
      })),
    ],
    [dates]
  );

  // One-way mirror: the body's own horizontal scrollbar is what the user
  // actually drags; the header's date-total row has no scrollbar of its
  // own (overflow-x-hidden) and just has its scrollLeft driven to match,
  // so both stay visually locked together as one continuous grid even
  // though they live in separate sticky/non-sticky DOM regions.
  function handleBodyScroll(e: React.UIEvent<HTMLDivElement>) {
    if (headerScrollRef.current) headerScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
  }

  const CurrentSortIcon = SORT_OPTIONS[sortMode].icon;

  return (
    // Plain div standing in for <Card> here, minus `overflow-hidden` — Card
    // sets that for rounded-corner clipping, but it also turns Card into a
    // clipping/scroll-container ancestor for the sticky CardHeader below,
    // which made the header cover the first row of content even at rest
    // (not just while scrolling). Everything else matches Card's own classes.
    <div className="flex flex-col gap-(--card-spacing) rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10 shadow-md [--card-spacing:--spacing(4)]">
      {/* Sticky within this div's own bounds (its containing block) — stays
          pinned below the app header while scrolling through the mitra list
          in CardContent, and lets go once this div's bottom comes into view. */}
      <CardHeader className="sticky top-14 z-20 border-b bg-card pt-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="font-display">Transaksi DO per Mitra — Bulan Berjalan</CardTitle>
          <p className="shrink-0 text-right text-sm font-semibold tabular-nums text-primary">
            {formatQty(totalKantong)} kantong
          </p>
        </div>
        <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-primary" />
            Tercapai
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-destructive" />
            Belum tercapai
          </span>
          <span>(Kemasan 5KG telah dikonversi)</span>
        </CardDescription>
        {/* Lives inside the sticky CardHeader (not CardContent) so both stay
            reachable at every scroll position within this panel, not just
            near the bottom — a bottom-sticky button here had nothing left
            below it in the flow to stick against, so it never actually
            engaged until you'd already scrolled past the whole list. */}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <div className="relative w-48">
            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama mitra..."
              className="h-9 pl-8 text-xs"
            />
          </div>
          <Select value={sortMode} onValueChange={(v) => setSortMode((v as SortMode) ?? "target")}>
            <SelectTrigger className="w-40" aria-label="Urutkan">
              <CurrentSortIcon className="size-3.5 text-muted-foreground" />
              <SelectValue>{(v: string) => SORT_OPTIONS[v as SortMode]?.label ?? SORT_OPTIONS.target.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_OPTIONS) as SortMode[]).map((mode) => {
                const Icon = SORT_OPTIONS[mode].icon;
                return (
                  <SelectItem key={mode} value={mode}>
                    <span className="inline-flex items-center gap-1.5">
                      <Icon className="size-3.5 text-muted-foreground" />
                      {SORT_OPTIONS[mode].label}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Select value={wilayahFilter} onValueChange={(v) => onWilayahFilterChange(v ?? "all")}>
            <SelectTrigger className="w-32" aria-label="Wilayah">
              <SelectValue>{(v: string) => (v === "all" ? "Wilayah" : v)}</SelectValue>
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
          <Select value={marketingFilter} onValueChange={(v) => onMarketingFilterChange(v ?? "all")}>
            <SelectTrigger className="w-32" aria-label="Marketing">
              <SelectValue>
                {(v: string) =>
                  v === "all" ? "Marketing" : v === UNASSIGNED_MARKETING ? "Belum Ditentukan" : v
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Marketing</SelectItem>
              <SelectItem value={UNASSIGNED_MARKETING}>Belum Ditentukan</SelectItem>
              {marketingOptions.map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {filteredInactive.length > 0 && (
            // hidden (display:none) rather than removed — kept in the DOM/
            // logic so `showAll`/`filteredInactive` still work if this is
            // ever un-hidden again, per explicit request not to delete it.
            <Button variant="outline" size="sm" className="hidden" onClick={() => setShowAll((v) => !v)}>
              {showAll ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              {filteredInactive.length} mitra tanpa transaksi
              <ChevronDown className={cn("size-3.5 transition-transform", showAll && "rotate-180")} />
            </Button>
          )}
          <ExportXlsxButton
            filename={`transaksi-do-per-mitra_${rangeStartISO}`}
            sheetName="DO per Mitra"
            columns={exportColumns}
            rows={exportRows}
          />
        </div>
        {/* Per-date total row — mirrors the body's horizontal scroll (see
            handleBodyScroll) so it always lines up with the date columns
            below it, while staying put in the sticky header itself. */}
        <div className="mt-2 flex min-w-0 border-t pt-2">
          <div
            className={cn(
              "flex shrink-0 items-center justify-between gap-1 self-center pr-3 text-xs font-medium text-muted-foreground",
              INFO_COL_CLASS
            )}
          >
            <span>{displayedMitra.length} mitra ditampilkan</span>
            <span className="flex items-center gap-1 tabular-nums text-foreground">
              <span className="size-2 shrink-0 rounded-full bg-primary" />
              {formatQty(totalTargetDisplayed)}
            </span>
          </div>
          <div ref={headerScrollRef} className="flex min-w-0 flex-1 overflow-x-hidden border-l">
            {dates.map((dateISO, i) => {
              const pemesanan = totalPemesananPerDate[i];
              return (
                <div
                  key={dateISO}
                  className={cn(
                    "flex shrink-0 flex-col items-center justify-center gap-0.5 border-r py-1 text-[10px] font-semibold tabular-nums text-primary",
                    DAY_COL_WIDTH_CLASS,
                    "min-h-14"
                  )}
                >
                  <span>{formatQty(totalPerDate[i])}</span>
                  {(pemesanan.hasChat || pemesanan.hasTelepon) && (
                    <span className="flex flex-col items-center gap-0.5 text-[8px] font-medium">
                      {pemesanan.hasChat && (
                        <PemesananBadge
                          angkaPemesanan={pemesanan.chat}
                          actualQtyForDate={totalPerDate[i]}
                          dateHasElapsed={dateISO <= todayISO}
                        />
                      )}
                      {pemesanan.hasTelepon && (
                        <PemesananBadge
                          angkaPemesanan={pemesanan.telepon}
                          actualQtyForDate={totalPerDate[i]}
                          dateHasElapsed={dateISO <= todayISO}
                        />
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {filteredActive.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Belum ada Delivery Order bulan ini.</p>
        ) : (
          <div ref={bodyScrollRef} onScroll={handleBodyScroll} className="overflow-x-auto">
            <div className="flex flex-col divide-y">
              {sortedActive.map((m) => (
                <MitraDOCard
                  key={m.BusinessPartnerID}
                  m={m}
                  dates={dates}
                  todayISO={todayISO}
                  elapsedDays={elapsedDays}
                  contactSummaryMap={contactSummaryMap}
                />
              ))}
            </div>

            {showAll && filteredInactive.length > 0 && (
              <div className="flex flex-col divide-y border-t">
                {filteredInactive.map((m) => (
                  <MitraDOCard
                    key={m.BusinessPartnerID}
                    m={m}
                    dates={dates}
                    todayISO={todayISO}
                    elapsedDays={elapsedDays}
                    contactSummaryMap={contactSummaryMap}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </div>
  );
}
