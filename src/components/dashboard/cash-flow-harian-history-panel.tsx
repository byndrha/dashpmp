"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRupiah, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { CashFlowHarianHistoryRow } from "@/lib/queries/cash-flow-harian";

export function CashFlowHarianHistoryPanel({
  rows,
  activeDate,
}: {
  rows: CashFlowHarianHistoryRow[];
  activeDate: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function goToDate(date: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("cfDate", date);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="font-display text-sm">
          Riwayat Cash Flow Harian{" "}
          <span className="font-normal text-muted-foreground">({rows.length} hari tercatat)</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto px-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-7 px-1.5 text-[10px]">Tanggal</TableHead>
                <TableHead className="h-7 px-1.5 text-right text-[10px]">Kas di Tangan</TableHead>
                <TableHead className="h-7 px-1.5 text-right text-[10px]">Peng. Kas di Tangan</TableHead>
                <TableHead className="h-7 px-1.5 text-right text-[10px]">Daftar Pengeluaran</TableHead>
                <TableHead className="h-7 w-8 px-1"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.businessDate}
                  className={cn(r.businessDate === activeDate && "bg-primary/5 hover:bg-primary/10")}
                >
                  <TableCell className="px-1.5 py-1.5 text-xs font-medium">
                    {formatDate(r.businessDate)}
                  </TableCell>
                  <TableCell className="px-1.5 py-1.5 text-right text-xs tabular-nums">
                    {r.kasDiTangan != null ? formatRupiah(r.kasDiTangan) : "-"}
                  </TableCell>
                  <TableCell className="px-1.5 py-1.5 text-right text-xs tabular-nums">
                    {r.pengeluaranKasDiTangan != null ? formatRupiah(r.pengeluaranKasDiTangan) : "-"}
                  </TableCell>
                  <TableCell className="px-1.5 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                    {r.itemCount > 0 ? `${formatRupiah(r.totalPengeluaranKas)} (${r.itemCount})` : "-"}
                  </TableCell>
                  <TableCell className="px-1 py-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={() => goToDate(r.businessDate)}
                    >
                      <Pencil className="size-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {rows.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Belum ada riwayat Cash Flow Harian yang tercatat.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
