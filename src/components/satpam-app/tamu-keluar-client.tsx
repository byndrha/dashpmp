"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWatermarkCameraCapture, type WatermarkCaptureResult } from "@/hooks/use-watermark-camera-capture";
import { recordTamuKeluarAction } from "@/app/mkesindo/satpam-app/actions";
import type { TamuKunjunganRow } from "@/lib/queries/satpam-tamu";
import { formatTime } from "@/lib/format";

async function uploadTamuKeluarFoto(file: File, kunjunganId: number): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("jenis", "keluar");
  formData.append("kunjunganId", String(kunjunganId));
  const res = await fetch("/api/mkesindo/upload/satpam-tamu", { method: "POST", body: formData });
  const data = (await res.json()) as { path?: string; error?: string };
  if (!res.ok || !data.path) throw new Error(data.error ?? "Gagal mengunggah foto.");
  return data.path;
}

export function TamuKeluarClient({ tamu }: { tamu: TamuKunjunganRow }) {
  const router = useRouter();
  const [captured, setCaptured] = useState<WatermarkCaptureResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!captured) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- same accepted pattern as patroli-foto-client.tsx
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(captured.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [captured]);

  const { videoRef, error, capturing, retry, handleCapture } = useWatermarkCameraCapture({
    label: "tamu-keluar",
    active: captured === null,
    onCapture: (result) => setCaptured(result),
  });

  function handleBatal() {
    router.push("/mkesindo/satpam-app/tamu");
  }

  async function handleSimpan() {
    if (!captured) return;
    setSaving(true);
    try {
      const fotoPath = await uploadTamuKeluarFoto(captured.file, tamu.kunjunganId);
      const result = await recordTamuKeluarAction({
        kunjunganId: tamu.kunjunganId,
        fotoPath,
        latitude: captured.latitude,
        longitude: captured.longitude,
      });
      if (!result.success) {
        toast.error(result.error);
        setSaving(false);
        return;
      }
      router.push("/mkesindo/satpam-app/tamu");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan foto keluar.");
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="font-display text-lg font-semibold">Konfirmasi Tamu Keluar</h1>

      <div className="rounded-lg border p-3 text-sm">
        <p className="font-medium">{tamu.namaTamu}</p>
        <p className="text-xs text-muted-foreground">
          {tamu.tujuanKunjungan} — {tamu.dikunjungi}
        </p>
        <p className="text-xs text-muted-foreground">Masuk {formatTime(tamu.waktuMasuk)}</p>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-display text-sm font-semibold">Foto Keluar</h2>
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL, not a static build asset
          <img src={previewUrl} alt="Foto keluar tamu" className="aspect-video w-full rounded-lg object-cover" />
        ) : error ? (
          <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg bg-black px-6 text-center text-sm text-white">
            <p>{error}</p>
            <Button size="sm" variant="outline" className="border-white/40 text-white" onClick={retry}>
              Coba Lagi
            </Button>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="aspect-video w-full rounded-lg bg-black object-cover"
          />
        )}
      </div>

      {captured ? (
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={saving} onClick={() => setCaptured(null)}>
            Ambil Ulang
          </Button>
          <Button className="flex-1" disabled={saving} onClick={handleSimpan}>
            {saving ? "Menyimpan..." : "Simpan"}
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={handleBatal}>
            Batal
          </Button>
          <Button className="flex-1" disabled={capturing || !!error} onClick={handleCapture}>
            {capturing ? "Memproses..." : "Ambil Foto"}
          </Button>
        </div>
      )}
    </div>
  );
}
