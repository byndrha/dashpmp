"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { User, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatTime } from "@/lib/format";
import type { SatpamInspectionCard } from "@/lib/queries/satpam-inspection";
import type { SatpamTimelineEntry } from "@/lib/queries/satpam-inspection";
import { VerticalTimeline, VerticalTimelineItem } from "@/components/ui/vertical-timeline";
import { UserMenu } from "@/components/dashboard/user-menu";
import { AppearanceMenu } from "@/components/dashboard/appearance-menu";
import type { OwnProfile } from "@/components/dashboard/account-settings-dialog";

function InspectionCard({ card }: { card: SatpamInspectionCard }) {
  const router = useRouter();
  const ready = card.status === "Terbit";

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
          <span className="flex shrink-0 items-center gap-1 rounded bg-muted px-2 py-1 font-mono text-sm">
            <Clock className="size-3.5" /> {formatTime(card.jamJadwal)}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between border-t pt-2">
          <span className="font-mono text-sm">{card.doVoucherNo ?? "Belum ada DO"}</span>
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

function TimelineCard({ entry }: { entry: SatpamTimelineEntry }) {
  return (
    <Card className="p-3">
      <p className="text-sm font-medium">
        {entry.tipe === "BERANGKAT" ? "Cek Berangkat" : "Cek Datang"} — {entry.armadaNama}
        {entry.vehicleNo && entry.vehicleNo !== entry.armadaNama ? ` (${entry.vehicleNo})` : ""}
      </p>
      <p className="text-xs text-muted-foreground">
        {entry.driverName ?? "Tanpa driver"} &mdash; {entry.odometerKM.toLocaleString("id-ID")} KM
      </p>
    </Card>
  );
}

export function SatpamBerandaClient({
  cards,
  timeline,
  userName,
  profile,
}: {
  cards: SatpamInspectionCard[];
  timeline: SatpamTimelineEntry[];
  userName: string;
  profile: OwnProfile | null;
}) {
  const [tab, setTab] = useState<"BERANGKAT" | "DATANG">("BERANGKAT");
  const filtered = cards.filter((c) => c.tipe === tab);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-4 py-3">
        <h1 className="font-display text-xl font-bold">Inspeksi Pengiriman</h1>
        <div className="flex items-center gap-1">
          <AppearanceMenu />
          <UserMenu name={userName} profile={profile} />
        </div>
      </header>
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
