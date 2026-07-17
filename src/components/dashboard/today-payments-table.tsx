import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { formatRupiah, formatTime, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TodayReceivablePayment } from "@/lib/queries/piutang-payments";
import type { PiutangStatus } from "@/lib/queries/aging";

const STATUS_BADGE: Record<PiutangStatus, string> = {
  Sehat: "bg-primary/15 text-primary",
  Perhatian: "bg-warning/15 text-warning",
  Kritis: "bg-destructive/15 text-destructive",
};

export function TodayPaymentsTable({ rows }: { rows: TodayReceivablePayment[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Pembayaran Piutang Hari Ini</CardTitle>
        <CardDescription>Pelunasan yang diterima dari mitra hari ini.</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <div className="overflow-x-auto px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mitra</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Wilayah</TableHead>
                <TableHead className="max-w-[110px]">Kecamatan</TableHead>
                <TableHead>Jam</TableHead>
                <TableHead className="text-right">Nominal Bayar</TableHead>
                <TableHead className="text-right">Pemesanan</TableHead>
                <TableHead className="text-right">Sisa Piutang</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.SalesPaymentID}>
                  <TableCell className="font-medium">{r.CustomerName}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{r.PartnerType}</Badge>
                  </TableCell>
                  <TableCell>{r.Wilayah}</TableCell>
                  <TableCell className="max-w-[110px] truncate" title={r.Kecamatan ?? undefined}>
                    {r.Kecamatan ?? "-"}
                  </TableCell>
                  <TableCell className="font-data text-xs">{formatTime(r.TransDate)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium text-primary">
                    {formatRupiah(r.Amount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatQty(r.AvgQtyPerOrderDay)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatRupiah(r.SisaPiutang)}</TableCell>
                  <TableCell>
                    <span className={cn("rounded px-2 py-0.5 text-xs font-medium", STATUS_BADGE[r.Status])}>
                      {r.Status}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    Belum ada pembayaran piutang hari ini.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
