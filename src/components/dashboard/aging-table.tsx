"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
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

  const filtered = useMemo(() => {
    const result = rows.filter((r) => {
      if (partnerType !== "all" && r.PartnerType !== partnerType) return false;
      if (status !== "all" && r.Status !== status) return false;
      if (search && !r.CustomerName?.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    result.sort((a, b) => {
      if (sortKey === "CustomerName") return dir * (a.CustomerName ?? "").localeCompare(b.CustomerName ?? "");
      if (sortKey === "DueDate") return dir * (new Date(a.DueDate).getTime() - new Date(b.DueDate).getTime());
      return dir * (a[sortKey] - b[sortKey]);
    });
    return result;
  }, [rows, search, partnerType, status, sortKey, sortDir]);

  const filterKey = `${search}|${partnerType}|${status}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
        Menampilkan {pageRows.length} dari {filtered.length} invoice outstanding.
      </p>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {pageRows.map((r) => (
          <Card key={r.SalesInvoiceID} className="py-3">
            <CardContent className="flex flex-col gap-1.5 px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.CustomerName}</p>
                  <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                      {r.PartnerType}
                    </Badge>
                    <span>{r.Wilayah ?? "-"}</span>
                    {r.Kecamatan && <span>&middot; {r.Kecamatan}</span>}
                  </p>
                </div>
                <span className={cn("shrink-0 rounded px-2 py-0.5 text-[11px] font-medium", STATUS_BADGE[r.Status])}>
                  {r.Status}
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-1.5 text-xs text-muted-foreground">
                <span className="font-data">{r.VoucherNo}</span>
                <span>Terbit {formatDate(r.TransDate)}</span>
                <span>Jatuh tempo {formatDate(r.DueDate)}</span>
              </div>

              <div className="flex items-center justify-between pt-0.5">
                <span className={cn("rounded px-2 py-0.5 text-xs font-medium", BUCKET_TONE[r.AgingBucket])}>
                  {r.AgingBucket}
                </span>
                <span className="font-display text-base font-semibold tabular-nums">
                  {formatRupiah(r.Outstanding)}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
        {pageRows.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Tidak ada data.</p>
        )}
      </div>

      <Pagination page={page} pageCount={pageCount} onChange={setPage} />
    </div>
  );
}
