"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/dashboard/pagination";
import { ExportXlsxButton } from "@/components/dashboard/export-xlsx-button";
import { formatDate, formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SEGMENTASI_OPTIONS, type Segmentasi } from "@/lib/segmentasi-mitra";
import type { XlsxColumn } from "@/lib/export-xlsx";
import type { EsBalokAgingBucket, EsBalokInvoiceRow, EsBalokPiutangStatus } from "@/lib/queries/piutang-invoice-outstanding";

// One row per EsBalokInvoiceRow (Pesanan), not per Agen — matches
// aging-table.tsx's own EXPORT_COLUMNS precedent (per-invoice grain export
// even though the screen groups by mitra/Agen).
const EXPORT_COLUMNS: XlsxColumn[] = [
  { header: "Agen", key: "agen", width: 26 },
  { header: "Segmentasi", key: "segmentasi", width: 16 },
  { header: "No Dokumen", key: "noDokumen", type: "text", width: 22 },
  { header: "Tanggal", key: "tanggal", type: "text", width: 14 },
  { header: "Outstanding", key: "outstanding", type: "number", width: 16 },
  { header: "Hari Terlambat", key: "hariTerlambat", type: "number", width: 14 },
  { header: "Kategori Umur", key: "kategoriUmur", type: "text", width: 16 },
  { header: "Status", key: "status", type: "text", width: 12 },
];

type SortKey = "AgenNama" | "Outstanding" | "DaysOverdue";

const PAGE_SIZE = 12;
const COLLAPSED_PREVIEW_COUNT = 2;

// Ported verbatim from aging-table.tsx:49-61 — same 3-key/5-key color maps,
// just re-keyed to EsBalokAgingBucket/EsBalokPiutangStatus's own literal
// union values (identical bucket labels and same 3 status names).
const BUCKET_TONE: Record<EsBalokAgingBucket, string> = {
  "Belum Jatuh Tempo": "bg-muted text-muted-foreground",
  "1-30 Hari": "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  "31-60 Hari": "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  "61-90 Hari": "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  ">90 Hari": "bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-200",
};

const STATUS_BADGE: Record<EsBalokPiutangStatus, string> = {
  Sehat: "bg-primary/15 text-primary",
  Perhatian: "bg-warning/15 text-warning",
  Kritis: "bg-destructive/15 text-destructive",
};

const STATUS_RANK: Record<EsBalokPiutangStatus, number> = { Kritis: 3, Perhatian: 2, Sehat: 1 };

function segmentasiLabel(value: Segmentasi | null): string | null {
  if (!value) return null;
  return SEGMENTASI_OPTIONS.find((s) => s.value === value)?.label ?? null;
}

interface AgenInvoiceGroup {
  agenId: string;
  agenNama: string;
  segmentasi: Segmentasi | null;
  totalOutstanding: number;
  maxDaysOverdue: number;
  worstStatus: EsBalokPiutangStatus;
  invoices: EsBalokInvoiceRow[];
}

// Ported from aging-table.tsx:78-107's groupByMitra, with
// BusinessPartnerID/CustomerName/Wilayah replaced by agenId/agenNama/
// segmentasi and DueDate-based tie-break dropped (EsBalokInvoiceRow has no
// due-date field of its own — see piutang-invoice-outstanding.ts's note
// that "jatuh tempo" here is only ever an in-JS-derived assumption, not a
// stored column).
function groupByAgen(rows: EsBalokInvoiceRow[]): AgenInvoiceGroup[] {
  const byAgen = new Map<string, AgenInvoiceGroup>();
  for (const r of rows) {
    let g = byAgen.get(r.agenId);
    if (!g) {
      g = {
        agenId: r.agenId,
        agenNama: r.agenNama,
        segmentasi: r.segmentasi,
        totalOutstanding: 0,
        maxDaysOverdue: -Infinity,
        worstStatus: r.status,
        invoices: [],
      };
      byAgen.set(r.agenId, g);
    }
    g.totalOutstanding += r.outstanding;
    g.maxDaysOverdue = Math.max(g.maxDaysOverdue, r.daysOverdue);
    if (STATUS_RANK[r.status] > STATUS_RANK[g.worstStatus]) g.worstStatus = r.status;
    g.invoices.push(r);
  }
  for (const g of byAgen.values()) {
    g.invoices.sort((a, b) => b.daysOverdue - a.daysOverdue);
  }
  return [...byAgen.values()];
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
        direction === "asc" ? (
          <ArrowUp className="size-3" />
        ) : (
          <ArrowDown className="size-3" />
        )
      ) : (
        <ArrowUpDown className="size-3 opacity-40" />
      )}
    </button>
  );
}

function PesananRow({ invoice }: { invoice: EsBalokInvoiceRow }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 py-1.5">
      <div className="min-w-0">
        <p className="font-data truncate text-[11px] text-muted-foreground">{invoice.noDokumen}</p>
        <p className="text-[11px] text-muted-foreground">{formatDate(invoice.tanggal)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", BUCKET_TONE[invoice.agingBucket])}>
          {invoice.agingBucket}
        </span>
        <span className="text-xs font-semibold tabular-nums">{formatRupiah(invoice.outstanding)}</span>
      </div>
    </div>
  );
}

function AgenInvoiceCard({ group }: { group: AgenInvoiceGroup }) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = group.invoices.length > COLLAPSED_PREVIEW_COUNT;
  const visibleInvoices = expanded ? group.invoices : group.invoices.slice(0, COLLAPSED_PREVIEW_COUNT);
  const segLabel = segmentasiLabel(group.segmentasi);

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={() => hasMore && setExpanded((v) => !v)}
      onKeyDown={(e) => {
        if (hasMore && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          setExpanded((v) => !v);
        }
      }}
      className={cn("py-3", hasMore && "cursor-pointer transition-colors hover:border-primary/40")}
    >
      <CardContent className="flex flex-col gap-1.5 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{group.agenNama}</p>
            <Badge variant={segLabel ? "secondary" : "outline"} className="mt-1 h-5 px-1.5 text-[10px]">
              {segLabel ?? "Belum Ditentukan"}
            </Badge>
          </div>
          <span className={cn("shrink-0 rounded px-2 py-0.5 text-[11px] font-medium", STATUS_BADGE[group.worstStatus])}>
            {group.worstStatus}
          </span>
        </div>

        <div className="flex items-center justify-between border-t pt-1.5">
          <span className="text-xs text-muted-foreground">{group.invoices.length} invoice outstanding</span>
          <span className="font-display text-base font-semibold tabular-nums">{formatRupiah(group.totalOutstanding)}</span>
        </div>

        <div className="divide-y divide-border border-t">
          {visibleInvoices.map((invoice) => (
            <PesananRow key={invoice.noDokumen} invoice={invoice} />
          ))}
        </div>

        {hasMore && (
          <p className="flex items-center justify-center gap-1 pt-0.5 text-[11px] text-muted-foreground">
            {expanded ? "Sembunyikan" : `+${group.invoices.length - COLLAPSED_PREVIEW_COUNT} transaksi lainnya`}
            <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function EsBalokInvoiceOutstandingTable({ rows }: { rows: EsBalokInvoiceRow[] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("DaysOverdue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const groups = useMemo(() => groupByAgen(rows), [rows]);

  const filtered = useMemo(() => {
    const result = groups.filter((g) => {
      if (search && !g.agenNama?.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    result.sort((a, b) => {
      if (sortKey === "AgenNama") return dir * a.agenNama.localeCompare(b.agenNama);
      if (sortKey === "Outstanding") return dir * (a.totalOutstanding - b.totalOutstanding);
      return dir * (a.maxDaysOverdue - b.maxDaysOverdue);
    });
    return result;
  }, [groups, search, sortKey, sortDir]);

  // Per-invoice, not per-Agen-card — flattens the filtered (not paginated)
  // groups back into EsBalokInvoiceRow[] so the export always has one row
  // per Pesanan/invoice, matching aging-table.tsx's own export precedent
  // (ignores pagination, honors the search filter).
  const exportRows = useMemo(
    () =>
      filtered
        .flatMap((g) => g.invoices)
        .map((inv) => ({
          agen: inv.agenNama,
          segmentasi: segmentasiLabel(inv.segmentasi) ?? "",
          noDokumen: inv.noDokumen,
          tanggal: formatDate(inv.tanggal),
          outstanding: inv.outstanding,
          hariTerlambat: inv.daysOverdue,
          kategoriUmur: inv.agingBucket,
          status: inv.status,
        })),
    [filtered]
  );

  const filterKey = search;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalInvoices = filtered.reduce((sum, g) => sum + g.invoices.length, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Cari nama Agen..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        <div className="flex flex-1 flex-wrap items-center gap-1.5 sm:justify-end">
          <SortToggle label="Terlambat" sortKey="DaysOverdue" active={sortKey === "DaysOverdue"} direction={sortDir} onSort={handleSort} />
          <SortToggle label="Nominal" sortKey="Outstanding" active={sortKey === "Outstanding"} direction={sortDir} onSort={handleSort} />
          <SortToggle label="Nama" sortKey="AgenNama" active={sortKey === "AgenNama"} direction={sortDir} onSort={handleSort} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Menampilkan {pageRows.length} dari {filtered.length} Agen ({totalInvoices} invoice outstanding).
        </p>
        <ExportXlsxButton
          filename="invoice-outstanding-es-balok"
          sheetName="Invoice Outstanding"
          columns={EXPORT_COLUMNS}
          rows={exportRows}
        />
      </div>

      <div className="grid grid-cols-1 gap-2 @2xl:grid-cols-2 @4xl:grid-cols-3">
        {pageRows.map((g) => (
          <AgenInvoiceCard key={g.agenId} group={g} />
        ))}
        {pageRows.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Tidak ada data.</p>
        )}
      </div>

      <Pagination page={page} pageCount={pageCount} onChange={setPage} />
    </div>
  );
}
