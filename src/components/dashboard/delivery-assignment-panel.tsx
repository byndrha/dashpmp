"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArmadaManager } from "@/components/dashboard/armada-dialog";
import { formatDate, formatTime } from "@/lib/format";
import type { DeliveryAssignmentRow, DriverOption } from "@/lib/queries/delivery";
import type { ArmadaRow } from "@/lib/queries/armada";
import { assignDeliveryDriverAction, assignDeliveryVehicleAction } from "@/app/(dashboard)/delivery/actions";

// Sentinel for "no driver/vehicle assigned yet" — Select items can't use an
// empty string as a value (established convention in this codebase, see
// the "all" sentinel in mitra-list.tsx's filter Selects).
const UNSET = "__unset__";

function AssignmentRowCard({
  row,
  drivers,
  armada,
}: {
  row: DeliveryAssignmentRow;
  drivers: DriverOption[];
  armada: ArmadaRow[];
}) {
  const [, startTransition] = useTransition();

  // If the current SalesmanID isn't in the assignable list (e.g. it's the
  // '0127' TakeAway sentinel, deliberately excluded from `drivers`), fall
  // back to showing "Belum ditugaskan" rather than a broken/empty Select.
  const driverValue = row.SalesmanID && drivers.some((d) => d.SalesmanID === row.SalesmanID) ? row.SalesmanID : UNSET;
  const vehicleValue = row.VehicleNo ?? UNSET;

  function handleDriverChange(value: string | null) {
    const salesmanId = !value || value === UNSET ? null : value;
    startTransition(async () => {
      await assignDeliveryDriverAction(row.DeliveryOrderID, salesmanId);
    });
  }

  function handleVehicleChange(value: string | null) {
    const vehicleName = !value || value === UNSET ? null : value;
    startTransition(async () => {
      await assignDeliveryVehicleAction(row.DeliveryOrderID, vehicleName);
    });
  }

  return (
    <Card className="py-3">
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{row.CustomerName}</p>
            <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <span>{row.Wilayah}</span>
              <span className="font-data">&middot; {formatTime(row.TransDate)}</span>
            </p>
          </div>
          <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">
            {row.VoucherNo}
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t pt-2">
          <Select value={driverValue} onValueChange={handleDriverChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Driver">
                {(v: string) => (v === UNSET ? "Belum ditugaskan" : (row.DriverName ?? "Belum ditugaskan"))}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Belum ditugaskan</SelectItem>
              {drivers.map((d) => (
                <SelectItem key={d.SalesmanID} value={d.SalesmanID}>
                  {d.Name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={vehicleValue} onValueChange={handleVehicleChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Armada">
                {(v: string) => (v === UNSET ? "Belum ditugaskan" : v)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Belum ditugaskan</SelectItem>
              {armada.map((a) => (
                <SelectItem key={a.ArmadaID} value={a.Nama}>
                  {a.Nama}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

export function DeliveryAssignmentPanel({
  rows,
  drivers,
  armada,
  businessDate,
  todayISO,
}: {
  rows: DeliveryAssignmentRow[];
  drivers: DriverOption[];
  armada: ArmadaRow[];
  businessDate: string;
  todayISO: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const isToday = businessDate === todayISO;

  function goToDate(newDate: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("pengirimanDate", newDate);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  function shiftDate(deltaDays: number) {
    const d = new Date(businessDate);
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + deltaDays));
    goToDate(next.toISOString().slice(0, 10));
  }

  return (
    <Card className="relative">
      {isPending && (
        <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-primary/15">
          <div className="h-full w-1/3 animate-indeterminate rounded-full bg-primary" />
        </div>
      )}
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="font-display">
            Penugasan Pengiriman {isToday ? "Hari Ini" : formatDate(businessDate)}
          </CardTitle>
          <CardDescription>{rows.length} Delivery Order</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ArmadaManager armada={armada} />
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="size-8" disabled={isPending} onClick={() => shiftDate(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Input
              type="date"
              value={businessDate}
              max={todayISO}
              disabled={isPending}
              onChange={(e) => e.target.value && goToDate(e.target.value)}
              className="h-8 w-40 text-xs"
            />
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={isToday || isPending}
              onClick={() => shiftDate(1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="grid grid-cols-1 gap-2 @2xl:grid-cols-2 @4xl:grid-cols-3">
          {rows.map((row) => (
            <AssignmentRowCard key={row.DeliveryOrderID} row={row} drivers={drivers} armada={armada} />
          ))}
          {rows.length === 0 && (
            <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
              Tidak ada Delivery Order {isToday ? "hari ini" : "pada tanggal ini"}.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
