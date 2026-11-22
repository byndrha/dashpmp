// Padanan blok "Tahun Berjalan" di SalesOverviewPanels (Es Kristal) untuk
// Es Balok: nominal, harga rata-rata per balok, jumlah agen, jumlah pesanan,
// total balok (kecil/besar), dan total pembayaran masuk.
import { ClipboardList, Coins, Users, Wallet, Box } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DocChip } from "@/components/dashboard/sales-chips";
import { BalokChip } from "@/components/dashboard/penjualan-balok-hari-panel";
import { formatRupiah } from "@/lib/format";
import type { PenjualanBalokYtd } from "@/lib/queries/penjualan-es-balok";

export function PenjualanBalokYtdPanel({ ytd }: { ytd: PenjualanBalokYtd }) {
  return (
    <div className="contents @4xl:flex @4xl:flex-col @4xl:gap-3">
      <h2 className="col-span-full font-display text-sm font-semibold text-muted-foreground">Tahun Berjalan</h2>

      <Card className="py-4">
        <CardContent className="flex flex-col gap-2 px-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Nominal Penjualan</p>
            <Tooltip>
              <TooltipTrigger className="flex items-center gap-1.5">
                <Coins className="size-4 text-muted-foreground" />
                <span className="font-display text-sm font-semibold tabular-nums">{formatRupiah(ytd.hargaRata)}</span>
              </TooltipTrigger>
              <TooltipContent>Harga rata-rata per balok</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="font-display text-xl font-semibold tabular-nums text-primary">{formatRupiah(ytd.nominal)}</p>
            <Tooltip>
              <TooltipTrigger className="flex items-center gap-1.5">
                <Users className="size-4 text-muted-foreground" />
                <span className="font-display text-sm font-semibold tabular-nums">
                  {ytd.agen.toLocaleString("id-ID")} mitra
                </span>
              </TooltipTrigger>
              <TooltipContent>Mitra yang membeli tahun ini</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <DocChip icon={ClipboardList} label="Pesanan" value={ytd.dokumen} />
          </div>
        </CardContent>
      </Card>

      <Card className="py-4">
        <CardContent className="flex flex-wrap items-start justify-between gap-3 px-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Box className="size-3.5" /> Total Balok
              </span>
              <span className="font-display text-lg font-semibold tabular-nums">
                {(ytd.qtyKecil + ytd.qtyBesar).toLocaleString("id-ID")}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Wallet className="size-3.5" /> Pembayaran
              </span>
              <span className="font-display text-sm font-semibold tabular-nums">{formatRupiah(ytd.pembayaran)}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 border-l border-border pl-3">
            <BalokChip label="Balok Kecil" value={ytd.qtyKecil} />
            <BalokChip label="Balok Besar" value={ytd.qtyBesar} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
