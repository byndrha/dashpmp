"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { MitraFormDialog } from "@/components/dashboard/mitra-list";
import type { MitraRow, TermOfPaymentOption, PriceLevelOption } from "@/lib/queries/mitra";
import { getMitraDetailAction, getMitraEditOptionsAction } from "@/app/mkesindo/(dashboard)/mitra/actions";

// Self-sufficient "Edit Mitra" popup, reused anywhere a mitra card is
// clickable outside the Mitra module itself (Transaksi's "Transaksi DO per
// Mitra" panel) — same businessPartnerId-driven open/fetch contract as
// MitraDetailDialog, reusing MitraList's own MitraFormDialog (which saves
// itself via simpanMitraLengkapAction — this dialog only ever edits an
// existing mitra, never creates one).
export function MitraEditDialog({
  businessPartnerId,
  onOpenChange,
}: {
  businessPartnerId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<MitraRow | null>(null);
  const [options, setOptions] = useState<{ termOptions: TermOfPaymentOption[]; priceLevels: PriceLevelOption[] } | null>(
    null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessPartnerId) return;
    let cancelled = false;
    // Kicks off the lazy fetch for whichever mitra was just clicked — not
    // derivable from render since it's an async network call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setDetail(null);
    setOptions(null);
    setError(null);
    Promise.all([getMitraDetailAction(businessPartnerId), getMitraEditOptionsAction()])
      .then(([detailResult, optionsResult]) => {
        if (cancelled) return;
        if (!detailResult.success) {
          setError(detailResult.error);
          return;
        }
        if (!optionsResult.success) {
          setError(optionsResult.error);
          return;
        }
        setDetail(detailResult.data);
        setOptions(optionsResult.data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [businessPartnerId]);

  if (!detail || !options) {
    return (
      <Dialog open={!!businessPartnerId} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Edit Mitra</DialogTitle>
            <DialogDescription className="sr-only">Memuat data mitra.</DialogDescription>
          </DialogHeader>
          {error ? (
            <p className="py-8 text-center text-sm text-destructive">{error}</p>
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Memuat...
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <MitraFormDialog
      key={detail.BusinessPartnerID}
      open={!!businessPartnerId}
      onOpenChange={onOpenChange}
      mitra={detail}
      title={`Edit Mitra — ${detail.Name}`}
      termOptions={options.termOptions}
      priceLevels={options.priceLevels}
      onSelesai={() => {
        onOpenChange(false);
        router.refresh();
      }}
    />
  );
}
