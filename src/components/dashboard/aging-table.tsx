"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/dashboard/pagination";
import { formatDate, formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AgingRow, PiutangStatus } from "@/lib/queries/aging";

type SortKey = "CustomerName" | "DueDate" | "Outstanding" | "DaysOverdue";

const PAGE_SIZE = 12;
const COLLAPSED_PREVIEW_COUNT = 2;

const BUCKET_TONE: Record<string, string> = {
  "Belum Jatuh Tempo": "bg-muted text-muted-foreground",
  "1-30 Hari": "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  "31-60 Hari": "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  "61-90 Hari": "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  ">90 Hari": "bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-200",
};

const STATUS_BADGE: Record<PiutangStatus, string> = {
  Sehat: "bg-primary/15 text-primary",
  Perhatian: "bg-warning/15 text-warning",
  Kritis: "bg-destructive/15 text-destructive",
};

const STATUS_RANK: Record<PiutangStatus, number> = { Kritis: 3, Perhatian: 2, Sehat: 1 };

interface MitraAgingGroup {
  BusinessPartnerID: string;
  CustomerName: string;
  PartnerType: AgingRow["PartnerType"];
  Wilayah: string | null;
  Kecamatan: string | null;
  TotalOutstanding: number;
  MaxDaysOverdue: number;
  MinDueDate: string;
  WorstStatus: PiutangStatus;
  invoices: AgingRow[];
}

function groupByMitra(rows: AgingRow[]): MitraAgingGroup[] {
  const byPartner = new Map<string, MitraAgingGroup>();
  for (const r of rows) {
    let g = byPartner.get(r.BusinessPartnerID);
    if (!g) {
      g = {
        BusinessPartnerID: r.BusinessPartnerID,
        CustomerName: r.CustomerName,
        PartnerType: r.PartnerType,
        Wilayah: r.Wilayah,
        Kecamatan: r.Kecamatan,
        TotalOutstanding: 0,
        MaxDaysOverdue: -Infinity,
        MinDueDate: r.DueDate,
        WorstStatus: r.Status,
        invoices: [],
      };
      byPartner.set(r.BusinessPartnerID, g);
    }
    g.TotalOutstanding += r.Outstanding;
    g.MaxDaysOverdue = Math.max(g.MaxDaysOverdue, r.DaysOverdue);
    if (new Date(r.DueDate).getTime() < new Date(g.MinDueDate).getTime()) g.MinDueDate = r.DueDate;
    if (STATUS_RANK[r.Status] > STATUS_RANK[g.WorstStatus]) g.WorstStatus = r.Status;
    g.invoices.push(r);
  }
  for (const g of byPartner.values()) {
    g.invoices.sort((a, b) => b.DaysOverdue - a.DaysOverdue);
  }
  return [...byPartner.values()];
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

function InvoiceRow({ invoice }: { invoice: AgingRow }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 py-1.5">
      <div className="min-w-0">
        <p className="font-data truncate text-[11px] text-muted-foreground">{invoice.VoucherNo}</p>
        <p className="text-[11px] text-muted-foreground">
          Terbit {formatDate(invoice.TransDate)} &middot; Jatuh tempo {formatDate(invoice.DueDate)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", BUCKET_TONE[invoice.AgingBucket])}>
          {invoice.AgingBucket}
        </span>
        <span className="text-xs font-semibold tabular-nums">{formatRupiah(invoice.Outstanding)}</span>
      </div>
    </div>
  );
}

function MitraAgingCard({ group }: { group: MitraAgingGroup }) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = group.invoices.length > COLLAPSED_PREVIEW_COUNT;
  const visibleInvoices = expanded ? group.invoices : group.invoices.slice(0, COLLAPSED_PREVIEW_COUNT);

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
            <p className="truncate font-medium">{group.CustomerName}</p>
            <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                {group.PartnerType}
              </Badge>
              <span>{group.Wilayah ?? "-"}</span>
              {group.Kecamatan && <span>&middot; {group.Kecamatan}</span>}
            </p>
          </div>
          <span className={cn("shrink-0 rounded px-2 py-0.5 text-[11px] font-medium", STATUS_BADGE[group.WorstStatus])}>
            {group.WorstStatus}
          </span>
        </div>

        <div className="flex items-center justify-between border-t pt-1.5">
          <span className="text-xs text-muted-foreground">{group.invoices.length} invoice outstanding</span>
          <span className="font-display text-base font-semibold tabular-nums">
            {formatRupiah(group.TotalOutstanding)}
          </span>
        </div>

        <div className="divide-y divide-border border-t">
          {visibleInvoices.map((invoice) => (
            <InvoiceRow key={invoice.SalesInvoiceID} invoice={invoice} />
          ))}
        </div>

        {hasMore && (
          <p className="flex items-center justify-center gap-1 pt-0.5 text-[11px] text-muted-foreground">
            {expanded ? "Sembunyikan" : `+${group.invoices.length - COLLAPSED_PREVIEW_COUNT} invoice lainnya`}
            <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function AgingTable({ rows }: { rows: AgingRow[] }) {
  const [search, setSearch] = useState("");
  const [partnerType, setPartnerType] = useState("all");
  const [status, setStatus] = useState("all");
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

  const groups = useMemo(() => groupByMitra(rows), [rows]);

  const filtered = useMemo(() => {
    const result = groups.filter((g) => {
      if (partnerType !== "all" && g.PartnerType !== partnerType) return false;
      if (status !== "all" && g.WorstStatus !== status) return false;
      if (search && !g.CustomerName?.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    result.sort((a, b) => {
      if (sortKey === "CustomerName") return dir * (a.CustomerName ?? "").localeCompare(b.CustomerName ?? "");
      if (sortKey === "DueDate") return dir * (new Date(a.MinDueDate).getTime() - new Date(b.MinDueDate).getTime());
      if (sortKey === "Outstanding") return dir * (a.TotalOutstanding - b.TotalOutstanding);
      return dir * (a.MaxDaysOverdue - b.MaxDaysOverdue);
    });
    return result;
  }, [groups, search, partnerType, status, sortKey, sortDir]);

  const filterKey = `${search}|${partnerType}|${status}`;
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
      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Cari nama mitra..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        <Select value={partnerType} onValueChange={(value) => setPartnerType(value ?? "all")}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Tipe Mitra" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Tipe</SelectItem>
            <SelectItem value="Agen">Agen</SelectItem>
            <SelectItem value="Retail">Retail</SelectItem>
            <SelectItem value="TakeAway">TakeAway</SelectItem>
            <SelectItem value="Lainnya">Lainnya</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(value) => setStatus(value ?? "all")}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="Sehat">Sehat</SelectItem>
            <SelectItem value="Perhatian">Perhatian</SelectItem>
            <SelectItem value="Kritis">Kritis</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex flex-1 flex-wrap items-center gap-1.5 sm:justify-end">
          <SortToggle label="Terbaru" sortKey="DaysOverdue" active={sortKey === "DaysOverdue"} direction={sortDir} onSort={handleSort} />
          <SortToggle label="Nominal" sortKey="Outstanding" active={sortKey === "Outstanding"} direction={sortDir} onSort={handleSort} />
          <SortToggle label="Jatuh Tempo" sortKey="DueDate" active={sortKey === "DueDate"} direction={sortDir} onSort={handleSort} />
          <SortToggle label="Nama" sortKey="CustomerName" active={sortKey === "CustomerName"} direction={sortDir} onSort={handleSort} />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Menampilkan {pageRows.length} dari {filtered.length} mitra ({totalInvoices} invoice outstanding).
      </p>

      <div className="grid grid-cols-1 gap-2 @2xl:grid-cols-2 @4xl:grid-cols-3">
        {pageRows.map((g) => (
          <MitraAgingCard key={g.BusinessPartnerID} group={g} />
        ))}
        {pageRows.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Tidak ada data.</p>
        )}
      </div>

      <Pagination page={page} pageCount={pageCount} onChange={setPage} />
    </div>
  );
}
