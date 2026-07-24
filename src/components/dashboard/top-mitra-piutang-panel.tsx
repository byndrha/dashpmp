import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatRupiah, formatDays, formatPercentPoints, formatQty, formatDate } from "@/lib/format";
import type { TopMitraPiutangRow } from "@/lib/queries/top-mitra-piutang";

export function TopMitraPiutangPanel({ rows }: { rows: TopMitraPiutangRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Top 10 Keseluruhan Mitra</CardTitle>
        <CardDescription>10 mitra dengan piutang outstanding terbesar, beserta pola pembayaran &amp; pengambilannya.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Belum ada mitra dengan piutang berjalan.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mitra</TableHead>
                <TableHead className="text-right">Nominal Piutang</TableHead>
                <TableHead className="text-right">Outstanding Day</TableHead>
                <TableHead className="text-right">Rasio Piutang</TableHead>
                <TableHead className="text-right">AVG DO/Hari</TableHead>
                <TableHead className="text-right">DO Terakhir</TableHead>
                <TableHead className="text-right">Terakhir Bayar (SP)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.BusinessPartnerID}>
                  <TableCell className="font-medium">{r.CustomerName}</TableCell>
                  <TableCell className="text-right tabular-nums text-primary">{formatRupiah(r.NominalPiutang)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatDays(r.OutstandingDay)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.RasioPiutangPct != null ? formatPercentPoints(r.RasioPiutangPct) : "-"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(r.AvgDOPerHari)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.DOTerakhir ? formatDate(r.DOTerakhir) : "-"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.TerakhirPembayaran ? formatDate(r.TerakhirPembayaran) : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
