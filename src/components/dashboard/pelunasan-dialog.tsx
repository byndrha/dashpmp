"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRupiah, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PAYMENT_CHANNELS, type PaymentChannelId } from "@/lib/pelunasan-types";
import type { OutstandingInvoice } from "@/lib/queries/pelunasan";
import { getOutstandingInvoicesAction, recordPaymentAction } from "@/app/mkesindo/(dashboard)/aging/actions";
import { toast } from "sonner";

interface LineState {
  checked: boolean;
  amount: string;
}

export function PelunasanDialog({
  businessPartnerId,
  customerName,
  open,
  onOpenChange,
}: {
  businessPartnerId: string;
  customerName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [invoices, setInvoices] = useState<OutstandingInvoice[] | null>(null);
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [channel, setChannel] = useState<PaymentChannelId>("014");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // Kicks off the fetch for whichever mitra's "Bayar" button was just
    // clicked — not derivable from render since it's an async network call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInvoices(null);
    getOutstandingInvoicesAction(businessPartnerId).then((result) => {
      if (cancelled || !result.success) return;
      const rows = result.data;
      setInvoices(rows);
      setLines(
        Object.fromEntries(rows.map((r) => [r.SalesInvoiceID, { checked: false, amount: String(r.Outstanding) }]))
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, businessPartnerId]);

  function toggleLine(invoice: OutstandingInvoice) {
    setLines((prev) => ({
      ...prev,
      [invoice.SalesInvoiceID]: { ...prev[invoice.SalesInvoiceID], checked: !prev[invoice.SalesInvoiceID]?.checked },
    }));
  }

  function setAmount(invoiceId: string, amount: string) {
    setLines((prev) => ({ ...prev, [invoiceId]: { ...prev[invoiceId], amount } }));
  }

  const activeLines = Object.entries(lines).filter(([, l]) => l.checked && Number(l.amount) > 0);
  const totalDibayar = activeLines.reduce((sum, [, l]) => sum + Number(l.amount), 0);
  const overpaidLines = invoices
    ? activeLines.filter(([id, l]) => {
        const inv = invoices.find((i) => i.SalesInvoiceID === id);
        return inv && Number(l.amount) > inv.Outstanding;
      })
    : [];
  const totalDeposit = overpaidLines.reduce((sum, [id, l]) => {
    const inv = invoices?.find((i) => i.SalesInvoiceID === id);
    return sum + (inv ? Number(l.amount) - inv.Outstanding : 0);
  }, 0);

  function handleSubmit() {
    if (activeLines.length === 0) return;

    startTransition(async () => {
      const result = await recordPaymentAction({
        businessPartnerId,
        chartOfAccountId: channel,
        allocations: activeLines.map(([salesInvoiceId, l]) => ({ salesInvoiceId, amount: Number(l.amount) })),
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Pembayaran ${result.data.voucherNo} tercatat — ${formatRupiah(result.data.totalAmount)}` +
          (result.data.totalDeposit > 0 ? ` (termasuk deposit ${formatRupiah(result.data.totalDeposit)})` : "")
      );
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <HandCoins className="size-4" />
            Catat Pembayaran &mdash; {customerName}
          </DialogTitle>
          <DialogDescription>
            Pilih invoice yang dibayar, oldest-first. Nominal per invoice bisa dikurangi (bayar sebagian) atau
            dilebihkan (kelebihan otomatis jadi deposit).
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label>Kanal Pembayaran</Label>
            <Select value={channel} onValueChange={(v) => v && setChannel(v as PaymentChannelId)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_CHANNELS.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex max-h-80 flex-col gap-1.5 overflow-y-auto rounded border p-2">
            {invoices === null && (
              <p className="py-6 text-center text-sm text-muted-foreground">Memuat invoice outstanding...</p>
            )}
            {invoices?.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">Tidak ada invoice outstanding.</p>
            )}
            {invoices?.map((inv) => {
              const line = lines[inv.SalesInvoiceID];
              const isOver = line?.checked && Number(line.amount) > inv.Outstanding;
              return (
                <div
                  key={inv.SalesInvoiceID}
                  className={cn(
                    "flex flex-col gap-1 rounded border px-2 py-1.5",
                    line?.checked ? "border-primary/40 bg-primary/5" : "border-border"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!line?.checked}
                      onChange={() => toggleLine(inv)}
                      className="size-3.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-data truncate text-[11px] text-muted-foreground">{inv.VoucherNo}</p>
                      <p className="text-[11px] text-muted-foreground">
                        Jatuh tempo {formatDate(inv.DueDate)}
                        {inv.DaysOverdue > 0 && <span className="text-destructive"> &middot; telat {inv.DaysOverdue} hari</span>}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold tabular-nums">{formatRupiah(inv.Outstanding)}</span>
                  </div>
                  {line?.checked && (
                    <div className="flex items-center gap-2 pl-6">
                      <Input
                        type="number"
                        min={0}
                        value={line.amount}
                        onChange={(e) => setAmount(inv.SalesInvoiceID, e.target.value)}
                        className="h-7 w-32 text-xs"
                      />
                      {isOver && (
                        <span className="flex items-center gap-1 text-[11px] text-warning">
                          <AlertTriangle className="size-3" />
                          Lebih {formatRupiah(Number(line.amount) - inv.Outstanding)} jadi deposit
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between rounded border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Total Dibayar</span>
            <span className="font-display text-base font-semibold tabular-nums">{formatRupiah(totalDibayar)}</span>
          </div>
          {totalDeposit > 0 && (
            <p className="flex items-center gap-1 text-xs text-warning">
              <AlertTriangle className="size-3" />
              Termasuk kelebihan bayar {formatRupiah(totalDeposit)} yang akan tercatat sebagai deposit.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleSubmit} disabled={pending || activeLines.length === 0}>
            {pending ? "Menyimpan..." : "Simpan Pembayaran"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
