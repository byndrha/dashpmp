"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getDriverJadwalListAction } from "@/app/mkesindo/driver-app/actions";
import { DriverJadwalCardItem } from "@/components/driver-app/jadwal-card";
import type { DriverJadwalCard } from "@/lib/queries/pengiriman-jadwal";

// Standalone drill-down page (reached via a button on the Tugas screen, not
// a bottom-nav tab anymore) -- reuses getDriverJadwalList/Action exactly
// like the Tugas screen does, just for a picked date and filtered down to
// IsSelesai, rendered with the same shared card component so the two
// screens never drift apart visually.
export function RiwayatView({ initialJadwal, initialDateISO }: { initialJadwal: DriverJadwalCard[]; initialDateISO: string }) {
  const router = useRouter();
  const [jadwal, setJadwal] = useState(initialJadwal);
  const [dateISO, setDateISO] = useState(initialDateISO);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const requestedDateRef = useRef(initialDateISO);

  function handleDateChange(next: string) {
    requestedDateRef.current = next;
    setDateISO(next);
    setError(null);
    startTransition(async () => {
      const result = await getDriverJadwalListAction(next);
      if (requestedDateRef.current !== next) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
      setJadwal(result.data);
    });
  }

  const selesai = jadwal.filter((j) => j.IsSelesai);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="font-display text-base font-semibold">Riwayat Pengiriman</h1>
      </header>

      <div className="flex flex-col gap-3 p-4">
        <Input type="date" value={dateISO} onChange={(e) => handleDateChange(e.target.value)} />

        {error && <p className="text-sm text-destructive">{error}</p>}
        {pending ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {selesai.map((j) => (
              <DriverJadwalCardItem key={j.JadwalID} jadwal={j} />
            ))}
            {selesai.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">Belum ada pengiriman selesai untuk tanggal ini.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
