"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWatermarkCameraCapture, type WatermarkCaptureResult } from "@/hooks/use-watermark-camera-capture";
import { addPatroliFotoAction } from "@/app/mkesindo/satpam-app/actions";

async function uploadPatroliFoto(file: File, sesiId: number, titikPatroli: string | null): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("sesiId", String(sesiId));
  if (titikPatroli) formData.append("titikPatroli", titikPatroli);
  const res = await fetch("/api/mkesindo/upload/satpam-patroli", { method: "POST", body: formData });
  const data = (await res.json()) as { path?: string; error?: string };
  if (!res.ok || !data.path) throw new Error(data.error ?? "Gagal mengunggah foto.");
  return data.path;
}

export function PatroliFotoClient({ sesiId, titikPatroli }: { sesiId: number; titikPatroli: string | null }) {
  const router = useRouter();
  const [captured, setCaptured] = useState<WatermarkCaptureResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [keterangan, setKeterangan] = useState("");
  const [saving, setSaving] = useState(false);

  // Object URL untuk pratinjau hasil jepretan -- dibuat/dihapus lewat effect
  // (bukan langsung di JSX) supaya tidak membuat URL baru di setiap render
  // dan tidak bocor memori (pola yang sama seperti use-live-camera-capture.ts
  // dan live-inspeksi-client.tsx yang sudah ada).
  useEffect(() => {
    if (!captured) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- same accepted pattern as use-watermark-camera-capture.ts's setError(null) reset
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(captured.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [captured]);

  const { videoRef, error, capturing, retry, handleCapture } = useWatermarkCameraCapture({
    label: titikPatroli ?? "tambahan",
    active: captured === null,
    onCapture: (result) => setCaptured(result),
  });

  function handleBatal() {
    router.push("/mkesindo/satpam-app/patroli");
  }

  async function handleSimpan() {
    if (!captured) return;
    if (!titikPatroli && !keterangan.trim()) {
      toast.error("Keterangan wajib diisi untuk Foto Tambahan.");
      return;
    }
    setSaving(true);
    try {
      const fotoPath = await uploadPatroliFoto(captured.file, sesiId, titikPatroli);
      const result = await addPatroliFotoAction({
        sesiId,
        titikPatroli,
        keterangan: titikPatroli ? null : keterangan.trim(),
        fotoPath,
        latitude: captured.latitude,
        longitude: captured.longitude,
      });
      if (!result.success) {
        toast.error(result.error);
        setSaving(false);
        return;
      }
      router.push("/mkesindo/satpam-app/patroli");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan foto.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-black text-foreground">
      <div className="relative flex-1">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL, not a static build asset
          <img src={previewUrl} alt="Hasil foto" className="h-full w-full object-cover" />
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-black px-6 text-center text-white">
            <p className="text-sm">{error}</p>
            <Button size="sm" variant="outline" className="border-white/40 text-white" onClick={retry}>
              Coba Lagi
            </Button>
          </div>
        ) : (
          <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
        )}
      </div>

      {/* Top bar sengaja `dark`-scoped, sama seperti LiveInspeksiClient --
          duduk di atas feed kamera/foto, jadi butuh token terang tanpa
          bergantung pada tema asli pengguna. */}
      <div className="dark contents">
        <div className="relative z-10 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent p-4">
          <Button size="icon" variant="ghost" className="rounded-full bg-black/40 text-foreground" onClick={handleBatal}>
            <ArrowLeft className="size-5" />
          </Button>
          <p className="font-display text-sm font-bold">{titikPatroli ?? "Foto Tambahan"}</p>
          <div className="size-9" />
        </div>
      </div>

      <div className="relative z-10 border-t border-border bg-background p-4">
        {!titikPatroli && captured && (
          <Input
            className="mb-3"
            placeholder="Keterangan foto tambahan"
            value={keterangan}
            onChange={(e) => setKeterangan(e.target.value)}
          />
        )}
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
          <Button className="h-14 w-full" disabled={capturing || !!error} onClick={handleCapture}>
            {capturing ? "Memproses..." : "Ambil Foto"}
          </Button>
        )}
      </div>
    </div>
  );
}
