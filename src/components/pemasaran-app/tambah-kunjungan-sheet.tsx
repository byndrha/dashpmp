"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, X, Camera, RefreshCw, MapPin, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { haversineKm } from "@/lib/route-estimate";
import { MitraLocationMap } from "@/components/dashboard/mitra-location-map";
import { KunjunganRouteMap, type RouteInfo } from "@/components/pemasaran-app/kunjungan-route-map";
import { useWatermarkCameraCapture } from "@/hooks/use-watermark-camera-capture";
import {
  getKunjunganMitraOptionsAction,
  setMitraLocationAction,
  confirmKunjunganAction,
} from "@/app/mkesindo/pemasaran-app/actions";
import type { MitraRow } from "@/lib/queries/mitra";

const RADIUS_METERS = 100;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// Satu slot foto — kamera + preview + tombol ambil ulang, dipakai untuk
// kedua slot (tampak depan & penagihan) dengan facingMode berbeda.
function PhotoSlot({
  label,
  facingMode,
  file,
  onCapture,
}: {
  label: string;
  facingMode: "environment" | "user";
  file: File | null;
  onCapture: (file: File) => void;
}) {
  const [active, setActive] = useState(false);
  const { videoRef, error, capturing, retry, handleCapture } = useWatermarkCameraCapture({
    label,
    active,
    facingMode,
    onCapture: (result) => {
      onCapture(result.file);
      setActive(false);
    },
  });
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  if (file && previewUrl) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">{label}</Label>
        <div className="relative">
          <img src={previewUrl} alt={label} className="h-40 w-full rounded-md object-cover" />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="absolute right-2 bottom-2 gap-1.5"
            onClick={() => setActive(true)}
          >
            <RefreshCw className="size-3.5" /> Ambil Ulang
          </Button>
        </div>
        {active && (
          <div className="relative overflow-hidden rounded-md bg-black">
            <video ref={videoRef} autoPlay playsInline muted className="h-40 w-full object-cover" />
            {error ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 p-2 text-center text-xs text-white">
                {error}
                <Button type="button" size="sm" onClick={retry}>Coba Lagi</Button>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={capturing}
                onClick={handleCapture}
                className="absolute bottom-2 left-1/2 -translate-x-1/2 gap-1.5"
              >
                <Camera className="size-3.5" /> {capturing ? "Memproses..." : "Ambil Foto"}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      {!active ? (
        <Button type="button" variant="outline" className="h-24 flex-col gap-1.5" onClick={() => setActive(true)}>
          <Camera className="size-5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Ambil Foto</span>
        </Button>
      ) : (
        <div className="relative overflow-hidden rounded-md bg-black">
          <video ref={videoRef} autoPlay playsInline muted className="h-40 w-full object-cover" />
          {error ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 p-2 text-center text-xs text-white">
              {error}
              <Button type="button" size="sm" onClick={retry}>Coba Lagi</Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={capturing}
              onClick={handleCapture}
              className="absolute bottom-2 left-1/2 -translate-x-1/2 gap-1.5"
            >
              <Camera className="size-3.5" /> {capturing ? "Memproses..." : "Ambil Foto"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function TambahKunjunganSheet() {
  const [open, setOpen] = useState(false);
  const [mitraOptions, setMitraOptions] = useState<MitraRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pinDraft, setPinDraft] = useState<{ lat: number; lng: number } | null>(null);
  const [savingPin, setSavingPin] = useState(false);
  const [marketingPosition, setMarketingPosition] = useState<[number, number] | null>(null);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [fotoDepan, setFotoDepan] = useState<File | null>(null);
  const [fotoPenagihan, setFotoPenagihan] = useState<File | null>(null);
  const [hasilKunjungan, setHasilKunjungan] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function resetState() {
    setSelectedId(null);
    setPinDraft(null);
    setMarketingPosition(null);
    setRouteInfo(null);
    setRouteError(null);
    setFotoDepan(null);
    setFotoPenagihan(null);
    setHasilKunjungan("");
    setConfirmError(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next && mitraOptions == null) {
      getKunjunganMitraOptionsAction().then((result) => {
        if (result.success) setMitraOptions(result.data);
      });
    }
    if (!next) resetState();
  }

  const selectedMitra = mitraOptions?.find((m) => m.BusinessPartnerID === selectedId) ?? null;
  // Lokasi efektif mitra: dari BusinessPartner/DashboardMitraLocation kalau
  // sudah ada, atau dari draft pin yang baru saja dikonfirmasi (belum
  // refresh mitraOptions).
  const mitraLat = pinDraft?.lat ?? selectedMitra?.Latitude ?? null;
  const mitraLng = pinDraft?.lng ?? selectedMitra?.Longitude ?? null;
  const needsPin = selectedMitra != null && mitraLat == null;

  const distanceMeters =
    mitraLat != null && mitraLng != null && marketingPosition
      ? haversineKm({ lat: mitraLat, lng: mitraLng }, { lat: marketingPosition[0], lng: marketingPosition[1] }) * 1000
      : null;
  const withinRadius = distanceMeters != null && distanceMeters <= RADIUS_METERS;

  function handleSelectMitra(id: string) {
    setSelectedId(id);
    setPinDraft(null);
    setMarketingPosition(null);
    setRouteInfo(null);
    setRouteError(null);
  }

  function handlePinConfirm() {
    if (!pinDraft || !selectedMitra) return;
    setSavingPin(true);
    startTransition(async () => {
      const result = await setMitraLocationAction({
        businessPartnerId: selectedMitra.BusinessPartnerID,
        latitude: pinDraft.lat,
        longitude: pinDraft.lng,
        alamat: selectedMitra.Alamat,
      });
      setSavingPin(false);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      // pinDraft tetap dipertahankan (bukan di-clear) sehingga mitraLat/Lng
      // efektif langsung mengikuti pin yang baru dikonfirmasi tanpa perlu
      // refetch getKunjunganMitraOptionsAction.
      toast.success("Lokasi mitra tersimpan.");
    });
  }

  function handleLocateMarketing(lat: number, lng: number) {
    setMarketingPosition([lat, lng]);
    setRouteInfo(null);
    setRouteError(null);
  }

  function handleGenerateRute() {
    if (!marketingPosition || mitraLat == null || mitraLng == null) return;
    setRouteLoading(true);
    setRouteError(null);
    fetch(
      `/api/mkesindo/routing/kunjungan?originLat=${marketingPosition[0]}&originLng=${marketingPosition[1]}&destLat=${mitraLat}&destLng=${mitraLng}`
    )
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setRouteError(data.error);
          return;
        }
        setRouteInfo({ distanceKm: data.distanceKm, durationMinutes: data.durationMinutes });
      })
      .catch(() => setRouteError("Gagal menghitung rute"))
      .finally(() => setRouteLoading(false));
  }

  async function uploadPhoto(file: File, slot: "depan" | "penagihan"): Promise<string> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("businessPartnerId", selectedMitra!.BusinessPartnerID);
    formData.append("slot", slot);
    const res = await fetch("/api/mkesindo/upload/marketing-kunjungan", { method: "POST", body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Gagal mengunggah foto");
    return data.path as string;
  }

  function handleConfirm() {
    if (!selectedMitra || !marketingPosition || !fotoDepan || !fotoPenagihan || !hasilKunjungan.trim()) return;
    setConfirmError(null);
    startTransition(async () => {
      try {
        const [fotoTampakDepanPath, fotoPenagihanPath] = await Promise.all([
          uploadPhoto(fotoDepan, "depan"),
          uploadPhoto(fotoPenagihan, "penagihan"),
        ]);
        const result = await confirmKunjunganAction({
          businessPartnerId: selectedMitra.BusinessPartnerID,
          dateISO: todayISO(),
          hasilKunjungan: hasilKunjungan.trim(),
          fotoTampakDepanPath,
          fotoPenagihanPath,
          latitude: marketingPosition[0],
          longitude: marketingPosition[1],
        });
        if (!result.success) {
          setConfirmError(result.error);
          return;
        }
        toast.success("Kunjungan berhasil dikonfirmasi.");
        handleOpenChange(false);
      } catch (err) {
        setConfirmError(err instanceof Error ? err.message : "Gagal mengonfirmasi kunjungan");
      }
    });
  }

  const canConfirm = withinRadius && !!fotoDepan && !!fotoPenagihan && hasilKunjungan.trim().length > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => handleOpenChange(true)}
        className="absolute right-4 bottom-4 z-30 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg transition-transform hover:scale-105"
      >
        <Plus className="size-4" /> Tambah Kunjungan
      </button>

      {open && (
        <div className="absolute inset-0 z-40 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="font-display text-base font-semibold">Tambah Kunjungan</h2>
            <button type="button" onClick={() => handleOpenChange(false)}>
              <X className="size-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Pilih Mitra</Label>
                <Select value={selectedId ?? undefined} onValueChange={(v) => v && handleSelectMitra(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Pilih mitra..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(mitraOptions ?? []).map((m) => (
                      <SelectItem key={m.BusinessPartnerID} value={m.BusinessPartnerID}>
                        {m.Name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedMitra && (
                <div className="rounded-md border border-border p-3 text-sm">
                  <p className="font-medium">{selectedMitra.Name}</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedMitra.Wilayah}
                    {selectedMitra.Kecamatan ? ` · ${selectedMitra.Kecamatan}` : ""}
                  </p>
                  {selectedMitra.Alamat && <p className="mt-1 text-xs text-muted-foreground">{selectedMitra.Alamat}</p>}
                </div>
              )}

              {needsPin && !pinDraft && (
                <div className="flex flex-col gap-2">
                  <p className="flex items-center gap-1.5 text-xs text-warning">
                    <MapPin className="size-3.5" /> Mitra ini belum punya lokasi tersimpan. Tandai lokasi di peta:
                  </p>
                  <MitraLocationMap
                    latitude={-7.8663}
                    longitude={111.4664}
                    onChange={(lat, lng) => setPinDraft({ lat, lng })}
                    recenterKey={0}
                  />
                  <p className="text-[11px] text-muted-foreground">Geser pin ke lokasi mitra yang benar, lalu peta akan lanjut otomatis.</p>
                </div>
              )}

              {needsPin && pinDraft && (
                <div className="flex flex-col gap-2">
                  <MitraLocationMap
                    latitude={pinDraft.lat}
                    longitude={pinDraft.lng}
                    onChange={(lat, lng) => setPinDraft({ lat, lng })}
                    recenterKey={0}
                  />
                  <Button type="button" onClick={handlePinConfirm} disabled={savingPin || pending}>
                    {savingPin ? "Menyimpan..." : "Konfirmasi Lokasi Mitra"}
                  </Button>
                </div>
              )}

              {selectedMitra && !needsPin && mitraLat != null && mitraLng != null && (
                <>
                  <KunjunganRouteMap
                    mitraLat={mitraLat}
                    mitraLng={mitraLng}
                    marketingPosition={marketingPosition}
                    onLocate={handleLocateMarketing}
                    onGenerateRute={handleGenerateRute}
                    routeInfo={routeInfo}
                    routeLoading={routeLoading}
                    routeError={routeError}
                  />

                  {marketingPosition && distanceMeters != null && (
                    <p className={cn("text-center text-sm font-medium", withinRadius ? "text-primary" : "text-destructive")}>
                      Jarak ke mitra: {Math.round(distanceMeters)}m{" "}
                      {withinRadius ? "— dalam radius, silakan lanjutkan" : `— harus dalam ${RADIUS_METERS}m untuk melanjutkan`}
                    </p>
                  )}

                  {withinRadius && (
                    <div className="flex flex-col gap-4 border-t pt-4">
                      <PhotoSlot label="Foto Tampak Depan Lokasi (bisa selfie)" facingMode="user" file={fotoDepan} onCapture={setFotoDepan} />
                      <PhotoSlot label="Foto Hasil Penagihan/Penawaran" facingMode="environment" file={fotoPenagihan} onCapture={setFotoPenagihan} />

                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs">Hasil Kunjungan</Label>
                        <Textarea
                          value={hasilKunjungan}
                          onChange={(e) => setHasilKunjungan(e.target.value)}
                          rows={4}
                          placeholder="Catat hasil kunjungan ke mitra ini..."
                        />
                      </div>

                      {confirmError && <p className="text-xs text-destructive">{confirmError}</p>}

                      <Button type="button" disabled={!canConfirm || pending} onClick={handleConfirm} className="gap-1.5">
                        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                        Konfirmasi Kunjungan
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
