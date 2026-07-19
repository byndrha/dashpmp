"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Trash2, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRupiah, formatDate } from "@/lib/format";
import type { CashFlowHarian } from "@/lib/queries/cash-flow-harian";
import {
  saveCashFlowDailyFiguresAction,
  addCashFlowExpenseAction,
  deleteCashFlowExpenseAction,
} from "@/app/(dashboard)/pnl/actions";

export function CashFlowHarianPanel({ data }: { data: CashFlowHarian }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [date, setDate] = useState(data.businessDate);
  const [kasDiTangan, setKasDiTangan] = useState(data.kasDiTangan?.toString() ?? "");
  const [pengeluaranKasDiTangan, setPengeluaranKasDiTangan] = useState(
    data.pengeluaranKasDiTangan?.toString() ?? ""
  );
  const [deskripsi, setDeskripsi] = useState("");
  const [nominal, setNominal] = useState("");

  function goToDate(newDate: string) {
    setDate(newDate);
    const params = new URLSearchParams(searchParams.toString());
    params.set("cfDate", newDate);
    router.push(`${pathname}?${params.toString()}`);
  }

  function handleSaveFigures() {
    startTransition(async () => {
      await saveCashFlowDailyFiguresAction({
        businessDate: data.businessDate,
        kasDiTangan: Number(kasDiTangan) || 0,
        pengeluaranKasDiTangan: Number(pengeluaranKasDiTangan) || 0,
      });
    });
  }

  function handleAddExpense() {
    if (!deskripsi.trim() || !(Number(nominal) > 0)) return;
    startTransition(async () => {
      await addCashFlowExpenseAction({
        businessDate: data.businessDate,
        deskripsi: deskripsi.trim(),
        nominal: Number(nominal),
      });
      setDeskripsi("");
      setNominal("");
    });
  }

  function handleDeleteExpense(id: number) {
    startTransition(async () => {
      await deleteCashFlowExpenseAction(id);
    });
  }

  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="font-display text-sm">Cash Flow Harian</CardTitle>
        <Input
          type="date"
          value={date}
          onChange={(e) => goToDate(e.target.value)}
          className="h-8 w-40 text-xs"
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          Pencatatan kas manual untuk {formatDate(data.businessDate)}
          {data.updatedAt && ` — terakhir disimpan ${formatDate(data.updatedAt)}`}.
        </p>

        <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-card/50 p-3 @sm:grid-cols-3">
          <div>
            <p className="text-[11px] text-muted-foreground">Pendapatan Operasional (Otomatis)</p>
            <p className="text-sm font-semibold tabular-nums">{formatRupiah(data.pendapatanOperasional)}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="kasDiTangan" className="text-[11px] text-muted-foreground">
              Kas di Tangan (Input Manual)
            </Label>
            <Input
              id="kasDiTangan"
              type="number"
              min={0}
              value={kasDiTangan}
              onChange={(e) => setKasDiTangan(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pengeluaranKasDiTangan" className="text-[11px] text-muted-foreground">
              Pengeluaran Kas di Tangan (Input Manual)
            </Label>
            <Input
              id="pengeluaranKasDiTangan"
              type="number"
              min={0}
              value={pengeluaranKasDiTangan}
              onChange={(e) => setPengeluaranKasDiTangan(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        </div>
        <Button size="sm" className="w-fit" disabled={pending} onClick={handleSaveFigures}>
          {pending ? "Menyimpan..." : "Simpan Kas di Tangan"}
        </Button>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              Daftar Pengeluaran Kas (Input Manual)
            </p>
            <p className="text-xs font-semibold tabular-nums">{formatRupiah(data.totalPengeluaranKas)}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            {data.daftarPengeluaranKas.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5"
              >
                <span className="truncate text-xs">{item.deskripsi}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs font-medium tabular-nums">{formatRupiah(item.nominal)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    disabled={pending}
                    onClick={() => handleDeleteExpense(item.id)}
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </div>
            ))}
            {data.daftarPengeluaranKas.length === 0 && (
              <p className="py-2 text-center text-xs text-muted-foreground">Belum ada pengeluaran dicatat.</p>
            )}
          </div>
          <div className="mt-2 flex flex-col gap-2 @sm:flex-row @sm:items-end">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="deskripsi" className="text-[11px] text-muted-foreground">
                Deskripsi Pengeluaran
              </Label>
              <Input
                id="deskripsi"
                value={deskripsi}
                onChange={(e) => setDeskripsi(e.target.value)}
                placeholder="mis. Beli sparepart"
                className="h-8 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1 @sm:w-40">
              <Label htmlFor="nominal" className="text-[11px] text-muted-foreground">
                Nominal Pengeluaran
              </Label>
              <Input
                id="nominal"
                type="number"
                min={0}
                value={nominal}
                onChange={(e) => setNominal(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
            <Button
              size="sm"
              disabled={pending || !deskripsi.trim() || !(Number(nominal) > 0)}
              onClick={handleAddExpense}
            >
              <Plus className="size-3.5" /> Tambah
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
