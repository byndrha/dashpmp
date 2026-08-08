"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DriverStopRow } from "@/lib/queries/pengiriman-jadwal";
import { PengirimanStep } from "@/components/driver-app/steps/pengiriman-step";
import { KonfirKirimStep } from "@/components/driver-app/steps/konfir-kirim-step";
import { KonfirTerimaStep } from "@/components/driver-app/steps/konfir-terima-step";
import { PembayaranStep } from "@/components/driver-app/steps/pembayaran-step";
import { BerhasilStep } from "@/components/driver-app/steps/berhasil-step";

type StepName = "peta" | "konfirKirim" | "konfirTerima" | "pembayaran" | "berhasil";

export interface KonfirKirimResult {
  items: { salesOrderDetailId: string; qtyDiterima: number; fotoReturUrl: string | null; keteranganRetur: string | null }[];
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
}: {
  jadwalId: number;
  armadaNama: string;
  vehicleNo: string | null;
  bbmContext: BbmContext;
  initialStops: DriverStopRow[];
  pabrik: { lat: number; lng: number };
  driverName: string;
}) {
  const router = useRouter();
  const [stops, setStops] = useState(initialStops);
  const [step, setStep] = useState<StepName>("peta");
  const [konfirKirimResult, setKonfirKirimResult] = useState<KonfirKirimResult | null>(null);
  const [salesInvoiceId, setSalesInvoiceId] = useState<string | null>(null);

  // Every not-yet-delivered stop, in order — activeStop is always the
  // first of these. Passed down whole (not just a count) so the Pengiriman
  // screen's map markers and "Lihat Daftar Tujuan" list share one source
  // of truth with whatever "N lokasi tersisa" it displays.
  const remainingStops = stops.filter((s) => s.JamSelesai == null);
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
    if (konfirKirimResult?.tanpaPembayaran || !invoiceId) {
      setStep("berhasil");
      return;
    }
    setStep("pembayaran");
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
    case "pembayaran":
      return (
        <PembayaranStep
          salesInvoiceId={salesInvoiceId!}
          businessPartnerId={activeStop.BusinessPartnerID}
          onDone={handlePembayaranDone}
        />
      );
    case "berhasil":
      return <BerhasilStep salesInvoiceId={salesInvoiceId} onSelesai={handleBerhasilDone} />;
  }
}
