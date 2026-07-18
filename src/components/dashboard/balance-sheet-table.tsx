import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRupiah, formatPercentPoints } from "@/lib/format";
import type { BalanceSheetKategori, BalanceSheetRow } from "@/lib/queries/balance-sheet";
import { BALANCE_SHEET_KATEGORI_LABEL } from "@/lib/balance-sheet-labels";

const KATEGORI_ORDER: BalanceSheetKategori[] = ["AsetLancar", "AsetTetap", "Liabilitas", "Ekuitas"];
const ASET_KATEGORI: BalanceSheetKategori[] = ["AsetLancar", "AsetTetap"];

export function BalanceSheetTable({ rows }: { rows: BalanceSheetRow[] }) {
  const grouped = KATEGORI_ORDER.map((kategori) => ({
    kategori,
    rows: rows.filter((r) => r.Kategori === kategori),
    total: rows.filter((r) => r.Kategori === kategori).reduce((sum, r) => sum + r.Saldo, 0),
  })).filter((g) => g.rows.length > 0);

  const totalAset = rows.filter((r) => ASET_KATEGORI.includes(r.Kategori)).reduce((s, r) => s + r.Saldo, 0);
  const totalLiabilitasEkuitas = rows
    .filter((r) => !ASET_KATEGORI.includes(r.Kategori))
    .reduce((s, r) => s + r.Saldo, 0);

  return (
    <div className="flex flex-col gap-3">
      {grouped.map((g) => (
        <Card key={g.kategori} size="sm">
          <CardHeader>
            <CardTitle className="font-display text-sm">
              {BALANCE_SHEET_KATEGORI_LABEL[g.kategori]}{" "}
              <span className="font-normal text-muted-foreground">({g.rows.length} akun)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto px-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-7 px-1.5 text-[10px]">Akun</TableHead>
                    <TableHead className="h-7 px-1.5 text-right text-[10px]">Saldo</TableHead>
                    <TableHead className="h-7 px-1.5 text-right text-[10px]">%Kat</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.rows.map((r) => (
                    <TableRow key={r.ChartOfAccountID}>
                      <TableCell className="px-1.5 py-1.5">
                        <p className="text-xs font-medium leading-tight">{r.AccountName}</p>
                        <p className="font-data text-[10px] leading-tight text-muted-foreground">{r.AccountNo}</p>
                      </TableCell>
                      <TableCell className="px-1.5 py-1.5 text-right text-xs font-medium tabular-nums">
                        {formatRupiah(r.Saldo)}
                      </TableCell>
                      <TableCell className="px-1.5 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                        {formatPercentPoints(r.SaldoPercent)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="px-1.5 py-1.5 text-xs font-semibold">Subtotal</TableCell>
                    <TableCell className="px-1.5 py-1.5 text-right text-xs font-semibold tabular-nums">
                      {formatRupiah(g.total)}
                    </TableCell>
                    <TableCell className="px-1.5 py-1.5" />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ))}

      {grouped.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada saldo akun pada periode ini.</p>
      )}

      {grouped.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-card/50 p-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Total Aset</span>
            <span className="font-semibold tabular-nums">{formatRupiah(totalAset)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Total Liabilitas + Ekuitas</span>
            <span className="font-semibold tabular-nums">{formatRupiah(totalLiabilitasEkuitas)}</span>
          </div>
          <p className="pt-1 text-[10px] text-muted-foreground">
            Selisih mencerminkan laba/rugi tahun berjalan yang baru diposting ke Ekuitas saat tutup buku
            akhir tahun, bukan kesalahan hitung.
          </p>
        </div>
      )}
    </div>
  );
}
