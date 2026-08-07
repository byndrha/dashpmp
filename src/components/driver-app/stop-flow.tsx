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
  items: { salesOrderDetailId: string; qtyDiterima: number; fotoReturUrl: string | null }[];
  fotoBuktiPengirimanUrl: string;
  fotoBuktiMuatanUrl: string;
  tanpaPembayaran: boolean;
}

export function StopFlow({
  jadwalId,
  initialStops,
  pabrik,
  driverName,
}: {
  jadwalId: number;
  initialStops: DriverStopRow[];
  pabrik: { lat: number; lng: number };
  driverName: string;
}) {
  const router = useRouter();
  const [stops, setStops] = useState(initialStops);
  const [step, setStep] = useState<StepName>("peta");
  const [konfirKirimResult, setKonfirKirimResult] = useState<KonfirKirimResult | null>(null);
  const [salesInvoiceId, setSalesInvoiceId] = useState<string | null>(null);

  const activeStop = stops.find((s) => s.JamSelesai == null) ?? null;

  if (!activeStop) {
    router.replace("/driver-app");
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
      return <PengirimanStep jadwalId={jadwalId} stop={activeStop} remainingCount={stops.length} pabrik={pabrik} driverName={driverName} onArrived={handleArrived} />;
    case "konfirKirim":
      return <KonfirKirimStep jadwalDetailId={activeStop.JadwalDetailID} onNext={handleKonfirKirimNext} />;
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
