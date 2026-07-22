"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PengajuanFormDialog } from "@/components/dashboard/pengajuan-form-dialog";
import { PengajuanList } from "@/components/dashboard/pengajuan-list";
import { createPengajuanAction } from "@/app/(dashboard)/pemasaran/actions";
import type { PengajuanRow, PengajuanInput } from "@/lib/queries/mitra-pengajuan";
import type { PriceLevelOption } from "@/lib/queries/mitra";

export function PemasaranSection({
  rows,
  priceLevels,
  canApprove,
}: {
  rows: PengajuanRow[];
  priceLevels: PriceLevelOption[];
  canApprove: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleCreate(input: PengajuanInput) {
    startTransition(async () => {
      await createPengajuanAction(input);
      setCreating(false);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-sm font-semibold text-muted-foreground">Daftar Pengajuan Mitra</h2>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          Pengajuan Baru
        </Button>
      </div>

      <PengajuanList rows={rows} canApprove={canApprove} />

      <PengajuanFormDialog
        open={creating}
        onOpenChange={setCreating}
        priceLevels={priceLevels}
        onSubmit={handleCreate}
        pending={pending}
      />
    </div>
  );
}
