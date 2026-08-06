"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X, MapPin, Map as MapIcon, Star, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { WilayahSelect } from "@/components/dashboard/wilayah-select";
import { KecamatanSelect } from "@/components/dashboard/kecamatan-select";
import { MitraSelect } from "@/components/dashboard/mitra-select";
import {
  addMarketingWilayahAction,
  removeMarketingWilayahAction,
  addMarketingMitraAction,
  removeMarketingMitraAction,
} from "@/app/(dashboard)/pemasaran/actions";
import type {
  MarketingWilayahAssignment,
  MarketingMitraAssignment,
  MarketingUserOption,
  MitraOption,
} from "@/lib/queries/marketing-wilayah";

// Accounting/Manager/Supervisor/Super Admin admin tool for assigning which
// Wilayah/Kecamatan each Marketing is responsible for — visible only when
// canManageWilayah, since this is what determines whose responsibility a
// Mitra falls under everywhere else in the app. A popup (not an inline
// panel) so it doesn't permanently take up space on the Pemasaran page.
export function MarketingWilayahPanel({
  assignments,
  mitraAssignments,
  marketingUsers,
  mitraOptions,
}: {
  assignments: MarketingWilayahAssignment[];
  mitraAssignments: MarketingMitraAssignment[];
  marketingUsers: MarketingUserOption[];
  mitraOptions: MitraOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [marketingUserId, setMarketingUserId] = useState("");
  const [wilayah, setWilayah] = useState("");
  const [regencyCode, setRegencyCode] = useState<string | null>(null);
  const [kecamatan, setKecamatan] = useState("");
  const [seluruhWilayah, setSeluruhWilayah] = useState(false);
  const [pending, startTransition] = useTransition();
  const [removingId, setRemovingId] = useState<number | null>(null);

  const [mitraMarketingUserId, setMitraMarketingUserId] = useState("");
  const [businessPartnerId, setBusinessPartnerId] = useState("");
  const [mitraPending, startMitraTransition] = useTransition();
  const [removingMitraId, setRemovingMitraId] = useState<number | null>(null);

  function handleWilayahChange(name: string, code: string | null) {
    // Same pattern as PengajuanFormDialog/MitraFormDialog: only clears
    // Kecamatan when Wilayah actually changes to a different region.
    if (name !== wilayah) setKecamatan("");
    setWilayah(name);
    setRegencyCode(code);
  }

  function resetForm() {
    setMarketingUserId("");
    setWilayah("");
    setRegencyCode(null);
    setKecamatan("");
    setSeluruhWilayah(false);
  }

  function handleAdd() {
    if (!marketingUserId || !wilayah || (!seluruhWilayah && !kecamatan)) {
      toast.error("Pilih Marketing, Wilayah, dan Kecamatan (atau centang Seluruh Wilayah).");
      return;
    }
    startTransition(async () => {
      const result = await addMarketingWilayahAction({
        marketingUserId,
        wilayah,
        kecamatan: seluruhWilayah ? null : kecamatan,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      resetForm();
      router.refresh();
    });
  }

  function handleRemove(id: number) {
    setRemovingId(id);
    startTransition(async () => {
      const result = await removeMarketingWilayahAction(id);
      if (!result.success) {
        toast.error(result.error);
      } else {
        router.refresh();
      }
      setRemovingId(null);
    });
  }

  function handleAddMitra() {
    if (!mitraMarketingUserId || !businessPartnerId) {
      toast.error("Pilih Marketing dan Mitra.");
      return;
    }
    startMitraTransition(async () => {
      const result = await addMarketingMitraAction({ marketingUserId: mitraMarketingUserId, businessPartnerId });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setMitraMarketingUserId("");
      setBusinessPartnerId("");
      router.refresh();
    });
  }

  function handleRemoveMitra(id: number) {
    setRemovingMitraId(id);
    startMitraTransition(async () => {
      const result = await removeMarketingMitraAction(id);
      if (!result.success) {
        toast.error(result.error);
      } else {
        router.refresh();
      }
      setRemovingMitraId(null);
    });
  }

  // One row per Marketing instead of one row per (Wilayah, Kecamatan) pair —
  // every assignment they hold shows as a removable badge inside that single
  // row, per explicit request to keep the table from ballooning into dozens
  // of near-duplicate rows for a Marketing covering many Kecamatan.
  const groupedAssignments = useMemo(() => {
    const byMarketing = new Map<string, { MarketingUserID: string; MarketingNama: string; items: MarketingWilayahAssignment[] }>();
    for (const a of assignments) {
      let g = byMarketing.get(a.MarketingUserID);
      if (!g) {
        g = { MarketingUserID: a.MarketingUserID, MarketingNama: a.MarketingNama, items: [] };
        byMarketing.set(a.MarketingUserID, g);
      }
      g.items.push(a);
    }
    return [...byMarketing.values()].sort((a, b) => a.MarketingNama.localeCompare(b.MarketingNama));
  }, [assignments]);

  // Marketing -> Wilayah -> Mitra, three levels deep per explicit request —
  // a Marketing's priority mitra list is what most needs scanning at a
  // glance, and grouping by Wilayah within that keeps mitra from the same
  // region together instead of one flat alphabetical dump.
  const groupedMitra = useMemo(() => {
    const byMarketing = new Map<
      string,
      { MarketingUserID: string; MarketingNama: string; byWilayah: Map<string, MarketingMitraAssignment[]> }
    >();
    for (const a of mitraAssignments) {
      let g = byMarketing.get(a.MarketingUserID);
      if (!g) {
        g = { MarketingUserID: a.MarketingUserID, MarketingNama: a.MarketingNama, byWilayah: new Map() };
        byMarketing.set(a.MarketingUserID, g);
      }
      let list = g.byWilayah.get(a.Wilayah);
      if (!list) {
        list = [];
        g.byWilayah.set(a.Wilayah, list);
      }
      list.push(a);
    }
    return [...byMarketing.values()]
      .map((g) => ({
        ...g,
        wilayahGroups: [...g.byWilayah.entries()].sort((a, b) => a[0].localeCompare(b[0])),
        totalCapacity: [...g.byWilayah.values()].flat().reduce((sum, a) => sum + (a.Capacity ?? 0), 0),
      }))
      .sort((a, b) => a.MarketingNama.localeCompare(b.MarketingNama));
  }, [mitraAssignments]);

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <MapIcon className="size-4" />
        Kelola Cakupan Wilayah Marketing
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Cakupan Wilayah Marketing</DialogTitle>
            <DialogDescription>
              Tentukan wilayah &amp; kecamatan yang menjadi tanggung jawab setiap Marketing, plus mitra tertentu yang
              jadi prioritas seorang Marketing meski berada di wilayah Marketing lain. Ini menjadi acuan mitra mana
              yang menjadi tanggung jawab siapa di seluruh dashboard — mitra prioritas selalu menang.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <h3 className="text-xs font-semibold text-muted-foreground">Wilayah &amp; Kecamatan</h3>
            <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-secondary/30 p-3">
              <div className="flex w-48 flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Marketing
                </span>
                <Select value={marketingUserId} onValueChange={(v) => setMarketingUserId(v ?? "")}>
                  <SelectTrigger className="w-full" aria-label="Marketing">
                    <SelectValue placeholder="Pilih Marketing">
                      {(v: string) => marketingUsers.find((u) => u.UserID === v)?.Nama ?? v}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {marketingUsers.map((u) => (
                      <SelectItem key={u.UserID} value={u.UserID}>
                        {u.Nama}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex w-48 flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Wilayah
                </span>
                <WilayahSelect value={wilayah} onChange={handleWilayahChange} />
              </div>
              <div className="flex w-48 flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Kecamatan
                </span>
                {seluruhWilayah ? (
                  <div className="flex h-9 items-center rounded-md border bg-muted px-3 text-xs text-muted-foreground">
                    Seluruh kecamatan
                  </div>
                ) : (
                  <KecamatanSelect regencyCode={regencyCode} value={kecamatan} onChange={setKecamatan} />
                )}
              </div>
              <Button
                type="button"
                variant={seluruhWilayah ? "default" : "outline"}
                size="sm"
                onClick={() => setSeluruhWilayah((v) => !v)}
              >
                Seluruh Wilayah
              </Button>
              <Button type="button" size="sm" disabled={pending} onClick={handleAdd}>
                <Plus className="size-4" />
                Tambah
              </Button>
            </div>

            {groupedAssignments.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Belum ada cakupan wilayah yang diatur.</p>
            ) : (
              <div className="flex max-h-[40vh] flex-col divide-y overflow-y-auto rounded-lg border">
                {groupedAssignments.map((g) => (
                  <div key={g.MarketingUserID} className="flex flex-wrap items-start gap-2 p-2.5">
                    <span className="flex w-36 shrink-0 items-center gap-1.5 pt-0.5 text-sm font-medium">
                      <Users className="size-3.5 shrink-0 text-muted-foreground" />
                      {g.MarketingNama}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                      {g.items.map((a) => (
                        <Badge key={a.MarketingWilayahID} variant="secondary" className="gap-1 pr-1 text-xs">
                          <MapPin className="size-3 shrink-0" />
                          {a.Wilayah}
                          {a.Kecamatan ? ` · ${a.Kecamatan}` : " · Seluruh Wilayah"}
                          <button
                            type="button"
                            disabled={pending && removingId === a.MarketingWilayahID}
                            onClick={() => handleRemove(a.MarketingWilayahID)}
                            className="ml-0.5 rounded-full p-0.5 hover:bg-destructive/20"
                          >
                            <X className="size-3 text-destructive" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <h3 className="mt-2 border-t pt-4 text-xs font-semibold text-muted-foreground">
              Mitra Prioritas &mdash; menang atas Wilayah &amp; Kecamatan di atas
            </h3>
            <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-secondary/30 p-3">
              <div className="flex w-48 flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Marketing
                </span>
                <Select value={mitraMarketingUserId} onValueChange={(v) => setMitraMarketingUserId(v ?? "")}>
                  <SelectTrigger className="w-full" aria-label="Marketing untuk mitra prioritas">
                    <SelectValue placeholder="Pilih Marketing">
                      {(v: string) => marketingUsers.find((u) => u.UserID === v)?.Nama ?? v}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {marketingUsers.map((u) => (
                      <SelectItem key={u.UserID} value={u.UserID}>
                        {u.Nama}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex w-64 flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Mitra</span>
                <MitraSelect options={mitraOptions} value={businessPartnerId} onChange={setBusinessPartnerId} />
              </div>
              <Button type="button" size="sm" disabled={mitraPending} onClick={handleAddMitra}>
                <Plus className="size-4" />
                Tambah
              </Button>
            </div>

            {groupedMitra.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Belum ada mitra prioritas yang diatur.</p>
            ) : (
              <div className="flex max-h-[40vh] flex-col divide-y overflow-y-auto rounded-lg border">
                {groupedMitra.map((g) => (
                  <div key={g.MarketingUserID} className="p-2.5">
                    <p className="flex items-center justify-between gap-1.5 text-sm font-medium">
                      <span className="flex items-center gap-1.5">
                        <Users className="size-3.5 shrink-0 text-muted-foreground" />
                        {g.MarketingNama}
                      </span>
                      <span className="text-xs font-normal text-muted-foreground">
                        Total Target{" "}
                        <span className="font-semibold tabular-nums text-foreground">
                          {g.totalCapacity.toLocaleString("id-ID")}
                        </span>
                      </span>
                    </p>
                    <div className="mt-1.5 flex flex-col gap-1.5 pl-5">
                      {g.wilayahGroups.map(([wilayah, items]) => (
                        <div key={wilayah} className="flex flex-wrap items-start gap-2">
                          <span className="flex w-32 shrink-0 items-center gap-1 pt-0.5 text-xs text-muted-foreground">
                            <MapPin className="size-3 shrink-0" />
                            {wilayah}
                          </span>
                          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                            {items.map((a) => (
                              <Badge key={a.MarketingMitraID} variant="secondary" className="gap-1 pr-1 text-xs">
                                <Star className="size-3 shrink-0 fill-primary text-primary" />
                                {a.MitraName}
                                <span className="tabular-nums text-muted-foreground">
                                  · {a.Capacity != null ? a.Capacity.toLocaleString("id-ID") : "-"}
                                </span>
                                <button
                                  type="button"
                                  disabled={mitraPending && removingMitraId === a.MarketingMitraID}
                                  onClick={() => handleRemoveMitra(a.MarketingMitraID)}
                                  className="ml-0.5 rounded-full p-0.5 hover:bg-destructive/20"
                                >
                                  <X className="size-3 text-destructive" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
