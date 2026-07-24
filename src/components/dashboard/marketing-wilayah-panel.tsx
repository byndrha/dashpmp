"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, MapPin, Map } from "lucide-react";
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
import { addMarketingWilayahAction, removeMarketingWilayahAction } from "@/app/(dashboard)/pemasaran/actions";
import type { MarketingWilayahAssignment, MarketingUserOption } from "@/lib/queries/marketing-wilayah";

// Accounting/Manager/Supervisor/Super Admin admin tool for assigning which
// Wilayah/Kecamatan each Marketing is responsible for — visible only when
// canManageWilayah, since this is what determines whose responsibility a
// Mitra falls under everywhere else in the app. A popup (not an inline
// panel) so it doesn't permanently take up space on the Pemasaran page.
export function MarketingWilayahPanel({
  assignments,
  marketingUsers,
}: {
  assignments: MarketingWilayahAssignment[];
  marketingUsers: MarketingUserOption[];
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
              Tentukan wilayah &amp; kecamatan yang menjadi tanggung jawab setiap Marketing. Ini menjadi acuan mitra
              mana yang menjadi tanggung jawab siapa di seluruh dashboard.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
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
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
