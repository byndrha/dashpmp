import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatTime } from "@/lib/format";
import type { KendalaReportRow } from "@/lib/queries/driver-kendala";

export function KendalaReportPanel({ rows }: { rows: KendalaReportRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Waktu</TableHead>
              <TableHead>Jadwal</TableHead>
              <TableHead>Armada</TableHead>
              <TableHead>Driver</TableHead>
              <TableHead>Tujuan Saat Itu</TableHead>
              <TableHead>Jenis Kendala</TableHead>
              <TableHead>Teknisi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.KendalaID}>
                <TableCell>
                  {formatDate(r.WaktuLapor)} {formatTime(r.WaktuLapor)}
                </TableCell>
                <TableCell>#{r.JadwalID}</TableCell>
                <TableCell>
                  {r.ArmadaNama} {r.VehicleNo ? `• ${r.VehicleNo}` : ""}
                </TableCell>
                <TableCell>{r.DriverName ?? "-"}</TableCell>
                <TableCell>{r.CustomerName ?? "-"}</TableCell>
                <TableCell className="font-medium">{r.JenisKendala}</TableCell>
                <TableCell>
                  <Badge variant={r.HubungiTeknisi ? "default" : "secondary"}>
                    {r.HubungiTeknisi ? "Dihubungi" : "Tidak"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  Belum ada laporan kendala.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
