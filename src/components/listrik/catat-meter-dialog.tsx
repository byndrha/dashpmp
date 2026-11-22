"use client";

import { useEffect, useState } from "react";
import { Camera, ImageUp, Loader2, RotateCcw, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useWatermarkCameraCapture,
  type WatermarkCaptureResult,
} from "@/hooks/use-watermark-camera-capture";
import {
  catatBacaanMeterAction,
  getBacaanTerakhirAction,
} from "@/app/listrik-actions";
import {
  jamLabel,
  slotDari,
  standTotal,
  LABEL_SLOT,
  type BacaanMeter,
  type PengaturanListrik,
} from "@/lib/listrik";

// Form "Catat Meter PLN" (modul Kelistrikan tahap 1): foto meter wajib
// (kamera watermark — waktu & lokasi tercetak di foto), lalu angka stand.
// Dipakai di dashboard Kelistrikan dan aplikasi produksi (Es Kristal & Es Balok).

/** "12.345,6" / "12345.6" / "12345,6" → 12345.6 */
export function parseAngka(teks: string): number | null {
  const t = teks.replace(/\s/g, "");
  if (!t) return null;
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(normal);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

async function unggahFoto(kode: string, file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("kode", kode);
  const res = await fetch("/api/listrik/foto", { method: "POST", body: fd });
  const json = (await res.json().catch(() => ({}))) as {
    path?: string;
    error?: string;
  };
  if (!res.ok || !json.path)
    throw new Error(json.error ?? "Gagal mengunggah foto.");
  return json.path;
}

const fmt = (n: number) =>
  n.toLocaleString("id-ID", { maximumFractionDigits: 2 });

function Kamera({
  aktif,
  onCapture,
}: {
  aktif: boolean;
  onCapture: (r: WatermarkCaptureResult) => void;
}) {
  const { videoRef, error, capturing, retry, handleCapture } =
    useWatermarkCameraCapture({
      label: "meter-pln",
      active: aktif,
      onCapture,
    });
  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-white">
            <p>{error}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-white/40 bg-transparent text-white"
                onClick={retry}
              >
                Coba Lagi
              </Button>
              <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-white/40 px-2.5 text-xs">
                <ImageUp className="size-3.5" /> Pilih foto
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f)
                      onCapture({ file: f, latitude: null, longitude: null });
                  }}
                />
              </label>
            </div>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="h-full w-full object-cover"
          />
        )}
        <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-dashed border-white/50" />
        <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[11px] text-white/80">
          Arahkan ke layar angka meter, pastikan terbaca jelas
        </p>
      </div>
      <Button
        className="h-11"
        disabled={capturing || !!error}
        onClick={handleCapture}
      >
        {capturing ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Camera className="size-4" />
        )}
        {capturing ? "Memproses foto..." : "Ambil Foto Meter"}
      </Button>
    </div>
  );
}

export function CatatMeterDialog({
  kode,
  pengaturan,
  open,
  onOpenChange,
  onTersimpan,
}: {
  kode: string;
  pengaturan: Pick<
    PengaturanListrik,
    "registerTerpisah" | "jamWbpMulai" | "jamWbpSelesai"
  >;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onTersimpan?: () => void;
}) {
  const [foto, setFoto] = useState<WatermarkCaptureResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [total, setTotal] = useState("");
  const [lwbp, setLwbp] = useState("");
  const [wbp, setWbp] = useState("");
  const [kvarh, setKvarh] = useState("");
  const [catatan, setCatatan] = useState("");
  const [menyimpan, setMenyimpan] = useState(false);
  const [terakhir, setTerakhir] = useState<BacaanMeter | null | undefined>(
    undefined
  );
  const [slotSekarang, setSlotSekarang] = useState<string>("");

  // URL pratinjau dibuat saat foto diambil (bukan di effect) dan dilepas
  // saat foto diganti/ditutup.
  function gantiFoto(f: WatermarkCaptureResult | null) {
    setPreviewUrl((lama) => {
      if (lama) URL.revokeObjectURL(lama);
      return f ? URL.createObjectURL(f.file) : null;
    });
    setFoto(f);
  }

  useEffect(() => {
    if (!open) return;
    let batal = false;
    getBacaanTerakhirAction(kode).then((r) => {
      if (!batal) setTerakhir(r.success ? r.data : null);
    });
    const slot = slotDari(new Date(), pengaturan);
    const teks =
      slot === "mulai_wbp"
        ? `${LABEL_SLOT[slot]} (${jamLabel(pengaturan.jamWbpMulai)})`
        : slot === "akhir_wbp"
        ? `${LABEL_SLOT[slot]} (${jamLabel(pengaturan.jamWbpSelesai)})`
        : `${LABEL_SLOT[slot]} — di luar jam ${jamLabel(
            pengaturan.jamWbpMulai
          )} & ${jamLabel(pengaturan.jamWbpSelesai)}`;
    queueMicrotask(() => !batal && setSlotSekarang(teks));
    return () => {
      batal = true;
    };
  }, [open, kode, pengaturan]);

  function reset() {
    gantiFoto(null);
    setTotal("");
    setLwbp("");
    setWbp("");
    setKvarh("");
    setCatatan("");
    setTerakhir(undefined);
  }

  function ubahOpen(v: boolean) {
    if (menyimpan) return;
    if (!v) reset();
    onOpenChange(v);
  }

  const nTotal = parseAngka(total);
  const nLwbp = parseAngka(lwbp);
  const nWbp = parseAngka(wbp);
  const nKvarh = parseAngka(kvarh);
  const standBaru = pengaturan.registerTerpisah
    ? nLwbp != null &&
      nWbp != null &&
      !Number.isNaN(nLwbp) &&
      !Number.isNaN(nWbp)
      ? nLwbp + nWbp
      : null
    : nTotal != null && !Number.isNaN(nTotal)
    ? nTotal
    : null;
  const standLama = terakhir ? standTotal(terakhir) : null;
  const turun = standBaru != null && standLama != null && standBaru < standLama;
  const angkaSalah = [nTotal, nLwbp, nWbp, nKvarh].some((n) => Number.isNaN(n));

  async function simpan() {
    if (!foto) return toast.error("Ambil foto meter dulu.");
    if (standBaru == null || angkaSalah)
      return toast.error("Isi angka stand meter dengan benar.");
    if (turun)
      return toast.error(
        "Stand lebih kecil dari pembacaan terakhir — periksa lagi angkanya."
      );
    setMenyimpan(true);
    try {
      const fotoPath = await unggahFoto(kode, foto.file);
      const r = await catatBacaanMeterAction(kode, {
        kwhTotal: pengaturan.registerTerpisah ? null : nTotal,
        kwhLwbp: pengaturan.registerTerpisah ? nLwbp : null,
        kwhWbp: pengaturan.registerTerpisah ? nWbp : null,
        kvarh: nKvarh,
        fotoPath,
        fotoLat: foto.latitude,
        fotoLng: foto.longitude,
        catatan,
      });
      if (!r.success) {
        toast.error(r.error);
        return;
      }
      toast.success(`Meter tercatat · ${r.data.label}`);
      reset();
      onOpenChange(false);
      onTersimpan?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan.");
    } finally {
      setMenyimpan(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={ubahOpen}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-warning/15 text-warning">
              <Zap className="size-4" />
            </span>
            Catat Meter PLN
          </DialogTitle>
          <DialogDescription>
            {slotSekarang
              ? `Slot: ${slotSekarang}`
              : "Foto meter, lalu isi angka yang tertera."}
          </DialogDescription>
        </DialogHeader>

        {!foto ? (
          <Kamera aktif={open && !foto} onCapture={gantiFoto} />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="relative overflow-hidden rounded-xl border">
              {previewUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- object URL lokal
                <img
                  src={previewUrl}
                  alt="Foto meter"
                  className="max-h-56 w-full object-cover"
                />
              )}
              <Button
                size="sm"
                variant="secondary"
                className="absolute top-2 right-2 h-7 gap-1 shadow"
                disabled={menyimpan}
                onClick={() => gantiFoto(null)}
              >
                <RotateCcw className="size-3.5" /> Ulangi
              </Button>
            </div>

            {pengaturan.registerTerpisah ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="stand-lwbp">Stand LWBP</Label>
                  <Input
                    id="stand-lwbp"
                    inputMode="decimal"
                    value={lwbp}
                    onChange={(e) => setLwbp(e.target.value)}
                    className="font-data text-base"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="stand-wbp">Stand WBP</Label>
                  <Input
                    id="stand-wbp"
                    inputMode="decimal"
                    value={wbp}
                    onChange={(e) => setWbp(e.target.value)}
                    className="font-data text-base"
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="stand-kwh">Stand kWh</Label>
                <Input
                  id="stand-kwh"
                  inputMode="decimal"
                  autoFocus
                  value={total}
                  onChange={(e) => setTotal(e.target.value)}
                  className="h-11 font-data text-lg"
                />
              </div>
            )}
            <p className="-mt-2 text-xs text-muted-foreground">
              {terakhir === undefined
                ? "Memuat pembacaan terakhir..."
                : terakhir && standLama != null
                ? `Terakhir: ${fmt(standLama)} · ${
                    terakhir.olehNama
                  }, ${new Date(terakhir.waktu).toLocaleString("id-ID", {
                    timeZone: "Asia/Jakarta",
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : "Belum ada pembacaan sebelumnya — ini menjadi angka awal."}
              {standBaru != null && standLama != null && !turun && (
                <span className="ml-1 font-medium text-foreground">
                  (+{fmt(standBaru - standLama)})
                </span>
              )}
            </p>
            {turun && (
              <p className="-mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                Lebih kecil dari pembacaan terakhir. Angka meter tidak pernah
                turun — periksa lagi.
              </p>
            )}

            <div className="grid grid-cols-[1fr_1.4fr] gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="stand-kvarh">
                  kVArh{" "}
                  <span className="font-normal text-muted-foreground">
                    (opsional)
                  </span>
                </Label>
                <Input
                  id="stand-kvarh"
                  inputMode="decimal"
                  value={kvarh}
                  onChange={(e) => setKvarh(e.target.value)}
                  className="font-data"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="catatan-meter">
                  Catatan{" "}
                  <span className="font-normal text-muted-foreground">
                    (opsional)
                  </span>
                </Label>
                <Input
                  id="catatan-meter"
                  value={catatan}
                  onChange={(e) => setCatatan(e.target.value)}
                  placeholder="mis. Msn 2 mati"
                />
              </div>
            </div>

            <Button
              className="h-11"
              disabled={menyimpan || standBaru == null || angkaSalah || turun}
              onClick={simpan}
            >
              {menyimpan && <Loader2 className="size-4 animate-spin" />}
              {menyimpan ? "Menyimpan..." : "Simpan Pembacaan"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
