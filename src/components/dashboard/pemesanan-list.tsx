import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatRupiah } from "@/lib/format";
import type { SalesOrderListRow, SalesOrderStatus } from "@/lib/queries/pemesanan";

const STATUS_VARIANT: Record<SalesOrderStatus, "outline" | "secondary" | "default"> = {
  "Belum Dijadwalkan": "outline",
  Draft: "secondary",
  Terbit: "default",
};

export function PemesananList({ rows }: { rows: SalesOrderListRow[] }) {
  return (
    <div className="rounded-lg border overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>No. Voucher</TableHead>
            <TableHead>Tanggal</TableHead>
            <TableHead>Mitra</TableHead>
            <TableHead>Wilayah</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Jatuh Tempo</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.SalesOrderID}>
              <TableCell className="font-medium">{r.VoucherNo}</TableCell>
              <TableCell>{formatDate(r.TransDate)}</TableCell>
              <TableCell>{r.CustomerName}</TableCell>
              <TableCell>{r.Wilayah}</TableCell>
              <TableCell className="text-right tabular-nums">{r.Qty}</TableCell>
              <TableCell className="text-right tabular-nums">{formatRupiah(r.Amount)}</TableCell>
              <TableCell>{r.DueDate ? formatDate(r.DueDate) : "-"}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[r.Status]}>{r.Status}</Badge>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                Tidak ada Sales Order pada rentang ini.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
