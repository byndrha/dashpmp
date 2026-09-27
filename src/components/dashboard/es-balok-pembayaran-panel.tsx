"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDate, formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EsBalokPiutangStatus } from "@/lib/queries/piutang-invoice-outstanding";
import type { EsBalokPembayaranRow } from "@/lib/queries/piutang-priority-es-balok";

// Ported from aging-table.tsx:57-61 / piutang-payments-panel.tsx's own
// STATUS_BADGE — same 3-key map, same 3 status literals.
const STATUS_BADGE: Record<EsBalokPiutangStatus, string> = {
  Sehat: "bg-primary/15 text-primary",
  Perhatian: "bg-warning/15 text-warning",
  Kritis: "bg-destructive/15 text-destructive",
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// One row per PMP_Pembayaran document (already the invoice grain — see
// piutang-priority-es-balok.ts's getEsBalokPembayaranByDate), no per-Agen
// grouping needed. Simple date-picker + card list, adapted from
// piutang-payments-panel.tsx's date-nav pattern but simplified to a plain
// `<input type="date">` calling `onDateChange` directly (no router/
// searchParams wiring here — the caller owns the date-fetch round trip).
export function EsBalokPembayaranPanel({
  rows,
  onDateChange,
}: {
  rows: EsBalokPembayaranRow[];
  onDateChange: (dateISO: string) => void;
}) {
  const [date, setDate] = useState(todayISO());

  function handleDateChange(value: string) {
    if (!value) return;
    setDate(value);
    onDateChange(value);
  }

  const totalPembayaran = rows.reduce((sum, r) => sum + r.pembayaran, 0);
  const totalTarikan = rows.reduce((sum, r) => sum + r.tarikan, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {rows.length} dokumen &middot; total pembayaran {formatRupiah(totalPembayaran)}
          {totalTarikan > 0 && <> &middot; tarikan {formatRupiah(totalTarikan)}</>}
        </p>
        <Input
          type="date"
          value={date}
          max={todayISO()}
          onChange={(e) => handleDateChange(e.target.value)}
          className="h-8 w-40 text-xs"
        />
      </div>

      <div className="grid grid-cols-1 gap-2 @2xl:grid-cols-2 @4xl:grid-cols-3">
        {rows.map((r) => (
          <Card key={`${r.sumber}-${r.noDokumen}`} className="py-3">
            <CardContent className="flex flex-col gap-1.5 px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.agenNama}</p>
                  <p className="font-data truncate text-[11px] text-muted-foreground">{r.noDokumen}</p>
                </div>
                <span className={cn("shrink-0 rounded px-2 py-0.5 text-[11px] font-medium", STATUS_BADGE[r.status])}>
                  {r.status}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-1.5 text-xs">
                <span className="text-muted-foreground">{formatDate(r.tanggal)}</span>
                <span className="text-muted-foreground">Sisa Piutang {formatRupiah(r.sisaPiutang)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">Pembayaran</span>
                <span
                  className={cn(
                    "font-display text-base font-semibold tabular-nums",
                    r.pembayaran > 0 ? "text-primary" : "text-foreground"
                  )}
                >
                  {formatRupiah(r.pembayaran)}
                </span>
              </div>
              {r.tarikan > 0 && (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">Tarikan</span>
                  <span className="font-display text-base font-semibold tabular-nums text-destructive">
                    {formatRupiah(r.tarikan)}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {rows.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
            Belum ada pembayaran pada tanggal ini.
          </p>
        )}
      </div>
    </div>
  );
}
