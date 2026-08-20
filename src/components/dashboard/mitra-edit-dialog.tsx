"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { MitraFormDialog, rowToForm, rowToLocation } from "@/components/dashboard/mitra-list";
import type { MitraRow, MitraInput, TermOfPaymentOption, PriceLevelOption } from "@/lib/queries/mitra";
import type { MitraLocationValue } from "@/components/dashboard/mitra-location-field";
import {
  getMitraDetailAction,
  getMitraEditOptionsAction,
  updateMitraAction,
  setMitraLocationAction,
  setMitraCompetitorAction,
} from "@/app/mkesindo/(dashboard)/mitra/actions";

// Self-sufficient "Edit Mitra" popup, reused anywhere a mitra card is
// clickable outside the Mitra module itself (Transaksi's "Transaksi DO per
// Mitra" panel) — same businessPartnerId-driven open/fetch contract as
// MitraDetailDialog, but wired to MitraList's own MitraFormDialog + save
// flow (createMitra is deliberately not exposed here — this dialog only
// ever edits an existing mitra, never creates one).
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
  const [pending, startTransition] = useTransition();

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

  function handleSubmit(input: MitraInput, location: MitraLocationValue | null, kompetitor: string | null) {
    if (!businessPartnerId) return;
    setError(null);
    startTransition(async () => {
      const updateResult = await updateMitraAction(businessPartnerId, input);
      if (!updateResult.success) {
        setError(updateResult.error);
        return;
      }
      if (location) {
        const locationResult = await setMitraLocationAction({ businessPartnerId, ...location });
        if (!locationResult.success) {
          setError(locationResult.error);
          return;
        }
      }
      const competitorResult = await setMitraCompetitorAction({ businessPartnerId, kompetitor });
      if (!competitorResult.success) {
        setError(competitorResult.error);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

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
      open={!!businessPartnerId}
      onOpenChange={onOpenChange}
      initial={rowToForm(detail)}
      initialLocation={rowToLocation(detail)}
      initialKompetitor={detail.Kompetitor}
      title={`Edit Mitra — ${detail.Name}`}
      termOptions={options.termOptions}
      priceLevels={options.priceLevels}
      onSubmit={handleSubmit}
      pending={pending}
      error={error}
    />
  );
}
