"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getJadwalBulanAction, setJadwalTimAction } from "@/app/mkesindo/produksi/actions";
import type { JadwalTimRow } from "@/lib/queries/jadwal-tim-produksi";
import type { TimRow } from "@/lib/queries/tim-produksi";
import type { ShiftNumber } from "@/lib/report-shift";

const UNSET = "__unset__";
const BULAN_NAMA = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// Urutan kronologis nyata dalam satu TanggalUsaha: Shift 2 (H-1, 15:00) ->
// Shift 3 (H-1 ke H, 23:00) -> Shift 1 (H, 07:00) -- lihat getShiftWindow
// di report-shift.ts. Kolom kalender mengikuti urutan ini, bukan 1-2-3.
const KOLOM_SHIFT: { shift: ShiftNumber; label: string }[] = [
  { shift: 2, label: "Shift 2 (15:00-22:59, H-1)" },
  { shift: 3, label: "Shift 3 (23:00-06:59, H-1->H)" },
  { shift: 1, label: "Shift 1 (07:00-14:59, H)" },
];

function SelSelect({
  timId,
  timList,
  onPilih,
}: {
  timId: number | null;
  timList: TimRow[];
  onPilih: (timId: number) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);

  async function handleChange(value: string | null) {
    if (!value || value === UNSET) return;
    setPending(true);
    await onPilih(Number(value));
    setPending(false);
  }

  return (
    <Select value={timId != null ? String(timId) : UNSET} onValueChange={handleChange} disabled={pending}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder="Belum dijadwalkan">
          {(v: string) => (v === UNSET ? "Belum dijadwalkan" : (timList.find((t) => String(t.timId) === v)?.nama ?? "Belum dijadwalkan"))}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET} disabled>
          Belum dijadwalkan
        </SelectItem>
        {timList.map((t) => (
          <SelectItem key={t.timId} value={String(t.timId)}>
            {t.nama}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function JadwalTimBulanan({
  tahunAwal,
  bulanAwal,
  jadwalAwal,
  timList,
}: {
  tahunAwal: number;
  bulanAwal: number;
  jadwalAwal: JadwalTimRow[];
  timList: TimRow[];
}) {
  const [tahun, setTahun] = useState(tahunAwal);
  const [bulan, setBulan] = useState(bulanAwal);
  const [jadwal, setJadwal] = useState(jadwalAwal);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (tahun === tahunAwal && bulan === bulanAwal) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getJadwalBulanAction(tahun, bulan).then((result) => {
      if (cancelled) return;
      if (result.success) setJadwal(result.data);
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

  function handleSaved(tanggalUsaha: string, shift: ShiftNumber, timId: number) {
    setJadwal((prev) => {
      const timNama = timList.find((t) => t.timId === timId)?.nama ?? "";
      const tanpaLama = prev.filter((j) => !(j.tanggalUsaha === tanggalUsaha && j.shift === shift));
      return [...tanpaLama, { tanggalUsaha, shift, timId, timNama }];
    });
  }

  async function pilihSel(tanggalUsaha: string, shift: ShiftNumber, timId: number) {
    const result = await setJadwalTimAction(tanggalUsaha, shift, timId);
    if (result.success) handleSaved(tanggalUsaha, shift, timId);
  }

  const jumlahHari = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
  const tanggalList = Array.from({ length: jumlahHari }, (_, i) => new Date(Date.UTC(tahun, bulan - 1, i + 1)).toISOString().slice(0, 10));

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
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-xs">
            <thead>
              <tr>
                <th className="border-b border-border p-1.5 text-left">Tanggal</th>
                {KOLOM_SHIFT.map((k) => (
                  <th key={k.shift} className="border-b border-border p-1.5 text-left font-normal text-muted-foreground">
                    {k.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tanggalList.map((tanggalUsaha) => (
                <tr key={tanggalUsaha}>
                  <td className="border-b border-border p-1.5 font-medium">{tanggalUsaha}</td>
                  {KOLOM_SHIFT.map((k) => {
                    const entry = jadwal.find((j) => j.tanggalUsaha === tanggalUsaha && j.shift === k.shift);
                    return (
                      <td key={k.shift} className="border-b border-border p-1.5">
                        <SelSelect timId={entry?.timId ?? null} timList={timList} onPilih={(timId) => pilihSel(tanggalUsaha, k.shift, timId)} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
