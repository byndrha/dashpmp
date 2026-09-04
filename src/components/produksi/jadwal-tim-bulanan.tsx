"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { getJadwalBulanAction, setJadwalTimAction, hapusJadwalTimAction } from "@/app/mkesindo/produksi/actions";
import type { JadwalTimRow } from "@/lib/queries/jadwal-tim-produksi";
import type { TimRow } from "@/lib/queries/tim-produksi";
import type { ShiftNumber } from "@/lib/report-shift";

const BULAN_NAMA = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const HARI_SINGKAT = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

// Urutan kronologis nyata dalam satu TanggalUsaha: Shift 2 (H-1, 15:00) ->
// Shift 3 (H-1 ke H, 23:00) -> Shift 1 (H, 07:00) -- lihat getShiftWindow
// di report-shift.ts. Kolom mengikuti urutan ini, bukan 1-2-3.
const KOLOM_SHIFT: { shift: ShiftNumber; label: string }[] = [
  { shift: 2, label: "Shift 2 (15:00-22:59, H-1)" },
  { shift: 3, label: "Shift 3 (23:00-06:59, H-1->H)" },
  { shift: 1, label: "Shift 1 (07:00-14:59, H)" },
];

// Satu warna per baris Tim (siklus kalau Tim lebih banyak dari palet) --
// murni pembeda visual antar baris di timeline, sama sekali tidak
// menyimpan makna bisnis apa pun.
const TIM_COLORS = ["bg-sky-600", "bg-emerald-600", "bg-amber-600", "bg-violet-600", "bg-rose-600", "bg-cyan-600"];

const TIM_COL_WIDTH = 112;
const DAY_COL_WIDTH = 66;

function cellKey(tanggalUsaha: string, shift: ShiftNumber): string {
  return `${tanggalUsaha}-${shift}`;
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
  const [pendingCell, setPendingCell] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmTarget, setConfirmTarget] = useState<{
    tanggalUsaha: string;
    shift: ShiftNumber;
    tim: TimRow;
    timNamaLama: string;
  } | null>(null);

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

  function handleSaved(tanggalUsaha: string, shift: ShiftNumber, timId: number, timNama: string) {
    setJadwal((prev) => {
      const tanpaLama = prev.filter((j) => !(j.tanggalUsaha === tanggalUsaha && j.shift === shift));
      return [...tanpaLama, { tanggalUsaha, shift, timId, timNama }];
    });
  }

  function handleRemoved(tanggalUsaha: string, shift: ShiftNumber) {
    setJadwal((prev) => prev.filter((j) => !(j.tanggalUsaha === tanggalUsaha && j.shift === shift)));
  }

  function doAssign(tanggalUsaha: string, shift: ShiftNumber, tim: TimRow) {
    setPendingCell(cellKey(tanggalUsaha, shift));
    startTransition(async () => {
      const result = await setJadwalTimAction(tanggalUsaha, shift, tim.timId);
      if (result.success) handleSaved(tanggalUsaha, shift, tim.timId, tim.nama);
      setPendingCell(null);
    });
  }

  function doHapus(tanggalUsaha: string, shift: ShiftNumber) {
    setPendingCell(cellKey(tanggalUsaha, shift));
    startTransition(async () => {
      const result = await hapusJadwalTimAction(tanggalUsaha, shift);
      if (result.success) handleRemoved(tanggalUsaha, shift);
      setPendingCell(null);
    });
  }

  function handleCellClick(tanggalUsaha: string, shift: ShiftNumber, tim: TimRow) {
    if (pending) return;
    const entry = jadwal.find((j) => j.tanggalUsaha === tanggalUsaha && j.shift === shift);
    if (entry?.timId === tim.timId) {
      doHapus(tanggalUsaha, shift);
      return;
    }
    if (entry) {
      setConfirmTarget({ tanggalUsaha, shift, tim, timNamaLama: entry.timNama });
      return;
    }
    doAssign(tanggalUsaha, shift, tim);
  }

  function handleKonfirmasiTimpa() {
    if (!confirmTarget) return;
    const target = confirmTarget;
    setConfirmTarget(null);
    doAssign(target.tanggalUsaha, target.shift, target.tim);
  }

  const jumlahHari = new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
  const tanggalList = Array.from({ length: jumlahHari }, (_, i) => new Date(Date.UTC(tahun, bulan - 1, i + 1)));

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
      ) : timList.length === 0 ? (
        <p className="text-xs text-muted-foreground">Belum ada Tim Produksi.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <div className="inline-flex min-w-full flex-col">
            {/* Header: label kolom Tim (kosong, sekadar penyelaras lebar
                kolom sticky di bawah) + tanggal + 3 sub-kolom shift per
                hari, mirip rasio garis waktu Papan Pengiriman. */}
            <div className="flex border-b border-border bg-muted/40">
              <div
                className="sticky left-0 z-10 shrink-0 border-r border-border bg-muted/40 p-1.5 text-[11px] font-medium text-muted-foreground"
                style={{ width: TIM_COL_WIDTH }}
              >
                Tim
              </div>
              {tanggalList.map((tgl) => (
                <div
                  key={tgl.toISOString()}
                  className="flex shrink-0 flex-col items-center border-r border-border py-1"
                  style={{ width: DAY_COL_WIDTH }}
                >
                  <span className="text-[10px] font-semibold">{tgl.getUTCDate()}</span>
                  <span className="text-[9px] text-muted-foreground">{HARI_SINGKAT[tgl.getUTCDay()]}</span>
                </div>
              ))}
            </div>

            {timList.map((tim, timIdx) => (
              <div key={tim.timId} className="flex border-b border-border last:border-b-0">
                <div
                  className="sticky left-0 z-10 flex shrink-0 items-center border-r border-border bg-background p-1.5 text-xs font-medium"
                  style={{ width: TIM_COL_WIDTH }}
                  title={tim.nama}
                >
                  <span className={cn("mr-1.5 size-2 shrink-0 rounded-full", TIM_COLORS[timIdx % TIM_COLORS.length])} />
                  <span className="truncate">{tim.nama}</span>
                </div>
                {tanggalList.map((tgl) => {
                  const tanggalUsaha = tgl.toISOString().slice(0, 10);
                  return (
                    <div key={tanggalUsaha} className="flex shrink-0 border-r border-border" style={{ width: DAY_COL_WIDTH }}>
                      {KOLOM_SHIFT.map((k) => {
                        const entry = jadwal.find((j) => j.tanggalUsaha === tanggalUsaha && j.shift === k.shift);
                        const isMine = entry?.timId === tim.timId;
                        const busy = pendingCell === cellKey(tanggalUsaha, k.shift) && pending;
                        return (
                          <button
                            key={k.shift}
                            type="button"
                            disabled={pending}
                            title={`${k.label} — ${tgl.toLocaleDateString("id-ID", { day: "2-digit", month: "short" })} — ${
                              entry ? entry.timNama : "Kosong"
                            }`}
                            onClick={() => handleCellClick(tanggalUsaha, k.shift, tim)}
                            className={cn(
                              "h-8 flex-1 border-r border-border/50 text-[8px] font-semibold text-white last:border-r-0",
                              isMine ? TIM_COLORS[timIdx % TIM_COLORS.length] : "bg-transparent hover:bg-muted",
                              busy && "opacity-50"
                            )}
                          >
                            {isMine ? k.shift : ""}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={confirmTarget != null} onOpenChange={(open) => !open && setConfirmTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ganti Tim Bertugas?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Slot ini sudah diisi <span className="font-medium text-foreground">{confirmTarget?.timNamaLama}</span>. Ganti ke{" "}
            <span className="font-medium text-foreground">{confirmTarget?.tim.nama}</span>?
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmTarget(null)}>
              Batal
            </Button>
            <Button onClick={handleKonfirmasiTimpa}>Ya, Ganti</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
