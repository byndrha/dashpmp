"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Banknote, ChevronDown, Clock, Copy, CreditCard, Download, FileText, MapPin, Package, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Pagination } from "@/components/dashboard/pagination";
import { ExportXlsxButton } from "@/components/dashboard/export-xlsx-button";
import { PiutangBayarDialog } from "@/components/dashboard/piutang-bayar-dialog";
import { formatRupiah } from "@/lib/format";
import { utcInstantToWibDisplay } from "@/lib/business-date";
import { cn } from "@/lib/utils";
import { SEGMENTASI_OPTIONS } from "@/lib/segmentasi-mitra";
import type { XlsxColumn } from "@/lib/export-xlsx";
import type { PiutangPerAgenRow, PiutangTransaksiRow } from "@/lib/queries/penjualan-piutang";
import type { PiutangBayarContext, PiutangTarikContext, BayarPiutangResult } from "@/lib/queries/piutang-pembayaran";

const EXPORT_COLUMNS: XlsxColumn[] = [
  { header: "Agen", key: "nama", width: 26 },
  { header: "Tabungan Awal", key: "tabunganAwal", type: "number", width: 16 },
  { header: "Hutang Awal", key: "hutangAwal", type: "number", width: 16 },
  { header: "Pesanan", key: "pesanan", type: "number", width: 16 },
  { header: "Retur", key: "retur", type: "number", width: 14 },
  { header: "Pembayaran", key: "pembayaran", type: "number", width: 16 },
  { header: "Tarikan", key: "tarikan", type: "number", width: 14 },
  { header: "Saldo Akhir", key: "saldoAkhir", type: "number", width: 16 },
];

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

type SortKey = "Nama" | "SaldoAkhir" | "Pesanan";
type StatusFilter = "all" | "hutang" | "tabungan" | "lunas";

const PAGE_SIZE = 12;

function statusOf(row: PiutangPerAgenRow): StatusFilter {
  if (row.saldoAkhir > 0) return "hutang";
  if (row.saldoAkhir < 0) return "tabungan";
  return "lunas";
}

// "dd/MM/yyyy • HH:mm" for a TRUE UTC instant (e.g. `new Date()` at fetch
// time) -- utcInstantToWibDisplay shifts it +7h so reading its raw
// UTC-component getters below gives the correct WIB wall-clock, same
// pattern formatDateWib/formatTimeWib rely on for naive-WIB values.
function formatUpdateStamp(date: Date): string {
  const wib = utcInstantToWibDisplay(date);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const d = String(wib.getUTCDate()).padStart(2, "0");
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mm = String(wib.getUTCMinutes()).padStart(2, "0");
  return `${d}/${m}/${y} • ${hh}:${mm}`;
}

// "September 2026" for a single-month range, or "dd/MM/yy - dd/MM/yy" when
// the chosen range spans more than one calendar month.
function formatPeriodeLabel(startISO: string, endISO: string): string {
  const [sy, sm] = startISO.split("-").map(Number);
  const [ey, em] = endISO.split("-").map(Number);
  if (sy === ey && sm === em) return `${MONTH_NAMES[sm - 1]} ${sy}`;
  const short = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };
  return `${short(startISO)} - ${short(endISO)}`;
}

function SortToggle({
  label,
  sortKey,
  active,
  direction,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:text-foreground",
        active ? "border-primary/40 text-foreground" : "border-border text-muted-foreground"
      )}
    >
      {label}
      {active ? (
        direction === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
      ) : (
        <ArrowUpDown className="size-3 opacity-40" />
      )}
    </button>
  );
}

const COLLAPSED_PREVIEW_COUNT = 2;

function segmentasiLabel(value: PiutangPerAgenRow["segmentasi"]): string | null {
  if (!value) return null;
  return SEGMENTASI_OPTIONS.find((s) => s.value === value)?.label ?? null;
}

function formatTanggalPendek(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const TIPE_LABEL: Record<PiutangTransaksiRow["tipe"], string> = {
  pesanan: "Pemesanan",
  pembayaran: "Pembayaran",
  tarikan: "Tarikan",
};

// Pemesanan = order fulfilled (primary/green), Pembayaran = payment
// received (warning/amber), Tarikan = savings withdrawal, i.e. debt goes
// up (destructive/red) -- three semantic tokens already used elsewhere in
// this app (see aging-table.tsx's STATUS_BADGE), not new custom colors.
const TIPE_BADGE_CLASS: Record<PiutangTransaksiRow["tipe"], string> = {
  pesanan: "bg-primary/15 text-primary",
  pembayaran: "bg-warning/15 text-warning",
  tarikan: "bg-destructive/15 text-destructive",
};

// Bordered card per transaction, per the reference design: doc icon + full
// NoDokumen and a colored tipe pill on top, date + a merged qty chip
// ("Kecil 230") and the signed amount below. Pesanan/Tarikan add to Hutang
// (shown plain), Pembayaran reduces it (shown negative, tinted primary like
// the Tabungan convention used elsewhere on this card). Padding kept tight
// (px-2/py-1.5, gap-1) so the box stays compact rather than tall.
function TransaksiRow({ item }: { item: PiutangTransaksiRow }) {
  const isReduction = item.jumlah < 0;
  return (
    <div className="flex flex-col gap-1 rounded-lg border px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1">
          <FileText className="size-3 shrink-0 text-muted-foreground" />
          <span className="font-data truncate text-[10px] text-muted-foreground">{item.noDokumen}</span>
        </span>
        <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium", TIPE_BADGE_CLASS[item.tipe])}>
          {TIPE_LABEL[item.tipe]}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="flex flex-nowrap items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-foreground">
          <span className="shrink-0">{formatTanggalPendek(item.tanggal)}</span>
          {item.balokKecil !== 0 && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
              Kecil <span className="font-semibold text-foreground">{item.balokKecil.toLocaleString("id-ID")}</span>
            </span>
          )}
          {item.balokBesar !== 0 && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
              Besar <span className="font-semibold text-foreground">{item.balokBesar.toLocaleString("id-ID")}</span>
            </span>
          )}
        </span>
        <span className={cn("font-data shrink-0 text-xs font-semibold tabular-nums", isReduction ? "text-primary" : "text-foreground")}>
          {isReduction ? "-" : ""}
          {formatRupiah(Math.abs(item.jumlah))}
        </span>
      </div>
    </div>
  );
}

function AgenCard({
  row,
  periodeLabel,
  lastUpdated,
  fetchBayarContext,
  submitBayar,
  fetchTarikContext,
  submitTarik,
}: {
  row: PiutangPerAgenRow;
  periodeLabel: string;
  lastUpdated: Date;
  fetchBayarContext: (agenId: string) => Promise<PiutangBayarContext>;
  submitBayar: (
    agenId: string,
    jumlah: number,
    kasBank: { utama?: string; logistik?: string },
    catatan: string | null
  ) => Promise<BayarPiutangResult[]>;
  fetchTarikContext: (agenId: string) => Promise<PiutangTarikContext>;
  submitTarik: (
    agenId: string,
    jumlah: number,
    kasBank: { utama?: string; logistik?: string },
    catatan: string | null
  ) => Promise<BayarPiutangResult[]>;
}) {
  const status = statusOf(row);
  const [expanded, setExpanded] = useState(false);
  const [bayarOpen, setBayarOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);
  const hasMore = row.transaksi.length > COLLAPSED_PREVIEW_COUNT;
  const visibleTransaksi = expanded ? row.transaksi : row.transaksi.slice(0, COLLAPSED_PREVIEW_COUNT);
  const segLabel = segmentasiLabel(row.segmentasi);
  const hasPin = row.latitude != null && row.longitude != null;

  // Total quantity ordered (Balok Kecil/Besar), not a count of documents --
  // derived from the already-fetched transaksi list rather than a new
  // backend field, since each pesanan entry already carries its own
  // net-of-Retur qty.
  const pesananItems = row.transaksi.filter((t) => t.tipe === "pesanan");
  const totalKecil = pesananItems.reduce((sum, t) => sum + t.balokKecil, 0);
  const totalBesar = pesananItems.reduce((sum, t) => sum + t.balokBesar, 0);
  const pembayaranCount = row.transaksi.filter((t) => t.tipe === "pembayaran").length;

  async function captureCardPng(): Promise<Blob> {
    if (!captureRef.current) throw new Error("Kartu tidak ditemukan.");
    // The collapsed preview hides transaksi beyond COLLAPSED_PREVIEW_COUNT --
    // a shared card export should still show everything, so force-expand
    // before capturing and restore the user's own collapsed/expanded state
    // afterward. Double rAF waits for React to commit and the browser to
    // paint the taller layout before html-to-image reads it.
    const wasExpanded = expanded;
    if (hasMore && !wasExpanded) {
      setExpanded(true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }
    try {
      const { toBlob } = await import("html-to-image");
      // Read the Card's own actual rendered background instead of a
      // hardcoded color -- the app has multiple palettes and a light/dark
      // mode, so a fixed value (e.g. pure black) mismatches whenever the
      // viewer isn't on that one specific theme.
      const bg = getComputedStyle(captureRef.current).backgroundColor;
      const blob = await toBlob(captureRef.current, {
        pixelRatio: 2,
        backgroundColor: bg,
        filter: (node) => !(node instanceof HTMLElement && node.dataset.captureHide === "true"),
      });
      if (!blob) throw new Error("Gagal membuat gambar.");
      return blob;
    } finally {
      if (hasMore && !wasExpanded) setExpanded(false);
    }
  }

  async function handleCopyPng() {
    setExporting(true);
    try {
      const blob = await captureCardPng();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast.success("Gambar disalin ke clipboard.");
    } catch {
      toast.error("Gagal menyalin kartu ke clipboard.");
    } finally {
      setExporting(false);
    }
  }

  async function handleDownloadPng() {
    setExporting(true);
    try {
      const blob = await captureCardPng();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `piutang-${row.nama.toLowerCase().replace(/\s+/g, "-")}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Gagal mengunduh kartu.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
    <div className="relative">
      {/* A sibling of Card, not a descendant -- Card's own `overflow-hidden`
          (see components/ui/card.tsx) clips anything positioned outside its
          bounds, so a button meant to float over the corner has to live
          outside that clipped box to stay visible. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="icon"
              className="absolute -left-2 -top-2 z-10 size-6 rounded-full bg-background shadow-sm"
              title="Bagikan"
              data-capture-hide="true"
              disabled={exporting}
            />
          }
        >
          <Share2 className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" data-capture-hide="true">
          <DropdownMenuItem onClick={handleCopyPng}>
            <Copy className="size-3.5" />
            Salin
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDownloadPng}>
            <Download className="size-3.5" />
            Unduh
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Card className="pt-3.5 pb-0" ref={captureRef}>
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{row.nama}</p>
              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="size-3" />
                {formatUpdateStamp(lastUpdated)}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <Badge variant={segLabel ? "secondary" : "outline"} className="h-5 px-1.5 text-[10px]">
                  {segLabel ?? "Belum Ditentukan"}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "h-5 gap-1 px-1.5 text-[10px]",
                    status === "hutang" && "border-destructive/40 text-destructive",
                    status === "tabungan" && "border-primary/40 text-primary"
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      status === "hutang" && "bg-destructive",
                      status === "tabungan" && "bg-primary",
                      status === "lunas" && "bg-muted-foreground"
                    )}
                  />
                  {status === "hutang" ? "Hutang" : status === "tabungan" ? "Tabungan" : "Lunas"}
                </Badge>
                {hasPin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5"
                    title="Lihat di Google Maps"
                    data-capture-hide="true"
                    onClick={() =>
                      window.open(`https://www.google.com/maps?q=${row.latitude},${row.longitude}`, "_blank", "noopener,noreferrer")
                    }
                  >
                    <MapPin className="size-3" />
                  </Button>
                )}
              </div>
            </div>
          <div className="shrink-0 border-l pl-2.5 text-right">
            <p className="text-[10px] text-muted-foreground">Piutang Awal</p>
            <p className="font-display text-sm font-semibold tabular-nums">{formatRupiah(row.hutangAwal)}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">Tabungan Awal</p>
            <p className="font-display text-sm font-semibold tabular-nums">{formatRupiah(row.tabunganAwal)}</p>
          </div>
        </div>

        {row.transaksi.length > 0 && (
          // -mx-4 cancels CardContent's own px-4 so these boxes sit snug
          // against the card's edge, then px-2 re-adds just enough inset to
          // avoid touching the border outright.
          <div className="-mx-4 border-t px-2 pt-2">
            <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
              <p className="min-w-0 truncate whitespace-nowrap text-[10px] font-semibold uppercase text-muted-foreground">
                {pesananItems.length} Pemesanan · {pembayaranCount} Pembayaran
              </p>
              <p className="shrink-0 text-muted-foreground">{periodeLabel}</p>
            </div>
            <div className="flex flex-col gap-1">
              {visibleTransaksi.map((item, i) => (
                <TransaksiRow key={`${item.noDokumen}-${item.tipe}-${i}`} item={item} />
              ))}
            </div>
          </div>
        )}
        {hasMore && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center justify-center gap-1 pt-0.5 text-[11px] text-muted-foreground hover:text-foreground"
            data-capture-hide="true"
          >
            {expanded ? "Sembunyikan" : `+${row.transaksi.length - COLLAPSED_PREVIEW_COUNT} transaksi lainnya`}
            <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
          </button>
        )}

        <div className="-mx-2 rounded-lg border px-2.5 py-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-semibold">
              <Package className="size-3.5 text-primary" />
              Total Pemesanan
            </span>
            <span className="font-data text-sm font-semibold tabular-nums">{formatRupiah(row.pesanan)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <div className="flex flex-1 items-center justify-between rounded border bg-muted/40 px-2.5 py-1.5">
              <span className="font-semibold tabular-nums">{totalKecil.toLocaleString("id-ID")}</span>
              <span className="text-[10px] text-muted-foreground">Es Balok Kecil</span>
            </div>
            <div className="flex flex-1 items-center justify-between rounded border bg-muted/40 px-2.5 py-1.5">
              <span className="font-semibold tabular-nums">{totalBesar.toLocaleString("id-ID")}</span>
              <span className="text-[10px] text-muted-foreground">Es Balok Besar</span>
            </div>
          </div>
          <div className="-mx-2.5 mt-2 grid grid-cols-2 divide-x border-t pt-1.5">
            <div className="flex items-center gap-1 pl-2.5">
              <span className="text-muted-foreground">Terbayar</span>
              <span className="font-semibold text-primary">{formatRupiah(row.pembayaran)}</span>
            </div>
            <div className="flex items-center justify-between gap-1 pl-2.5 pr-2.5">
              <span className="text-muted-foreground">Tarikan</span>
              <span className="font-semibold text-foreground">{formatRupiah(row.tarikan)}</span>
            </div>
          </div>
        </div>

        <div
          className={cn(
            // Card itself carries no bottom padding (pb-0, see its own
            // className) specifically so this bar can reach the card's
            // bottom edge without a negative-margin bleed -- html-to-image's
            // cloned-node export doesn't reliably reproduce negative-margin
            // overlap into a padding area, so the padding is removed at the
            // source instead. rounded-b-xl matches Card's own corner radius
            // since the bar now touches that edge.
            "-mx-4 flex items-center justify-between gap-2 rounded-b-xl px-4 py-2.5",
            row.saldoAkhir >= 0 ? "bg-destructive/10" : "bg-primary/10"
          )}
        >
          <div className="flex flex-wrap items-baseline gap-1.5">
            <span className={cn("size-1.5 shrink-0 self-center rounded-full", row.saldoAkhir >= 0 ? "bg-destructive" : "bg-primary")} />
            <span className={cn("text-[11px] font-semibold uppercase", row.saldoAkhir >= 0 ? "text-destructive" : "text-primary")}>
              {row.saldoAkhir >= 0 ? "Sisa Hutang" : "Tabungan"}
            </span>
            <span className={cn("font-data text-sm font-bold tabular-nums", row.saldoAkhir >= 0 ? "text-destructive" : "text-primary")}>
              {formatRupiah(Math.abs(row.saldoAkhir))}
            </span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 shrink-0 gap-1 bg-background px-2.5 text-[11px] text-foreground hover:bg-background/90"
            data-capture-hide="true"
            onClick={() => setBayarOpen(true)}
          >
            {row.saldoAkhir < 0 ? <Banknote className="size-3" /> : <CreditCard className="size-3" />}
            {row.saldoAkhir < 0 ? "Tarik" : "Bayar"}
          </Button>
        </div>
      </CardContent>
      </Card>
    </div>

    <PiutangBayarDialog
      open={bayarOpen}
      onOpenChange={setBayarOpen}
      mode={row.saldoAkhir < 0 ? "tarik" : "bayar"}
      agenNama={row.nama}
      fetchContext={async () => {
        if (row.saldoAkhir < 0) {
          const c = await fetchTarikContext(row.agenId);
          return { capacityUtama: c.tabunganUtama, capacityLogistik: c.tabunganLogistik, kasBankUtama: c.kasBankUtama, kasBankLogistik: c.kasBankLogistik };
        }
        const c = await fetchBayarContext(row.agenId);
        return { capacityUtama: c.hutangUtama, capacityLogistik: c.hutangLogistik, kasBankUtama: c.kasBankUtama, kasBankLogistik: c.kasBankLogistik };
      }}
      onSubmit={(jumlah, kasBank, catatan) =>
        row.saldoAkhir < 0
          ? submitTarik(row.agenId, jumlah, kasBank, catatan)
          : submitBayar(row.agenId, jumlah, kasBank, catatan)
      }
    />
    </>
  );
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthStartISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// Per-Agen breakdown matching the "Rekening Agen Gabungan" ERP export
// (Tabungan Awal / Hutang Awal / Pesanan / Retur / Pembayaran / Tarikan /
// Saldo Akhir per Agen), with a caller-adjustable date range -- same
// card-based search/sort/pagination/export pattern as MKEsindo's own
// aging-table.tsx. Loads its own data via a Server Action rather than
// through the page's server-side fetch, since the date range is
// client-adjustable after first load.
export function PiutangPerAgenTable({
  initialRows,
  fetchAction,
  fetchBayarContext,
  submitBayar,
  fetchTarikContext,
  submitTarik,
}: {
  initialRows: PiutangPerAgenRow[];
  fetchAction: (startDate: string, endDate: string) => Promise<PiutangPerAgenRow[]>;
  fetchBayarContext: (agenId: string) => Promise<PiutangBayarContext>;
  submitBayar: (
    agenId: string,
    jumlah: number,
    kasBank: { utama?: string; logistik?: string },
    catatan: string | null
  ) => Promise<BayarPiutangResult[]>;
  fetchTarikContext: (agenId: string) => Promise<PiutangTarikContext>;
  submitTarik: (
    agenId: string,
    jumlah: number,
    kasBank: { utama?: string; logistik?: string },
    catatan: string | null
  ) => Promise<BayarPiutangResult[]>;
}) {
  const [startDate, setStartDate] = useState(monthStartISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [rows, setRows] = useState(initialRows);
  const [lastUpdated, setLastUpdated] = useState(() => new Date());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("SaldoAkhir");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  function applyRange() {
    setError(null);
    startTransition(async () => {
      try {
        setRows(await fetchAction(startDate, endDate));
        setLastUpdated(new Date());
        setPage(1);
      } catch {
        setError("Gagal memuat data periode ini.");
      }
    });
  }

  // Refreshes the whole list after a successful payment -- Saldo Akhir and
  // the transaction list both change for the affected Agen, and re-running
  // the same fetchAction (current date range) is simpler than patching one
  // row's derived fields client-side.
  async function handleBayar(
    agenId: string,
    jumlah: number,
    kasBank: { utama?: string; logistik?: string },
    catatan: string | null
  ) {
    const results = await submitBayar(agenId, jumlah, kasBank, catatan);
    setRows(await fetchAction(startDate, endDate));
    setLastUpdated(new Date());
    return results;
  }

  // Mirrors handleBayar for a Tabungan withdrawal -- same full-refresh
  // rationale (Saldo Akhir and the transaction list both change).
  async function handleTarik(
    agenId: string,
    jumlah: number,
    kasBank: { utama?: string; logistik?: string },
    catatan: string | null
  ) {
    const results = await submitTarik(agenId, jumlah, kasBank, catatan);
    setRows(await fetchAction(startDate, endDate));
    setLastUpdated(new Date());
    return results;
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const filtered = useMemo(() => {
    let result = rows.filter((r) => {
      if (status !== "all" && statusOf(r) !== status) return false;
      if (search && !r.nama.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    result = [...result].sort((a, b) => {
      if (sortKey === "Nama") return dir * a.nama.localeCompare(b.nama);
      if (sortKey === "Pesanan") return dir * (a.pesanan - b.pesanan);
      return dir * (a.saldoAkhir - b.saldoAkhir);
    });
    return result;
  }, [rows, search, status, sortKey, sortDir]);

  const filterKey = `${search}|${status}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const periodeLabel = formatPeriodeLabel(startDate, endDate);

  const exportRows = useMemo(
    () =>
      filtered.map((r) => ({
        nama: r.nama,
        tabunganAwal: r.tabunganAwal,
        hutangAwal: r.hutangAwal,
        pesanan: r.pesanan,
        retur: r.retur,
        pembayaran: r.pembayaran,
        tarikan: r.tarikan,
        saldoAkhir: r.saldoAkhir,
      })),
    [filtered]
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="piutang-start" className="text-xs">
            Tanggal Awal
          </Label>
          <Input id="piutang-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="piutang-end" className="text-xs">
            Tanggal Akhir
          </Label>
          <Input id="piutang-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
        </div>
        <Button onClick={applyRange} disabled={pending}>
          {pending ? "Memuat..." : "Terapkan"}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Cari nama Agen..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
        <Select value={status} onValueChange={(v) => setStatus((v as StatusFilter) ?? "all")}>
          <SelectTrigger className="w-36">
            <SelectValue>
              {() => (status === "all" ? "Semua Status" : status === "hutang" ? "Hutang" : status === "tabungan" ? "Tabungan" : "Lunas")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="hutang">Hutang</SelectItem>
            <SelectItem value="tabungan">Tabungan</SelectItem>
            <SelectItem value="lunas">Lunas</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex flex-1 flex-wrap items-center gap-1.5 sm:justify-end">
          <SortToggle label="Saldo Akhir" sortKey="SaldoAkhir" active={sortKey === "SaldoAkhir"} direction={sortDir} onSort={handleSort} />
          <SortToggle label="Pesanan" sortKey="Pesanan" active={sortKey === "Pesanan"} direction={sortDir} onSort={handleSort} />
          <SortToggle label="Nama" sortKey="Nama" active={sortKey === "Nama"} direction={sortDir} onSort={handleSort} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Menampilkan {pageRows.length} dari {filtered.length} Agen.
        </p>
        <ExportXlsxButton filename="rekening-agen-gabungan" sheetName="Rekening Agen" columns={EXPORT_COLUMNS} rows={exportRows} />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {pageRows.map((r) => (
          <AgenCard
            key={r.agenId}
            row={r}
            periodeLabel={periodeLabel}
            lastUpdated={lastUpdated}
            fetchBayarContext={fetchBayarContext}
            submitBayar={handleBayar}
            fetchTarikContext={fetchTarikContext}
            submitTarik={handleTarik}
          />
        ))}
        {pageRows.length === 0 && <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Tidak ada data.</p>}
      </div>

      <Pagination page={page} pageCount={pageCount} onChange={setPage} />
    </div>
  );
}
