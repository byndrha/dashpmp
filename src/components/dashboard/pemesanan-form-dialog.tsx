"use client";

import { useMemo, useState, useTransition } from "react";
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
import { MitraSelect } from "@/components/dashboard/mitra-select";
import { formatRupiah } from "@/lib/format";
import type { MitraRow, PriceLevelOption } from "@/lib/queries/mitra";
import type { ArmadaRow } from "@/lib/queries/armada";
import type { DriverOption } from "@/lib/queries/delivery";
import type { KantongVariant } from "@/lib/queries/sales-order";
import { createPemesananAction } from "@/app/(dashboard)/pemesanan/actions";

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
  const [date, setDate] = useState("");
  const [time, setTime] = useState("08:00");
  const [armadaId, setArmadaId] = useState<string>(UNSET);
  const [salesmanId, setSalesmanId] = useState<string>(UNSET);
  const [error, setError] = useState<string | null>(null);
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
  const total = price != null && qtyNumber > 0 ? price * qtyNumber : 0;
  const canSubmit = !!mitra && mitra.PriceLevel != null && price != null && qtyNumber > 0 && !!date && armadaId !== UNSET;

  function resetForm() {
    setBusinessPartnerId("");
    setVariant("10kg");
    setQty("");
    setDate("");
    setTime("08:00");
    setArmadaId(UNSET);
    setSalesmanId(UNSET);
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) resetForm();
  }

  function handleSubmit() {
    if (!canSubmit || !mitra) return;
    setError(null);
    startTransition(async () => {
      try {
        await createPemesananAction({
          businessPartnerId: mitra.BusinessPartnerID,
          variant,
          qtyKantong: qtyNumber,
          deliveryDateTime: new Date(`${date}T${time}:00`),
          armadaId: Number(armadaId),
          salesmanId: salesmanId === UNSET ? null : salesmanId,
        });
        handleOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal membuat pemesanan.");
      }
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

            <div className="grid grid-cols-2 gap-2">
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
                  min="1"
                  step="1"
                  placeholder="Qty (kantong)"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>
            </div>

            {price != null && (
              <div className="flex items-center justify-between rounded-lg border p-3 text-sm">
                <span className="text-muted-foreground">{formatRupiah(price)} / kantong</span>
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

            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button disabled={!canSubmit || pending} onClick={handleSubmit}>
              {pending ? "Menyimpan..." : "Buat Pemesanan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
