"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { Plus, X, Camera, RefreshCw, SwitchCamera, MapPin, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { haversineKm } from "@/lib/route-estimate";
import type { RouteInfo } from "@/components/pemasaran-app/kunjungan-route-map";
import { useWatermarkCameraCapture } from "@/hooks/use-watermark-camera-capture";

// Leaflet/react-leaflet menyentuh `window` saat module dievaluasi -- pecah
// kalau dirender di server (SSR). Komponen lain yang sudah pakai Leaflet di
// codebase ini (mis. mitra-location-field.tsx) selalu memuatnya lewat
// next/dynamic + ssr:false; sheet ini sebelumnya meng-import langsung dan
// baru ketahuan pecah saat uji browser sungguhan (2026-09-23) -- tidak
// pernah terdeteksi lewat tsc/eslint karena itu murni error runtime SSR.
const MitraLocationMap = dynamic(
  () => import("@/components/dashboard/mitra-location-map").then((m) => m.MitraLocationMap),
  { ssr: false, loading: () => <Skeleton className="h-[260px] w-full rounded-lg" /> }
);
const KunjunganRouteMap = dynamic(
  () => import("@/components/pemasaran-app/kunjungan-route-map").then((m) => m.KunjunganRouteMap),
  { ssr: false, loading: () => <Skeleton className="h-[280px] w-full rounded-lg" /> }
);
import {
  getKunjunganMitraOptionsAction,
  setMitraLocationAction,
  confirmKunjunganAction,
} from "@/app/mkesindo/pemasaran-app/actions";
import type { MitraRow } from "@/lib/queries/mitra";
import { notifyKunjunganConfirmed } from "@/lib/kunjungan-refresh-bus";

const RADIUS_METERS = 100;

// Fallback dipakai HANYA kalau geolocation gagal/ditolak saat masuk mode
// pin-drop (lihat effect di bawah) — bukan lagi nilai yang selalu dipakai
// (final review Finding 4).
const FALLBACK_LAT = -7.8663;
const FALLBACK_LNG = 111.4664;

// Satu slot foto — kamera + preview + tombol ambil ulang, dipakai untuk
// kedua slot (tampak depan & penagihan). `facingMode` sekarang hanya nilai
// AWAL — kalau `allowToggle` true (khusus slot "Tampak Depan", per spec
// Bagian 4: "opsi toggle kamera depan/belakang (untuk selfie)"), slot ini
// punya state lokal sendiri dan menampilkan tombol flip; slot "Penagihan"
// tetap terkunci ke facingMode prop-nya (final review Finding 5).
function PhotoSlot({
  label,
  facingMode,
  allowToggle = false,
  file,
  onCapture,
}: {
  label: string;
  facingMode: "environment" | "user";
  allowToggle?: boolean;
  file: File | null;
  onCapture: (file: File) => void;
}) {
  const [active, setActive] = useState(false);
  const [currentFacingMode, setCurrentFacingMode] = useState(facingMode);
  const { videoRef, error, capturing, retry, handleCapture } = useWatermarkCameraCapture({
    label,
    active,
    facingMode: currentFacingMode,
    onCapture: (result) => {
      onCapture(result.file);
      setActive(false);
    },
  });
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  function toggleFacingMode() {
    setCurrentFacingMode((prev) => (prev === "user" ? "environment" : "user"));
  }

  const flipButton = allowToggle && (
    <Button
      type="button"
      size="icon"
      variant="secondary"
      className="absolute top-2 right-2 size-8"
      onClick={toggleFacingMode}
      title="Ganti kamera depan/belakang"
    >
      <SwitchCamera className="size-3.5" />
    </Button>
  );

  // aspect-square (bukan h-40/h-24 tetap) -- supaya kedua slot foto bisa
  // berdampingan 1:1 dalam grid 2 kolom, sesuai permintaan user 2026-09-23.
  if (file && previewUrl) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">{label}</Label>
        <div className="relative aspect-square w-full">
          <img src={previewUrl} alt={label} className="size-full rounded-md object-cover" />
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
          <div className="relative aspect-square w-full overflow-hidden rounded-md bg-black">
            <video ref={videoRef} autoPlay playsInline muted className="size-full object-cover" />
            {flipButton}
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
        // Button shadcn punya tinggi bawaan sendiri (mis. h-9) yang menimpa
        // aspect-square kalau ditaruh langsung di elemen Button -- dibungkus
        // div aspect-square dulu, Button diisi penuh lewat absolute inset-0,
        // pola sama seperti pratinjau foto/video di bawah.
        <div className="relative aspect-square w-full">
          <Button
            type="button"
            variant="outline"
            className="absolute inset-0"
            onClick={() => setActive(true)}
            title="Ambil Foto"
          >
            <Camera className="size-5 text-muted-foreground" />
          </Button>
        </div>
      ) : (
        <div className="relative aspect-square w-full overflow-hidden rounded-md bg-black">
          <video ref={videoRef} autoPlay playsInline muted className="size-full object-cover" />
          {flipButton}
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

// Ganti "Pilih Mitra" (dropdown Select biasa) -- input ketik untuk cari +
// daftar hasil (Nama, Wilayah, Kecamatan), begitu dipilih berubah jadi
// kotak panel detail mitra dengan tombol "Ganti" untuk kembali cari.
// Sesuai permintaan user 2026-09-23.
function MitraSelector({
  mitraOptions,
  selectedMitra,
  onSelect,
  onChangeMitra,
}: {
  mitraOptions: MitraRow[] | null;
  selectedMitra: MitraRow | null;
  onSelect: (id: string) => void;
  onChangeMitra: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = mitraOptions ?? [];
    if (!q) return list;
    return list.filter((m) => m.Name.toLowerCase().includes(q));
  }, [mitraOptions, query]);

  if (selectedMitra) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Mitra</Label>
        <div className="rounded-md border border-border p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium">{selectedMitra.Name}</p>
              <p className="text-xs text-muted-foreground">
                {selectedMitra.Wilayah}
                {selectedMitra.Kecamatan ? ` · ${selectedMitra.Kecamatan}` : ""}
              </p>
              {selectedMitra.Alamat && <p className="mt-1 text-xs text-muted-foreground">{selectedMitra.Alamat}</p>}
            </div>
            <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={onChangeMitra}>
              Ganti
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="mitra-search" className="text-xs">
        Pilih Mitra
      </Label>
      <div className="relative">
        <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="mitra-search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Ketik nama mitra..."
          className="pl-8"
        />
      </div>
      {open && (
        <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-card shadow-md">
          {mitraOptions == null ? (
            <p className="p-3 text-center text-xs text-muted-foreground">Memuat mitra...</p>
          ) : filtered.length === 0 ? (
            <p className="p-3 text-center text-xs text-muted-foreground">Tidak ada mitra ditemukan.</p>
          ) : (
            filtered.map((m) => (
              <button
                key={m.BusinessPartnerID}
                type="button"
                // onMouseDown (bukan onClick) supaya event ini terpicu SEBELUM
                // onBlur input menutup daftar -- kalau pakai onClick, blur
                // duluan menutup daftar dan klik kehilangan targetnya.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(m.BusinessPartnerID);
                  setQuery("");
                  setOpen(false);
                }}
                className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <span className="font-medium">{m.Name}</span>
                <span className="text-xs text-muted-foreground">
                  {m.Wilayah}
                  {m.Kecamatan ? ` · ${m.Kecamatan}` : ""}
                </span>
              </button>
            ))
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
  const [savedPin, setSavedPin] = useState<{ lat: number; lng: number } | null>(null);
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
  // Posisi awal peta pin-drop — GPS marketing saat itu (spec Bagian 3 poin
  // 3), diisi lewat navigator.geolocation SEKALI (single-shot, bukan
  // watchPosition — Global Constraint GPS di feature ini) waktu masuk mode
  // pin-drop; FALLBACK_LAT/LNG cuma dipakai kalau geolocation gagal/ditolak
  // (final review Finding 4).
  const [pinInitialPos, setPinInitialPos] = useState<{ lat: number; lng: number }>({ lat: FALLBACK_LAT, lng: FALLBACK_LNG });
  const pinGeoRequestedRef = useRef(false);

  function resetState() {
    setSelectedId(null);
    setPinDraft(null);
    setSavedPin(null);
    setMarketingPosition(null);
    setRouteInfo(null);
    setRouteError(null);
    setFotoDepan(null);
    setFotoPenagihan(null);
    setHasilKunjungan("");
    setConfirmError(null);
    setPinInitialPos({ lat: FALLBACK_LAT, lng: FALLBACK_LNG });
    pinGeoRequestedRef.current = false;
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
  // sudah ada, atau dari pin yang BERHASIL disimpan sesi ini (savedPin;
  // belum refresh mitraOptions). pinDraft TIDAK ikut di sini — itu cuma
  // posisi pin yang sedang digeser user di peta pin-drop, belum tersimpan.
  const mitraLat = savedPin?.lat ?? selectedMitra?.Latitude ?? null;
  const mitraLng = savedPin?.lng ?? selectedMitra?.Longitude ?? null;
  const needsPin = selectedMitra != null && selectedMitra.Latitude == null && savedPin == null;

  const distanceMeters =
    mitraLat != null && mitraLng != null && marketingPosition
      ? haversineKm({ lat: mitraLat, lng: mitraLng }, { lat: marketingPosition[0], lng: marketingPosition[1] }) * 1000
      : null;
  const withinRadius = distanceMeters != null && distanceMeters <= RADIUS_METERS;

  function handleSelectMitra(id: string) {
    setSelectedId(id);
    setPinDraft(null);
    setSavedPin(null);
    setMarketingPosition(null);
    setRouteInfo(null);
    setRouteError(null);
    setFotoDepan(null);
    setFotoPenagihan(null);
    setHasilKunjungan("");
    setConfirmError(null);
    setPinInitialPos({ lat: FALLBACK_LAT, lng: FALLBACK_LNG });
    pinGeoRequestedRef.current = false;
  }

  // Tombol "Ganti" di kotak panel Mitra-Selector -- sama seperti
  // handleSelectMitra tapi mengosongkan pilihan (kembali ke input cari).
  function handleChangeMitra() {
    setSelectedId(null);
    setPinDraft(null);
    setSavedPin(null);
    setMarketingPosition(null);
    setRouteInfo(null);
    setRouteError(null);
    setFotoDepan(null);
    setFotoPenagihan(null);
    setHasilKunjungan("");
    setConfirmError(null);
    setPinInitialPos({ lat: FALLBACK_LAT, lng: FALLBACK_LNG });
    pinGeoRequestedRef.current = false;
  }

  // Sekali per mitra terpilih yang butuh pin-drop: minta GPS marketing saat
  // ini untuk jadi posisi awal peta (bukan koordinat statis) — lihat
  // pinInitialPos di atas. Guard pinGeoRequestedRef mencegah permintaan
  // berulang tiap re-render selama pinDraft masih null.
  useEffect(() => {
    if (!needsPin || pinDraft || pinGeoRequestedRef.current) return;
    pinGeoRequestedRef.current = true;
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setPinInitialPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {
        // Gagal/ditolak — tetap pakai FALLBACK_LAT/LNG yang sudah jadi
        // default state, tidak perlu diapa-apakan lagi di sini.
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [needsPin, pinDraft]);

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
      // savedPin diset SETELAH sukses tersimpan di server — ini yang bikin
      // needsPin jadi false dan mitraLat/Lng ikut pin ini, tanpa perlu
      // refetch getKunjunganMitraOptionsAction.
      setSavedPin(pinDraft);
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
        // dateISO TIDAK dikirim lagi dari sini — dihitung server-side di
        // confirmKunjunganAction lewat getBusinessDateISO() (WIB-aware),
        // bukan dari jam device client (final review Finding 3).
        const result = await confirmKunjunganAction({
          businessPartnerId: selectedMitra.BusinessPartnerID,
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
        // Beritahu Beranda/Kinerja Marketing (mounted sebagai sibling di tab
        // shell, tetap hidup lewat pola keep-alive) supaya refetch data
        // mereka sendiri — lihat kunjungan-refresh-bus.ts (final review
        // Finding 2).
        notifyKunjunganConfirmed();
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
        // fixed (bukan absolute) inset-0 -- supaya sheet ini menutupi
        // navbar atas (header shell) DAN navbar bawah (bottom nav), bukan
        // cuma area tengah antara keduanya. z-50 di atas header shell
        // (z-20) dan tombol trigger (z-30). Sesuai permintaan user 2026-09-23.
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="font-display text-base font-semibold">Tambah Kunjungan</h2>
            <button type="button" onClick={() => handleOpenChange(false)}>
              <X className="size-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex flex-col gap-4">
              <MitraSelector
                mitraOptions={mitraOptions}
                selectedMitra={selectedMitra}
                onSelect={handleSelectMitra}
                onChangeMitra={handleChangeMitra}
              />

              {needsPin && !pinDraft && (
                <div className="flex flex-col gap-2">
                  <p className="flex items-center gap-1.5 text-xs text-warning">
                    <MapPin className="size-3.5" /> Mitra ini belum punya lokasi tersimpan. Tandai lokasi di peta:
                  </p>
                  <MitraLocationMap
                    latitude={pinInitialPos.lat}
                    longitude={pinInitialPos.lng}
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
                      {/* Grid 2 kolom + aspect-square di PhotoSlot -- kedua
                          foto berdampingan 1:1, label dipersingkat sesuai
                          permintaan user 2026-09-23. */}
                      <div className="grid grid-cols-2 gap-3">
                        <PhotoSlot label="Foto Lokasi" facingMode="user" allowToggle file={fotoDepan} onCapture={setFotoDepan} />
                        <PhotoSlot label="Foto Hasil" facingMode="environment" file={fotoPenagihan} onCapture={setFotoPenagihan} />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <Label className="text-xs">Hasil Kunjungan</Label>
                        <Textarea
                          value={hasilKunjungan}
                          onChange={(e) => setHasilKunjungan(e.target.value)}
                          rows={4}
                          placeholder="Catat hasil kunjungan ke mitra ini..."
                          className="resize-none"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Footer di luar area scroll (bukan class `sticky`) -- flex child
              sesudah area overflow-y-auto di atas, sehingga selalu menempel
              di bawah tanpa ikut ter-scroll, sesuai permintaan user
              2026-09-23. */}
          {withinRadius && (
            <div className="flex flex-col gap-2 border-t bg-background p-4">
              {confirmError && <p className="text-xs text-destructive">{confirmError}</p>}
              <Button type="button" disabled={!canConfirm || pending} onClick={handleConfirm} className="w-full gap-1.5">
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                Konfirmasi Kunjungan
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
