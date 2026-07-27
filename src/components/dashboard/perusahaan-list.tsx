"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil, Trash2, MapPin, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PerusahaanRow, PerusahaanStatus, PerusahaanInput } from "@/lib/queries/perusahaan";
import { PerusahaanFormDialog } from "@/components/dashboard/perusahaan-form-dialog";
import {
  createPerusahaanAction,
  updatePerusahaanAction,
  deletePerusahaanAction,
} from "@/app/(dashboard)/perusahaan/actions";

const STATUS_BADGE: Record<PerusahaanStatus, string> = {
  Draft: "bg-muted text-muted-foreground",
  StandaloneHTML: "bg-warning/15 text-warning",
  AktifPenuh: "bg-primary/15 text-primary",
};

const STATUS_LABEL: Record<PerusahaanStatus, string> = {
  Draft: "Draft",
  StandaloneHTML: "Standalone HTML",
  AktifPenuh: "Aktif Penuh",
};

export function PerusahaanList({ rows }: { rows: PerusahaanRow[] }) {
  const [target, setTarget] = useState<PerusahaanRow | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(input: PerusahaanInput) {
    setError(null);
    startTransition(async () => {
      try {
        if (target === "new") {
          await createPerusahaanAction(input);
        } else if (target) {
          await updatePerusahaanAction(target.PerusahaanID, input);
        }
        setTarget(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan PT.");
      }
    });
  }

  function handleDelete(row: PerusahaanRow) {
    if (!confirm(`Hapus PT "${row.Nama}"? Tindakan ini tidak dapat dibatalkan.`)) return;
    startTransition(async () => {
      try {
        await deletePerusahaanAction(row.PerusahaanID);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Gagal menghapus PT.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{rows.length} PT terdaftar.</p>
        <Button
          onClick={() => {
            setError(null);
            setTarget("new");
          }}
        >
          <Plus className="size-4" />
          Tambah PT
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => (
          <Card key={r.PerusahaanID} className="py-3.5">
            <CardContent className="flex flex-col gap-2 px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate font-medium">
                    <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
                    {r.Nama}
                  </p>
                  <p className="text-xs text-muted-foreground">{r.JenisBisnis ?? "-"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => {
                      setError(null);
                      setTarget(r);
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" disabled={pending} onClick={() => handleDelete(r)}>
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              </div>

              <span className={cn("w-fit rounded px-1.5 py-0.5 text-[10px] font-medium", STATUS_BADGE[r.Status])}>
                {STATUS_LABEL[r.Status]}
              </span>

              <div className="flex flex-col gap-1 border-t pt-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3" /> {r.Wilayah ?? "-"}
                </span>
                <span>DB: {r.DbServer ? `${r.DbServer}${r.DbName ? `/${r.DbName}` : ""}` : "belum diisi"}</span>
              </div>
            </CardContent>
          </Card>
        ))}
        {rows.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Belum ada PT terdaftar.</p>
        )}
      </div>

      <PerusahaanFormDialog
        target={target}
        onOpenChange={(open) => !open && setTarget(null)}
        onSubmit={handleSubmit}
        pending={pending}
        error={error}
      />
    </div>
  );
}
