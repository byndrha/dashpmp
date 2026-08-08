"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignaturePad } from "@/components/driver-app/signature-pad";
import { confirmStopDeliveryAction } from "@/app/mkesindo/driver-app/actions";
import type { KonfirKirimResult } from "@/components/driver-app/stop-flow";

async function uploadSignature(jadwalDetailId: number, file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("jadwalDetailId", String(jadwalDetailId));
  formData.append("jenisFoto", "tanda-tangan");
  const res = await fetch("/api/mkesindo/upload/driver-app", { method: "POST", body: formData });
  const data = (await res.json()) as { path?: string; error?: string };
  if (!res.ok || !data.path) throw new Error(data.error ?? "Gagal mengunggah tanda tangan");
  return data.path;
}

export function KonfirTerimaStep({
  jadwalDetailId,
  result,
  onConfirmed,
}: {
  jadwalDetailId: number;
  result: KonfirKirimResult;
  onConfirmed: (salesInvoiceId: string | null) => void;
}) {
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!signatureFile) {
      setError("Tanda tangan penerima wajib diisi.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const tandaTanganUrl = await uploadSignature(jadwalDetailId, signatureFile);
      const actionResult = await confirmStopDeliveryAction({
        jadwalDetailId,
        items: result.items,
        fotoBuktiUrls: result.fotoBuktiUrls,
        tandaTanganUrl,
        tanpaPembayaran: result.tanpaPembayaran,
      });
      if (!actionResult.success) {
        setError(actionResult.error);
        return;
      }
      onConfirmed(actionResult.data.salesInvoiceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah tanda tangan.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-border bg-background p-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">Tanda Tangan Penerima</h2>
        {/* Decorative only: this component has no onCancel/onBack prop from
            its caller (stop-flow.tsx's KonfirTerimaStep usage defines no
            cancel path), so no action is wired here pending a defined
            cancel/back flow. */}
        <X className="size-4 text-muted-foreground" />
      </div>
      <SignaturePad onCapture={setSignatureFile} onClear={() => setSignatureFile(null)} />
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <Button className="mt-3 w-full" disabled={submitting} onClick={handleConfirm}>
        {submitting ? "Menyimpan..." : "Konfirmasi Penerima"}
      </Button>
    </div>
  );
}
