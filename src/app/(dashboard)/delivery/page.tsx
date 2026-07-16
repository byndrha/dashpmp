import { getOpenDeliveries } from "@/lib/queries/delivery";
import { getBranches } from "@/lib/queries/branches";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/format";

export default async function DeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const params = await searchParams;
  const branchId = params.branch || undefined;

  const [rows, branches] = await Promise.all([getOpenDeliveries(branchId), getBranches()]);

  const totalSisa = rows.reduce((sum, r) => sum + r.SisaBelumDikirim, 0);
  const uniqueOrders = new Set(rows.map((r) => r.DeliveryOrderID)).size;

  return (
    <div className="flex flex-col gap-4">
      <FilterBar branches={branches} showDateRange={false} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <KpiCard label="Delivery Order Terbuka" value={uniqueOrders.toLocaleString("id-ID")} />
        <KpiCard label="Total Sisa Belum Dikirim" value={totalSisa.toLocaleString("id-ID")} />
      </div>

      <p className="text-xs text-muted-foreground">
        Sisa kirim dihitung manual dari Qty − Delivered (kolom Outstanding pada sistem sumber
        tidak reliable).
      </p>

      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No. Voucher</TableHead>
              <TableHead>Tanggal</TableHead>
              <TableHead>Jatuh Tempo</TableHead>
              <TableHead>Cabang</TableHead>
              <TableHead>Pelanggan</TableHead>
              <TableHead>Kendaraan</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Terkirim</TableHead>
              <TableHead className="text-right">Sisa</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={`${r.DeliveryOrderID}-${r.ItemID}-${i}`}>
                <TableCell className="font-medium">{r.VoucherNo}</TableCell>
                <TableCell>{formatDate(r.TransDate)}</TableCell>
                <TableCell>{formatDate(r.DueDate)}</TableCell>
                <TableCell>{r.BranchName}</TableCell>
                <TableCell>{r.CustomerName}</TableCell>
                <TableCell>{r.VehicleNo ?? "-"}</TableCell>
                <TableCell>{r.ItemName}</TableCell>
                <TableCell className="text-right tabular-nums">{r.Qty}</TableCell>
                <TableCell className="text-right tabular-nums">{r.Delivered}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">{r.SisaBelumDikirim}</TableCell>
                <TableCell>
                  <Badge variant={r.IsInvoiced ? "default" : "secondary"}>
                    {r.IsInvoiced ? "Sudah Ditagih" : "Belum Ditagih"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                  Tidak ada pengiriman terbuka.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
