import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RiwayatProduksiRowWithNama } from "@/app/mkesindo/produksi/actions";

export function RiwayatProduksi({ riwayat }: { riwayat: RiwayatProduksiRowWithNama[] }) {
  if (riwayat.length === 0) {
    return <p className="text-sm text-muted-foreground">Belum ada riwayat produksi.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tanggal</TableHead>
            <TableHead>Tanggal &amp; Shift Produksi</TableHead>
            <TableHead>Jam Panen</TableHead>
            <TableHead>Mesin</TableHead>
            <TableHead>Pallet</TableHead>
            <TableHead>Jumlah Awal</TableHead>
            <TableHead>Sisa</TableHead>
            <TableHead>Dicatat Oleh</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {riwayat.map((r) => (
            <TableRow key={r.BatchID}>
              <TableCell>{new Date(r.TanggalProduksi).toLocaleDateString("id-ID")}</TableCell>
              <TableCell>
                {new Date(r.TanggalLabel).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                {" — Shift "}
                {r.Shift}
              </TableCell>
              <TableCell>{r.JamPanen || "-"}</TableCell>
              <TableCell>{r.MesinNama}</TableCell>
              <TableCell>{r.Kode}</TableCell>
              <TableCell>{r.Qty10KG} kantong 10kg</TableCell>
              <TableCell>{r.SisaQty10KG} kantong 10kg</TableCell>
              <TableCell>{r.DicatatOlehNama}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
