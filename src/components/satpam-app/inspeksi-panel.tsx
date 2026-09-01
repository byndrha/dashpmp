"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { User, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatTime, formatDate, formatKemasanQty } from "@/lib/format";
import type { SatpamInspectionCard, SatpamTimelineEntry } from "@/lib/queries/satpam-inspection";
import { VerticalTimeline, VerticalTimelineItem } from "@/components/ui/vertical-timeline";
import { CheckSummary } from "@/components/vehicle-check-summary";
import { getVehicleChecksForJadwalAction } from "@/app/mkesindo/(dashboard)/delivery/actions";
import type { VehicleCheckRow } from "@/lib/vehicle-check-types";

function InspectionCard({ card }: { card: SatpamInspectionCard }) {
  const router = useRouter();
  const ready = card.status === "Terbit";
  // Kedatangan shows when the armada is estimated back at the pabrik
  // (JamAktualBerangkat + estimated travel time), not the original
  // departure schedule — falls back to jamJadwal only if the estimate
  // genuinely isn't available (see the field's own doc comment).
  const displayTime = card.tipe === "DATANG" && card.jamEstimasiKedatangan ? card.jamEstimasiKedatangan : card.jamJadwal;

  return (
    <Card className={`flex flex-row overflow-hidden p-0 ${ready ? "border-warning/40" : ""}`}>
      <div className={`w-2 shrink-0 ${ready ? "bg-warning" : "bg-border"}`} />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-display text-lg font-semibold leading-tight">
              {card.armadaNama}
              {card.vehicleNo && card.vehicleNo !== card.armadaNama ? ` — ${card.vehicleNo}` : ""}
            </p>
            <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <User className="size-4" /> {card.driverName ?? "Belum ada driver"}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="flex items-center gap-1 rounded bg-muted px-2 py-1 font-mono text-sm">
              <Clock className="size-3.5" /> {formatTime(displayTime)}
            </span>
            <span className="text-xs text-muted-foreground">{formatDate(displayTime)}</span>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between border-t pt-2">
          <span className="text-sm text-muted-foreground">
            {card.tipe === "DATANG" ? formatKemasanQty(card.qtyRetur10KG, card.qtyRetur5KG) : formatKemasanQty(card.qty10KG, card.qty5KG)}
          </span>
          {ready ? (
            <Button
              size="sm"
              className="bg-warning text-warning-foreground hover:bg-warning/90"
              onClick={() => router.push(`/mkesindo/satpam-app/inspeksi/${card.jadwalId}?tipe=${card.tipe}`)}
            >
              Inspeksi
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled>
              Proses Muat
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

// Departed/completed cards used to simply vanish from the active list with
// no way back in — this makes the "Riwayat Hari Ini" entry clickable to
// re-open a read-only view of what was actually recorded (photos +
// odometer + fuel + muatan), fetched on demand via the same
// getVehicleChecksForJadwalAction the desktop dialog already uses.
function TimelineCard({ entry }: { entry: SatpamTimelineEntry }) {
  const [open, setOpen] = useState(false);
  const [check, setCheck] = useState<VehicleCheckRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpen() {
    setOpen(true);
    if (check) return;
    setLoading(true);
    setError(null);
    getVehicleChecksForJadwalAction(entry.jadwalId)
      .then((checks) => {
        const found = checks.find((c) => c.vehicleCheckId === entry.vehicleCheckId);
        if (!found) {
          setError("Data cek kendaraan tidak ditemukan.");
          return;
        }
        setCheck(found);
      })
      .catch(() => setError("Gagal memuat data cek kendaraan."))
      .finally(() => setLoading(false));
  }

  return (
    <>
      <Card
        role="button"
        tabIndex={0}
        onClick={handleOpen}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && handleOpen()}
        className="cursor-pointer p-3 text-left transition-colors active:bg-muted/50"
      >
        <p className="text-sm font-medium">
          {entry.tipe === "BERANGKAT" ? "Cek Berangkat" : "Cek Datang"} — {entry.armadaNama}
          {entry.vehicleNo && entry.vehicleNo !== entry.armadaNama ? ` (${entry.vehicleNo})` : ""}
        </p>
        <p className="text-xs text-muted-foreground">
          {entry.driverName ?? "Tanpa driver"} &mdash; {entry.odometerKM.toLocaleString("id-ID")} KM
        </p>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {entry.tipe === "BERANGKAT" ? "Cek Berangkat" : "Cek Datang"} — {entry.armadaNama}
            </DialogTitle>
          </DialogHeader>
          {loading && <p className="text-sm text-muted-foreground">Memuat...</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {check && <CheckSummary check={check} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

// Konten tab "Inspeksi" — diekstrak dari SatpamBerandaClient lama, minus
// <header>-nya (header sekarang dimiliki SatpamTabShell, dipakai bersama
// oleh ketiga tab). Polling 30 detik dipertahankan apa adanya: router.refresh()
// tetap benar di arsitektur baru karena ini adalah re-render Server
// Component sungguhan untuk route (tabs)/*/page.tsx yang sedang dimuat,
// yang hanya memengaruhi prop data route itu sendiri.
export function InspeksiPanel({
  cards,
  timeline,
}: {
  cards: SatpamInspectionCard[];
  timeline: SatpamTimelineEntry[];
}) {
  const [tab, setTab] = useState<"BERANGKAT" | "DATANG">("BERANGKAT");
  const filtered = cards.filter((c) => c.tipe === tab);
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 30000);
    return () => clearInterval(id);
  }, [router]);

  return (
    <div className="flex flex-col bg-background">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "BERANGKAT" | "DATANG")} className="flex-1">
        <div className="px-4 pt-3">
          <TabsList className="w-full">
            <TabsTrigger value="BERANGKAT" className="flex-1">
              Keberangkatan
            </TabsTrigger>
            <TabsTrigger value="DATANG" className="flex-1">
              Kedatangan
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value={tab} className="flex flex-col gap-3 px-4 py-4">
          <p className="text-sm text-muted-foreground">Menunggu Inspeksi ({filtered.length})</p>
          {filtered.map((c) => (
            <InspectionCard key={`${c.jadwalId}-${c.tipe}`} card={c} />
          ))}
          {filtered.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">Tidak ada yang perlu diinspeksi.</p>
          )}
        </TabsContent>
      </Tabs>
      <div className="flex flex-col gap-3 border-t px-4 py-4">
        <h2 className="font-display text-base font-semibold">Riwayat Hari Ini</h2>
        {timeline.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Belum ada aktivitas hari ini.</p>
        ) : (
          <VerticalTimeline>
            {timeline.map((entry, i) => (
              <VerticalTimelineItem key={entry.vehicleCheckId} time={formatTime(entry.checkedAt)} isLast={i === timeline.length - 1}>
                <TimelineCard entry={entry} />
              </VerticalTimelineItem>
            ))}
          </VerticalTimeline>
        )}
      </div>
    </div>
  );
}
