"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { getAktivitasMuatanDistribusiAction } from "@/app/mkesindo/(dashboard)/laporan/actions";
import type { AktivitasMuatanDistribusiRow } from "@/lib/queries/laporan-muatan-distribusi";

const BULAN_NAMA = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

export function LaporanAktivitasMuatanDistribusi({
  tahunAwal,
  bulanAwal,
  rowsAwal,
}: {
  tahunAwal: number;
  bulanAwal: number;
  rowsAwal: AktivitasMuatanDistribusiRow[];
}) {
  const [tahun, setTahun] = useState(tahunAwal);
  const [bulan, setBulan] = useState(bulanAwal);
  const [rows, setRows] = useState(rowsAwal);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (tahun === tahunAwal && bulan === bulanAwal) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getAktivitasMuatanDistribusiAction(tahun, bulan).then((result) => {
      if (cancelled) return;
      if (result.success) setRows(result.data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tahun, bulan, tahunAwal, bulanAwal]);

  function gantiBulan(delta: number) {
    let nextBulan = bulan + delta;
    let nextTahun = tahun;
    if (nextBulan < 1) {
      nextBulan = 12;
      nextTahun -= 1;
    } else if (nextBulan > 12) {
      nextBulan = 1;
      nextTahun += 1;
    }
    setBulan(nextBulan);
    setTahun(nextTahun);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Button variant="outline" size="icon" onClick={() => gantiBulan(-1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <p className="text-sm font-semibold">
          {BULAN_NAMA[bulan - 1]} {tahun}
        </p>
        <Button variant="outline" size="icon" onClick={() => gantiBulan(1)}>
          <ChevronRight className="size-4" />
        </Button>
      </div>
      {loading ? (
        <p className="text-xs text-muted-foreground">Memuat...</p>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tanggal Usaha</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead className="text-right">Jumlah Muat</TableHead>
                <TableHead className="text-right">Qty 10KG</TableHead>
                <TableHead className="text-right">Qty 5KG</TableHead>
                <TableHead className="text-right">Kantong Ekivalen</TableHead>
                <TableHead className="text-right">Kendala</TableHead>
                <TableHead className="text-right">BBM (L)</TableHead>
                <TableHead className="text-right">BBM (Rp)</TableHead>
                <TableHead className="text-right">Istirahat</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={`${r.tanggalUsaha}-${r.shift}-${r.salesmanId}`}>
                  <TableCell>{formatDate(r.tanggalUsaha)}</TableCell>
                  <TableCell>Shift {r.shift}</TableCell>
                  <TableCell>{r.driverName}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.jumlahMuat}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.totalQty10KG.toLocaleString("id-ID")}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.totalQty5KG.toLocaleString("id-ID")}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.totalKantongEkivalen.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.jumlahKendala > 0 ? `${r.jumlahKendala} (${r.kendalaPerJenis.map((k) => `${k.jenisKendala}: ${k.jumlah}`).join(", ")})` : 0}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.totalLiterBBM.toLocaleString("id-ID")}</TableCell>
                  <TableCell className="text-right tabular-nums">Rp{r.totalNominalBBM.toLocaleString("id-ID")}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.jumlahSesiIstirahat} sesi ({r.totalDurasiIstirahatMenit} menit)
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                    Belum ada data.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
