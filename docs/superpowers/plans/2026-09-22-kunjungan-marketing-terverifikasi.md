# Kunjungan Marketing Terverifikasi (GPS + Foto) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Marketing dapat mengonfirmasi kunjungan lapangan ke mitra dengan bukti GPS (radius 100m) + 2 foto, memicu ikon centang terverifikasi yang berbeda dari catatan teks biasa, terlihat di grid Kinerja Marketing (desktop + mobile) dan panel Piutang Tertinggi.

**Architecture:** Perluasan tabel `DashboardMarketingVisitLog` yang sudah ada (6 kolom baru) — bukan tabel/sistem baru. Flow "Tambah Kunjungan" adalah komponen client baru yang mengorkestrasi komponen-komponen yang sudah ada (`MitraLocationMap`, `useWatermarkCameraCapture`, `getRoute` OSRM) plus 1 komponen peta baru (mitra pin + marketing pin + garis rute). Validasi jarak 100m dihitung client-side (UX) dan diulang server-side (keamanan) dengan `haversineKm` yang sama.

**Tech Stack:** Next.js 16 App Router, Server Actions, MSSQL (`mssql`/`sql` via `getPool()`), Leaflet/react-leaflet, OSRM self-hosted, Google Drive upload (`uploadFile`), `navigator.geolocation`/`getUserMedia`.

**Spec:** [docs/superpowers/specs/2026-09-22-kunjungan-marketing-terverifikasi-design.md](../specs/2026-09-22-kunjungan-marketing-terverifikasi-design.md)

## Status (2026-09-22)

Task 1-5 sudah SELESAI dan sudah di-commit langsung ke `main` (lihat `.superpowers/sdd/2026-09-22-kunjungan-marketing-terverifikasi/progress.md` untuk ledger lengkap — commit `d1a3828`, `0dfe2f4`, `a6ca9b1`, `1b5a74b`, `1e1f25e`). Task 6, 7, 8 dan review akhir whole-branch BELUM dikerjakan — lanjutkan dari Task 6 memakai Subagent-Driven Development di sesi berikutnya.

## Global Constraints

- Semua UI dan pesan berbahasa Indonesia.
- Perluasan tabel `DashboardMarketingVisitLog` yang sudah ada, bukan tabel baru — model 1-baris-per-(mitra,tanggal) dipertahankan.
- `IsTerverifikasi` HANYA pernah diset oleh alur "Tambah Kunjungan" baru — `saveMarketingVisitLog` (jalur teks manual lama) TIDAK PERNAH disentuh/diubah untuk menyertakan kolom baru.
- Validasi jarak 100 meter WAJIB diulang di server saat konfirmasi (tidak boleh hanya percaya client).
- Kedua foto (tampak depan, hasil penagihan/penawaran) WAJIB diisi sebelum "Konfirmasi Kunjungan" bisa ditekan.
- Mitra tanpa lokasi tersimpan WAJIB melalui alur pin-lokasi dulu (`MitraLocationMap` + `setMitraLocationAction`, keduanya sudah ada) sebelum bisa lanjut ke validasi jarak.
- GPS marketing diambil manual (tombol, `getCurrentPosition` sekali-tembak) — bukan `watchPosition`.
- "Generate Rute" memakai OSRM lewat API route Next.js — tidak pernah dipanggil langsung dari client component.
- Foto disimpan ke Google Drive lewat `uploadFile()` — validasi MIME (`image/jpeg|png|webp`) + batas 5MB, pola identik Satpam Patroli/Produksi Kualitas.
- Tidak ada framework migrasi — perubahan skema lewat script `scripts/_scratch_*.ts` sekali jalan, dihapus setelah dipakai.
- Tidak ada test suite otomatis — verifikasi via `npx tsc --noEmit`, `npx eslint <file>`, skrip scratch DB live, dan uji browser.
- Field/kolom existing (`HasilKunjungan`, dot/tint penanda catatan, upsert MERGE) tidak diubah perilakunya — hanya diperluas.

## Review Focus

- **Mitra tanpa `DashboardMitraLocation`** (banyak mitra lama tidak punya lat/lng tersimpan — `MitraRow.Latitude` null): alur harus masuk mode pin-drop, bukan crash/NaN saat menghitung jarak.
- **Percobaan memalsukan koordinat dari DevTools** (mengirim `confirmKunjunganAction` dengan lat/lng jauh dari mitra tapi lolos validasi client): server WAJIB menghitung ulang `haversineKm` dari koordinat yang dikirim vs `DashboardMitraLocation` mitra tsb dan menolak jika >100m, terlepas dari apa pun yang dikirim client.
- **Edit teks manual di tanggal yang sudah terverifikasi** (desktop `saveMarketingVisitLogAction`/mobile `saveVisitLogAction` dipanggil untuk (mitra,tanggal) yang `IsTerverifikasi=1`): foto/GPS/status centang tidak boleh hilang — hanya `HasilKunjungan` yang berubah, `saveMarketingVisitLog`'s MERGE tidak boleh menyentuh kolom baru.
- **`VerifiedAt` ditampilkan dengan formatter WIB yang salah**: `VerifiedAt` diisi via `GETDATE()` (server MSSQL, sudah dikonfirmasi berjalan UTC asli — lihat precedent `DipostingPada`), jadi harus dirender dengan `formatDate`/`formatTime` biasa (BUKAN `formatDateWib`/`formatTimeWib`) di semua komponen client.
- **Ikon centang bocor ke tanggal/mitra yang salah**: `mitraTerverifikasiByDay` di `marketing-performance.ts` harus di-index persis sama dengan `mitraDailyQty` (dayIndex dari `rangeStart`), dan dot/tint lama (`hasEntry`/`hasLog`) tidak boleh berubah kondisinya — keduanya independen.

---

### Task 1: Skema database + perluasan query layer — SELESAI (commit d1a3828)

Lihat `.superpowers/sdd/2026-09-22-kunjungan-marketing-terverifikasi/progress.md` untuk detail review. Ringkasan: 6 kolom baru di `DashboardMarketingVisitLog` (`FotoTampakDepanPath`, `FotoPenagihanPath`, `Latitude`, `Longitude`, `IsTerverifikasi`, `VerifiedAt`), `MarketingVisitLogEntry` diperluas, `saveVerifiedKunjungan`/`getVisitLogHistoryForMitra`/`getLatestVisitLogSnippets` ditambahkan di `src/lib/queries/marketing-visit-log.ts`, `saveMarketingVisitLog` TIDAK diubah.

### Task 2: Ikon centang di grid Kinerja Marketing — Desktop — SELESAI (commit 0dfe2f4)

`marketing-performance.ts`'s `getMarketingPerformance()` menghasilkan `mitraTerverifikasiByDay: Record<string, boolean[]>` baru (index sama dengan `mitraDailyQty`). `MitraDayCell`/`MitraPrioritasRow`/`AllMitraRow`/`MarketingCard`/`MarketingPerformancePanel` di `marketing-performance-panel.tsx` semuanya diperluas untuk mengalirkan `isTerverifikasi`/`terverifikasiByDay` dan menampilkan ikon `CheckCircle2` independen dari dot lama.

### Task 3: Ikon centang di grid Kinerja Marketing — Mobile — SELESAI (commit a6ca9b1)

`getKinerjaMarketingAction()` di `pemasaran-app/actions.ts` menyertakan `mitraTerverifikasiByDay` yang sudah dinarrow ke roster milik marketing yang login. `DayBox`/`RosterCard` di `kinerja-marketing-sub-tab.tsx` menampilkan ikon centang yang sama, independen dari tint `hasEntry` lama.

### Task 4: Kamera front/back toggle + API route upload foto kunjungan — SELESAI (commit 1b5a74b)

`use-watermark-camera-capture.ts`'s `facingMode` jadi parameter opsional (default `"environment"`, backward-compatible untuk Satpam Patroli/Tamu). Route baru `src/app/api/mkesindo/upload/marketing-kunjungan/route.ts` (pola sama `produksi-kualitas/route.ts`, plus field `businessPartnerId`/`slot`).

### Task 5: Komponen peta Kunjungan + API route OSRM — SELESAI (commit 1e1f25e)

Route baru `src/app/api/mkesindo/routing/kunjungan/route.ts` (origin dinamis dari GPS marketing, bukan Pabrik seperti `routing/route.ts` yang sudah ada). Komponen baru `src/components/pemasaran-app/kunjungan-route-map.tsx` (`KunjunganRouteMap`) — pin mitra tetap + pin marketing (GPS sekali-tembak) + garis putus-putus + tombol Generate Rute + overlay jarak/durasi. Belum dipakai di mana pun sampai Task 7.

---

### Task 6: Server actions alur "Tambah Kunjungan" (dropdown, konfirmasi, validasi jarak server)

**Files:**
- Modify: `src/app/mkesindo/pemasaran-app/actions.ts`

**Interfaces:**
- Consumes: `getMitraList` (sudah ada, sudah menyertakan `Latitude`/`Longitude`/`GeoAlamat`), `getMitraLocation` dari `@/lib/queries/mitra-location` (sudah ada), `saveVerifiedKunjungan` (Task 1), `haversineKm`/`LatLng` dari `@/lib/route-estimate` (sudah ada).
- Produces:
  - `getKunjunganMitraOptionsAction(): Promise<ActionResult<MitraRow[]>>` — sumber dropdown Tambah Kunjungan (mitra milik marketing yang login, apa adanya termasuk lat/lng-nya). Dipakai Task 7.
  - `confirmKunjunganAction(input): Promise<ActionResult<void>>` — validasi ulang jarak 100m di server, lalu memanggil `saveVerifiedKunjungan`. Dipakai Task 7.

- [ ] **Step 1: Tambah import baru**

At the top of `src/app/mkesindo/pemasaran-app/actions.ts`, add:

```typescript
import { saveVerifiedKunjungan, getVisitLogHistoryForMitra, getLatestVisitLogSnippets } from "@/lib/queries/marketing-visit-log";
import { getMitraLocation } from "@/lib/queries/mitra-location";
import { haversineKm } from "@/lib/route-estimate";
```

(`getVisitLogHistoryForMitra`/`getLatestVisitLogSnippets` are wired into their own actions in Task 8 — importing them here now keeps this task's diff self-contained per file, but if the SDD tool prefers, these two imports may instead be added directly in Task 8's step; either placement is correct since both land in the same file.)

- [ ] **Step 2: Tambah `getKunjunganMitraOptionsAction`**

```typescript
// Sumber dropdown "Tambah Kunjungan" — mitra milik marketing yang login,
// apa adanya (termasuk Latitude/Longitude/GeoAlamat kalau sudah pernah
// dipin) — reuse getMitraList() yang sudah JOIN DashboardMitraLocation,
// tidak perlu query baru.
export async function getKunjunganMitraOptionsAction(): Promise<ActionResult<MitraRow[]>> {
  return runAction(async () => {
    const session = await requireMarketing();
    const all = await getMitraList();
    return ownMitra(all, session.user.name ?? session.user.username);
  });
}
```

- [ ] **Step 3: Tambah `confirmKunjunganAction` dengan validasi jarak server**

```typescript
const KUNJUNGAN_RADIUS_METERS = 100;

export async function confirmKunjunganAction(input: {
  businessPartnerId: string;
  dateISO: string;
  hasilKunjungan: string;
  fotoTampakDepanPath: string;
  fotoPenagihanPath: string;
  latitude: number;
  longitude: number;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireMarketing();
    // Ownership check sama seperti saveVisitLogAction — mencegah konfirmasi
    // kunjungan ke mitra di luar cakupan marketing yang login.
    const roster = await getVisitLogStatusForMarketing(session.user.id, input.dateISO);
    if (!roster.some((r) => r.BusinessPartnerID === input.businessPartnerId)) {
      throw new AppError("Anda tidak memiliki akses ke mitra ini.");
    }

    const mitraLocation = await getMitraLocation(input.businessPartnerId);
    if (!mitraLocation) {
      throw new AppError("Lokasi mitra belum tersimpan. Silakan pin lokasi mitra terlebih dahulu.");
    }

    // Validasi jarak DIULANG di server — tidak boleh hanya percaya validasi
    // sisi client, mencegah manipulasi koordinat lewat DevTools (Review
    // Focus plan ini).
    const distanceKm = haversineKm(
      { lat: mitraLocation.Latitude, lng: mitraLocation.Longitude },
      { lat: input.latitude, lng: input.longitude }
    );
    if (distanceKm * 1000 > KUNJUNGAN_RADIUS_METERS) {
      throw new AppError(
        `Anda berada ${Math.round(distanceKm * 1000)}m dari lokasi mitra — kunjungan hanya bisa dikonfirmasi dalam radius ${KUNJUNGAN_RADIUS_METERS}m.`
      );
    }

    await saveVerifiedKunjungan({
      businessPartnerId: input.businessPartnerId,
      dateISO: input.dateISO,
      hasilKunjungan: input.hasilKunjungan,
      fotoTampakDepanPath: input.fotoTampakDepanPath,
      fotoPenagihanPath: input.fotoPenagihanPath,
      latitude: input.latitude,
      longitude: input.longitude,
      userId: session.user.id,
    });
  });
}
```

- [ ] **Step 4: Verifikasi tipe & lint**

Run: `npx tsc --noEmit && npx eslint src/app/mkesindo/pemasaran-app/actions.ts`
Expected: tidak ada error baru. (`getVisitLogHistoryForMitra`/`getLatestVisitLogSnippets` imported but unused until Task 8 will trigger an eslint unused-import warning — if Task 8 runs immediately after in the same SDD session this is transient; if this task is reviewed standalone, move those two imports to Task 8's step instead to keep this commit lint-clean.)

- [ ] **Step 5: Uji browser (test manual dengan koordinat palsu)**

Belum ada UI untuk memanggil `confirmKunjunganAction` sampai Task 7 — verifikasi logic jarak lewat unit-level manual check: panggil `haversineKm` langsung di scratch script sementara dengan koordinat mitra sungguhan dan koordinat >100m untuk memastikan hasil km-nya sesuai ekspektasi (dihapus setelah dicek, tidak dicommit).

- [ ] **Step 6: Commit**

```bash
git add src/app/mkesindo/pemasaran-app/actions.ts
git commit -m "feat: tambah server actions dropdown mitra + konfirmasi kunjungan dengan validasi jarak server"
```

---

### Task 7: Floating button "Tambah Kunjungan" + alur lengkap

**Files:**
- Modify: `src/components/pemasaran-app/pemasaran-app-tab-shell.tsx`
- Create: `src/components/pemasaran-app/tambah-kunjungan-sheet.tsx`

**Interfaces:**
- Consumes: `getKunjunganMitraOptionsAction`, `confirmKunjunganAction` (Task 6), `setMitraLocationAction` (sudah ada), `KunjunganRouteMap` (Task 5), `MitraLocationMap` (sudah ada, untuk mode pin-drop), `useWatermarkCameraCapture` dengan `facingMode` (Task 4), `POST /api/mkesindo/upload/marketing-kunjungan` (Task 4), `GET /api/mkesindo/routing/kunjungan` (Task 5), `haversineKm` dari `@/lib/route-estimate` (client-side gate).
- Produces: `<TambahKunjunganSheet />` — dirender sekali di `PemasaranAppTabShell` sehingga persisten di semua tab.

- [ ] **Step 1: Render floating button + sheet di tab shell**

In `src/components/pemasaran-app/pemasaran-app-tab-shell.tsx`, add the import and render `<TambahKunjunganSheet />` inside the `relative min-h-0 flex-1` wrapper (so it stays fixed across every tab, per Bagian 3 of the spec — "persisten di level shell marketing-app"):

```typescript
import { TambahKunjunganSheet } from "@/components/pemasaran-app/tambah-kunjungan-sheet";
```

```tsx
      <div className="relative min-h-0 flex-1">
        {visited.has("beranda") && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "beranda" && "hidden")}>{beranda}</div>
        )}
        {visited.has("mitra") && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "mitra" && "hidden")}>{mitra}</div>
        )}
        {visited.has("pemasaran") && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "pemasaran" && "hidden")}>{pemasaran}</div>
        )}
        <TambahKunjunganSheet />
      </div>
```

- [ ] **Step 2: Buat `TambahKunjunganSheet`**

```tsx
// src/components/pemasaran-app/tambah-kunjungan-sheet.tsx
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
```

- [ ] **Step 3: Verifikasi tipe & lint**

Run: `npx tsc --noEmit && npx eslint src/components/pemasaran-app/pemasaran-app-tab-shell.tsx src/components/pemasaran-app/tambah-kunjungan-sheet.tsx`
Expected: tidak ada error baru.

- [ ] **Step 4: Uji browser end-to-end**

Buka `/mkesindo/pemasaran-app` sebagai akun Marketing sungguhan. Klik "Tambah Kunjungan", pilih mitra dari dropdown:
- Kalau mitra belum punya lokasi: pastikan peta pin-drop muncul, geser pin, klik "Konfirmasi Lokasi Mitra", pastikan lanjut ke peta rute.
- Kalau mitra sudah punya lokasi: pastikan peta rute langsung muncul.
- Klik tombol GPS (izinkan lokasi browser) — pastikan pin biru marketing muncul dan jarak terhitung.
- Kalau berada >100m dari mitra: pastikan bagian foto+teks TIDAK muncul, pesan jarak tampil.
- Kalau perlu, uji dengan koordinat manual dekat mitra (mis. mock geolocation di DevTools) untuk lolos radius — ambil 2 foto, isi teks, klik "Konfirmasi Kunjungan", pastikan sukses dan sheet tertutup.
- Setelah konfirmasi, buka kembali grid Kinerja Marketing (Task 2/3) dan pastikan ikon centang muncul di tanggal hari ini untuk mitra tsb.

- [ ] **Step 5: Commit**

```bash
git add src/components/pemasaran-app/pemasaran-app-tab-shell.tsx src/components/pemasaran-app/tambah-kunjungan-sheet.tsx
git commit -m "feat: tambah floating button dan alur lengkap Tambah Kunjungan (GPS+foto+konfirmasi)"
```

---

### Task 8: Panel Piutang Tertinggi — cuplikan terbaru & riwayat kunjungan

**Files:**
- Modify: `src/app/mkesindo/pemasaran-app/actions.ts`
- Modify: `src/components/pemasaran-app/beranda-tab.tsx`
- Create: `src/components/pemasaran-app/riwayat-kunjungan-dialog.tsx`

**Interfaces:**
- Consumes: `getLatestVisitLogSnippets`, `getVisitLogHistoryForMitra` (Task 1), `getAkunNamaMap` dari `@/lib/queries/akun` (sudah ada), `formatDate`/`formatTime` dari `@/lib/format` (untuk `VerifiedAt`, BUKAN varian Wib — lihat Review Focus), `FotoThumbnail` dari `@/components/produksi/foto-thumbnail` (sudah ada).
- Produces:
  - `getBerandaDataAction`'s return type gains a `latestKunjungan` per row (returned as a plain array field, not a `Map` — see Step 1 for the exact shape).
  - `getVisitLogHistoryForMitraAction(businessPartnerId): Promise<ActionResult<Array<MarketingVisitLogEntry & { dicatatOlehNama: string }>>>`.
  - `<RiwayatKunjunganDialog businessPartnerId={string|null} mitraName={string} onOpenChange={(open)=>void} />`.

- [ ] **Step 1: Perluas `getBerandaDataAction` dengan cuplikan terbaru**

In `src/app/mkesindo/pemasaran-app/actions.ts`, add the imports (if not already added in Task 6's Step 1):

```typescript
import { getLatestVisitLogSnippets, getVisitLogHistoryForMitra } from "@/lib/queries/marketing-visit-log";
import { getAkunNamaMap } from "@/lib/queries/akun";
```

Replace `getBerandaDataAction` to also attach each row's latest snippet:

```typescript
export type TopMitraPiutangRowWithKunjungan = TopMitraPiutangRow & {
  LatestKunjunganText: string | null;
  LatestKunjunganDate: string | null;
};

export async function getBerandaDataAction(): Promise<
  ActionResult<{ sales: SalesDayComparisonResult; topPiutang: TopMitraPiutangRowWithKunjungan[] }>
> {
  return runAction(async () => {
    const session = await requireMarketing();
    const marketingName = session.user.name ?? session.user.username;
    const [sales, allPiutang, ownMitraList] = await Promise.all([
      getSalesDayComparisonForMarketing(session.user.id),
      getTopMitraPiutang(),
      getMitraList(),
    ]);
    const ownIds = new Set(ownMitra(ownMitraList, marketingName).map((m) => m.BusinessPartnerID));
    const ownPiutang = allPiutang.filter((r) => ownIds.has(r.BusinessPartnerID));
    const snippets = await getLatestVisitLogSnippets(ownPiutang.map((r) => r.BusinessPartnerID));
    const topPiutang: TopMitraPiutangRowWithKunjungan[] = ownPiutang.map((r) => {
      const snippet = snippets.get(r.BusinessPartnerID);
      return { ...r, LatestKunjunganText: snippet?.hasilKunjungan ?? null, LatestKunjunganDate: snippet?.logDate ?? null };
    });
    return { sales, topPiutang };
  });
}
```

- [ ] **Step 2: Tambah `getVisitLogHistoryForMitraAction`**

```typescript
export type VisitLogHistoryEntry = MarketingVisitLogEntry & { dicatatOlehNama: string };

export async function getVisitLogHistoryForMitraAction(businessPartnerId: string): Promise<ActionResult<VisitLogHistoryEntry[]>> {
  return runAction(async () => {
    const session = await requireMarketing();
    // Ownership check sama seperti getVisitLogDetailAction — hanya boleh
    // lihat riwayat mitra milik sendiri.
    const roster = await getVisitLogStatusForMarketing(session.user.id, new Date().toISOString().slice(0, 10));
    if (!roster.some((r) => r.BusinessPartnerID === businessPartnerId)) {
      throw new AppError("Anda tidak memiliki akses ke mitra ini.");
    }
    const history = await getVisitLogHistoryForMitra(businessPartnerId);
    // CreatedByUserID -> nama akun, resolusi lintas-DB (Postgres akun,
    // bukan MSSQL) — pola identik produksi-riwayat-detail.ts.
    const akunIds = [...new Set(history.map((h) => Number(h.CreatedByUserID)))].filter((id) => !Number.isNaN(id));
    const namaMap = await getAkunNamaMap(akunIds);
    return history.map((h) => ({ ...h, dicatatOlehNama: namaMap.get(Number(h.CreatedByUserID)) ?? "Tidak diketahui" }));
  });
}
```

Add `MarketingVisitLogEntry` to the existing named import from `@/lib/queries/marketing-visit-log` at the top of the file (it's already imported for `getMarketingVisitLogForDate`/`saveMarketingVisitLog` — extend that import line to include the type):

```typescript
import {
  getMarketingVisitLogForDate,
  saveMarketingVisitLog,
  getLatestVisitLogSnippets,
  getVisitLogHistoryForMitra,
  type MarketingVisitLogEntry,
} from "@/lib/queries/marketing-visit-log";
```

- [ ] **Step 3: Buat `RiwayatKunjunganDialog`**

```tsx
// src/components/pemasaran-app/riwayat-kunjungan-dialog.tsx
"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FotoThumbnail } from "@/components/produksi/foto-thumbnail";
import { formatDate, formatTime } from "@/lib/format";
import { getVisitLogHistoryForMitraAction, type VisitLogHistoryEntry } from "@/app/mkesindo/pemasaran-app/actions";

function formatDateLong(dateISO: string): string {
  return `${dateISO.slice(8, 10)}/${dateISO.slice(5, 7)}/${dateISO.slice(0, 4)}`;
}

export function RiwayatKunjunganDialog({
  businessPartnerId,
  mitraName,
  onOpenChange,
}: {
  businessPartnerId: string | null;
  mitraName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const [entries, setEntries] = useState<VisitLogHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessPartnerId) {
      setEntries(null);
      setError(null);
      return;
    }
    let cancelled = false;
    getVisitLogHistoryForMitraAction(businessPartnerId).then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setError(result.error);
        return;
      }
      setEntries(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [businessPartnerId]);

  return (
    <Dialog open={businessPartnerId != null} onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Riwayat Kunjungan — {mitraName}</DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : !entries ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Memuat...
          </div>
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Belum ada riwayat kunjungan.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {entries.map((e) => (
              <div key={e.LogID} className="rounded-md border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{formatDateLong(e.LogDate)}</p>
                  {e.IsTerverifikasi && (
                    <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                      <CheckCircle2 className="size-3" /> Terverifikasi
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground">{e.HasilKunjungan}</p>
                {e.IsTerverifikasi && (e.FotoTampakDepanPath || e.FotoPenagihanPath) && (
                  <div className="mt-2 flex gap-2">
                    <FotoThumbnail path={e.FotoTampakDepanPath} alt="Tampak depan" size={64} />
                    <FotoThumbnail path={e.FotoPenagihanPath} alt="Penagihan/penawaran" size={64} />
                  </div>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Dicatat oleh: {e.dicatatOlehNama}
                  {e.IsTerverifikasi && e.VerifiedAt ? ` · Diverifikasi ${formatDate(e.VerifiedAt)} ${formatTime(e.VerifiedAt)}` : ""}
                </p>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Tambah baris cuplikan + trigger riwayat di `beranda-tab.tsx`**

In `src/components/pemasaran-app/beranda-tab.tsx`, add the imports:

```typescript
import { MessageSquareText } from "lucide-react";
import { RiwayatKunjunganDialog } from "@/components/pemasaran-app/riwayat-kunjungan-dialog";
import type { TopMitraPiutangRowWithKunjungan } from "@/app/mkesindo/pemasaran-app/actions";
```

Update the `topPiutang` state type (was `TopMitraPiutangRow[] | null`, now `TopMitraPiutangRowWithKunjungan[] | null`) and add a new piece of state for the riwayat dialog:

```typescript
  const [topPiutang, setTopPiutang] = useState<TopMitraPiutangRowWithKunjungan[] | null>(null);
```

```typescript
  const [riwayatMitra, setRiwayatMitra] = useState<{ businessPartnerId: string; name: string } | null>(null);
```

Add the new snippet row inside the `topPiutang.map(...)` block, right after the existing "Tambah catatan" button:

```tsx
                <button
                  type="button"
                  onClick={() => openNoteEditor(r)}
                  className="mt-1 flex items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-primary"
                >
                  <NotebookPen className="size-3.5 shrink-0" />
                  {r.TargetNote ? <span className="truncate">{r.TargetNote}</span> : <span>Tambah catatan</span>}
                </button>
                {r.LatestKunjunganText && (
                  <button
                    type="button"
                    onClick={() => setRiwayatMitra({ businessPartnerId: r.BusinessPartnerID, name: r.CustomerName })}
                    className="mt-1 flex items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-primary"
                  >
                    <MessageSquareText className="size-3.5 shrink-0" />
                    <span className="truncate">{r.LatestKunjunganText}</span>
                  </button>
                )}
```

Render the dialog at the bottom of the component, alongside the existing note-editor `<Dialog>`:

```tsx
      <RiwayatKunjunganDialog
        businessPartnerId={riwayatMitra?.businessPartnerId ?? null}
        mitraName={riwayatMitra?.name ?? ""}
        onOpenChange={(open) => !open && setRiwayatMitra(null)}
      />
```

- [ ] **Step 5: Verifikasi tipe & lint**

Run: `npx tsc --noEmit && npx eslint src/app/mkesindo/pemasaran-app/actions.ts src/components/pemasaran-app/beranda-tab.tsx src/components/pemasaran-app/riwayat-kunjungan-dialog.tsx`
Expected: tidak ada error baru.

- [ ] **Step 6: Uji browser**

Buka tab Beranda `/mkesindo/pemasaran-app` sebagai marketing yang baru saja mengonfirmasi kunjungan di Task 7 — pastikan baris cuplikan "Hasil Kunjungan" muncul di bawah mitra tersebut di panel Piutang Tertinggi. Klik baris itu, pastikan dialog Riwayat Kunjungan menampilkan entri terbaru, badge "Terverifikasi", 2 thumbnail foto, dan "Dicatat oleh" dengan nama akun yang benar.

- [ ] **Step 7: Commit**

```bash
git add src/app/mkesindo/pemasaran-app/actions.ts src/components/pemasaran-app/beranda-tab.tsx src/components/pemasaran-app/riwayat-kunjungan-dialog.tsx
git commit -m "feat: tampilkan cuplikan hasil kunjungan terbaru + dialog riwayat di panel Piutang Tertinggi"
```
