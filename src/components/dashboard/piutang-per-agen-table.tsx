"use client";

import { useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/dashboard/pagination";
import { ExportXlsxButton } from "@/components/dashboard/export-xlsx-button";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SEGMENTASI_OPTIONS } from "@/lib/segmentasi-mitra";
import type { XlsxColumn } from "@/lib/export-xlsx";
import type { PiutangPerAgenRow, PiutangTransaksiRow } from "@/lib/queries/penjualan-piutang";

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

type SortKey = "Nama" | "SaldoAkhir" | "Pesanan";
type StatusFilter = "all" | "hutang" | "tabungan" | "lunas";

const PAGE_SIZE = 12;

function statusOf(row: PiutangPerAgenRow): StatusFilter {
  if (row.saldoAkhir > 0) return "hutang";
  if (row.saldoAkhir < 0) return "tabungan";
  return "lunas";
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

function TransaksiRow({ item }: { item: PiutangTransaksiRow }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 py-1.5">
      <div className="min-w-0">
        <p className="font-data truncate text-[11px] text-muted-foreground">{item.noDokumen}</p>
        <p className="text-[11px] text-muted-foreground">
          {formatTanggalPendek(item.tanggal)}
          {item.balokKecil !== 0 && ` · Kecil ${item.balokKecil.toLocaleString("id-ID")}`}
          {item.balokBesar !== 0 && ` · Besar ${item.balokBesar.toLocaleString("id-ID")}`}
        </p>
      </div>
      <span className="shrink-0 text-xs font-semibold tabular-nums">{formatRupiah(item.total)}</span>
    </div>
  );
}

function AgenCard({ row }: { row: PiutangPerAgenRow }) {
  const status = statusOf(row);
  const [expanded, setExpanded] = useState(false);
  const hasMore = row.transaksi.length > COLLAPSED_PREVIEW_COUNT;
  const visibleTransaksi = expanded ? row.transaksi : row.transaksi.slice(0, COLLAPSED_PREVIEW_COUNT);
  const segLabel = segmentasiLabel(row.segmentasi);
  const hasPin = row.latitude != null && row.longitude != null;

  return (
    <Card className="py-3.5">
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{row.nama}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              <Badge variant={segLabel ? "secondary" : "outline"} className="h-5 px-1.5 text-[10px]">
                {segLabel ?? "Belum Ditentukan"}
              </Badge>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {hasPin && (
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                title="Lihat di Google Maps"
                onClick={() =>
                  window.open(`https://www.google.com/maps?q=${row.latitude},${row.longitude}`, "_blank", "noopener,noreferrer")
                }
              >
                <MapPin className="size-3.5" />
              </Button>
            )}
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
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t pt-2 text-xs">
          <span className="text-muted-foreground">
            Tabungan Awal: <span className="text-foreground">{formatRupiah(row.tabunganAwal)}</span>
          </span>
          <span className="text-muted-foreground">
            Hutang Awal: <span className="text-foreground">{formatRupiah(row.hutangAwal)}</span>
          </span>
          <span className="text-muted-foreground">
            Pesanan: <span className="text-foreground">{formatRupiah(row.pesanan)}</span>
          </span>
          <span className="text-muted-foreground">
            Retur: <span className="text-foreground">{formatRupiah(row.retur)}</span>
          </span>
          <span className="text-muted-foreground">
            Pembayaran: <span className="text-foreground">{formatRupiah(row.pembayaran)}</span>
          </span>
          <span className="text-muted-foreground">
            Tarikan: <span className="text-foreground">{formatRupiah(row.tarikan)}</span>
          </span>
        </div>

        {row.transaksi.length > 0 && (
          <div className="divide-y divide-border border-t">
            {visibleTransaksi.map((item) => (
              <TransaksiRow key={item.noDokumen} item={item} />
            ))}
          </div>
        )}
        {hasMore && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center justify-center gap-1 pt-0.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {expanded ? "Sembunyikan" : `+${row.transaksi.length - COLLAPSED_PREVIEW_COUNT} transaksi lainnya`}
            <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
          </button>
        )}

        <div className="flex items-center justify-between border-t pt-2">
          <span className="text-xs text-muted-foreground">Saldo Akhir</span>
          <span
            className={cn(
              "font-display text-base font-semibold tabular-nums",
              row.saldoAkhir > 0 && "text-destructive",
              row.saldoAkhir < 0 && "text-primary"
            )}
          >
            {formatRupiah(Math.abs(row.saldoAkhir))}
          </span>
        </div>
      </CardContent>
    </Card>
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
}: {
  initialRows: PiutangPerAgenRow[];
  fetchAction: (startDate: string, endDate: string) => Promise<PiutangPerAgenRow[]>;
}) {
  const [startDate, setStartDate] = useState(monthStartISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [rows, setRows] = useState(initialRows);
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
        setPage(1);
      } catch {
        setError("Gagal memuat data periode ini.");
      }
    });
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
          <AgenCard key={r.agenId} row={r} />
        ))}
        {pageRows.length === 0 && <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Tidak ada data.</p>}
      </div>

      <Pagination page={page} pageCount={pageCount} onChange={setPage} />
    </div>
  );
}
