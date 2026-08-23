"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Pencil, Trash2, MapPin, Building2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PerusahaanRow, PerusahaanStatus, PerusahaanInput } from "@/lib/queries/perusahaan";
import type { PerusahaanDirektoriOption } from "@/lib/queries/akun";
import type { KoneksiRow, UpsertKoneksiInput } from "@/lib/queries/perusahaan-koneksi";
import type { GDriveKoneksiRow } from "@/lib/queries/perusahaan-gdrive";
import type { ChartOfAccountOption } from "@/lib/queries/chart-of-account";
import { PerusahaanFormDialog } from "@/components/dashboard/perusahaan-form-dialog";
import { PaymentMethodDialog } from "@/components/dashboard/payment-method-dialog";
import {
  createPerusahaanAction,
  updatePerusahaanAction,
  deletePerusahaanAction,
  upsertKoneksiAction,
  disconnectGDriveAction,
} from "@/app/grup/perusahaan/actions";

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

export function PerusahaanList({
  rows,
  perusahaanDirektoriOptions,
  koneksi,
  gdriveKoneksi,
  chartOfAccountOptions,
}: {
  rows: PerusahaanRow[];
  perusahaanDirektoriOptions: PerusahaanDirektoriOption[];
  koneksi: KoneksiRow[];
  gdriveKoneksi: GDriveKoneksiRow[];
  chartOfAccountOptions: ChartOfAccountOption[];
}) {
  const [target, setTarget] = useState<PerusahaanRow | "new" | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<PerusahaanRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const searchParams = useSearchParams();
  const gdriveStatus = searchParams.get("gdrive");

  // metode_pembayaran is keyed by the Postgres perusahaan.id (same id
  // KoneksiRow/GDriveKoneksiRow use), not PerusahaanRow's MSSQL PerusahaanID —
  // resolve it via the shared Kode link, same lookup PerusahaanFormDialog
  // uses for direktoriId. null when the row isn't linked yet.
  const paymentPerusahaanId =
    paymentTarget != null ? (perusahaanDirektoriOptions.find((o) => o.kode === paymentTarget.Kode)?.id ?? null) : null;

  function handleSubmit(input: PerusahaanInput, koneksiBlocks: UpsertKoneksiInput[]) {
    setError(null);
    startTransition(async () => {
      if (target === "new") {
        const result = await createPerusahaanAction(input);
        if (!result.success) {
          setError(result.error);
          return;
        }
      } else if (target) {
        const result = await updatePerusahaanAction(target.PerusahaanID, input);
        if (!result.success) {
          setError(result.error);
          return;
        }
      }
      for (const block of koneksiBlocks) {
        const result = await upsertKoneksiAction(block);
        if (!result.success) {
          setError(result.error);
          return;
        }
      }
      setTarget(null);
    });
  }

  function handleDelete(row: PerusahaanRow) {
    if (!confirm(`Hapus PT "${row.Nama}"? Tindakan ini tidak dapat dibatalkan.`)) return;
    startTransition(async () => {
      const result = await deletePerusahaanAction(row.PerusahaanID);
      if (!result.success) {
        alert(result.error);
      }
    });
  }

  function handleDisconnectGDrive(perusahaanId: number) {
    if (!confirm("Putuskan koneksi Google Drive? Upload/baca file untuk PT ini akan berhenti sampai dihubungkan ulang.")) return;
    startTransition(async () => {
      const result = await disconnectGDriveAction(perusahaanId);
      if (!result.success) {
        alert(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {gdriveStatus === "connected" && (
        <p className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm text-primary">
          Google Drive berhasil dihubungkan.
        </p>
      )}
      {gdriveStatus === "error" && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Gagal menghubungkan Google Drive. Coba lagi dari kartu PT terkait.
        </p>
      )}
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
                    disabled={!r.Kode}
                    title={r.Kode ? "Kelola Pembayaran" : "Tautkan ke Perusahaan (Postgres) dulu untuk mengatur pembayaran"}
                    onClick={() => setPaymentTarget(r)}
                  >
                    <Wallet className="size-3.5" />
                  </Button>
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
                <span>Tautan Postgres: {r.Kode ?? "belum ditautkan"}</span>
              </div>
            </CardContent>
          </Card>
        ))}
        {rows.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Belum ada PT terdaftar.</p>
        )}
      </div>

      {/* Keyed on target identity — see the original comment this replaces:
          PerusahaanFormDialog's local useState hooks only read their initial
          value once on mount, so this key forces a remount when switching
          between PTs while the dialog stays conceptually "open". */}
      <PerusahaanFormDialog
        key={target === "new" ? "new" : target ? target.PerusahaanID : "closed"}
        target={target}
        allRows={rows}
        perusahaanDirektoriOptions={perusahaanDirektoriOptions}
        existingKoneksi={koneksi}
        existingGDrive={gdriveKoneksi}
        onOpenChange={(open) => !open && setTarget(null)}
        onSubmit={handleSubmit}
        onDisconnectGDrive={handleDisconnectGDrive}
        pending={pending}
        error={error}
      />

      <PaymentMethodDialog
        key={paymentTarget ? paymentTarget.PerusahaanID : "closed"}
        perusahaanId={paymentPerusahaanId}
        perusahaanNama={paymentTarget?.Nama ?? ""}
        chartOfAccountOptions={chartOfAccountOptions}
        onOpenChange={(open) => !open && setPaymentTarget(null)}
      />
    </div>
  );
}
