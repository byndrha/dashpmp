"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getShiftLabel, type ShiftNumber } from "@/lib/report-shift";
import {
  getKartuPengirimanBelumSelesaiAction,
  getKartuPengirimanSelesaiAction,
} from "@/app/mkesindo/produksi/actions";
import { KartuPengirimanList } from "@/components/produksi-app/kartu-pengiriman-list";
import type { DraftJadwalForProduksi, SelesaiMuatJadwalForProduksi } from "@/lib/queries/produksi-muatan";

const SHIFT_OPTIONS: ShiftNumber[] = [1, 2, 3];

// Layar penuh-layar baru yang menggantikan tab Pengiriman + Riwayat lama --
// dibuka lewat tombol "Riwayat" di tab Stok Es (Task 5). Filter tanggal+shift
// memuat ulang KEDUA daftar sekaligus lewat 2 action baru (Task 2);
// KartuPengirimanList (komponen lama, tidak diubah sama sekali) dipakai
// ulang lewat `key` yang berubah tiap filter berganti -- komponen itu hanya
// membaca initialJadwal/fetchSelesaiList SEKALI saat mount, jadi remount
// penuh adalah cara yang benar untuk "memberinya data baru", bukan
// mengandalkan prop-sync yang komponen itu memang tidak punya.
export function RiwayatKartuPengirimanView({
  initialTanggalUsahaISO,
  initialShift,
  initialBelumSelesai,
  initialSelesai,
}: {
  initialTanggalUsahaISO: string;
  initialShift: ShiftNumber;
  initialBelumSelesai: DraftJadwalForProduksi[];
  initialSelesai: SelesaiMuatJadwalForProduksi[];
}) {
  const router = useRouter();
  const [tanggalUsahaISO, setTanggalUsahaISO] = useState(initialTanggalUsahaISO);
  const [shift, setShift] = useState<ShiftNumber>(initialShift);
  const [belumSelesai, setBelumSelesai] = useState(initialBelumSelesai);
  const [selesai, setSelesai] = useState(initialSelesai);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refetch(tanggal: string, shiftValue: ShiftNumber) {
    setLoading(true);
    setError(null);
    Promise.all([
      getKartuPengirimanBelumSelesaiAction(tanggal, shiftValue),
      getKartuPengirimanSelesaiAction(tanggal, shiftValue),
    ]).then(([belumResult, selesaiResult]) => {
      if (!belumResult.success) {
        setError(belumResult.error);
        setLoading(false);
        return;
      }
      if (!selesaiResult.success) {
        setError(selesaiResult.error);
        setLoading(false);
        return;
      }
      setBelumSelesai(belumResult.data);
      setSelesai(selesaiResult.data);
      setLoading(false);
    });
  }

  // Data awal sudah datang dari server component (initial* props) -- effect
  // ini hanya boleh refetch saat filter BERUBAH setelah mount, bukan saat
  // mount itu sendiri (kalau tidak, permintaan pertama akan sia-sia
  // mengulang apa yang sudah difetch server).
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    refetch(tanggalUsahaISO, shift);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tanggalUsahaISO, shift]);

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background px-4 py-2.5">
        <Button size="icon" variant="ghost" onClick={() => router.push("/mkesindo/produksi-app")}>
          <ArrowLeft className="size-5" />
        </Button>
        <h1 className="font-display text-base font-semibold">Riwayat Kartu Pengiriman</h1>
      </header>

      <div className="flex flex-col gap-3 border-b border-border p-4">
        <Input type="date" value={tanggalUsahaISO} onChange={(e) => setTanggalUsahaISO(e.target.value)} />
        <div className="grid grid-cols-3">
          {SHIFT_OPTIONS.map((s) => (
            <Button
              key={s}
              type="button"
              variant={shift === s ? "default" : "outline"}
              className="rounded-none"
              onClick={() => setShift(s)}
            >
              {getShiftLabel(s, "work")}
            </Button>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && (
          <p className="m-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <KartuPengirimanList
          key={`${tanggalUsahaISO}-${shift}`}
          initialJadwal={belumSelesai}
          fetchSelesaiList={async () => ({ success: true, data: selesai })}
          emptyMessage="Tidak ada Kartu Pengiriman pada periode ini."
          onAfterMuat={() => refetch(tanggalUsahaISO, shift)}
        />
      </div>
    </div>
  );
}
