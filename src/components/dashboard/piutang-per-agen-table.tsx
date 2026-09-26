"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Download, HandCoins, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/dashboard/pagination";
import { ExportXlsxButton } from "@/components/dashboard/export-xlsx-button";
import { PiutangBayarDialog } from "@/components/dashboard/piutang-bayar-dialog";
import { formatRupiah } from "@/lib/format";
import { utcInstantToWibDisplay } from "@/lib/business-date";
import { cn } from "@/lib/utils";
import { SEGMENTASI_OPTIONS } from "@/lib/segmentasi-mitra";
import type { XlsxColumn } from "@/lib/export-xlsx";
import type { PiutangPerAgenRow, PiutangTransaksiRow } from "@/lib/queries/penjualan-piutang";
import type { PiutangBayarContext, BayarPiutangResult } from "@/lib/queries/piutang-pembayaran";

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

// "yyyy/MM/dd - HH:mm WIB" for a TRUE UTC instant (e.g. `new Date()` at
// fetch time) -- utcInstantToWibDisplay shifts it +7h so reading its raw
// UTC-component getters below gives the correct WIB wall-clock, same
// pattern formatDateWib/formatTimeWib rely on for naive-WIB values.
function formatUpdateStamp(date: Date): string {
  const wib = utcInstantToWibDisplay(date);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const d = String(wib.getUTCDate()).padStart(2, "0");
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mm = String(wib.getUTCMinutes()).padStart(2, "0");
  return `${y}/${m}/${d} - ${hh}:${mm} WIB`;
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
  pesanan: "Pesanan",
  pembayaran: "Pembayaran",
  tarikan: "Tarikan",
};

// Each entry is its own boxed chip (item + amount on a shared background)
// per explicit request -- Pesanan/Tarikan add to Hutang (shown plain),
// Pembayaran reduces it (shown as a negative, tinted like the Tabungan
// convention used elsewhere on this card).
function TransaksiRow({ item }: { item: PiutangTransaksiRow }) {
  const isReduction = item.jumlah < 0;
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-2.5 py-2">
      <div className="min-w-0">
        <p className="font-data truncate text-[11px] text-muted-foreground">{item.noDokumen}</p>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>
            {formatTanggalPendek(item.tanggal)}
            {item.balokKecil !== 0 && ` · Kecil ${item.balokKecil.toLocaleString("id-ID")}`}
            {item.balokBesar !== 0 && ` · Besar ${item.balokBesar.toLocaleString("id-ID")}`}
          </span>
          <span className="font-medium text-foreground">{TIPE_LABEL[item.tipe]}</span>
        </p>
      </div>
      <span className={cn("shrink-0 text-xs font-semibold tabular-nums", isReduction ? "text-primary" : "text-foreground")}>
        {isReduction ? "-" : ""}
        {formatRupiah(Math.abs(item.jumlah))}
      </span>
    </div>
  );
}

function AgenCard({
  row,
  periodeLabel,
  lastUpdated,
  fetchBayarContext,
  submitBayar,
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

  const jumlahPesanan = row.transaksi.filter((t) => t.tipe === "pesanan").length;
  const totalPembayaranTarikan = row.pembayaran + row.tarikan;

  async function handleExportPng() {
    if (!captureRef.current) return;
    setExporting(true);
    try {
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(captureRef.current, {
        pixelRatio: 2,
        backgroundColor: "#0a0a0a",
        filter: (node) => !(node instanceof HTMLElement && node.dataset.captureHide === "true"),
      });
      if (!blob) throw new Error("Gagal membuat gambar.");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `piutang-${row.nama.toLowerCase().replace(/\s+/g, "-")}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Gagal mengekspor kartu ke PNG.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
    <Card className="py-3.5" ref={captureRef}>
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{row.nama}</p>
            <p className="text-[10px] text-muted-foreground">Update {formatUpdateStamp(lastUpdated)}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              <Badge variant={segLabel ? "secondary" : "outline"} className="h-5 px-1.5 text-[10px]">
                {segLabel ?? "Belum Ditentukan"}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  "h-5 px-1.5 text-[10px]",
                  status === "hutang" && "border-destructive/40 text-destructive",
                  status === "tabungan" && "border-primary/40 text-primary"
                )}
              >
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
          <div className="shrink-0 text-right">
            <p className="text-[10px] text-muted-foreground">Piutang Awal</p>
            <p className="font-display text-sm font-semibold tabular-nums">{formatRupiah(row.hutangAwal)}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Tabungan Awal</p>
            <p className="font-display text-sm font-semibold tabular-nums">{formatRupiah(row.tabunganAwal)}</p>
          </div>
        </div>

        {row.transaksi.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t pt-2">
            {visibleTransaksi.map((item, i) => (
              <TransaksiRow key={`${item.noDokumen}-${item.tipe}-${i}`} item={item} />
            ))}
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

        <div className="grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-2 text-xs">
          <div>
            <p className="text-muted-foreground">Jumlah Pesanan</p>
            <p className="font-semibold tabular-nums">{jumlahPesanan} Item</p>
          </div>
          <div>
            <p className="text-muted-foreground">Total Pesanan</p>
            <p className="font-semibold tabular-nums">{formatRupiah(row.pesanan)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">T. Pembayaran/Tarikan</p>
            <p className="font-semibold tabular-nums">{formatRupiah(totalPembayaranTarikan)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Sisa Hutang</p>
            <p
              className={cn(
                "font-semibold tabular-nums",
                row.saldoAkhir > 0 && "text-destructive",
                row.saldoAkhir < 0 && "text-primary"
              )}
            >
              {formatRupiah(Math.abs(row.saldoAkhir))}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between border-t pt-2">
          <p className="text-[11px] text-muted-foreground">
            {row.transaksi.length} Entri - Periode {periodeLabel}
          </p>
          <div className="flex items-center gap-1.5" data-capture-hide="true">
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={handleExportPng} disabled={exporting}>
              <Download className="size-3" />
              {exporting ? "..." : "Export .PNG"}
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setBayarOpen(true)}>
              <HandCoins className="size-3" />
              Bayar
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <PiutangBayarDialog
      open={bayarOpen}
      onOpenChange={setBayarOpen}
      agenNama={row.nama}
      fetchContext={() => fetchBayarContext(row.agenId)}
      onSubmit={(jumlah, kasBank, catatan) => submitBayar(row.agenId, jumlah, kasBank, catatan)}
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
          />
        ))}
        {pageRows.length === 0 && <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Tidak ada data.</p>}
      </div>

      <Pagination page={page} pageCount={pageCount} onChange={setPage} />
    </div>
  );
}
