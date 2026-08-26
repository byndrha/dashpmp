"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getWibTimeHHmm } from "@/lib/business-date";
import { MitraSelect } from "@/components/dashboard/mitra-select";
import { ArmadaConflictDialog } from "@/components/dashboard/armada-conflict-dialog";
import { formatRupiah } from "@/lib/format";
import type { MitraRow, PriceLevelOption } from "@/lib/queries/mitra";
import type { ArmadaRow } from "@/lib/queries/armada";
import type { DriverOption } from "@/lib/queries/delivery";
import type { KantongVariant } from "@/lib/queries/sales-order";
import type { ArmadaConflictInfo } from "@/lib/queries/pengiriman-jadwal";
import { createPemesananAction, createTakeAwayPemesananAction } from "@/app/mkesindo/(dashboard)/pemesanan/actions";
import { checkArmadaConflictAction } from "@/app/mkesindo/(dashboard)/delivery/actions";
import { triggerPrintQueuePollNow } from "@/components/dashboard/print-queue-poller";

// Sentinel for "not chosen yet" — Select items can't use an empty string as
// a value (established convention, see the "all" sentinel in
// mitra-list.tsx's filter Selects / delivery-assignment-panel.tsx's UNSET).
const UNSET = "__unset__";

export function PemesananFormDialog({
  mitraList,
  armadaList,
  drivers,
  priceLevels10kg,
  priceLevels5kg,
  todayISO,
}: {
  mitraList: MitraRow[];
  armadaList: ArmadaRow[];
  drivers: DriverOption[];
  priceLevels10kg: PriceLevelOption[];
  priceLevels5kg: PriceLevelOption[];
  todayISO: string;
}) {
  const [open, setOpen] = useState(false);
  const [businessPartnerId, setBusinessPartnerId] = useState("");
  const [variant, setVariant] = useState<KantongVariant>("10kg");
  const [qty, setQty] = useState("");
  const [bonusQty, setBonusQty] = useState("");
  // Defaults to "now" (today's business date + current WIB time) purely as
  // a convenience — explicit request, still fully editable. todayISO
  // already follows the same 14:00 WIB cutoff every other "today" in this
  // app does (getBusinessDateISO), so a pemesanan created right after the
  // cutoff correctly defaults to tomorrow's date, not literally today.
  const [date, setDate] = useState(todayISO);
  const [time, setTime] = useState(() => getWibTimeHHmm());
  const [armadaId, setArmadaId] = useState<string>(UNSET);
  const [salesmanId, setSalesmanId] = useState<string>(UNSET);
  const [isTakeAway, setIsTakeAway] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ info: ArmadaConflictInfo; deliveryDateTime: Date } | null>(null);
  const [pending, startTransition] = useTransition();

  const mitra = useMemo(
    () => mitraList.find((m) => m.BusinessPartnerID === businessPartnerId) ?? null,
    [mitraList, businessPartnerId]
  );
  const mitraOptions = useMemo(
    () =>
      mitraList.map((m) => ({
        BusinessPartnerID: m.BusinessPartnerID,
        Name: m.Name,
        Wilayah: m.Wilayah ?? "Tidak Diketahui",
      })),
    [mitraList]
  );
  const priceLevels = variant === "10kg" ? priceLevels10kg : priceLevels5kg;
  const price = mitra?.PriceLevel != null ? (priceLevels.find((p) => p.Level === mitra.PriceLevel)?.Price ?? null) : null;
  const qtyNumber = Number(qty);
  const bonusQtyNumber = bonusQty ? Number(bonusQty) : 0;
  const total = price != null && qtyNumber > 0 ? price * qtyNumber : 0;
  const canSubmit =
    !!mitra &&
    mitra.PriceLevel != null &&
    price != null &&
    qtyNumber >= 0 &&
    bonusQtyNumber >= 0 &&
    // Qty may be 0 (a pure-bonus/freebie order), but the order can't be
    // entirely empty — at least one of the two must be non-zero.
    (qtyNumber > 0 || bonusQtyNumber > 0) &&
    !!date &&
    (isTakeAway || armadaId !== UNSET);

  function resetForm() {
    setBusinessPartnerId("");
    setVariant("10kg");
    setQty("");
    setBonusQty("");
    setDate(todayISO);
    setTime(getWibTimeHHmm());
    setArmadaId(UNSET);
    setSalesmanId(UNSET);
    setIsTakeAway(false);
    setError(null);
    setConflict(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetForm();
  }

  function doCreatePemesanan(deliveryDateTime: Date) {
    if (!mitra) return;
    startTransition(async () => {
      const result = await createPemesananAction({
        businessPartnerId: mitra.BusinessPartnerID,
        variant,
        qtyKantong: qtyNumber,
        bonusQty: bonusQtyNumber,
        deliveryDateTime,
        armadaId: Number(armadaId),
        salesmanId: salesmanId === UNSET ? null : salesmanId,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      handleOpenChange(false);
    });
  }

  function handleSubmit() {
    if (!canSubmit || !mitra) return;
    setError(null);
    if (isTakeAway) {
      startTransition(async () => {
        const result = await createTakeAwayPemesananAction({
          businessPartnerId: mitra.BusinessPartnerID,
          variant,
          qtyKantong: qtyNumber,
          bonusQty: bonusQtyNumber,
          deliveryDateTime: new Date(`${date}T${time}:00`),
        });
        if (!result.success) {
          setError(result.error);
          return;
        }
        toast.success("SI ditambahkan ke antrian cetak.");
        triggerPrintQueuePollNow();
        handleOpenChange(false);
      });
      return;
    }
    const candidateQty = qtyNumber + bonusQtyNumber;
    const deliveryDateTime = new Date(`${date}T${time}:00`);
    startTransition(async () => {
      const check = await checkArmadaConflictAction(Number(armadaId), deliveryDateTime, candidateQty, null);
      if (check) {
        setConflict({ info: check, deliveryDateTime });
        return;
      }
      doCreatePemesanan(deliveryDateTime);
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Buat Pemesanan
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Buat Pemesanan</DialogTitle>
            <DialogDescription>
              Pilih mitra, isi jumlah pesanan, lalu jadwalkan pengirimannya. Pesanan langsung tampil sebagai Draft di
              Papan Pengiriman.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="sr-only">Mitra</Label>
              <MitraSelect options={mitraOptions} value={businessPartnerId} onChange={setBusinessPartnerId} />
            </div>

            {mitra && (
              <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
                <div>
                  <p className="text-muted-foreground">Wilayah</p>
                  <p className="font-medium">{mitra.Wilayah ?? "Tidak Diketahui"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Kecamatan</p>
                  <p className="font-medium">{mitra.Kecamatan ?? "-"}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-muted-foreground">Alamat</p>
                  <p className="font-medium">{mitra.Alamat ?? "-"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Termin Pembayaran</p>
                  <p className="font-medium">{mitra.TermOfPaymentName ?? "-"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Price Level</p>
                  <p className="font-medium">{mitra.PriceLevel != null ? `Level ${mitra.PriceLevel}` : "Belum diatur"}</p>
                </div>
              </div>
            )}

            {mitra && mitra.PriceLevel == null && (
              <p className="text-xs text-destructive">
                Mitra ini belum punya Price Level — atur dulu di modul Mitra sebelum bisa dipesankan.
              </p>
            )}

            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label className="sr-only">Varian Kantong</Label>
                <Select value={variant} onValueChange={(v) => setVariant((v as KantongVariant) ?? "10kg")}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: string) => (v === "5kg" ? "5 KG" : "10 KG")}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10kg">10 KG</SelectItem>
                    <SelectItem value="5kg">5 KG</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qty" className="sr-only">
                  Qty (kantong)
                </Label>
                <Input
                  id="qty"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Qty (kantong)"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="bonusQty" className="sr-only">
                  Bonus (kantong)
                </Label>
                <Input
                  id="bonusQty"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Bonus (kantong)"
                  value={bonusQty}
                  onChange={(e) => setBonusQty(e.target.value)}
                />
              </div>
            </div>

            {price != null && (
              <div className="flex items-center justify-between rounded-lg border p-3 text-sm">
                <span className="text-muted-foreground">
                  {formatRupiah(price)} / kantong
                  {bonusQtyNumber > 0 && <span className="ml-1 text-primary">+{bonusQtyNumber} bonus</span>}
                </span>
                <span className="font-semibold">Total {formatRupiah(total)}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tanggal" className="sr-only">
                  Tanggal Kirim
                </Label>
                <Input id="tanggal" type="date" min={todayISO} value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="jam" className="sr-only">
                  Jam
                </Label>
                <Input id="jam" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
            </div>

            <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
              <input
                type="checkbox"
                checked={isTakeAway}
                onChange={(e) => setIsTakeAway(e.target.checked)}
                className="mt-0.5 size-4"
              />
              <span>
                <span className="font-medium">TakeAway (Ambil Sendiri)</span>
                <span className="block text-xs text-muted-foreground">
                  Mitra ambil sendiri di pabrik — SO, DO, dan Invoice langsung terbit tanpa armada/driver, lalu SI
                  langsung masuk ke antrian cetak thermal.
                </span>
              </span>
            </label>

            {!isTakeAway && (
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1.5">
                  <Label className="sr-only">Armada</Label>
                  <Select value={armadaId} onValueChange={(v) => setArmadaId(v ?? UNSET)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Pilih armada">
                        {(v: string) =>
                          v === UNSET ? "Pilih armada" : (armadaList.find((a) => String(a.ArmadaID) === v)?.Nama ?? "Pilih armada")
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {armadaList.map((a) => (
                        <SelectItem key={a.ArmadaID} value={String(a.ArmadaID)} disabled={a.Status !== "Baik"}>
                          {a.Nama} {a.Status !== "Baik" && `(${a.Status})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="sr-only">Driver</Label>
                  <Select value={salesmanId} onValueChange={(v) => setSalesmanId(v ?? UNSET)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Belum ditentukan">
                        {(v: string) =>
                          v === UNSET ? "Belum ditentukan" : (drivers.find((d) => d.SalesmanID === v)?.Name ?? "Belum ditentukan")
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Belum ditentukan</SelectItem>
                      {drivers.map((d) => (
                        <SelectItem key={d.SalesmanID} value={d.SalesmanID}>
                          {d.Name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button disabled={!canSubmit || pending} onClick={handleSubmit}>
              {pending ? "Menyimpan..." : isTakeAway ? "Terbitkan TakeAway" : "Buat Pemesanan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {conflict && (
        <ArmadaConflictDialog
          conflict={conflict.info}
          onCancel={() => setConflict(null)}
          onConfirm={() => {
            const deliveryDateTime = conflict.deliveryDateTime;
            setConflict(null);
            doCreatePemesanan(deliveryDateTime);
          }}
        />
      )}
    </>
  );
}
