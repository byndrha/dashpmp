"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRupiah } from "@/lib/format";
import { computeProportionalAllocation } from "@/lib/piutang-allocation";
import type { PiutangBayarContext, BayarPiutangResult } from "@/lib/queries/piutang-pembayaran";

const SUMBER_LABEL: Record<"utama" | "logistik", string> = { utama: "Utama", logistik: "Logistik" };

// Payment is auto-split across "utama"/"logistik" by each source's own
// Hutang (never using one source's Tabungan to offset the other's Hutang --
// different PT, COA, and rekening bank, per user decision 2026-09-26).
// Kas Bank is asked only for whichever source(s) the live preview actually
// allocates money to.
export function PiutangBayarDialog({
  open,
  onOpenChange,
  agenNama,
  fetchContext,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agenNama: string;
  fetchContext: () => Promise<PiutangBayarContext>;
  onSubmit: (jumlah: number, kasBank: { utama?: string; logistik?: string }, catatan: string | null) => Promise<BayarPiutangResult[]>;
}) {
  const [context, setContext] = useState<PiutangBayarContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [jumlah, setJumlah] = useState("");
  const [kasBankUtama, setKasBankUtama] = useState<string | null>(null);
  const [kasBankLogistik, setKasBankLogistik] = useState<string | null>(null);
  const [catatan, setCatatan] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Resets the dialog to a blank state every time it opens for a new
    // Agen -- not derivable from render since these are user-editable
    // fields, not synced from any prop while the dialog stays open.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJumlah("");
    setKasBankUtama(null);
    setKasBankLogistik(null);
    setCatatan("");
    setError(null);
    setContext(null);
    setLoadingContext(true);
    fetchContext()
      .then(setContext)
      .catch(() => setError("Gagal memuat data saldo Agen."))
      .finally(() => setLoadingContext(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchContext is stable per-agent for the dialog's lifetime
  }, [open]);

  const jumlahNum = Number(jumlah) || 0;
  const allocation = useMemo(() => {
    if (!context || jumlahNum <= 0) return [];
    return computeProportionalAllocation(context.hutangUtama, context.hutangLogistik, jumlahNum);
  }, [context, jumlahNum]);

  const needsUtamaKasBank = allocation.some((a) => a.sumber === "utama");
  const needsLogistikKasBank = allocation.some((a) => a.sumber === "logistik");

  async function handleSubmit() {
    if (jumlahNum <= 0) {
      setError("Jumlah pembayaran harus lebih dari 0.");
      return;
    }
    if (needsUtamaKasBank && !kasBankUtama) {
      setError("Pilih Kas Bank untuk sumber Utama.");
      return;
    }
    if (needsLogistikKasBank && !kasBankLogistik) {
      setError("Pilih Kas Bank untuk sumber Logistik.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const results = await onSubmit(
        jumlahNum,
        { utama: kasBankUtama ?? undefined, logistik: kasBankLogistik ?? undefined },
        catatan.trim() || null
      );
      toast.success(
        `Pembayaran tercatat: ${results.map((r) => `${SUMBER_LABEL[r.sumber]} ${formatRupiah(r.jumlah)} (${r.noDokumen})`).join(", ")}`
      );
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mencatat pembayaran.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Bayar — {agenNama}</DialogTitle>
        </DialogHeader>

        {loadingContext ? (
          <Skeleton className="h-40 w-full" />
        ) : context ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 rounded-md border p-3 text-xs">
              <span className="text-muted-foreground">
                Hutang Utama: <span className="text-foreground">{formatRupiah(context.hutangUtama)}</span>
              </span>
              <span className="text-muted-foreground">
                Hutang Logistik: <span className="text-foreground">{formatRupiah(context.hutangLogistik)}</span>
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Jumlah Pembayaran</Label>
              <Input type="number" value={jumlah} onChange={(e) => setJumlah(e.target.value)} placeholder="0" />
            </div>

            {allocation.length > 0 && (
              <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                Akan dialokasikan otomatis:{" "}
                {allocation.map((a, i) => (
                  <span key={a.sumber}>
                    {i > 0 && ", "}
                    <span className="font-medium text-foreground">{SUMBER_LABEL[a.sumber]}</span> {formatRupiah(a.jumlah)}
                  </span>
                ))}
              </div>
            )}

            {needsUtamaKasBank && (
              <div className="flex flex-col gap-1.5">
                <Label>Kas Bank (Utama)</Label>
                <Select value={kasBankUtama ?? ""} onValueChange={(v) => setKasBankUtama(v || null)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih Kas Bank">
                      {() => context.kasBankUtama.find((k) => k.chartOfAccountId === kasBankUtama)?.nama ?? "Pilih Kas Bank"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {context.kasBankUtama.map((k) => (
                      <SelectItem key={k.chartOfAccountId} value={k.chartOfAccountId}>
                        {k.nama}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {needsLogistikKasBank && (
              <div className="flex flex-col gap-1.5">
                <Label>Kas Bank (Logistik)</Label>
                <Select value={kasBankLogistik ?? ""} onValueChange={(v) => setKasBankLogistik(v || null)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih Kas Bank">
                      {() => context.kasBankLogistik.find((k) => k.chartOfAccountId === kasBankLogistik)?.nama ?? "Pilih Kas Bank"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {context.kasBankLogistik.map((k) => (
                      <SelectItem key={k.chartOfAccountId} value={k.chartOfAccountId}>
                        {k.nama}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label>Catatan (opsional)</Label>
              <Input value={catatan} onChange={(e) => setCatatan(e.target.value)} />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-destructive">{error ?? "Gagal memuat data."}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || loadingContext || !context}>
            {submitting ? "Menyimpan..." : "Simpan Pembayaran"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
