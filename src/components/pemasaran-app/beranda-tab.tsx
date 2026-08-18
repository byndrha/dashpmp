"use client";

import { useEffect, useState, useTransition } from "react";
import { NotebookPen, PackageCheck, Wallet, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatRupiah } from "@/lib/format";
import { getBerandaDataAction, setMitraNoteAction } from "@/app/mkesindo/pemasaran-app/actions";
import type { SalesDayComparisonResult } from "@/lib/queries/sales-overview";
import type { TopMitraPiutangRow } from "@/lib/queries/top-mitra-piutang";
import type { PiutangStatus } from "@/lib/queries/aging";
import { cn } from "@/lib/utils";

const STATUS_BADGE_VARIANT: Record<PiutangStatus, string> = {
  Sehat: "border-primary/30 bg-primary/5 text-primary",
  Perhatian: "border-warning/30 bg-warning/5 text-warning",
  Kritis: "border-destructive/30 bg-destructive/5 text-destructive",
};

export function BerandaTab() {
  const [sales, setSales] = useState<SalesDayComparisonResult | null>(null);
  const [topPiutang, setTopPiutang] = useState<TopMitraPiutangRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<TopMitraPiutangRow | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getBerandaDataAction().then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSales(result.data.sales);
      setTopPiutang(result.data.topPiutang);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSaveNote(formData: FormData) {
    if (!editingNote) return;
    const targetId = editingNote.BusinessPartnerID;
    const note = String(formData.get("note") ?? "").trim();
    startTransition(async () => {
      const result = await setMitraNoteAction({ businessPartnerId: targetId, note: note || null });
      if (!result.success) return;
      setTopPiutang((prev) => prev?.map((r) => (r.BusinessPartnerID === targetId ? { ...r, TargetNote: note || null } : r)) ?? null);
      setEditingNote(null);
    });
  }

  if (error) return <p className="p-4 text-sm text-destructive">{error}</p>;
  if (!sales || !topPiutang) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const today = sales.comparisons[0]?.current;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="flex flex-col gap-1 p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <PackageCheck className="size-3.5" /> Kantong Terkirim
            </div>
            <p className="font-display text-lg font-semibold tabular-nums">{today?.DOQty.toLocaleString("id-ID") ?? 0}</p>
            <p className="text-[11px] text-muted-foreground">hari ini</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Wallet className="size-3.5" /> Penjualan
            </div>
            <p className="font-display text-lg font-semibold tabular-nums">{formatRupiah(today?.NetSales ?? 0)}</p>
            <p className="text-[11px] text-muted-foreground">hari ini</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Perbandingan Penjualan</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {sales.comparisons.map((c) => (
            <div key={c.label} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
              <div>
                <p className="font-medium">{c.label}</p>
                <p className="text-[11px] text-muted-foreground">{c.dateISO}</p>
              </div>
              <div className="text-right">
                <p className="tabular-nums">{formatRupiah(c.previous?.NetSales ?? 0)}</p>
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  {c.previous?.DOQty.toLocaleString("id-ID") ?? 0} kantong
                  {c.NominalPctChange != null && ` · ${c.NominalPctChange >= 0 ? "+" : ""}${c.NominalPctChange.toFixed(0)}%`}
                </p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Top Mitra — Piutang Tertinggi</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {topPiutang.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Belum ada mitra dengan piutang berjalan.</p>
          ) : (
            topPiutang.map((r) => (
              <div key={r.BusinessPartnerID} className="rounded-md border border-border p-2.5 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium">{r.CustomerName}</p>
                  <Badge variant="outline" className={cn("shrink-0 text-[10px]", STATUS_BADGE_VARIANT[r.Status])}>
                    {r.Status}
                  </Badge>
                </div>
                <p className="tabular-nums text-primary">{formatRupiah(r.NominalPiutang)}</p>
                <button
                  type="button"
                  onClick={() => setEditingNote(r)}
                  className="mt-1 flex items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-primary"
                >
                  <NotebookPen className="size-3.5 shrink-0" />
                  {r.TargetNote ? <span className="truncate">{r.TargetNote}</span> : <span>Tambah catatan</span>}
                </button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={editingNote != null} onOpenChange={(open) => !open && setEditingNote(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Catatan — {editingNote?.CustomerName}</DialogTitle>
          </DialogHeader>
          <form action={handleSaveNote} className="flex flex-col gap-3">
            <Textarea name="note" rows={4} defaultValue={editingNote?.TargetNote ?? ""} />
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? "Menyimpan..." : "Simpan Catatan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
