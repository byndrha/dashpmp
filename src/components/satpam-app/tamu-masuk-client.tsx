"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWatermarkCameraCapture, type WatermarkCaptureResult } from "@/hooks/use-watermark-camera-capture";
import { createTamuMasukAction } from "@/app/mkesindo/satpam-app/actions";

async function uploadTamuMasukFoto(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("jenis", "masuk");
  const res = await fetch("/api/mkesindo/upload/satpam-tamu", { method: "POST", body: formData });
  const data = (await res.json()) as { path?: string; error?: string };
  if (!res.ok || !data.path) throw new Error(data.error ?? "Gagal mengunggah foto.");
  return data.path;
}

export function TamuMasukClient() {
  const router = useRouter();
  const [namaTamu, setNamaTamu] = useState("");
  const [asalInstansi, setAsalInstansi] = useState("");
  const [tujuanKunjungan, setTujuanKunjungan] = useState("");
  const [dikunjungi, setDikunjungi] = useState("");
  const [nomorKendaraan, setNomorKendaraan] = useState("");
  const [captured, setCaptured] = useState<WatermarkCaptureResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [saving, setSaving] = useState(false);

  // Object URL untuk pratinjau hasil jepretan -- pola sama seperti
  // patroli-foto-client.tsx (effect create/revoke, bukan inline di JSX).
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
    label: "tamu-masuk",
    active: cameraActive && captured === null,
    onCapture: (result) => {
      setCaptured(result);
      setCameraActive(false);
    },
  });

  const formLengkap = Boolean(namaTamu.trim() && tujuanKunjungan.trim() && dikunjungi.trim());

  function handleBatal() {
    router.push("/mkesindo/satpam-app/tamu");
  }

  async function handleSimpan() {
    if (!formLengkap || !captured) return;
    setSaving(true);
    try {
      const fotoPath = await uploadTamuMasukFoto(captured.file);
      const result = await createTamuMasukAction({
        namaTamu: namaTamu.trim(),
        asalInstansi: asalInstansi.trim() || null,
        tujuanKunjungan: tujuanKunjungan.trim(),
        dikunjungi: dikunjungi.trim(),
        nomorKendaraan: nomorKendaraan.trim() || null,
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
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan data tamu.");
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="font-display text-lg font-semibold">Tamu Baru</h1>

      <div className="flex flex-col gap-3">
        <Input placeholder="Nama Tamu*" value={namaTamu} onChange={(e) => setNamaTamu(e.target.value)} />
        <Input placeholder="Asal Instansi" value={asalInstansi} onChange={(e) => setAsalInstansi(e.target.value)} />
        <Input
          placeholder="Tujuan Kunjungan*"
          value={tujuanKunjungan}
          onChange={(e) => setTujuanKunjungan(e.target.value)}
        />
        <Input placeholder="Dikunjungi*" value={dikunjungi} onChange={(e) => setDikunjungi(e.target.value)} />
        <Input
          placeholder="Nomor Kendaraan"
          value={nomorKendaraan}
          onChange={(e) => setNomorKendaraan(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-display text-sm font-semibold">Foto Masuk</h2>
        {previewUrl ? (
          <div className="flex flex-col gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL, not a static build asset */}
            <img src={previewUrl} alt="Foto masuk tamu" className="aspect-video w-full rounded-lg object-cover" />
            <Button
              variant="outline"
              onClick={() => {
                setCaptured(null);
                setCameraActive(true);
              }}
            >
              <RotateCcw className="size-4" /> Ambil Ulang
            </Button>
          </div>
        ) : cameraActive ? (
          <div className="flex flex-col gap-2">
            {error ? (
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
            <Button disabled={capturing || !!error} onClick={handleCapture}>
              {capturing ? "Memproses..." : "Ambil Foto"}
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => setCameraActive(true)}>
            <Camera className="size-4" /> Buka Kamera
          </Button>
        )}
      </div>

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" disabled={saving} onClick={handleBatal}>
          Batal
        </Button>
        <Button className="flex-1" disabled={saving || !formLengkap || !captured} onClick={handleSimpan}>
          {saving ? "Menyimpan..." : "Simpan"}
        </Button>
      </div>
    </div>
  );
}
