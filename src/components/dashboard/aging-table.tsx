"use client";

import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate, formatRupiah } from "@/lib/format";
import type { AgingRow } from "@/lib/queries/aging";

const BUCKET_TONE: Record<string, string> = {
  "Belum Jatuh Tempo": "bg-muted text-muted-foreground",
  "1-30 Hari": "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  "31-60 Hari": "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  "61-90 Hari": "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  ">90 Hari": "bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-200",
};

export function AgingTable({ rows }: { rows: AgingRow[] }) {
  const [search, setSearch] = useState("");
  const [partnerType, setPartnerType] = useState("all");

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (partnerType !== "all" && r.PartnerType !== partnerType) return false;
      if (search && !r.CustomerName?.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [rows, search, partnerType]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Input
          placeholder="Cari nama pelanggan..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        <Select value={partnerType} onValueChange={(value) => setPartnerType(value ?? "all")}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Tipe Mitra" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Tipe Mitra</SelectItem>
            <SelectItem value="Agen">Agen</SelectItem>
            <SelectItem value="Retail">Retail</SelectItem>
            <SelectItem value="TakeAway">TakeAway</SelectItem>
            <SelectItem value="Lainnya">Lainnya</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pelanggan</TableHead>
              <TableHead>Tipe</TableHead>
              <TableHead>Wilayah</TableHead>
              <TableHead>Kecamatan</TableHead>
              <TableHead>Kontak</TableHead>
              <TableHead>No. Invoice</TableHead>
              <TableHead>Jatuh Tempo</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead>Aging</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.SalesInvoiceID}>
                <TableCell className="font-medium">{r.CustomerName}</TableCell>
                <TableCell>
                  <Badge variant="outline">{r.PartnerType}</Badge>
                </TableCell>
                <TableCell>{r.Wilayah ?? "-"}</TableCell>
                <TableCell>{r.Kecamatan ?? "-"}</TableCell>
                <TableCell>{r.Kontak ?? "-"}</TableCell>
                <TableCell>{r.VoucherNo}</TableCell>
                <TableCell>{formatDate(r.DueDate)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRupiah(r.Outstanding)}</TableCell>
                <TableCell>
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${BUCKET_TONE[r.AgingBucket]}`}>
                    {r.AgingBucket}
                  </span>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                  Tidak ada data.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
