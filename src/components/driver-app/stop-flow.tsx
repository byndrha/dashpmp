"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DriverStopRow } from "@/lib/queries/pengiriman-jadwal";
import { PengirimanStep } from "@/components/driver-app/steps/pengiriman-step";
import { KonfirKirimStep } from "@/components/driver-app/steps/konfir-kirim-step";
import { KonfirTerimaStep } from "@/components/driver-app/steps/konfir-terima-step";
import { PembayaranStep } from "@/components/driver-app/steps/pembayaran-step";
import { BerhasilStep } from "@/components/driver-app/steps/berhasil-step";
import { JualUlangReturSheet } from "@/components/driver-app/jual-ulang-retur-sheet";
import { Button } from "@/components/ui/button";
import { getSisaReturTersediaDriverAction } from "@/app/mkesindo/driver-app/actions";
import type { SisaReturRow } from "@/lib/queries/retur-resale";

type StepName = "peta" | "konfirKirim" | "konfirTerima" | "jualUlangRetur" | "pembayaran" | "berhasil";

export interface KonfirKirimResult {
  items: {
    salesOrderDetailId: string;
    qtyDiterima: number;
    fotoReturUrl: string | null;
    keteranganRetur: string | null;
    kondisiRetur: "BAIK" | "RUSAK" | null;
  }[];
  // Merged "Bukti Pengiriman" + "Bukti Muatan" into one multi-photo
  // category — the driver captures as many proof photos as needed in one
  // input instead of two separate single-photo-only fields.
  fotoBuktiUrls: string[];
  tanpaPembayaran: boolean;
}

// BBM budget inputs for this Jadwal's Armada — null fields fall back to
// "no asli/ekstra split" in BbmDialog rather than blocking the flow.
export interface BbmContext {
  jarakKM: number | null;
  konsumsiBBM: number | null;
  biayaBBMPerLiter: number | null;
  qrMyPertaminaPath: string | null;
}

export function StopFlow({
  jadwalId,
  armadaNama,
  vehicleNo,
  bbmContext,
  initialStops,
  pabrik,
  driverName,
  perusahaanId,
}: {
  jadwalId: number;
  armadaNama: string;
  vehicleNo: string | null;
  bbmContext: BbmContext;
  initialStops: DriverStopRow[];
  pabrik: { lat: number; lng: number };
  driverName: string;
  perusahaanId: number;
}) {
  const router = useRouter();
  const [stops, setStops] = useState(initialStops);

  // pengiriman-step.tsx's terkendala report/reorder flows call
  // router.refresh() to pick up a fresh IsTerkendala/UrutanOverride from the
  // server, but `stops` is a local mirror seeded once via useState above —
  // a parent-driven refresh alone would re-render this component with a new
  // `initialStops` prop without touching that mirror, since React preserves
  // state across a props-only update. Re-sync during render (React's
  // documented "adjusting state when a prop changes" pattern — see
  // https://react.dev/learn/you-might-not-need-an-effect) rather than in a
  // useEffect, which would cause an extra commit-then-recommit render pass
  // for every server refetch. This never fires from handleBerhasilDone's own
  // optimistic update below, since that doesn't change `initialStops`'s
  // reference.
  const [prevInitialStops, setPrevInitialStops] = useState(initialStops);
  if (initialStops !== prevInitialStops) {
    setPrevInitialStops(initialStops);
    setStops(initialStops);
  }

  const [step, setStep] = useState<StepName>("peta");
  const [konfirKirimResult, setKonfirKirimResult] = useState<KonfirKirimResult | null>(null);
  const [salesInvoiceId, setSalesInvoiceId] = useState<string | null>(null);
  // Task 9 Step 3's one-shot "jual sekarang" prompt — candidate retur rows
  // (KondisiRetur BAIK, sisa > 0) belonging to the stop just confirmed,
  // fetched fresh from getSisaReturTersediaDriverAction AFTER
  // confirmStopDeliveryAction commits (see handleKonfirmasiPenerima below).
  // Never populated from konfirKirimResult directly: that result only
  // carries the driver's INTENT (kondisiRetur per item) from before submit,
  // not the real DashboardPengirimanStopDeliveryItem rows/StopDeliveryItemIDs,
  // which don't exist until the confirm actually commits.
  const [jualUlangCandidates, setJualUlangCandidates] = useState<SisaReturRow[]>([]);
  const [jualUlangTarget, setJualUlangTarget] = useState<{ stopDeliveryItemId: number; itemName: string; jadwalDetailId: number } | null>(
    null
  );

  // Every not-yet-delivered stop, in order — activeStop is always the
  // first of these. Passed down whole (not just a count) so the Pengiriman
  // screen's map markers and "Lihat Daftar Tujuan" list share one source
  // of truth with whatever "N lokasi tersisa" it displays.
  //
  // This is the ONLY place in the whole codebase that re-sorts by
  // UrutanOverride ?? Urutan — getDriverJadwalStops() deliberately keeps
  // sorting by plain Urutan since desktop's RouteValidationDialog shares
  // that same query function and must not see driver-app-only reordering.
  const remainingStops = stops
    .filter((s) => s.JamSelesai == null)
    .sort((a, b) => (a.UrutanOverride ?? a.Urutan) - (b.UrutanOverride ?? b.Urutan));
  const activeStop = remainingStops[0] ?? null;

  if (!activeStop) {
    router.replace("/mkesindo/driver-app");
    return null;
  }

  function handleArrived() {
    setStep("konfirKirim");
  }

  function handleKonfirKirimNext(result: KonfirKirimResult) {
    setKonfirKirimResult(result);
    setStep("konfirTerima");
  }

  function handleKonfirmasiPenerima(invoiceId: string | null) {
    setSalesInvoiceId(invoiceId);
    // Only NOW (after confirmStopDeliveryAction has actually committed) does
    // this stop's DashboardPengirimanStopDeliveryItem rows — and their real
    // StopDeliveryItemIDs — exist. If any item was recorded with kondisiRetur
    // "BAIK", re-fetch the just-created rows via getSisaReturTersediaDriverAction
    // and offer the "jual sekarang" prompt as an optional step before
    // continuing to pembayaran/berhasil. No dependency on konfir-kirim-step's
    // "niat" button (Task 9 Step 2) — that button is UI-only acknowledgment,
    // not a gate: any BAIK-condition item on this stop triggers this prompt.
    const adaBaik = konfirKirimResult?.items.some((item) => item.kondisiRetur === "BAIK") ?? false;
    if (!adaBaik) {
      proceedAfterJualUlang(invoiceId);
      return;
    }
    const doneJadwalDetailId = activeStop!.JadwalDetailID;
    getSisaReturTersediaDriverAction(jadwalId).then((result) => {
      const candidates = result.success ? result.data.filter((r) => r.jadwalDetailId === doneJadwalDetailId) : [];
      if (candidates.length === 0) {
        proceedAfterJualUlang(invoiceId);
        return;
      }
      setJualUlangCandidates(candidates);
      setStep("jualUlangRetur");
    });
  }

  // Shared continuation after the (optional) jualUlangRetur step — same
  // tanpaPembayaran/invoiceId branch handleKonfirmasiPenerima used to apply
  // directly before Task 9 inserted the prompt in between.
  function proceedAfterJualUlang(invoiceId: string | null) {
    if (konfirKirimResult?.tanpaPembayaran || !invoiceId) {
      setStep("berhasil");
      return;
    }
    setStep("pembayaran");
  }

  function refetchJualUlangCandidates() {
    const doneJadwalDetailId = activeStop!.JadwalDetailID;
    getSisaReturTersediaDriverAction(jadwalId).then((result) => {
      if (result.success) {
        setJualUlangCandidates(result.data.filter((r) => r.jadwalDetailId === doneJadwalDetailId));
      }
    });
  }

  function handlePembayaranDone() {
    setStep("berhasil");
  }

  function handleBerhasilDone() {
    const doneId = activeStop!.JadwalDetailID;
    setStops((prev) => prev.map((s) => (s.JadwalDetailID === doneId ? { ...s, JamSelesai: new Date().toISOString() } : s)));
    setStep("peta");
    setKonfirKirimResult(null);
    setSalesInvoiceId(null);
    // Re-derive whether any stop is left; if none, StopFlow's own
    // `activeStop == null` branch above redirects to /driver-app on the
    // next render.
  }

  switch (step) {
    case "peta":
      // Keyed by JadwalDetailID so switching to the NEXT stop after
      // handleBerhasilDone mounts a fresh PengirimanStep instance —
      // otherwise its per-stop local state (kendalaReported, dialog open
      // flags, ETA) would silently carry over from the previous stop.
      return (
        <PengirimanStep
          key={activeStop.JadwalDetailID}
          jadwalId={jadwalId}
          armadaNama={armadaNama}
          vehicleNo={vehicleNo}
          bbmContext={bbmContext}
          activeStop={activeStop}
          remainingStops={remainingStops}
          pabrik={pabrik}
          driverName={driverName}
          onArrived={handleArrived}
        />
      );
    case "konfirKirim":
      return <KonfirKirimStep jadwalDetailId={activeStop.JadwalDetailID} stop={activeStop} onNext={handleKonfirKirimNext} />;
    case "konfirTerima":
      return (
        <KonfirTerimaStep
          jadwalDetailId={activeStop.JadwalDetailID}
          result={konfirKirimResult!}
          onConfirmed={handleKonfirmasiPenerima}
        />
      );
    case "jualUlangRetur":
      return (
        <div className="flex flex-col gap-4 p-4 pb-24">
          <h1 className="font-display text-lg font-semibold">Ada yang Mau Beli Retur Ini?</h1>
          <p className="text-sm text-muted-foreground">
            Stop ini mencatat retur berkondisi Baik. Jual sekarang kalau sudah ada peminat, atau lewati untuk lanjut —
            retur yang belum terjual tetap bisa diakses lewat tombol &quot;Retur Tersedia&quot; di layar Pengiriman.
          </p>
          <div className="flex flex-col gap-2">
            {jualUlangCandidates.map((row) => (
              <div key={row.stopDeliveryItemId} className="flex items-center justify-between gap-2 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.itemName}</p>
                  <p className="truncate text-xs text-muted-foreground">Sisa {row.sisaQty}</p>
                </div>
                <Button
                  size="sm"
                  onClick={() =>
                    setJualUlangTarget({ stopDeliveryItemId: row.stopDeliveryItemId, itemName: row.itemName, jadwalDetailId: row.jadwalDetailId })
                  }
                >
                  Jual
                </Button>
              </div>
            ))}
          </div>
          <Button variant="outline" className="w-full" onClick={() => proceedAfterJualUlang(salesInvoiceId)}>
            Lewati
          </Button>
          <JualUlangReturSheet
            jadwalId={jadwalId}
            originJadwalDetailId={jualUlangTarget?.jadwalDetailId ?? null}
            target={jualUlangTarget}
            onOpenChange={(open) => {
              if (!open) setJualUlangTarget(null);
            }}
            onDone={() => {
              setJualUlangTarget(null);
              refetchJualUlangCandidates();
            }}
          />
        </div>
      );
    case "pembayaran":
      return (
        <PembayaranStep
          salesInvoiceId={salesInvoiceId!}
          businessPartnerId={activeStop.BusinessPartnerID}
          perusahaanId={perusahaanId}
          onDone={handlePembayaranDone}
        />
      );
    case "berhasil":
      return <BerhasilStep salesInvoiceId={salesInvoiceId} onSelesai={handleBerhasilDone} />;
  }
}
