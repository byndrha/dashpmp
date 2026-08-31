# Ikon Status Upload Foto (Seluruh Sistem) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan ikon status (centang/silang/loading) di pojok kanan-atas setiap foto di 8 titik upload di seluruh dashpmp, tanpa mengubah logika upload/fetch yang sudah ada di masing-masing lokasi.

**Architecture:** Satu komponen tampilan bersama (`PhotoStatusOverlay`) plus satu prop opsional baru di komponen kamera bersama yang sudah ada (`LiveCameraCaptureField`). Keenam alur upload yang sudah ada (Kualitas, Vehicle Check, Bukti Pengiriman, Retur, Tanda Tangan, Armada, Logo Situs, Template Dokumen) masing-masing menambahkan satu variabel/peta status lokal di sekitar kode upload yang sudah ada, lalu meneruskannya ke overlay. Tidak ada hook upload bersama, tidak ada refactor logika fetch.

**Tech Stack:** React (client components), lucide-react (ikon), Tailwind CSS.

**Spec:** [docs/superpowers/specs/2026-08-31-ikon-status-upload-foto-design.md](../specs/2026-08-31-ikon-status-upload-foto-design.md)

## Global Constraints

- **Tidak ada hook upload bersama** — logika fetch/FormData di keenam alur tetap independen; hanya state status + overlay yang ditambahkan.
- **Tidak ada interaksi retry baru** — ikon gagal murni indikator visual, bukan tombol.
- **Tidak ada perubahan validasi file** (tipe/ukuran) — tetap ditangani di masing-masing API route.
- **Ikon**: `CheckCircle2` (berhasil, `text-emerald-600`), `XCircle` (gagal, `text-destructive`), `Loader2` dengan `animate-spin` (sedang mengunggah, `text-muted-foreground`) — semua dari `lucide-react`.
- **Posisi**: chip bulat kecil `bg-background shadow-sm rounded-full`, ukuran chip `size-5` (20px), ikon `size-3.5` (14px) di dalamnya, posisi `absolute -top-1.5 -right-1.5` — meniru posisi tombol hapus (X) yang sudah ada di grid multi-foto driver.
- **Aksesibilitas**: setiap ikon punya `title`/`aria-label`: "Sedang mengunggah" / "Berhasil diunggah" / "Gagal diunggah".
- **Status yang dedicated, bukan reuse state error umum**: kalau sebuah lokasi punya state `error`/`uploadError` yang SUDAH murni untuk foto itu saja (tidak dipakai bareng validasi/submit lain), boleh diturunkan langsung dari situ. Kalau state error-nya dipakai bersama untuk hal lain, WAJIB bikin state status baru yang terpisah.
- **Tidak ada automated test framework di repo ini** — verifikasi tiap task lewat `npx tsc --noEmit`, `npx eslint <file yang disentuh>`, dan cek manual di browser (mode dev, `npm run dev`) untuk memastikan ketiga status (uploading/success/error) benar-benar tampil.

---

### Task 1: Komponen `PhotoStatusOverlay` + prop `status` di `LiveCameraCaptureField`

**Files:**
- Create: `src/components/ui/photo-status-overlay.tsx`
- Modify: `src/components/dashboard/live-camera-capture-field.tsx`

**Interfaces:**
- Produces: `export type PhotoUploadStatus = "uploading" | "success" | "error"` dan `export function PhotoStatusOverlay({ status }: { status?: PhotoUploadStatus })` dari `src/components/ui/photo-status-overlay.tsx` — dipakai oleh SEMUA task berikutnya (2-6).
- Produces: `LiveCameraCaptureField` menerima prop opsional baru `status?: PhotoUploadStatus`, diteruskan langsung ke `PhotoStatusOverlay`.

- [ ] **Step 1: Tulis `src/components/ui/photo-status-overlay.tsx`**

```tsx
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

export type PhotoUploadStatus = "uploading" | "success" | "error";

const STATUS_CONFIG: Record<PhotoUploadStatus, { Icon: typeof CheckCircle2; className: string; label: string }> = {
  uploading: { Icon: Loader2, className: "text-muted-foreground animate-spin", label: "Sedang mengunggah" },
  success: { Icon: CheckCircle2, className: "text-emerald-600", label: "Berhasil diunggah" },
  error: { Icon: XCircle, className: "text-destructive", label: "Gagal diunggah" },
};

// Overlay tampilan murni untuk menandai status upload satu foto — tidak
// melakukan fetch, tidak menyimpan state apa pun sendiri. Parent WAJIB
// punya className="relative" di elemen pembungkus foto agar posisi
// absolut ini benar. Merender null saat status undefined (idle — foto
// belum diambil / belum ada upaya upload).
export function PhotoStatusOverlay({ status }: { status?: PhotoUploadStatus }) {
  if (!status) return null;
  const { Icon, className, label } = STATUS_CONFIG[status];
  return (
    <span
      title={label}
      aria-label={label}
      className="absolute -top-1.5 -right-1.5 z-10 flex size-5 items-center justify-center rounded-full bg-background shadow-sm"
    >
      <Icon className={`size-3.5 ${className}`} />
    </span>
  );
}
```

- [ ] **Step 2: Tambah prop `status` di `src/components/dashboard/live-camera-capture-field.tsx`**

File saat ini persis:

```tsx
"use client";

import { Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useLiveCameraCapture } from "@/hooks/use-live-camera-capture";

export function LiveCameraCaptureField({
  label,
  photoUrl,
  size,
  onCapture,
  onTogglePress,
  active,
  disabled,
}: {
  label: string;
  photoUrl: string | null;
  size: "main" | "toggle";
  onCapture: (file: File) => void;
  onTogglePress?: () => void;
  active: boolean;
  disabled?: boolean;
}) {
  const { videoRef, displayedPhotoUrl, showLive, error, retry, handleTap } = useLiveCameraCapture({
    label,
    photoUrl,
    active: size === "main" && active,
    disabled,
    onCapture,
  });

  function handleAreaClick() {
    if (disabled) return;
    if (size === "toggle") {
      onTogglePress?.();
      return;
    }
    handleTap();
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={handleAreaClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleAreaClick();
        }
      }}
      aria-label={label}
      className={cn(
        "relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border bg-muted/30 text-xs",
        size === "main" ? "h-full w-full" : "h-20 w-20 shrink-0",
        disabled && "pointer-events-none cursor-not-allowed opacity-50"
      )}
    >
      {displayedPhotoUrl != null ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL or uploaded path, not a static build asset
        <img src={displayedPhotoUrl} alt={label} className="h-full w-full object-cover" />
      ) : showLive ? (
        error ? (
          <div className="flex flex-col items-center gap-1 p-2 text-center text-[10px] text-destructive">
            <span>Izin kamera diperlukan untuk mengambil foto.</span>
            <Button
              type="button"
              size="xs"
              variant="outline"
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
        <div className="flex flex-col items-center gap-1 text-muted-foreground">
          <Camera className="size-5" style={{ transform: "rotate(15deg)" }} />
          <span className="px-1 text-center leading-tight">{label}</span>
        </div>
      )}
    </div>
  );
}
```

Ganti jadi:

```tsx
"use client";

import { Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useLiveCameraCapture } from "@/hooks/use-live-camera-capture";
import { PhotoStatusOverlay, type PhotoUploadStatus } from "@/components/ui/photo-status-overlay";

export function LiveCameraCaptureField({
  label,
  photoUrl,
  size,
  onCapture,
  onTogglePress,
  active,
  disabled,
  status,
}: {
  label: string;
  photoUrl: string | null;
  size: "main" | "toggle";
  onCapture: (file: File) => void;
  onTogglePress?: () => void;
  active: boolean;
  disabled?: boolean;
  status?: PhotoUploadStatus;
}) {
  const { videoRef, displayedPhotoUrl, showLive, error, retry, handleTap } = useLiveCameraCapture({
    label,
    photoUrl,
    active: size === "main" && active,
    disabled,
    onCapture,
  });

  function handleAreaClick() {
    if (disabled) return;
    if (size === "toggle") {
      onTogglePress?.();
      return;
    }
    handleTap();
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={handleAreaClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleAreaClick();
        }
      }}
      aria-label={label}
      className={cn(
        "relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border bg-muted/30 text-xs",
        size === "main" ? "h-full w-full" : "h-20 w-20 shrink-0",
        disabled && "pointer-events-none cursor-not-allowed opacity-50"
      )}
    >
      {displayedPhotoUrl != null ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL or uploaded path, not a static build asset
        <img src={displayedPhotoUrl} alt={label} className="h-full w-full object-cover" />
      ) : showLive ? (
        error ? (
          <div className="flex flex-col items-center gap-1 p-2 text-center text-[10px] text-destructive">
            <span>Izin kamera diperlukan untuk mengambil foto.</span>
            <Button
              type="button"
              size="xs"
              variant="outline"
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
        <div className="flex flex-col items-center gap-1 text-muted-foreground">
          <Camera className="size-5" style={{ transform: "rotate(15deg)" }} />
          <span className="px-1 text-center leading-tight">{label}</span>
        </div>
      )}
      <PhotoStatusOverlay status={status} />
    </div>
  );
}
```

(Satu-satunya perubahan: import baru, satu field `status` di props destructure dan tipe, satu baris `<PhotoStatusOverlay status={status} />` sebelum penutup `</div>`. Tidak ada baris lain yang berubah.)

- [ ] **Step 3: Verifikasi build**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/components/ui/photo-status-overlay.tsx src/components/dashboard/live-camera-capture-field.tsx`
Expected: tidak ada error.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/photo-status-overlay.tsx src/components/dashboard/live-camera-capture-field.tsx
git commit -m "feat: add shared PhotoStatusOverlay component"
```

---

### Task 2: Retrofit Kualitas

**Files:**
- Modify: `src/components/produksi-app/kualitas-view.tsx`

**Interfaces:**
- Consumes: `PhotoUploadStatus` (type) dari `src/components/ui/photo-status-overlay.tsx` (Task 1); `LiveCameraCaptureField`'s prop `status` (Task 1).

- [ ] **Step 1: Tambah state `fotoStatus` dan import type**

Tambah import ini di baris import paling atas (setelah baris `import { LiveCameraCaptureField } ...`):

```tsx
import type { PhotoUploadStatus } from "@/components/ui/photo-status-overlay";
```

Di dalam `TambahKualitasDialog`, tambah state baru tepat setelah baris `const [uploading, setUploading] = useState(false);`:

```tsx
  const [fotoStatus, setFotoStatus] = useState<PhotoUploadStatus | undefined>(undefined);
```

- [ ] **Step 2: Set status di `handleCapture` dan `reset`**

Fungsi `reset()` saat ini:

```tsx
  function reset() {
    setTanggalLabel(getBusinessDateISO());
    setWaktu(getWibTimeHHmm());
    setShift("1");
    setMesinId("");
    setChecklist(DEFAULT_CHECKLIST);
    setDiameterDalamMm("");
    setQty10KG("");
    setCatatan("");
    setFotoPath(null);
    setError(null);
  }
```

Ganti jadi (tambah satu baris `setFotoStatus(undefined);`):

```tsx
  function reset() {
    setTanggalLabel(getBusinessDateISO());
    setWaktu(getWibTimeHHmm());
    setShift("1");
    setMesinId("");
    setChecklist(DEFAULT_CHECKLIST);
    setDiameterDalamMm("");
    setQty10KG("");
    setCatatan("");
    setFotoPath(null);
    setFotoStatus(undefined);
    setError(null);
  }
```

Fungsi `handleCapture` saat ini:

```tsx
  async function handleCapture(file: File) {
    setError(null);
    setUploading(true);
    try {
      const path = await uploadFotoKualitas(file);
      setFotoPath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah foto.");
    } finally {
      setUploading(false);
    }
  }
```

Ganti jadi:

```tsx
  async function handleCapture(file: File) {
    setError(null);
    setUploading(true);
    setFotoStatus("uploading");
    try {
      const path = await uploadFotoKualitas(file);
      setFotoPath(path);
      setFotoStatus("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah foto.");
      setFotoStatus("error");
    } finally {
      setUploading(false);
    }
  }
```

(State `fotoStatus` sengaja terpisah dari `error` — `error` di file ini dipakai bareng untuk validasi lain di `handleSubmit`, mis. "Pilih mesin yang dipakai." Kalau ikon status diturunkan dari `error`, ikon silang bisa salah muncul di foto padahal error-nya bukan soal foto.)

- [ ] **Step 3: Teruskan `status` ke `LiveCameraCaptureField`**

Kode saat ini:

```tsx
              <LiveCameraCaptureField
                label="Foto Sampel"
                photoUrl={fotoPath}
                size="main"
                active
                disabled={uploading || pending}
                onCapture={handleCapture}
              />
```

Ganti jadi:

```tsx
              <LiveCameraCaptureField
                label="Foto Sampel"
                photoUrl={fotoPath}
                size="main"
                active
                disabled={uploading || pending}
                onCapture={handleCapture}
                status={fotoStatus}
              />
```

- [ ] **Step 4: Verifikasi build & manual**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/components/produksi-app/kualitas-view.tsx`
Expected: tidak ada error.

Buka `/mkesindo/produksi-app`, tab Kualitas, klik "Tambah" untuk buka dialog. Ambil foto sampel — konfirmasi ikon loading tampil sesaat, lalu berganti ikon centang hijau setelah upload selesai. Tutup dialog dan buka lagi — konfirmasi ikon TIDAK tersisa dari sesi sebelumnya (foto & ikon kembali kosong).

- [ ] **Step 5: Commit**

```bash
git add src/components/produksi-app/kualitas-view.tsx
git commit -m "feat: add upload status icon to Kualitas photo capture"
```

---

### Task 3: Retrofit Vehicle Check

**Files:**
- Modify: `src/components/dashboard/vehicle-check-dialog.tsx`

**Interfaces:**
- Consumes: `PhotoUploadStatus` (type) dari `src/components/ui/photo-status-overlay.tsx` (Task 1); `LiveCameraCaptureField`'s prop `status` (Task 1).

- [ ] **Step 1: Tambah state `photoStatus` (peta per sisi truk) dan import type**

Tambah import ini setelah baris `import { LiveCameraCaptureField } ...`:

```tsx
import type { PhotoUploadStatus } from "@/components/ui/photo-status-overlay";
```

Di dalam `CheckForm`, tambah state baru tepat setelah baris `const [uploading, setUploading] = useState<JenisFotoKendaraan | null>(null);`:

```tsx
  const [photoStatus, setPhotoStatus] = useState<Partial<Record<JenisFotoKendaraan, PhotoUploadStatus>>>({});
```

(Peta per `JenisFotoKendaraan`, bukan skalar tunggal seperti Kualitas — Vehicle Check punya 4 sisi truk independen, meski hanya satu kamera aktif dalam satu waktu.)

- [ ] **Step 2: Set status di `handleCapture`**

Fungsi `handleCapture` saat ini:

```tsx
  async function handleCapture(file: File, jenisFoto: JenisFotoKendaraan) {
    setError(null);
    setUploading(jenisFoto);
    try {
      const path = await onUploadPhoto(file, jenisFoto);
      setPhotos((prev) => ({ ...prev, [jenisFoto]: path }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah foto.");
    } finally {
      setUploading(null);
    }
  }
```

Ganti jadi:

```tsx
  async function handleCapture(file: File, jenisFoto: JenisFotoKendaraan) {
    setError(null);
    setUploading(jenisFoto);
    setPhotoStatus((prev) => ({ ...prev, [jenisFoto]: "uploading" }));
    try {
      const path = await onUploadPhoto(file, jenisFoto);
      setPhotos((prev) => ({ ...prev, [jenisFoto]: path }));
      setPhotoStatus((prev) => ({ ...prev, [jenisFoto]: "success" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah foto.");
      setPhotoStatus((prev) => ({ ...prev, [jenisFoto]: "error" }));
    } finally {
      setUploading(null);
    }
  }
```

(State `photoStatus` sengaja terpisah dari `error` — `error` di file ini dipakai bareng untuk kegagalan submit cek kendaraan di `handleSubmit`, bukan cuma upload foto.)

Tidak perlu logika reset tambahan: `CheckForm` untuk satu `tipe` ("BERANGKAT"/"DATANG") berhenti dirender permanen begitu cek itu berhasil disimpan (diganti `CheckSummary` di `VehicleCheckDialog`), jadi tidak ada risiko ikon lama nongol lagi di sesi berikutnya seperti di Kualitas/Armada.

- [ ] **Step 3: Teruskan `status` ke kedua `LiveCameraCaptureField` di `renderSideContent`**

Kode saat ini:

```tsx
          <LiveCameraCaptureField
            key={mainTarget}
            label={JENIS_FOTO_LABEL[mainTarget]}
            photoUrl={photos[mainTarget] ?? null}
            size="main"
            active={activeSide === side}
            disabled={uploading != null || pending}
            onCapture={(file) => handleCapture(file, mainTarget)}
          />
          {toggleTarget && (
            <LiveCameraCaptureField
              key={toggleTarget}
              label={JENIS_FOTO_LABEL[toggleTarget]}
              photoUrl={photos[toggleTarget] ?? null}
              size="toggle"
              active={false}
              disabled={uploading != null || pending}
              onCapture={() => {}}
              onTogglePress={() => setMainTarget(toggleTarget)}
            />
          )}
```

Ganti jadi:

```tsx
          <LiveCameraCaptureField
            key={mainTarget}
            label={JENIS_FOTO_LABEL[mainTarget]}
            photoUrl={photos[mainTarget] ?? null}
            size="main"
            active={activeSide === side}
            disabled={uploading != null || pending}
            onCapture={(file) => handleCapture(file, mainTarget)}
            status={photoStatus[mainTarget]}
          />
          {toggleTarget && (
            <LiveCameraCaptureField
              key={toggleTarget}
              label={JENIS_FOTO_LABEL[toggleTarget]}
              photoUrl={photos[toggleTarget] ?? null}
              size="toggle"
              active={false}
              disabled={uploading != null || pending}
              onCapture={() => {}}
              onTogglePress={() => setMainTarget(toggleTarget)}
              status={photoStatus[toggleTarget]}
            />
          )}
```

- [ ] **Step 4: Verifikasi build & manual**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/components/dashboard/vehicle-check-dialog.tsx`
Expected: tidak ada error.

Buka Cek Keamanan Kendaraan (Satpam), ambil foto salah satu sisi truk — konfirmasi ikon loading lalu centang hijau tampil tepat di foto sisi itu, sisi lain tidak ikut berubah.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/vehicle-check-dialog.tsx
git commit -m "feat: add upload status icon to Vehicle Check photo capture"
```

---

### Task 4: Retrofit Driver-App (Bukti Pengiriman, Retur, Tanda Tangan)

**Files:**
- Modify: `src/components/driver-app/multi-photo-capture-field.tsx`
- Modify: `src/components/driver-app/steps/konfir-kirim-step.tsx`
- Modify: `src/components/driver-app/steps/konfir-terima-step.tsx`

**Interfaces:**
- Consumes: `PhotoStatusOverlay`, `PhotoUploadStatus` (type) dari `src/components/ui/photo-status-overlay.tsx` (Task 1); `LiveCameraCaptureField`'s prop `status` (Task 1).
- Produces: `MultiPhotoCaptureField` menerima prop opsional baru `statuses?: Record<number, PhotoUploadStatus>` — kalau ada entry untuk index tertentu, overlay status menggantikan tombol hapus (X) di pojok foto itu.

- [ ] **Step 1: Tambah prop `statuses` di `src/components/driver-app/multi-photo-capture-field.tsx`**

File saat ini persis:

```tsx
"use client";

import { useEffect, useMemo } from "react";
import { X } from "lucide-react";
import { LiveCameraCaptureField } from "@/components/dashboard/live-camera-capture-field";

// One object URL per captured File, created during render (memoized on the
// files array's identity) and revoked by the cleanup effect once that
// memoized set is replaced or the component unmounts — building these
// inline without memoization would leak a URL on every re-render.
function useObjectUrls(files: File[]): string[] {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => {
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [urls]);
  return urls;
}

// Merged "Bukti Pengiriman" + "Bukti Muatan" into this single multi-photo
// input — the driver captures as many proof photos as needed here instead
// of two separate boxes that only ever held one photo each.
export function MultiPhotoCaptureField({
  label,
  files,
  onChange,
}: {
  label: string;
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const urls = useObjectUrls(files);

  function handleCapture(file: File) {
    onChange([...files, file]);
  }

  function handleRemove(index: number) {
    onChange(files.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        {files.map((_, i) => (
          <div key={i} className="relative h-24 w-24">
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL, not a static build asset */}
            <img src={urls[i]} alt={`${label} ${i + 1}`} className="h-full w-full rounded-lg object-cover" />
            <button
              type="button"
              aria-label={`Hapus foto ${i + 1}`}
              onClick={() => handleRemove(i)}
              className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-md"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        <div className="h-24 w-24">
          <LiveCameraCaptureField label="Tambah Foto" photoUrl={null} size="main" active onCapture={handleCapture} />
        </div>
      </div>
    </div>
  );
}
```

Ganti jadi:

```tsx
"use client";

import { useEffect, useMemo } from "react";
import { X } from "lucide-react";
import { LiveCameraCaptureField } from "@/components/dashboard/live-camera-capture-field";
import { PhotoStatusOverlay, type PhotoUploadStatus } from "@/components/ui/photo-status-overlay";

// One object URL per captured File, created during render (memoized on the
// files array's identity) and revoked by the cleanup effect once that
// memoized set is replaced or the component unmounts — building these
// inline without memoization would leak a URL on every re-render.
function useObjectUrls(files: File[]): string[] {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => {
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [urls]);
  return urls;
}

// Merged "Bukti Pengiriman" + "Bukti Muatan" into this single multi-photo
// input — the driver captures as many proof photos as needed here instead
// of two separate boxes that only ever held one photo each.
export function MultiPhotoCaptureField({
  label,
  files,
  onChange,
  statuses,
}: {
  label: string;
  files: File[];
  onChange: (files: File[]) => void;
  statuses?: Record<number, PhotoUploadStatus>;
}) {
  const urls = useObjectUrls(files);

  function handleCapture(file: File) {
    onChange([...files, file]);
  }

  function handleRemove(index: number) {
    onChange(files.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        {files.map((_, i) => {
          const status = statuses?.[i];
          return (
            <div key={i} className="relative h-24 w-24">
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL, not a static build asset */}
              <img src={urls[i]} alt={`${label} ${i + 1}`} className="h-full w-full rounded-lg object-cover" />
              {status ? (
                <PhotoStatusOverlay status={status} />
              ) : (
                <button
                  type="button"
                  aria-label={`Hapus foto ${i + 1}`}
                  onClick={() => handleRemove(i)}
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-md"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          );
        })}
        <div className="h-24 w-24">
          <LiveCameraCaptureField label="Tambah Foto" photoUrl={null} size="main" active onCapture={handleCapture} />
        </div>
      </div>
    </div>
  );
}
```

(Saat sebuah index punya `status` di `statuses`, tombol hapus digantikan overlay status — konsisten dengan keputusan desain: form terkunci selama submit, jadi hapus foto saat itu tidak relevan.)

- [ ] **Step 2: Tambah pelacakan status per foto di `src/components/driver-app/steps/konfir-kirim-step.tsx`**

File saat ini punya bagian ini (baris 1-22, header & fungsi upload):

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Minus, Plus, MapPin, MessageSquare } from "lucide-react";
import { LiveCameraCaptureField } from "@/components/dashboard/live-camera-capture-field";
import { MultiPhotoCaptureField } from "@/components/driver-app/multi-photo-capture-field";
import { formatRupiah } from "@/lib/format";
import { getStopOrderItemsAction } from "@/app/mkesindo/driver-app/actions";
import type { KonfirKirimResult } from "@/components/driver-app/stop-flow";
import type { DriverStopRow, StopOrderItem } from "@/lib/queries/pengiriman-jadwal";

async function uploadDriverPhoto(jadwalDetailId: number, jenisFoto: string, file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("jadwalDetailId", String(jadwalDetailId));
  formData.append("jenisFoto", jenisFoto);
  const res = await fetch("/api/mkesindo/upload/driver-app", { method: "POST", body: formData });
  const data = (await res.json()) as { path?: string; error?: string };
  if (!res.ok || !data.path) throw new Error(data.error ?? "Gagal mengunggah foto");
  return data.path;
}
```

Ganti jadi (tambah import `PhotoUploadStatus` dan satu fungsi helper `uploadWithStatus`):

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Minus, Plus, MapPin, MessageSquare } from "lucide-react";
import { LiveCameraCaptureField } from "@/components/dashboard/live-camera-capture-field";
import { MultiPhotoCaptureField } from "@/components/driver-app/multi-photo-capture-field";
import { formatRupiah } from "@/lib/format";
import { getStopOrderItemsAction } from "@/app/mkesindo/driver-app/actions";
import type { KonfirKirimResult } from "@/components/driver-app/stop-flow";
import type { DriverStopRow, StopOrderItem } from "@/lib/queries/pengiriman-jadwal";
import type { PhotoUploadStatus } from "@/components/ui/photo-status-overlay";

async function uploadDriverPhoto(jadwalDetailId: number, jenisFoto: string, file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("jadwalDetailId", String(jadwalDetailId));
  formData.append("jenisFoto", jenisFoto);
  const res = await fetch("/api/mkesindo/upload/driver-app", { method: "POST", body: formData });
  const data = (await res.json()) as { path?: string; error?: string };
  if (!res.ok || !data.path) throw new Error(data.error ?? "Gagal mengunggah foto");
  return data.path;
}

// Upload satu foto sambil melaporkan statusnya ke peta status milik
// caller (fotoBuktiStatus atau returFotoStatus) — dipakai di dalam
// Promise.all supaya tiap foto melaporkan status masing-masing begitu
// upload-nya sendiri selesai, bukan menunggu SEMUA foto selesai baru
// tahu mana yang gagal.
async function uploadWithStatus<K extends string | number>(
  key: K,
  jadwalDetailId: number,
  jenisFoto: string,
  file: File,
  setStatus: React.Dispatch<React.SetStateAction<Record<K, PhotoUploadStatus>>>
): Promise<string> {
  setStatus((prev) => ({ ...prev, [key]: "uploading" }));
  try {
    const path = await uploadDriverPhoto(jadwalDetailId, jenisFoto, file);
    setStatus((prev) => ({ ...prev, [key]: "success" }));
    return path;
  } catch (err) {
    setStatus((prev) => ({ ...prev, [key]: "error" }));
    throw err;
  }
}
```

Di dalam `KonfirKirimStep`, tambah dua state baru tepat setelah baris `const [fotoBuktiFiles, setFotoBuktiFiles] = useState<File[]>([]);`:

```tsx
  const [fotoBuktiStatus, setFotoBuktiStatus] = useState<Record<number, PhotoUploadStatus>>({});
  const [returFotoStatus, setReturFotoStatus] = useState<Record<string, PhotoUploadStatus>>({});
```

Fungsi `handleSubmit` saat ini:

```tsx
  async function handleSubmit() {
    if (fotoBuktiFiles.length === 0) {
      setError("Foto bukti pengiriman wajib diisi, minimal 1 foto.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const fotoBuktiUrls = await Promise.all(
        fotoBuktiFiles.map((file, i) => uploadDriverPhoto(jadwalDetailId, `bukti-pengiriman-${i + 1}`, file))
      );
      const resultItems = await Promise.all(
        items.map(async (item) => {
          const returFile = returFotoFiles[item.SalesOrderDetailID];
          const fotoReturUrl = returFile ? await uploadDriverPhoto(jadwalDetailId, `retur-${item.SalesOrderDetailID}`, returFile) : null;
          return {
            salesOrderDetailId: item.SalesOrderDetailID,
            qtyDiterima: qtyDiterima[item.SalesOrderDetailID] ?? item.Qty,
            fotoReturUrl,
            keteranganRetur: keteranganRetur[item.SalesOrderDetailID]?.trim() || null,
          };
        })
      );
      onNext({ items: resultItems, fotoBuktiUrls, tanpaPembayaran });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah foto.");
    } finally {
      setSubmitting(false);
    }
  }
```

Ganti jadi:

```tsx
  async function handleSubmit() {
    if (fotoBuktiFiles.length === 0) {
      setError("Foto bukti pengiriman wajib diisi, minimal 1 foto.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const fotoBuktiUrls = await Promise.all(
        fotoBuktiFiles.map((file, i) =>
          uploadWithStatus(i, jadwalDetailId, `bukti-pengiriman-${i + 1}`, file, setFotoBuktiStatus)
        )
      );
      const resultItems = await Promise.all(
        items.map(async (item) => {
          const returFile = returFotoFiles[item.SalesOrderDetailID];
          const fotoReturUrl = returFile
            ? await uploadWithStatus(
                item.SalesOrderDetailID,
                jadwalDetailId,
                `retur-${item.SalesOrderDetailID}`,
                returFile,
                setReturFotoStatus
              )
            : null;
          return {
            salesOrderDetailId: item.SalesOrderDetailID,
            qtyDiterima: qtyDiterima[item.SalesOrderDetailID] ?? item.Qty,
            fotoReturUrl,
            keteranganRetur: keteranganRetur[item.SalesOrderDetailID]?.trim() || null,
          };
        })
      );
      onNext({ items: resultItems, fotoBuktiUrls, tanpaPembayaran });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah foto.");
    } finally {
      setSubmitting(false);
    }
  }
```

- [ ] **Step 3: Teruskan status ke `MultiPhotoCaptureField` dan ke `LiveCameraCaptureField` Foto Retur**

Kode saat ini:

```tsx
      <MultiPhotoCaptureField label="Bukti Pengiriman" files={fotoBuktiFiles} onChange={setFotoBuktiFiles} />
```

Ganti jadi:

```tsx
      <MultiPhotoCaptureField
        label="Bukti Pengiriman"
        files={fotoBuktiFiles}
        onChange={setFotoBuktiFiles}
        statuses={submitting ? fotoBuktiStatus : undefined}
      />
```

Kode saat ini (di dalam blok retur per item):

```tsx
                      <div className="relative h-14 w-14">
                        <LiveCameraCaptureField
                          label="Foto Retur"
                          photoUrl={null}
                          size="main"
                          active={activeReturSlot === item.SalesOrderDetailID}
                          disabled={activeReturSlot !== item.SalesOrderDetailID}
                          onCapture={(file) => {
                            setReturFotoFiles((prev) => ({ ...prev, [item.SalesOrderDetailID]: file }));
                            setActiveReturSlot(null);
                          }}
                        />
```

Ganti jadi:

```tsx
                      <div className="relative h-14 w-14">
                        <LiveCameraCaptureField
                          label="Foto Retur"
                          photoUrl={null}
                          size="main"
                          active={activeReturSlot === item.SalesOrderDetailID}
                          disabled={activeReturSlot !== item.SalesOrderDetailID}
                          onCapture={(file) => {
                            setReturFotoFiles((prev) => ({ ...prev, [item.SalesOrderDetailID]: file }));
                            setActiveReturSlot(null);
                          }}
                          status={submitting ? returFotoStatus[item.SalesOrderDetailID] : undefined}
                        />
```

(Status hanya ditampilkan selama `submitting` true — sejalan dengan keputusan desain di Task 1's spec: pojok status/hapus berganti peran mengikuti apakah form sedang terkunci untuk submit atau tidak.)

- [ ] **Step 4: Tambah `signatureStatus` di `src/components/driver-app/steps/konfir-terima-step.tsx`**

File saat ini persis:

```tsx
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
```

Ganti jadi:

```tsx
"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignaturePad } from "@/components/driver-app/signature-pad";
import { confirmStopDeliveryAction } from "@/app/mkesindo/driver-app/actions";
import type { KonfirKirimResult } from "@/components/driver-app/stop-flow";
import { PhotoStatusOverlay, type PhotoUploadStatus } from "@/components/ui/photo-status-overlay";

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
  const [signatureStatus, setSignatureStatus] = useState<PhotoUploadStatus | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (!signatureFile) {
      setError("Tanda tangan penerima wajib diisi.");
      return;
    }
    setError(null);
    setSubmitting(true);
    setSignatureStatus("uploading");
    try {
      const tandaTanganUrl = await uploadSignature(jadwalDetailId, signatureFile);
      setSignatureStatus("success");
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
      setSignatureStatus("error");
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
      <div className="relative">
        <SignaturePad
          onCapture={setSignatureFile}
          onClear={() => {
            setSignatureFile(null);
            setSignatureStatus(undefined);
          }}
        />
        <PhotoStatusOverlay status={signatureStatus} />
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <Button className="mt-3 w-full" disabled={submitting} onClick={handleConfirm}>
        {submitting ? "Menyimpan..." : "Konfirmasi Penerima"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 5: Verifikasi build & manual**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/components/driver-app/multi-photo-capture-field.tsx "src/components/driver-app/steps/konfir-kirim-step.tsx" "src/components/driver-app/steps/konfir-terima-step.tsx"`
Expected: tidak ada error.

Di Aplikasi Driver, jalankan alur konfirmasi pengiriman: ambil 2+ foto Bukti Pengiriman, tekan "Lanjut" — konfirmasi ikon loading lalu centang muncul di tiap foto sesaat sebelum berpindah layar. Kalau ada item retur, ambil foto retur juga dan konfirmasi ikonnya muncul serupa. Di layar Tanda Tangan, gambar tanda tangan lalu tekan "Konfirmasi Penerima" — konfirmasi ikon loading/centang muncul di atas area tanda tangan.

- [ ] **Step 6: Commit**

```bash
git add src/components/driver-app/multi-photo-capture-field.tsx "src/components/driver-app/steps/konfir-kirim-step.tsx" "src/components/driver-app/steps/konfir-terima-step.tsx"
git commit -m "feat: add upload status icons to driver-app delivery confirmation photos"
```

---

### Task 5: Retrofit Foto Armada (+ QR MyPertamina)

**Files:**
- Modify: `src/components/dashboard/armada-dialog.tsx`

**Interfaces:**
- Consumes: `PhotoStatusOverlay`, `PhotoUploadStatus` (type) dari `src/components/ui/photo-status-overlay.tsx` (Task 1).

- [ ] **Step 1: Tambah import dan turunkan status dari state yang sudah ada**

Tambah import ini (dekat import lain di bagian atas file):

```tsx
import { PhotoStatusOverlay, type PhotoUploadStatus } from "@/components/ui/photo-status-overlay";
```

Tepat setelah baris `const [qrUploadError, setQrUploadError] = useState<string | null>(null);`, tambah dua fungsi turunan (bukan state baru — `uploading`/`uploadError` dan `qrUploading`/`qrUploadError` sudah dedicated ke masing-masing foto, tidak tercampur validasi lain):

```tsx
  const fotoStatus: PhotoUploadStatus | undefined = uploading
    ? "uploading"
    : uploadError
    ? "error"
    : previewUrl ?? fotoPath
    ? "success"
    : undefined;
  const qrFotoStatus: PhotoUploadStatus | undefined = qrUploading
    ? "uploading"
    : qrUploadError
    ? "error"
    : qrPreviewUrl ?? qrMyPertaminaPath
    ? "success"
    : undefined;
```

- [ ] **Step 2: Ubah kondisi tampil foto + tambah overlay**

Kode saat ini untuk foto armada:

```tsx
            {selectedFile && !uploading && (
              <p className="text-xs text-muted-foreground">Foto baru dipilih — diunggah saat &quot;Simpan&quot; ditekan.</p>
            )}
            {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
            {(previewUrl ?? fotoPath) && !uploading && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl ?? fotoPath ?? undefined} alt="Pratinjau foto armada" className="h-24 w-24 rounded-lg object-cover" />
            )}
```

Ganti jadi:

```tsx
            {selectedFile && !uploading && (
              <p className="text-xs text-muted-foreground">Foto baru dipilih — diunggah saat &quot;Simpan&quot; ditekan.</p>
            )}
            {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
            {(previewUrl ?? fotoPath) && (
              <div className="relative h-24 w-24">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl ?? fotoPath ?? undefined} alt="Pratinjau foto armada" className="h-full w-full rounded-lg object-cover" />
                <PhotoStatusOverlay status={fotoStatus} />
              </div>
            )}
```

Kode saat ini untuk foto QR MyPertamina:

```tsx
            {selectedQrFile && !qrUploading && (
              <p className="text-xs text-muted-foreground">QR baru dipilih — diunggah saat &quot;Simpan&quot; ditekan.</p>
            )}
            {qrUploadError && <p className="text-xs text-destructive">{qrUploadError}</p>}
            {(qrPreviewUrl ?? qrMyPertaminaPath) && !qrUploading && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrPreviewUrl ?? qrMyPertaminaPath ?? undefined}
                alt="Pratinjau QR MyPertamina"
                className="h-24 w-24 rounded-lg object-cover"
              />
            )}
```

Ganti jadi:

```tsx
            {selectedQrFile && !qrUploading && (
              <p className="text-xs text-muted-foreground">QR baru dipilih — diunggah saat &quot;Simpan&quot; ditekan.</p>
            )}
            {qrUploadError && <p className="text-xs text-destructive">{qrUploadError}</p>}
            {(qrPreviewUrl ?? qrMyPertaminaPath) && (
              <div className="relative h-24 w-24">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrPreviewUrl ?? qrMyPertaminaPath ?? undefined}
                  alt="Pratinjau QR MyPertamina"
                  className="h-full w-full rounded-lg object-cover"
                />
                <PhotoStatusOverlay status={qrFotoStatus} />
              </div>
            )}
```

(Perubahan perilaku yang disetujui: foto sekarang tetap tampil selama upload — sebelumnya disembunyikan total lewat syarat `!uploading` — diganti dengan overlay loading di atasnya. State reset saat dialog dibuka lagi TIDAK perlu diubah — `setUploadError(null)`/`setQrUploadError(null)` yang sudah ada di `onOpenChange` otomatis membuat `fotoStatus`/`qrFotoStatus` kembali ke `undefined`/`"success"` yang benar sesuai `fotoPath`/`qrMyPertaminaPath` awal, karena keduanya nilai turunan, bukan state tersendiri.)

- [ ] **Step 3: Verifikasi build & manual**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/components/dashboard/armada-dialog.tsx`
Expected: tidak ada error.

Buka dialog Tambah/Ubah Armada, pilih file foto — konfirmasi foto langsung tampil (tanpa ikon, belum upload). Tekan "Simpan" — konfirmasi ikon loading muncul di atas foto yang tetap tampil, lalu (setelah submit selesai dan dialog kemungkinan tertutup otomatis) ulangi dengan membuka dialog Ubah pada armada yang sama untuk melihat foto tersimpan tampil dengan ikon centang.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/armada-dialog.tsx
git commit -m "feat: add upload status icon to Armada photo fields"
```

---

### Task 6: Retrofit Logo Situs & Template Dokumen

**Files:**
- Modify: `src/components/dashboard/site-settings-panel.tsx`
- Modify: `src/components/dashboard/doc-template-panel.tsx`

**Interfaces:**
- Consumes: `PhotoStatusOverlay`, `PhotoUploadStatus` (type) dari `src/components/ui/photo-status-overlay.tsx` (Task 1).

- [ ] **Step 1: Retrofit `ImageUploadField` di `src/components/dashboard/site-settings-panel.tsx`**

Tambah import ini (dekat import lain di bagian atas file):

```tsx
import { PhotoStatusOverlay, type PhotoUploadStatus } from "@/components/ui/photo-status-overlay";
```

Kode `ImageUploadField` saat ini:

```tsx
function ImageUploadField({
  label,
  caption,
  path,
  kind,
  onUploaded,
}: {
  label: string;
  caption?: string;
  path: string | null;
  kind: "favicon" | "og-image";
  onUploaded: (path: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", kind);
      const res = await fetch("/api/mkesindo/upload/site-asset", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal mengunggah file");
      onUploaded(data.path);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Gagal mengunggah file");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {caption && <p className="text-[11px] text-muted-foreground">{caption}</p>}
      <div className="flex items-center gap-3">
        {path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={path} alt={label} className="size-16 rounded-lg border object-cover" />
        ) : (
          <div className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-dashed text-[10px] text-muted-foreground">
            Default
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} disabled={uploading} className="text-xs" />
          {uploading && <p className="text-xs text-muted-foreground">Mengunggah...</p>}
          {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
        </div>
      </div>
    </div>
  );
}
```

Ganti jadi:

```tsx
function ImageUploadField({
  label,
  caption,
  path,
  kind,
  onUploaded,
}: {
  label: string;
  caption?: string;
  path: string | null;
  kind: "favicon" | "og-image";
  onUploaded: (path: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const status: PhotoUploadStatus | undefined = uploading ? "uploading" : uploadError ? "error" : path ? "success" : undefined;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", kind);
      const res = await fetch("/api/mkesindo/upload/site-asset", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal mengunggah file");
      onUploaded(data.path);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Gagal mengunggah file");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {caption && <p className="text-[11px] text-muted-foreground">{caption}</p>}
      <div className="flex items-center gap-3">
        {path ? (
          <div className="relative size-16 shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={path} alt={label} className="size-16 rounded-lg border object-cover" />
            <PhotoStatusOverlay status={status} />
          </div>
        ) : (
          <div className="relative flex size-16 shrink-0 items-center justify-center rounded-lg border border-dashed text-[10px] text-muted-foreground">
            Default
            <PhotoStatusOverlay status={status} />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} disabled={uploading} className="text-xs" />
          {uploading && <p className="text-xs text-muted-foreground">Mengunggah...</p>}
          {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
        </div>
      </div>
    </div>
  );
}
```

(`status` sudah aman diturunkan langsung dari `uploading`/`uploadError` — keduanya scoped satu instance per pemanggilan `ImageUploadField`, tidak tercampur validasi lain. Overlay dipasang di kedua cabang — ada foto maupun placeholder "Default" — supaya status "uploading"/"error" tetap kelihatan meski upload pertama kali belum pernah berhasil sebelumnya.)

- [ ] **Step 2: Retrofit logo di `src/components/dashboard/doc-template-panel.tsx`**

Tambah import ini (dekat import lain di bagian atas file):

```tsx
import { PhotoStatusOverlay, type PhotoUploadStatus } from "@/components/ui/photo-status-overlay";
```

Di dalam `DocTemplatePanel`, tambah state baru tepat setelah baris `const [uploading, setUploading] = useState(false);`:

```tsx
  const [logoUploadStatus, setLogoUploadStatus] = useState<PhotoUploadStatus | undefined>(undefined);
```

(State baru, BUKAN diturunkan dari `error` yang sudah ada — `error` di file ini dipakai bersama oleh `handleLogoChange` DAN `handleSave`, jadi ikon status bisa salah muncul di logo akibat kegagalan simpan template yang tidak berkaitan dengan foto.)

Fungsi `handleLogoChange` saat ini:

```tsx
  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/mkesindo/upload/doc-template", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal mengunggah logo");
      setLogoPath(data.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah logo");
    } finally {
      setUploading(false);
    }
  }
```

Ganti jadi:

```tsx
  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setLogoUploadStatus("uploading");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/mkesindo/upload/doc-template", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal mengunggah logo");
      setLogoPath(data.path);
      setLogoUploadStatus("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah logo");
      setLogoUploadStatus("error");
    } finally {
      setUploading(false);
    }
  }
```

Kode JSX logo saat ini:

```tsx
          <div className="flex items-center gap-3">
            {logoPath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPath} alt="Logo" className="size-14 rounded-lg border object-contain" />
            ) : (
              <div className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-dashed text-[10px] text-muted-foreground">
                Tanpa logo
              </div>
            )}
            <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleLogoChange} disabled={uploading} className="text-xs" />
          </div>
```

Ganti jadi:

```tsx
          <div className="flex items-center gap-3">
            {logoPath ? (
              <div className="relative size-14 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoPath} alt="Logo" className="size-14 rounded-lg border object-contain" />
                <PhotoStatusOverlay status={logoUploadStatus} />
              </div>
            ) : (
              <div className="relative flex size-14 shrink-0 items-center justify-center rounded-lg border border-dashed text-[10px] text-muted-foreground">
                Tanpa logo
                <PhotoStatusOverlay status={logoUploadStatus} />
              </div>
            )}
            <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleLogoChange} disabled={uploading} className="text-xs" />
          </div>
```

- [ ] **Step 3: Verifikasi build & manual**

Run: `npx tsc --noEmit`
Expected: tidak ada error.

Run: `npx eslint src/components/dashboard/site-settings-panel.tsx src/components/dashboard/doc-template-panel.tsx`
Expected: tidak ada error.

Buka halaman pengaturan situs (superadmin), unggah favicon baru — konfirmasi ikon loading lalu centang tampil di atas gambar favicon. Ulangi untuk gambar Open Graph. Buka panel Template Dokumen, unggah logo baru — konfirmasi ikon serupa tampil di atas logo.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/site-settings-panel.tsx src/components/dashboard/doc-template-panel.tsx
git commit -m "feat: add upload status icon to Logo Situs and Template Dokumen"
```
