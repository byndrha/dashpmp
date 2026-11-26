"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PhotoStatusOverlay, type PhotoUploadStatus } from "@/components/ui/photo-status-overlay";
import { cn } from "@/lib/utils";
import { AppearanceMenu } from "@/components/dashboard/appearance-menu";
import { useLiveCameraCapture } from "@/hooks/use-live-camera-capture";
import { createVehicleCheckAction } from "@/app/mkesindo/(dashboard)/delivery/actions";
import {
  JENIS_FOTO_LABEL,
  FUEL_BAR_MAX,
  POSISI_BAN,
  LABEL_POSISI_BAN,
  PSI_MIN,
  PSI_MAKS,
  jenisFotoWajib,
  psiAman,
  type VehicleCheckTipe,
  type FuelBar,
  type JenisFotoKendaraan,
  type JumlahBan,
  type PosisiBan,
  type VehicleCheckPhoto,
} from "@/lib/vehicle-check-types";

const TIPE_LABEL: Record<VehicleCheckTipe, string> = { BERANGKAT: "Kendaraan Berangkat", DATANG: "Kendaraan Tiba" };

async function uploadPhoto(file: File, jenisFoto: JenisFotoKendaraan, armadaId: number): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("armadaId", String(armadaId));
  formData.append("jenisFoto", jenisFoto);
  const res = await fetch("/api/mkesindo/upload/satpam-check", { method: "POST", body: formData });
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
  // Vehicle inspections often happen at night or in dim corners of the
  // vehicle (undercarriage, wheel wells) — the flashlight should just be on
  // for the whole inspection, not something the satpam has to remember to
  // toggle per photo slot.
  const { videoRef, displayedPhotoUrl, showLive, error, retry, handleTap } = useLiveCameraCapture({
    label: JENIS_FOTO_LABEL[jenisFoto],
    photoUrl,
    active: true,
    disabled,
    onCapture,
    autoTorch: true,
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

// Label kolom di form Security: sisi saja (depan/belakang sudah jadi judul
// kelompok), L/D = ban luar/dalam pada ban ganda truk.
const LABEL_KOLOM_BAN: Record<PosisiBan, string> = {
  DKI: "Kiri",
  DKA: "Kanan",
  BKI: "Kiri",
  BKA: "Kanan",
  BKI_LUAR: "Kiri-L",
  BKI_DALAM: "Kiri-D",
  BKA_DALAM: "Kanan-D",
  BKA_LUAR: "Kanan-L",
};

// Nilai awal = tekanan aman umum (tahap uji coba: form tidak dibiarkan kosong,
// Security cukup mengoreksi ban yang berbeda).
function tekananBanAwal(jumlahBan: JumlahBan): Partial<Record<PosisiBan, string>> {
  return Object.fromEntries(POSISI_BAN[jumlahBan].map((p) => [p, String(psiAman(jumlahBan, p))]));
}

// Input tekanan ban — satu baris ringkas supaya tidak memakan ruang kamera:
// kelompok "Ban Depan" | "Ban Belakang" dipisah garis, label sisi di bawah
// tiap kotak.
function InputTekananBan({
  jumlahBan,
  nilai,
  onUbah,
}: {
  jumlahBan: JumlahBan;
  nilai: Partial<Record<PosisiBan, string>>;
  onUbah: (posisi: PosisiBan, v: string) => void;
}) {
  const posisi = POSISI_BAN[jumlahBan];
  const kelompok = [
    { judul: "Ban Depan", daftar: posisi.filter((p) => p.startsWith("D")) },
    { judul: "Ban Belakang", daftar: posisi.filter((p) => p.startsWith("B")) },
  ];
  return (
    <div className="flex flex-col gap-1">
      <div
        className="flex items-center gap-1.5"
        title="Nilai awal = tekanan aman umum; ubah bila hasil ukur berbeda (ikuti stiker tekanan ban kendaraan)."
      >
        <span className="rounded-full bg-warning/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-warning">
          Uji Coba
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tekanan ban (PSI)</span>
      </div>
      <div
        className="grid gap-x-2"
        style={{ gridTemplateColumns: `${kelompok[0].daftar.length}fr ${kelompok[1].daftar.length}fr` }}
      >
        {kelompok.map((k, ki) => (
          <div key={k.judul} className={cn("flex min-w-0 flex-col gap-0.5", ki === 1 && "border-l border-border pl-2")}>
            <span className="text-center text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{k.judul}</span>
            <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${k.daftar.length}, minmax(0, 1fr))` }}>
              {k.daftar.map((p) => {
                const v = nilai[p] ?? "";
                const n = Number(v);
                const salah = !(v.trim() !== "" && Number.isFinite(n) && n >= PSI_MIN && n <= PSI_MAKS);
                return (
                  <label key={p} className="flex min-w-0 flex-col items-center" title={`${LABEL_POSISI_BAN[p]} (aman ±${psiAman(jumlahBan, p)} PSI)`}>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      placeholder={String(psiAman(jumlahBan, p))}
                      aria-label={`Tekanan ban ${LABEL_POSISI_BAN[p]} (PSI)`}
                      value={v}
                      onChange={(e) => onUbah(p, e.target.value)}
                      className={cn(
                        "h-8 border-border bg-muted/20 px-0.5 text-center text-sm text-foreground tabular-nums placeholder:text-muted-foreground/60",
                        salah && "border-destructive"
                      )}
                    />
                    <span className="text-[9px] leading-tight font-bold uppercase text-muted-foreground">{LABEL_KOLOM_BAN[p]}</span>
                  </label>
                );
              })}
            </div>
          </div>
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
  jumlahBan,
}: {
  jadwalId: number;
  armadaId: number;
  // Jumlah ban armada — menentukan posisi input tekanan ban (Cek Berangkat).
  jumlahBan: JumlahBan;
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
  const [remark, setRemark] = useState("");
  const [tekananBan, setTekananBan] = useState<Partial<Record<PosisiBan, string>>>(() => tekananBanAwal(jumlahBan));
  // Petunjuk singkat saat slot foto "Ban" diketuk.
  const [petunjukBan, setPetunjukBan] = useState(false);
  useEffect(() => {
    if (!petunjukBan) return;
    const t = setTimeout(() => setPetunjukBan(false), 2500);
    return () => clearTimeout(t);
  }, [petunjukBan]);
  // Cek Berangkat: 6 foto sisi + 1 foto tekanan ban; Cek Datang: 6 foto.
  const fotoWajib = jenisFotoWajib(tipe);
  const catatBan = tipe === "BERANGKAT";
  const posisiBan = POSISI_BAN[jumlahBan];
  const banLengkap =
    !catatBan ||
    posisiBan.every((p) => {
      const n = Number(tekananBan[p]);
      return (tekananBan[p] ?? "").trim() !== "" && Number.isFinite(n) && n >= PSI_MIN && n <= PSI_MAKS;
    });
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

  const allPhotosReady = fotoWajib.every((j) => photos[j] != null);
  const canSubmit = allPhotosReady && Number(odometerKM) > 0 && banLengkap && muatanQty != null && !pending;

  function handleSubmit() {
    if (!canSubmit || muatanQty == null) return;
    setError(null);
    startTransition(async () => {
      const photoList: VehicleCheckPhoto[] = fotoWajib.map((jenisFoto) => ({
        jenisFoto,
        filePath: photos[jenisFoto] as string,
      }));
      const result = await createVehicleCheckAction({
        jadwalId,
        tipe,
        odometerKM: Number(odometerKM),
        fuelBar,
        muatanQty,
        remark: tipe === "DATANG" && remark.trim() ? remark.trim() : null,
        photos: photoList,
        tekananBan: catatBan ? posisiBan.map((p) => ({ posisi: p, psi: Number(tekananBan[p]) })) : undefined,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.push("/mkesindo/satpam-app");
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

  const photosDone = fotoWajib.filter((j) => photos[j] != null).length;

  function photoStatusFor(j: JenisFotoKendaraan): PhotoUploadStatus | undefined {
    if (uploading === j) return "uploading";
    if (photos[j] != null) return "success";
    return undefined;
  }

  return (
    <div className="fixed inset-0 flex flex-col bg-black text-foreground">
      <ActiveSlotView
        key={activeSlot}
        jenisFoto={activeSlot}
        photoUrl={photos[activeSlot] ?? null}
        disabled={uploading != null || pending}
        onCapture={(file) => handleCapture(file, activeSlot)}
      />

      {/* Top bar + status pill sit directly on the live camera feed, so they
          stay forced dark (a `dark`-scoped subtree, not the app's real
          theme) regardless of the satpam's AppearanceMenu choice — their
          bg-black/40 scrim needs light foreground tokens to stay legible
          compositing over video pixels, unlike the bottom sheet/footer
          below (real themed surfaces, outside this scope, that DO follow
          the real theme). `contents` keeps this wrapper invisible to the
          parent flex column's layout — only the CSS variable scoping is
          local. */}
      <div className="dark contents">
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
          <AppearanceMenu triggerClassName="rounded-full bg-black/40 text-foreground hover:bg-black/60" />
        </div>

        <div className="relative z-10 mx-4 flex items-center justify-between rounded-full bg-black/40 px-4 py-2 text-xs">
          <span className="flex items-center gap-2">
            <span className="size-2 animate-pulse rounded-full bg-warning" /> LIVE VIEW
          </span>
          <span className="font-mono font-bold">
            {photosDone}/{fotoWajib.length} SELESAI
          </span>
        </div>
      </div>

      <div className="flex-1" />

      {/* Bottom sheet — a real themed surface (not overlaying video), so it
          uses this project's existing card/border/muted tokens like every
          other dark-mode panel in the app. */}
      <div className="relative z-10 rounded-t-3xl border-t border-border bg-card/90 px-4 pb-4 pt-6 backdrop-blur-md">
        <div className={cn("mb-4 grid gap-2", fotoWajib.length === 7 ? "grid-cols-7" : "grid-cols-6")}>
          {fotoWajib.map((j) => (
            <button
              key={j}
              type="button"
              onClick={() => {
                setActiveSlot(j);
                setPetunjukBan(j === "TEKANAN_BAN");
              }}
              className={cn(
                "relative flex flex-col items-center gap-1 rounded-lg border p-1",
                j === activeSlot ? "border-warning bg-warning/10" : "border-border bg-muted/30"
              )}
            >
              <div className="relative aspect-square w-full">
                <div className="h-full w-full overflow-hidden rounded bg-muted/50">
                  {previewUrls[j] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local object URL, not a static build asset
                    <img src={previewUrls[j]} alt={JENIS_FOTO_LABEL[j]} className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <PhotoStatusOverlay status={photoStatusFor(j)} />
              </div>
              <span className={cn("text-[9px] font-bold uppercase", j === activeSlot ? "text-warning" : "text-muted-foreground")}>
                {JENIS_FOTO_LABEL[j]}
              </span>
              {j === "TEKANAN_BAN" && petunjukBan && (
                <span
                  role="tooltip"
                  className="pointer-events-none absolute right-0 bottom-full z-20 mb-1.5 w-max max-w-40 rounded-lg border border-border bg-popover px-2 py-1 text-[11px] font-semibold text-popover-foreground shadow-lg"
                >
                  Foto Ban Paling Beresiko
                </span>
              )}
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
        {catatBan && (
          <div className="mt-3">
            <InputTekananBan
              jumlahBan={jumlahBan}
              nilai={tekananBan}
              onUbah={(p, v) => setTekananBan((prev) => ({ ...prev, [p]: v }))}
            />
          </div>
        )}
        {tipe === "DATANG" && (
          <div className="mt-4 flex flex-col gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Remark (opsional)
            </label>
            <Textarea
              rows={2}
              placeholder="Mis. driver tidak sesuai, qty return es tidak sesuai..."
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              className="border-border bg-muted/20 text-foreground placeholder:text-muted-foreground"
            />
          </div>
        )}
        {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      </div>

      {/* Sticky footer */}
      <div className="relative z-10 border-t border-border bg-background p-4">
        <Button
          className="h-14 w-full gap-2 bg-warning font-display text-base text-warning-foreground hover:bg-warning/90 disabled:bg-muted disabled:text-muted-foreground"
          disabled={!allPhotosReady || !(Number(odometerKM) > 0) || !banLengkap}
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
            Total muatan seharusnya: <strong>{expectedMuatanQty}</strong> kantong es kristal.
          </p>
          {muatanStep === "manual" && (
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              autoFocus
              placeholder="Jumlah kantong es kristal sebenarnya"
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
