"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, HelpCircle, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useLiveCameraCapture } from "@/hooks/use-live-camera-capture";
import { createVehicleCheckAction } from "@/app/(dashboard)/delivery/actions";
import {
  JENIS_FOTO_LIST,
  JENIS_FOTO_LABEL,
  FUEL_BAR_MAX,
  type VehicleCheckTipe,
  type FuelBar,
  type JenisFotoKendaraan,
  type VehicleCheckPhoto,
} from "@/lib/vehicle-check-types";

const TIPE_LABEL: Record<VehicleCheckTipe, string> = { BERANGKAT: "Kendaraan Berangkat", DATANG: "Kendaraan Tiba" };

async function uploadPhoto(file: File, jenisFoto: JenisFotoKendaraan, armadaId: number): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("armadaId", String(armadaId));
  formData.append("jenisFoto", jenisFoto);
  const res = await fetch("/api/upload/satpam-check", { method: "POST", body: formData });
  const data = (await res.json()) as { path?: string; error?: string };
  if (!res.ok || !data.path) throw new Error(data.error ?? "Gagal mengunggah foto.");
  return data.path;
}

function ActiveSlotView({
  jenisFoto,
  photoUrl,
  disabled,
  onCapture,
}: {
  jenisFoto: JenisFotoKendaraan;
  photoUrl: string | null;
  disabled: boolean;
  onCapture: (file: File) => void;
}) {
  // Keying the hook instance by jenisFoto (via the parent's `key` prop, see
  // below) is what actually prevents a stale-photo leak when switching
  // slots — same class of bug fixed earlier for the desktop toggle. Without
  // a fresh hook instance per slot, internal state like `retaking` could
  // carry over from the previously-active slot.
  const { videoRef, displayedPhotoUrl, showLive, error, retry, handleTap } = useLiveCameraCapture({
    label: JENIS_FOTO_LABEL[jenisFoto],
    photoUrl,
    active: true,
    disabled,
    onCapture,
  });

  return (
    <div className="absolute inset-0" onClick={handleTap}>
      {displayedPhotoUrl != null ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL or uploaded path
        <img src={displayedPhotoUrl} alt={JENIS_FOTO_LABEL[jenisFoto]} className="h-full w-full object-cover" />
      ) : showLive ? (
        error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-black px-6 text-center text-white">
            <p className="text-sm">{error}</p>
            <Button
              size="sm"
              variant="outline"
              className="border-white/40 text-white"
              onClick={(e) => {
                e.stopPropagation();
                retry();
              }}
            >
              Coba Lagi
            </Button>
          </div>
        ) : (
          <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
        )
      ) : (
        <div className="h-full w-full bg-black" />
      )}
    </div>
  );
}

function FuelBarSelector({ value, onChange }: { value: FuelBar; onChange: (v: FuelBar) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fuelmeter (/{FUEL_BAR_MAX})</span>
      <div className="flex h-8 gap-1">
        <button
          type="button"
          onClick={() => onChange(0)}
          className={cn(
            "flex w-8 items-center justify-center rounded-l-xl border text-[10px] font-bold transition-colors",
            value === 0 ? "border-warning bg-warning text-warning-foreground" : "border-border bg-muted/20 text-muted-foreground"
          )}
        >
          E
        </button>
        {([1, 2, 3, 4] as FuelBar[]).map((bar) => (
          <button
            key={bar}
            type="button"
            onClick={() => onChange(bar)}
            className={cn(
              "flex-1 border transition-colors last:rounded-r-xl",
              bar <= value ? "border-warning bg-warning" : "border-border bg-muted/20"
            )}
            aria-label={`${bar} bar`}
          />
        ))}
      </div>
    </div>
  );
}

// The muatan-confirmation dialog walks through two steps rather than
// rendering an always-present-but-hidden manual input: "choice" (Ya/Tidak)
// and, only once "Tidak" is tapped, "manual" (a number input + Konfirmasi).
// Both steps reset to "choice" whenever the dialog reopens, so a
// half-filled manual entry from a previous open never leaks forward.
type MuatanStep = "choice" | "manual";

export function LiveInspeksiClient({
  jadwalId,
  armadaId,
  tipe,
  armadaNama,
  vehicleNo,
  driverName,
  expectedMuatanQty,
}: {
  jadwalId: number;
  armadaId: number;
  tipe: VehicleCheckTipe;
  armadaNama: string;
  vehicleNo: string | null;
  driverName: string | null;
  expectedMuatanQty: number;
}) {
  const router = useRouter();
  const [activeSlot, setActiveSlot] = useState<JenisFotoKendaraan>("DEPAN");
  const [photos, setPhotos] = useState<Partial<Record<JenisFotoKendaraan, string>>>({});
  // Local object URLs for the bottom-grid thumbnails — shown instead of the
  // uploaded server path so a thumbnail never depends on a follow-up network
  // request succeeding (production has shown broken-image icons here despite
  // the upload itself succeeding). `photos` above still holds the real
  // server path used for submission.
  const [previewUrls, setPreviewUrls] = useState<Partial<Record<JenisFotoKendaraan, string>>>({});
  const previewUrlsRef = useRef(previewUrls);
  const [uploading, setUploading] = useState<JenisFotoKendaraan | null>(null);
  const [odometerKM, setOdometerKM] = useState("");
  const [fuelBar, setFuelBar] = useState<FuelBar>(2);
  const [muatanQty, setMuatanQty] = useState<number | null>(null);
  const [showMuatanDialog, setShowMuatanDialog] = useState(false);
  const [muatanStep, setMuatanStep] = useState<MuatanStep>("choice");
  const [manualMuatanInput, setManualMuatanInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    previewUrlsRef.current = previewUrls;
  }, [previewUrls]);

  useEffect(() => {
    return () => {
      for (const url of Object.values(previewUrlsRef.current)) {
        if (url) URL.revokeObjectURL(url);
      }
    };
  }, []);

  async function handleCapture(file: File, jenisFoto: JenisFotoKendaraan) {
    setError(null);
    setUploading(jenisFoto);
    const localUrl = URL.createObjectURL(file);
    setPreviewUrls((prev) => {
      const old = prev[jenisFoto];
      if (old) URL.revokeObjectURL(old);
      return { ...prev, [jenisFoto]: localUrl };
    });
    try {
      const path = await uploadPhoto(file, jenisFoto, armadaId);
      setPhotos((prev) => ({ ...prev, [jenisFoto]: path }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah foto.");
    } finally {
      setUploading(null);
    }
  }

  const allPhotosReady = JENIS_FOTO_LIST.every((j) => photos[j] != null);
  const canSubmit = allPhotosReady && Number(odometerKM) > 0 && muatanQty != null && !pending;

  function handleSubmit() {
    if (!canSubmit || muatanQty == null) return;
    setError(null);
    startTransition(async () => {
      const photoList: VehicleCheckPhoto[] = JENIS_FOTO_LIST.map((jenisFoto) => ({
        jenisFoto,
        filePath: photos[jenisFoto] as string,
      }));
      const result = await createVehicleCheckAction({ jadwalId, tipe, odometerKM: Number(odometerKM), fuelBar, muatanQty, photos: photoList });
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.push("/satpam-app");
    });
  }

  function openMuatanDialog() {
    setMuatanStep("choice");
    setManualMuatanInput("");
    setShowMuatanDialog(true);
  }

  function confirmMuatanSesuai() {
    setMuatanQty(expectedMuatanQty);
    setShowMuatanDialog(false);
  }

  const manualMuatanValid = manualMuatanInput.trim() !== "" && Number(manualMuatanInput) >= 0;

  function confirmMuatanManual() {
    if (!manualMuatanValid) return;
    setMuatanQty(Number(manualMuatanInput));
    setShowMuatanDialog(false);
  }

  const photosDone = JENIS_FOTO_LIST.filter((j) => photos[j] != null).length;

  return (
    <div className="fixed inset-0 flex flex-col bg-black text-foreground">
      <ActiveSlotView
        key={activeSlot}
        jenisFoto={activeSlot}
        photoUrl={photos[activeSlot] ?? null}
        disabled={uploading != null || pending}
        onCapture={(file) => handleCapture(file, activeSlot)}
      />

      {/* Top bar — sits directly on the live camera feed, so its scrim stays
          literal black/transparent (compositing against video pixels, not a
          themed surface); text/icons use the forced-dark foreground token. */}
      <div className="relative z-10 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent p-4">
        <Button size="icon" variant="ghost" className="rounded-full bg-black/40 text-foreground" onClick={() => router.back()}>
          <ArrowLeft className="size-5" />
        </Button>
        <div className="flex flex-col items-center">
          <p className="font-display text-lg font-bold">Inspeksi Kendaraan</p>
          <p className="text-xs font-semibold uppercase tracking-wide text-warning">
            {armadaNama}
            {vehicleNo && vehicleNo !== armadaNama ? ` - ${vehicleNo}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">Driver: {driverName ?? "-"}</p>
        </div>
        <Button size="icon" variant="ghost" className="rounded-full bg-black/40 text-foreground">
          <HelpCircle className="size-5" />
        </Button>
      </div>

      {/* Status pill */}
      <div className="relative z-10 mx-4 flex items-center justify-between rounded-full bg-black/40 px-4 py-2 text-xs">
        <span className="flex items-center gap-2">
          <span className="size-2 animate-pulse rounded-full bg-warning" /> LIVE VIEW
        </span>
        <span className="font-mono font-bold">
          {photosDone}/{JENIS_FOTO_LIST.length} SELESAI
        </span>
      </div>

      <div className="flex-1" />

      {/* Bottom sheet — a real themed surface (not overlaying video), so it
          uses this project's existing card/border/muted tokens like every
          other dark-mode panel in the app. */}
      <div className="relative z-10 rounded-t-3xl border-t border-border bg-card/90 px-4 pb-4 pt-6 backdrop-blur-md">
        <p className="mb-3 font-display text-base font-semibold">Data Kendaraan</p>
        <div className="mb-4 grid grid-cols-6 gap-2">
          {JENIS_FOTO_LIST.map((j) => (
            <button
              key={j}
              type="button"
              onClick={() => setActiveSlot(j)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg border p-1",
                j === activeSlot ? "border-warning bg-warning/10" : "border-border bg-muted/30"
              )}
            >
              <div className="aspect-square w-full overflow-hidden rounded bg-muted/50">
                {previewUrls[j] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local object URL, not a static build asset
                  <img src={previewUrls[j]} alt={JENIS_FOTO_LABEL[j]} className="h-full w-full object-cover" />
                ) : null}
              </div>
              <span className={cn("text-[9px] font-bold uppercase", j === activeSlot ? "text-warning" : "text-muted-foreground")}>
                {JENIS_FOTO_LABEL[j]}
              </span>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Odometer (KM)</label>
            <Input
              type="number"
              inputMode="numeric"
              placeholder="Mis. 45020"
              value={odometerKM}
              onChange={(e) => setOdometerKM(e.target.value)}
              className="border-border bg-muted/20 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <FuelBarSelector value={fuelBar} onChange={setFuelBar} />
        </div>
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      </div>

      {/* Sticky footer */}
      <div className="relative z-10 border-t border-border bg-background p-4">
        <Button
          className="h-14 w-full gap-2 bg-warning font-display text-base text-warning-foreground hover:bg-warning/90 disabled:bg-muted disabled:text-muted-foreground"
          disabled={!allPhotosReady || !(Number(odometerKM) > 0)}
          onClick={() => {
            if (muatanQty == null) {
              openMuatanDialog();
              return;
            }
            handleSubmit();
          }}
        >
          <Truck className="size-5" />
          {pending ? "Menyimpan..." : TIPE_LABEL[tipe]}
        </Button>
      </div>

      <Dialog open={showMuatanDialog} onOpenChange={setShowMuatanDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Muatan sudah sesuai?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Total muatan seharusnya: <strong>{expectedMuatanQty}</strong> koli.
          </p>
          {muatanStep === "manual" && (
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              autoFocus
              placeholder="Jumlah koli sebenarnya"
              value={manualMuatanInput}
              onChange={(e) => setManualMuatanInput(e.target.value)}
            />
          )}
          <DialogFooter className="flex-row gap-2">
            {muatanStep === "choice" ? (
              <>
                <Button variant="outline" className="flex-1" onClick={() => setMuatanStep("manual")}>
                  Tidak, catat manual
                </Button>
                <Button className="flex-1" onClick={confirmMuatanSesuai}>
                  Ya, sesuai
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" className="flex-1" onClick={() => setMuatanStep("choice")}>
                  Kembali
                </Button>
                <Button className="flex-1" disabled={!manualMuatanValid} onClick={confirmMuatanManual}>
                  Konfirmasi
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
