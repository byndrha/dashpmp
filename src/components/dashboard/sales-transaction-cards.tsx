"use client";

import { useEffect, useMemo, useState } from "react";
import { Package, Truck, User, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/dashboard/pagination";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SalesOrderCard, DeliveryCard } from "@/lib/queries/sales-cards";
import { getDeliveryCardsAction } from "@/app/(dashboard)/transaksi/actions";

const PAGE_SIZE = 6;
const badgeBase = "h-5 px-1.5 text-[10px] font-medium leading-none whitespace-nowrap";

function QtyLabel({ qty10, qty5 }: { qty10: number; qty5: number }) {
  return (
    <span className="flex flex-col text-right text-xs tabular-nums text-muted-foreground">
      {qty10 > 0 && <span>{qty10.toLocaleString("id-ID")} - Kemasan 10KG</span>}
      {qty5 > 0 && <span>{qty5.toLocaleString("id-ID")} - Kemasan 5KG</span>}
      {qty10 === 0 && qty5 === 0 && <span>-</span>}
    </span>
  );
}

function StatusBadges({ delivery }: { delivery: DeliveryCard }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {delivery.BillingStatus === "SudahDitagih" ? (
        <Badge className={cn(badgeBase, "bg-primary/15 text-primary hover:bg-primary/15")}>
          Tertagih {delivery.SIVoucherNo}
        </Badge>
      ) : (
        <Badge className={cn(badgeBase, "bg-destructive/15 text-destructive hover:bg-destructive/15")}>
          Belum Ditagih
        </Badge>
      )}
      {delivery.PaymentStatus === "Lunas" && (
        <Badge className={cn(badgeBase, "bg-primary/15 text-primary hover:bg-primary/15")}>
          Lunas {delivery.SPVoucherNo}
        </Badge>
      )}
      {delivery.PaymentStatus === "BelumLunas" && (
        <Badge variant="outline" className={cn(badgeBase, "text-warning border-warning/40")}>
          Belum Lunas
        </Badge>
      )}
    </div>
  );
}

function DeliveryRow({ delivery }: { delivery: DeliveryCard }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 py-2">
      <span className="text-xs text-muted-foreground">
        {formatDate(delivery.TransDate)} {formatTime(delivery.TransDate)}
      </span>
      <StatusBadges delivery={delivery} />
    </div>
  );
}

function DeliveryRowDetailed({ delivery }: { delivery: DeliveryCard }) {
  return (
    <div className="flex flex-col gap-1.5 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {formatDate(delivery.TransDate)} {formatTime(delivery.TransDate)}
          </p>
          <p className="font-data text-xs text-muted-foreground">{delivery.VoucherNo}</p>
          <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <User className="size-3" /> {delivery.Driver || "-"}
            </span>
            <span className="inline-flex items-center gap-1">
              <Truck className="size-3" /> {delivery.VehicleNo || "-"}
            </span>
          </p>
        </div>
        <QtyLabel qty10={delivery.Qty10KG} qty5={delivery.Qty5KG} />
      </div>
      <StatusBadges delivery={delivery} />
    </div>
  );
}

function SalesOrderTransactionCard({
  so,
  deliveries,
  loading,
}: {
  so: SalesOrderCard;
  deliveries: DeliveryCard[] | undefined;
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={() => setExpanded((v) => !v)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setExpanded((v) => !v);
        }
      }}
      className="py-4 cursor-pointer transition-colors hover:border-primary/40"
    >
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-medium">
              {so.CustomerName}
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                {so.PartnerType}
              </Badge>
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDate(so.TransDate)} {formatTime(so.TransDate)}
            </p>
            <p className="font-data text-xs text-muted-foreground">{so.VoucherNo}</p>
          </div>
          <div className="flex items-start gap-2">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">
                {so.Wilayah}
                {so.Kecamatan ? ` | ${so.Kecamatan}` : ""}
              </p>
              <QtyLabel qty10={so.Qty10KG} qty5={so.Qty5KG} />
            </div>
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                expanded && "rotate-180"
              )}
            />
          </div>
        </div>

        <div className="border-t divide-y divide-border">
          {loading && (
            <div className="flex flex-col gap-1 py-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          )}
          {!loading && (deliveries?.length ?? 0) === 0 && (
            <p className="py-2 text-xs text-muted-foreground">Belum ada pengiriman.</p>
          )}
          {!expanded && deliveries?.map((d) => <DeliveryRow key={d.DeliveryOrderID} delivery={d} />)}
          {expanded && deliveries?.map((d) => <DeliveryRowDetailed key={d.DeliveryOrderID} delivery={d} />)}
        </div>
      </CardContent>
    </Card>
  );
}

export function SalesTransactionCards({ orders }: { orders: SalesOrderCard[] }) {
  const [page, setPage] = useState(1);
  const [deliveriesByOrder, setDeliveriesByOrder] = useState<Record<string, DeliveryCard[]>>({});
  const [loading, setLoading] = useState(false);

  const [prevOrders, setPrevOrders] = useState(orders);
  if (orders !== prevOrders) {
    setPrevOrders(orders);
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(orders.length / PAGE_SIZE));
  const pageOrders = useMemo(
    () => orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [orders, page]
  );

  useEffect(() => {
    if (pageOrders.length === 0) return;
    let cancelled = false;
    // Kicks off a data fetch from an external system (the server action) —
    // the loading flag it sets is consumed by the fetch's own callback below,
    // not derived from props/state during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getDeliveryCardsAction(pageOrders.map((so) => so.SalesOrderID)).then((rows) => {
      if (cancelled) return;
      const grouped: Record<string, DeliveryCard[]> = {};
      for (const row of rows) {
        (grouped[row.SalesOrderID] ??= []).push(row);
      }
      setDeliveriesByOrder(grouped);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageOrders.map((o) => o.SalesOrderID).join(",")]);

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Package className="size-3.5" />
        Menampilkan {pageOrders.length} dari {orders.length} pesanan (SO), diikuti tiap pengiriman (DO) dan status
        penagihan/pelunasan.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {pageOrders.map((so) => (
          <SalesOrderTransactionCard
            key={so.SalesOrderID}
            so={so}
            deliveries={deliveriesByOrder[so.SalesOrderID]}
            loading={loading}
          />
        ))}
        {pageOrders.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
            Tidak ada pesanan pada periode ini.
          </p>
        )}
      </div>
      <Pagination page={page} pageCount={pageCount} onChange={setPage} />
    </div>
  );
}
