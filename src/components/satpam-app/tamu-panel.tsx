"use client";

import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TamuKunjunganRow } from "@/lib/queries/satpam-tamu";
import { formatDate, formatTime } from "@/lib/format";

// Konten tab "Tamu" -- tombol "Tamu Baru" (navigasi ke layar penuh-layar
// terpisah, Task 6), daftar "Tamu di Dalam" (belum checkout, tap membuka
// layar konfirmasi keluar, Task 7), dan "Riwayat" (sudah checkout). Semua
// data ini SHARED antar-satpam -- tidak difilter per akun yang login, sesuai
// keputusan desain (serah-terima shift).
export function TamuPanel({
  initialDiDalam,
  initialRiwayat,
}: {
  initialDiDalam: TamuKunjunganRow[];
  initialRiwayat: TamuKunjunganRow[];
}) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-4 p-4">
      <Button size="lg" className="h-14" onClick={() => router.push("/mkesindo/satpam-app/tamu/masuk")}>
        <UserPlus className="size-5" /> Tamu Baru
      </Button>

      <div className="flex flex-col gap-2">
        <h2 className="font-display text-base font-semibold">Tamu di Dalam</h2>
        {initialDiDalam.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Tidak ada tamu di dalam.</p>
        ) : (
          initialDiDalam.map((tamu) => (
            <button
              key={tamu.kunjunganId}
              type="button"
              className="flex flex-col gap-1 rounded-lg border p-3 text-left"
              onClick={() => router.push(`/mkesindo/satpam-app/tamu/keluar/${tamu.kunjunganId}`)}
            >
              <span className="text-sm font-medium">{tamu.namaTamu}</span>
              <span className="text-xs text-muted-foreground">
                {tamu.tujuanKunjungan} — {tamu.dikunjungi}
              </span>
              <span className="text-xs text-muted-foreground">Masuk {formatTime(tamu.waktuMasuk)}</span>
            </button>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-display text-base font-semibold">Riwayat</h2>
        {initialRiwayat.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Belum ada riwayat tamu.</p>
        ) : (
          initialRiwayat.map((tamu) => (
            <div key={tamu.kunjunganId} className="rounded-lg border p-3 text-sm">
              <p className="font-medium">{tamu.namaTamu}</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(tamu.waktuMasuk)} — {formatTime(tamu.waktuMasuk)} s/d{" "}
                {tamu.waktuKeluar ? formatTime(tamu.waktuKeluar) : "-"}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
