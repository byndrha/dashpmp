"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, MapPin, Map, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
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
      try {
        await addMarketingWilayahAction({
          marketingUserId,
          wilayah,
          kecamatan: seluruhWilayah ? null : kecamatan,
        });
        resetForm();
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Gagal menambah cakupan wilayah.");
      }
    });
  }

  function handleRemove(id: number) {
    setRemovingId(id);
    startTransition(async () => {
      try {
        await removeMarketingWilayahAction(id);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Gagal menghapus cakupan wilayah.");
      } finally {
        setRemovingId(null);
      }
    });
  }

  function handleAddMitra() {
    if (!mitraMarketingUserId || !businessPartnerId) {
      toast.error("Pilih Marketing dan Mitra.");
      return;
    }
    startMitraTransition(async () => {
      try {
        await addMarketingMitraAction({ marketingUserId: mitraMarketingUserId, businessPartnerId });
        setMitraMarketingUserId("");
        setBusinessPartnerId("");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Gagal menambah mitra prioritas.");
      }
    });
  }

  function handleRemoveMitra(id: number) {
    setRemovingMitraId(id);
    startMitraTransition(async () => {
      try {
        await removeMarketingMitraAction(id);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Gagal menghapus mitra prioritas.");
      } finally {
        setRemovingMitraId(null);
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Map className="size-4" />
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

            {assignments.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Belum ada cakupan wilayah yang diatur.</p>
            ) : (
              <div className="max-h-[50vh] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Marketing</TableHead>
                      <TableHead>Wilayah</TableHead>
                      <TableHead>Kecamatan</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments.map((a) => (
                      <TableRow key={a.MarketingWilayahID}>
                        <TableCell className="font-medium">{a.MarketingNama}</TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="size-3.5 text-muted-foreground" />
                            {a.Wilayah}
                          </span>
                        </TableCell>
                        <TableCell>{a.Kecamatan ?? <Badge variant="outline">Seluruh Wilayah</Badge>}</TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={pending && removingId === a.MarketingWilayahID}
                            onClick={() => handleRemove(a.MarketingWilayahID)}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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

            {mitraAssignments.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Belum ada mitra prioritas yang diatur.</p>
            ) : (
              <div className="max-h-[50vh] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Marketing</TableHead>
                      <TableHead>Mitra</TableHead>
                      <TableHead>Wilayah</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mitraAssignments.map((a) => (
                      <TableRow key={a.MarketingMitraID}>
                        <TableCell className="font-medium">{a.MarketingNama}</TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1">
                            <Star className="size-3.5 shrink-0 fill-primary text-primary" />
                            {a.MitraName}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{a.Wilayah}</TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={mitraPending && removingMitraId === a.MarketingMitraID}
                            onClick={() => handleRemoveMitra(a.MarketingMitraID)}
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
