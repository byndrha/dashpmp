"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PengajuanFormDialog } from "@/components/dashboard/pengajuan-form-dialog";
import { PengajuanList } from "@/components/dashboard/pengajuan-list";
import { createPengajuanAction } from "@/app/mkesindo/pemasaran/actions";
import type { PengajuanRow, PengajuanInput } from "@/lib/queries/mitra-pengajuan";
import type { PriceLevelOption } from "@/lib/queries/mitra";

export function PemasaranSection({
  rows,
  priceLevels,
  canApprove,
  isSuperAdmin,
}: {
  rows: PengajuanRow[];
  priceLevels: PriceLevelOption[];
  canApprove: boolean;
  isSuperAdmin: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCreate(input: PengajuanInput) {
    setError(null);
    startTransition(async () => {
      const result = await createPengajuanAction(input);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setCreating(false);
    });
  }

  // Also clears `error` on every dismissal path (X button, Escape,
  // outside-click), not just a successful submit — same lesson as
  // revenue-target-panel.tsx (Task 11), so a failed attempt's message can't
  // still be sitting there the next time the dialog is reopened.
  function handleOpenChange(open: boolean) {
    setCreating(open);
    if (!open) setError(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-sm font-semibold text-muted-foreground">Daftar Pengajuan Mitra</h2>
        <Button
          onClick={() => {
            setError(null);
            setCreating(true);
          }}
        >
          <Plus className="size-4" />
          Pengajuan Baru
        </Button>
      </div>

      <PengajuanList rows={rows} priceLevels={priceLevels} canApprove={canApprove} isSuperAdmin={isSuperAdmin} />

      <PengajuanFormDialog
        open={creating}
        onOpenChange={handleOpenChange}
        priceLevels={priceLevels}
        onSubmit={handleCreate}
        pending={pending}
        error={error}
      />
    </div>
  );
}
