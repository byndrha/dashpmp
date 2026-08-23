"use client";

import { useEffect, useState } from "react";
import { Coffee } from "lucide-react";
import { Button } from "@/components/ui/button";
import { endIstirahatAction } from "@/app/mkesindo/driver-app/actions";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function IstirahatOverlay({
  initialIstirahat,
}: {
  initialIstirahat: { istirahatId: number; keterangan: string; waktuMulai: string } | null;
}) {
  const [istirahat, setIstirahat] = useState(initialIstirahat);
  // Tracks the last initialIstirahat we've synced to, so a change in the
  // server-supplied prop (fresh data after revalidatePath, or a plain
  // reload) resets local state during render instead of via a useEffect —
  // react-hooks/set-state-in-effect flags direct effect-based
  // prop-to-state forwarding, so this uses React's documented
  // "adjust state during render" pattern instead.
  const [prevInitialIstirahat, setPrevInitialIstirahat] = useState(initialIstirahat);
  if (initialIstirahat !== prevInitialIstirahat) {
    setPrevInitialIstirahat(initialIstirahat);
    setIstirahat(initialIstirahat);
  }
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    if (!istirahat) return;
    function tick() {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - new Date(istirahat!.waktuMulai).getTime()) / 1000)));
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [istirahat]);

  if (!istirahat) return null;

  async function handleSelesai() {
    setEnding(true);
    const result = await endIstirahatAction(istirahat!.istirahatId);
    setEnding(false);
    if (result.success) setIstirahat(null);
    // On failure, the overlay simply stays up with its existing error
    // surface omitted for v1 — the driver can retry the same button.
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-background/98 p-6 text-center backdrop-blur-sm">
      <Coffee className="size-12 text-primary" />
      <div>
        <p className="text-lg font-semibold">Sedang Istirahat</p>
        <p className="text-sm text-muted-foreground">{istirahat.keterangan}</p>
      </div>
      <p className="font-data text-4xl font-semibold tabular-nums">{formatElapsed(elapsedSeconds)}</p>
      <Button size="lg" disabled={ending} onClick={handleSelesai}>
        {ending ? "Menyimpan..." : "Selesai Istirahat"}
      </Button>
    </div>
  );
}
