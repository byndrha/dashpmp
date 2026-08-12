"use client";

import { useEffect, useState, useTransition, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import {
  getRekMapAction,
  getBakListAction,
  isiAirBaruAction,
  setBabonanAction,
  setMaintenanceAction,
  overrideTahapAction,
  koreksiBatchAction,
} from "@/app/pmpersada/produksi/actions";
import type { RekMapRowWithNama, BatchRowWithNama, AuditLogRowWithNama } from "@/app/pmpersada/produksi/actions";
import type { BakRow, KonfigurasiRow } from "@/lib/queries/produksi-bak-pmpersada";
import { RekDetailDialog } from "./rek-detail-dialog";
import { formatUsia, TAHAP_BADGE_CLASS } from "./produksi-lib";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 30000;
// Toleransi di atas durasi standar sebelum sebuah Rek dianggap perlu
// diperingatkan (meniru ambang draf referensi: durasi + 12 jam).
const PERINGATAN_TOLERANSI_JAM = 12;

export function ProduksiDashboardClient({
  initialBak,
  initialRek,
  initialKonfigurasi,
  initialRiwayat,
  initialAudit,
  isAdmin,
}: {
  initialBak: BakRow[];
  initialRek: RekMapRowWithNama[];
  initialKonfigurasi: KonfigurasiRow;
  initialRiwayat: BatchRowWithNama[];
  initialAudit: AuditLogRowWithNama[];
  isAdmin: boolean;
}) {
  const [bak] = useState(initialBak);
  const [rek, setRek] = useState(initialRek);
  const [konfigurasi, setKonfigurasi] = useState(initialKonfigurasi);
  const [riwayat] = useState(initialRiwayat);
  const [audit] = useState(initialAudit);
  const [, startTransition] = useTransition();
  const [selectedBakId, setSelectedBakId] = useState(bak[0]?.BakID ?? 0);
  const [selectedRek, setSelectedRek] = useState<RekMapRowWithNama | null>(null);

  const refreshRek = useCallback(() => {
    startTransition(async () => {
      const result = await getRekMapAction();
      if (result.success) setRek(result.data);
    });
  }, []);

  useEffect(() => {
    const id = setInterval(refreshRek, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshRek]);

  const totalCan = rek.reduce((sum, r) => sum + (r.IsMaintenance ? 0 : (r.JumlahCan ?? 0)), 0);
  const canBaru = rek.filter((r) => r.Tahap === "BARU").reduce((sum, r) => sum + (r.JumlahCan ?? 0), 0);
  const canProses = rek.filter((r) => ["MULAI", "KRISTAL", "SIAP"].includes(r.Tahap)).reduce((sum, r) => sum + (r.JumlahCan ?? 0), 0);
  const canMatang = rek.filter((r) => ["JADI", "BABONAN"].includes(r.Tahap)).reduce((sum, r) => sum + (r.JumlahCan ?? 0), 0);

  const peringatan = rek.filter((r) => {
    if (r.IsMaintenance || r.IsBabonan || r.BatchID == null || !r.JenisEs) return false;
    const durasiStandar = r.JenisEs === "BK" ? konfigurasi.DurasiBKJam : konfigurasi.DurasiBBJam;
    return r.UsiaJam > durasiStandar + PERINGATAN_TOLERANSI_JAM;
  });

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Produksi — Pembekuan Es</h1>
        <p className="text-sm text-muted-foreground">Monitoring proses pembekuan, FIFO, dan audit stok — PMPersada Tuban.</p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="denah">Denah Bak 1-5</TabsTrigger>
          <TabsTrigger value="rekap">Rekap &amp; Log Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-4 pt-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Total Can Sehat</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold">{totalCan.toLocaleString("id-ID")}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Isi Air Baru</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold">{canBaru.toLocaleString("id-ID")}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Proses Beku</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold">{canProses.toLocaleString("id-ID")}</CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">Matang / Babonan</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-bold">{canMatang.toLocaleString("id-ID")}</CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Progres per Bak</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {bak.map((b) => {
                const rekBak = rek.filter((r) => r.BakID === b.BakID && !r.IsMaintenance);
                const isi = rekBak.filter((r) => r.BatchID != null).length;
                const pct = rekBak.length > 0 ? Math.round((isi / rekBak.length) * 100) : 0;
                return (
                  <div key={b.BakID} className="flex flex-col gap-1">
                    <div className="flex justify-between text-xs font-medium">
                      <span>
                        {b.Nama} ({b.TotalRek} Rek)
                      </span>
                      <span className="text-muted-foreground">
                        {isi} / {rekBak.length} terisi ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="size-4 text-amber-500" />
                Peringatan ({peringatan.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {peringatan.length === 0 ? (
                <p className="text-sm text-muted-foreground">Tidak ada Rek yang usianya melebihi batas standar.</p>
              ) : (
                peringatan.map((r) => (
                  <p key={r.RekID} className="text-sm">
                    <span className="font-medium">
                      {r.BakNama} Rek {r.NomorRek}
                    </span>{" "}
                    — usia {formatUsia(r.UsiaJam)}, melebihi durasi standar {r.JenisEs === "BK" ? konfigurasi.DurasiBKJam : konfigurasi.DurasiBBJam} jam.
                  </p>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="denah" className="flex flex-col gap-4 pt-4">
          <div className="flex flex-wrap gap-2">
            {bak.map((b) => (
              <Button key={b.BakID} size="sm" variant={selectedBakId === b.BakID ? "default" : "outline"} onClick={() => setSelectedBakId(b.BakID)}>
                {b.Nama} ({b.TotalRek})
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {rek
              .filter((r) => r.BakID === selectedBakId)
              .map((r) => (
                <button
                  key={r.RekID}
                  type="button"
                  onClick={() => setSelectedRek(r)}
                  className={cn("flex flex-col gap-1 rounded-lg border p-2 text-left text-xs", TAHAP_BADGE_CLASS[r.Tahap])}
                >
                  <span className="font-bold">Rek {r.NomorRek}</span>
                  <span className="truncate">{r.JenisEs ?? "-"}</span>
                </button>
              ))}
          </div>
          {selectedRek && (
            <RekDetailDialog
              rek={selectedRek}
              isAdmin={isAdmin}
              onClose={() => setSelectedRek(null)}
              onIsiAirBaru={(jenisEs, jumlahCan) => isiAirBaruAction({ rekId: selectedRek.RekID, jenisEs, jumlahCan }).then((r) => { if (r.success) refreshRek(); return r; })}
              onSetBabonan={() => setBabonanAction(selectedRek.RekID).then((r) => { if (r.success) refreshRek(); return r; })}
              onSetMaintenance={() => setMaintenanceAction(selectedRek.RekID).then((r) => { if (r.success) refreshRek(); return r; })}
              onOverrideTahap={(tahap) => overrideTahapAction(selectedRek.RekID, tahap).then((r) => { if (r.success) refreshRek(); return r; })}
              onKoreksiBatch={(jenisEs, jumlahCan) => koreksiBatchAction({ rekId: selectedRek.RekID, jenisEs, jumlahCan }).then((r) => { if (r.success) refreshRek(); return r; })}
            />
          )}
        </TabsContent>

        {/* TabsContent "denah" ditambahkan Task 9, "rekap" ditambahkan Task 10 */}
      </Tabs>
    </div>
  );
}
