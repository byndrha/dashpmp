"use client";

import { useEffect, useState, useTransition } from "react";
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
import type { ArmadaRow } from "@/lib/queries/armada";
import type { DriverOption } from "@/lib/queries/delivery";
import {
  getCurrentAssignmentAction,
  reschedulePemesananAction,
  getEditableSalesOrderQtyAction,
  updateSalesOrderQtyAction,
} from "@/app/(dashboard)/pemesanan/actions";
import { formatKemasanQty } from "@/lib/format";

const UNSET = "__unset__";

export interface UbahPemesananTarget {
  salesOrderId: string;
  customerName: string;
  wilayah: string;
  qty: number;
  // Raw (un-halved) per-kemasan bag counts — see formatKemasanQty in
  // lib/format.ts.
  qty10KG: number;
  qty5KG: number;
}

// Controlled by the caller (target === null means closed), same pattern as
// RouteValidationDialog — two different pages (Papan Pengiriman's stop
// list, the Pemesanan list) both need to open this, so it can't own its
// own trigger the way PemesananFormDialog does.
export function UbahPemesananDialog({
  target,
  onOpenChange,
  armadaList,
  drivers,
}: {
  target: UbahPemesananTarget | null;
  onOpenChange: (open: boolean) => void;
  armadaList: ArmadaRow[];
  drivers: DriverOption[];
}) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("08:00");
  const [armadaId, setArmadaId] = useState<string>(UNSET);
  const [salesmanId, setSalesmanId] = useState<string>(UNSET);
  const [qty10KG, setQty10KG] = useState("");
  const [qty5KG, setQty5KG] = useState("");
  const [initialQty10KG, setInitialQty10KG] = useState<number | null>(null);
  const [initialQty5KG, setInitialQty5KG] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!target) return;
    // Kicks off a fetch for the newly-opened target — not derivable from
    // render, so the loading/error reset has to happen here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    Promise.all([getCurrentAssignmentAction(target.salesOrderId), getEditableSalesOrderQtyAction(target.salesOrderId)])
      .then(([assignment, editableQty]) => {
        if (assignment) {
          const d = new Date(assignment.jamJadwal);
          setDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
          setTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
          setArmadaId(String(assignment.armadaId));
          setSalesmanId(assignment.salesmanId ?? UNSET);
        } else {
          setDate("");
          setTime("08:00");
          setArmadaId(UNSET);
          setSalesmanId(UNSET);
        }
        setQty10KG(editableQty.qty10KG != null ? String(editableQty.qty10KG) : "");
        setQty5KG(editableQty.qty5KG != null ? String(editableQty.qty5KG) : "");
        setInitialQty10KG(editableQty.qty10KG);
        setInitialQty5KG(editableQty.qty5KG);
      })
      .finally(() => setLoading(false));
  }, [target]);

  const canSubmit =
    !!target &&
    !!date &&
    armadaId !== UNSET &&
    (initialQty10KG == null || (qty10KG !== "" && Number(qty10KG) > 0)) &&
    (initialQty5KG == null || (qty5KG !== "" && Number(qty5KG) > 0));

  function handleSubmit() {
    if (!target || !canSubmit) return;
    setError(null);
    startTransition(async () => {
      if (initialQty10KG != null && Number(qty10KG) !== initialQty10KG) {
        const result = await updateSalesOrderQtyAction(target.salesOrderId, "10kg", Number(qty10KG));
        if (!result.success) {
          setError(result.error);
          return;
        }
      }
      if (initialQty5KG != null && Number(qty5KG) !== initialQty5KG) {
        const result = await updateSalesOrderQtyAction(target.salesOrderId, "5kg", Number(qty5KG));
        if (!result.success) {
          setError(result.error);
          return;
        }
      }
      const result = await reschedulePemesananAction({
        salesOrderId: target.salesOrderId,
        armadaId: Number(armadaId),
        deliveryDateTime: new Date(`${date}T${time}:00`),
        salesmanId: salesmanId === UNSET ? null : salesmanId,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Ubah Pemesanan</DialogTitle>
          <DialogDescription>
            Ganti armada, waktu, atau driver untuk pesanan ini saja — tidak memengaruhi SO lain pada keberangkatan yang
            sama.
          </DialogDescription>
        </DialogHeader>

        {target && (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border bg-muted/30 p-3 text-xs">
              <p className="font-medium">{target.customerName}</p>
              <p className="text-muted-foreground">
                {target.wilayah} &middot; {formatKemasanQty(target.qty10KG, target.qty5KG)}
              </p>
            </div>

            {loading ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Memuat...</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ubah-tanggal" className="sr-only">
                      Tanggal Kirim
                    </Label>
                    <Input id="ubah-tanggal" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="ubah-jam" className="sr-only">
                      Jam
                    </Label>
                    <Input id="ubah-jam" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
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

                {(initialQty10KG != null || initialQty5KG != null) && (
                  <div className="grid grid-cols-2 gap-2">
                    {initialQty10KG != null && (
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="ubah-qty10" className="text-xs text-muted-foreground">
                          Qty 10 KG (terjual)
                        </Label>
                        <Input
                          id="ubah-qty10"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          value={qty10KG}
                          onChange={(e) => setQty10KG(e.target.value)}
                        />
                        {target.qty10KG - initialQty10KG > 0 && (
                          <p className="text-[10px] text-muted-foreground">
                            + {target.qty10KG - initialQty10KG} bonus (tidak diubah di sini)
                          </p>
                        )}
                      </div>
                    )}
                    {initialQty5KG != null && (
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="ubah-qty5" className="text-xs text-muted-foreground">
                          Qty 5 KG (terjual)
                        </Label>
                        <Input
                          id="ubah-qty5"
                          type="number"
                          inputMode="numeric"
                          min={1}
                          value={qty5KG}
                          onChange={(e) => setQty5KG(e.target.value)}
                        />
                        {target.qty5KG - initialQty5KG > 0 && (
                          <p className="text-[10px] text-muted-foreground">
                            + {target.qty5KG - initialQty5KG} bonus (tidak diubah di sini)
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {error && <p className="text-xs text-destructive">{error}</p>}
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button disabled={!canSubmit || pending || loading} onClick={handleSubmit}>
            {pending ? "Menyimpan..." : "Simpan Perubahan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
