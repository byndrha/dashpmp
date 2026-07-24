"use client";

import { useState, useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { HPPBersihData } from "@/lib/queries/hpp-bersih";
import { getHPPBersihAction } from "@/app/(dashboard)/pnl/actions";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const STICKY_LABEL_CLASS = "sticky left-0 z-10 bg-card";

function formatQty(value: number): string {
  return value.toLocaleString("id-ID", { maximumFractionDigits: 0 });
}

// Mirrors SalesTodayPanel's self-contained navigation pattern: local state +
// useTransition + a server action refetch, no URL/searchParams involved.
export function HPPBersihPanel({ initialData }: { initialData: HPPBersihData }) {
  const [data, setData] = useState(initialData);
  const [pending, startTransition] = useTransition();

  function navigate(nextYear: number) {
    startTransition(async () => {
      const result = await getHPPBersihAction(nextYear);
      setData(result);
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle>Perhitungan HPP Bersih</CardTitle>
          <CardDescription>
            Detail HPP Bersih per bulan &mdash; jumlah nominal tiap akun COA dibagi total kantong penjualan bulan
            tersebut.
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            disabled={pending}
            onClick={() => navigate(data.year - 1)}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="w-12 text-center text-sm font-medium tabular-nums">{data.year}</span>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            disabled={pending}
            onClick={() => navigate(data.year + 1)}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className={cn("overflow-x-auto", pending && "opacity-50 transition-opacity")}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className={cn("h-auto min-w-[11rem] px-2 py-1.5 text-xs", STICKY_LABEL_CLASS)}>Akun</TableHead>
                {MONTH_LABELS.map((label, i) => (
                  <TableHead key={label} className="h-auto min-w-[6.5rem] px-2 py-1.5 text-right text-xs">
                    <p>{label}</p>
                    <p className="font-normal tabular-nums text-muted-foreground">
                      {formatQty(data.totalKantongPenjualan[i])}
                    </p>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.accounts.map((acc) => (
                <TableRow key={acc.AccountNo}>
                  <TableCell className={cn("px-2 py-1.5", STICKY_LABEL_CLASS)}>
                    <p className="text-xs font-medium leading-tight">{acc.AccountName}</p>
                    <p className="font-data text-[10px] leading-tight text-muted-foreground">{acc.AccountNo}</p>
                  </TableCell>
                  {acc.MonthlyRatio.map((ratio, i) => (
                    <TableCell key={i} className="px-2 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                      <Tooltip>
                        <TooltipTrigger className="cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2">
                          {formatRupiah(ratio)}
                        </TooltipTrigger>
                        <TooltipContent>
                          Nominal {acc.AccountName} ({MONTH_LABELS[i]}): {formatRupiah(acc.MonthlyNominal[i])}
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                  ))}
                </TableRow>
              ))}

              <TableRow className="bg-card/50">
                <TableCell className={cn("px-2 py-1.5", STICKY_LABEL_CLASS, "bg-card/50")}>
                  <p className="text-xs font-medium leading-tight">Total Kantong Penjualan</p>
                </TableCell>
                {data.totalKantongPenjualan.map((qty, i) => (
                  <TableCell key={i} className="px-2 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                    {formatQty(qty)}
                  </TableCell>
                ))}
              </TableRow>

              <TableRow>
                <TableCell className={cn("border-t px-2 py-2 font-semibold", STICKY_LABEL_CLASS)}>
                  <p className="text-xs leading-tight">HPP Bersih</p>
                </TableCell>
                {data.totalHPPBersih.map((total, i) => (
                  <TableCell key={i} className="border-t px-2 py-2 text-right text-xs font-semibold tabular-nums">
                    {formatRupiah(total)}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </div>

        <div className="mt-3 rounded-lg border border-border bg-card/50 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Rumus Perhitungan HPP Bersih:</p>
          <p className="mt-1 font-data">
            HPP Bersih = &Sigma; (Nominal Akun COA &divide; Total Kantong Penjualan), per bulan, dijumlahkan dari
            akun: 5000, 6103, 6105, 6108, 6110, 6115, 6126, 6101.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
