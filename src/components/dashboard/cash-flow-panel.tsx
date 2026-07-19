import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRupiah, formatPercentPoints } from "@/lib/format";
import type { CashFlowSummary, CashFlowTypeRow } from "@/lib/queries/cash-flow";

function CashFlowList({ title, rows, total }: { title: string; rows: CashFlowTypeRow[]; total: number }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <p className="text-xs font-semibold tabular-nums">{formatRupiah(total)}</p>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-7 px-1.5 text-[10px]">Jenis Transaksi</TableHead>
              <TableHead className="h-7 px-1.5 text-right text-[10px]">Nominal</TableHead>
              <TableHead className="h-7 px-1.5 text-right text-[10px]">%</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.type}>
                <TableCell className="px-1.5 py-1.5 text-xs">{r.label}</TableCell>
                <TableCell className="px-1.5 py-1.5 text-right text-xs font-medium tabular-nums">
                  {formatRupiah(r.amount)}
                </TableCell>
                <TableCell className="px-1.5 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                  {formatPercentPoints(total ? (r.amount / total) * 100 : 0)}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={3} className="px-1.5 py-4 text-center text-xs text-muted-foreground">
                  Tidak ada transaksi pada periode ini.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "negative" }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${tone === "negative" ? "text-destructive" : ""}`}>
        {value}
      </p>
    </div>
  );
}

export function CashFlowPanel({ data, asOfLabel }: { data: CashFlowSummary; asOfLabel: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="font-display text-sm">Detail Cash Flow</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-card/50 p-3 @sm:grid-cols-3">
          <Stat label="Pendapatan Operasional" value={formatRupiah(data.pendapatanOperasional)} />
          <Stat label={`Kas di Tangan (per ${asOfLabel})`} value={formatRupiah(data.kasDiTangan)} />
          <Stat
            label="Pengeluaran Kas di Tangan"
            value={formatRupiah(data.pengeluaranKasDiTangan)}
            tone="negative"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
          <CashFlowList title="Daftar Pemasukan Kas" rows={data.pemasukan} total={data.totalPemasukan} />
          <CashFlowList title="Daftar Pengeluaran Kas" rows={data.pengeluaran} total={data.totalPengeluaran} />
        </div>

        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Kas &amp; Bank mencakup Kas Besar, Kas Kecil, dan seluruh rekening Bank/Deposito.
          &ldquo;Voucher / Transfer Lainnya&rdquo; dapat mencakup perpindahan dana antar Kas/Bank
          secara internal (mis. setor dari Kas Kecil ke Kas Besar), bukan murni pemasukan atau
          pengeluaran perusahaan &mdash; ditampilkan apa adanya, bukan disaring, agar tidak
          menyembunyikan data.
        </p>
      </CardContent>
    </Card>
  );
}
