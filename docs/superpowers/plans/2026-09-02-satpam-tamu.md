# Tab Tamu Satpam-App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Tamu" tab's `ComingSoonPanel` placeholder on `/mkesindo/satpam-app` with a real visitor log — satpam record a guest's arrival (name, purpose, host, optional vehicle plate, watermarked entry photo) and, later, their departure (watermarked exit photo) — visible and actionable by any satpam on duty, regardless of who logged the arrival.

**Architecture:** One new MSSQL table (`DashboardSatpamTamu`, one row per visit, no separate photo table since exactly 2 photos exist per row). A query layer + Server Actions extending the existing `satpam-app/actions.ts`. Two new full-screen routes (`tamu/masuk` for entry, `tamu/keluar/[kunjunganId]` for exit), each using the same watermark camera mechanism Patroli already uses — reached by renaming the existing Patroli-only hook to a feature-neutral name rather than duplicating it a third time.

**Tech Stack:** Next.js App Router (Server Actions, Server Components), MSSQL (`mssql` package via `src/lib/db.ts`), Google Drive storage (`src/lib/storage/google-drive.ts`), Tailwind, shadcn/ui, sonner toasts, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-09-02-satpam-tamu-design.md`

## Global Constraints

- Never modify `src/hooks/use-live-camera-capture.ts`, `src/components/satpam-app/live-inspeksi-client.tsx`, or any part of the Inspeksi vehicle-check flow.
- Task 1's hook rename is a **zero-behavior-change** mechanical rename only — no logic in the hook body changes, only identifier names and the file path.
- "Tamu di Dalam" and "Riwayat" visibility is **shared** across all satpam accounts — no per-user ownership scoping on reads or writes (this differs deliberately from Patroli's per-session ownership checks).
- "Dikunjungi" (who is being visited) is a free-text field — no employee/account dropdown or lookup.
- `NomorKendaraan` (guest vehicle plate) is optional — never required to submit the entry form.
- This repo has **no automated test suite**. Verification is `npx tsc --noEmit` + `npm run lint`, plus manual browser testing when an `isSatpam` session is available in the environment, falling back to a careful, itemized code-review trace when it is not (the accepted norm for every satpam-app sub-project so far).
- **Deviation from the spec's Upload Foto wording, decided during planning:** the spec's "one Drive folder per kunjungan" phrasing cannot hold for the entry (masuk) photo, because `KunjunganID` does not exist yet at the moment that photo is captured — the row is only inserted *after* the photo is already uploaded (this order is required by the spec's own Error Handling guarantee: no half-created "orphan" row if the app closes mid-form). Task 3's upload route therefore uses a single flat Drive folder (`["satpam-tamu"]`) for both entry and exit photos, with `jenis` (`"masuk"|"keluar"`) and, when known, `kunjunganId` baked into the filename instead of the folder path. This does not change any Tujuan/Non-tujuan in the spec — it only resolves an implementation-level sequencing detail the spec's prose left implicit.

---

### Task 1: Rename the watermark camera hook to a feature-neutral name

**Files:**
- Create: `src/hooks/use-watermark-camera-capture.ts`
- Delete: `src/hooks/use-patroli-camera-capture.ts`
- Modify: `src/components/satpam-app/patroli-foto-client.tsx`

**Interfaces:**
- Produces (consumed by Tasks 6 and 7, and by the untouched Task-5-era `patroli-foto-client.tsx`): `useWatermarkCameraCapture({label, active, onCapture}): {videoRef, error, capturing, retry, handleCapture}`, `WatermarkCaptureResult = {file: File; latitude: number | null; longitude: number | null}`.

This is a **pure rename** — every line of logic in the hook body is copied verbatim. Only these identifiers change: `usePatroliCameraCapture` → `useWatermarkCameraCapture`, `PatroliCaptureResult` → `WatermarkCaptureResult`, `UsePatroliCameraCaptureOptions` → `UseWatermarkCameraCaptureOptions`, `UsePatroliCameraCaptureResult` → `UseWatermarkCameraCaptureResult`. Nothing else in the file's body, comments, or behavior changes.

- [ ] **Step 1: Create `src/hooks/use-watermark-camera-capture.ts`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

export interface WatermarkCaptureResult {
  file: File;
  latitude: number | null;
  longitude: number | null;
}

export interface UseWatermarkCameraCaptureOptions {
  label: string;
  active: boolean;
  onCapture: (result: WatermarkCaptureResult) => void;
}

export interface UseWatermarkCameraCaptureResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  error: string | null;
  capturing: boolean;
  retry: () => void;
  handleCapture: () => void;
}

// Format tanggal+jam WIB untuk watermark -- SENGAJA pin timeZone:"Asia/Jakarta"
// secara eksplisit (bukan mengandalkan zona waktu perangkat/browser), meniru
// teknik getWibTimeHHmm di business-date.ts. Ini murni formatter kosmetik
// untuk pemakai watermark foto (Patroli & Tamu), sehingga sengaja ditaruh di
// sini, bukan di business-date.ts yang jadi tumpuan logika penulisan tanggal
// ke database yang jauh lebih sensitif (lihat Global Constraints plan ini).
function formatWibWatermarkDateTime(now: Date): string {
  const formatter = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${formatter.format(now)} WIB`;
}

interface WatermarkData {
  alamat: string;
  latitude: number | null;
  longitude: number | null;
  cuaca: string;
  waktu: string;
}

interface GeocodeApiResponse {
  alamat?: string | null;
}

interface WeatherApiResponse {
  cuaca?: string;
  suhu?: number;
}

// Kumpulkan semua data watermark (lokasi, alamat, cuaca, waktu) sebelum foto
// digambar -- kalau lokasi gagal didapat sama sekali (izin ditolak/timeout),
// SEMUA bagian watermark yang bergantung padanya (alamat, koordinat, cuaca)
// ditulis "tidak tersedia", tapi foto tetap bisa diambil (lihat Global
// Constraints plan ini -- kegagalan GPS/geocode/cuaca tidak pernah
// menghalangi pengambilan foto).
async function collectWatermarkData(): Promise<WatermarkData> {
  const waktu = formatWibWatermarkDateTime(new Date());
  const position = await new Promise<GeolocationPosition | null>((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { timeout: 8000, maximumAge: 0 }
    );
  });

  if (!position) {
    return { alamat: "Lokasi tidak tersedia", latitude: null, longitude: null, cuaca: "Cuaca tidak tersedia", waktu };
  }

  const { latitude, longitude } = position.coords;
  const [geocodeResult, weatherResult] = await Promise.all([
    fetch(`/api/geocode?lat=${latitude}&lng=${longitude}`)
      .then((r) => r.json() as Promise<GeocodeApiResponse>)
      .catch(() => null),
    fetch(`/api/weather?lat=${latitude}&lng=${longitude}`)
      .then((r) => r.json() as Promise<WeatherApiResponse>)
      .catch(() => null),
  ]);

  const alamat = geocodeResult?.alamat ?? "Lokasi tidak tersedia";
  const cuaca =
    weatherResult?.cuaca != null && weatherResult?.suhu != null
      ? `${weatherResult.cuaca}, ${weatherResult.suhu}°C`
      : "Cuaca tidak tersedia";

  return { alamat, latitude, longitude, cuaca, waktu };
}

function drawWatermark(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, data: WatermarkData) {
  const lines = [
    data.alamat,
    data.latitude != null && data.longitude != null
      ? `${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}`
      : "Koordinat tidak tersedia",
    data.waktu,
    data.cuaca,
  ];
  const lineHeight = 22;
  const padding = 12;
  const boxHeight = lines.length * lineHeight + padding * 2;
  const boxY = canvas.height - boxHeight;

  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(0, boxY, canvas.width, boxHeight);

  ctx.fillStyle = "#ffffff";
  ctx.font = "16px sans-serif";
  ctx.textBaseline = "top";
  lines.forEach((line, i) => {
    ctx.fillText(line, padding, boxY + padding + i * lineHeight, canvas.width - padding * 2);
  });
}

export function useWatermarkCameraCapture({
  label,
  active,
  onCapture,
}: UseWatermarkCameraCaptureOptions): UseWatermarkCameraCaptureResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturingRef = useRef(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!active) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      return;
    }
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
        if (capabilities?.torch) {
          track
            .applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] })
            .catch(() => {
              // Device reported torch support but declined the constraint --
              // camera still works without flash, so this is not an error.
            });
        }
      })
      .catch(() => {
        if (!cancelled) setError("Izin kamera diperlukan untuk mengambil foto.");
      });
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [active, retryCount]);

  function handleCapture() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      capturingRef.current = false;
      setCapturing(false);
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    collectWatermarkData()
      .then((data) => {
        drawWatermark(ctx, canvas, data);
        canvas.toBlob(
          (blob) => {
            capturingRef.current = false;
            setCapturing(false);
            if (!blob) return;
            const file = new File([blob], `${label}.jpg`, { type: "image/jpeg" });
            onCapture({ file, latitude: data.latitude, longitude: data.longitude });
          },
          "image/jpeg",
          0.9
        );
      })
      .catch(() => {
        capturingRef.current = false;
        setCapturing(false);
      });
  }

  function retry() {
    setError(null);
    setRetryCount((c) => c + 1);
  }

  return { videoRef, error, capturing, retry, handleCapture };
}
```

- [ ] **Step 2: Delete the old file**

```bash
git rm src/hooks/use-patroli-camera-capture.ts
```

- [ ] **Step 3: Update `src/components/satpam-app/patroli-foto-client.tsx`'s import and usage**

Change line 9 from:
```tsx
import { usePatroliCameraCapture, type PatroliCaptureResult } from "@/hooks/use-patroli-camera-capture";
```
to:
```tsx
import { useWatermarkCameraCapture, type WatermarkCaptureResult } from "@/hooks/use-watermark-camera-capture";
```

Change line 25 from:
```tsx
  const [captured, setCaptured] = useState<PatroliCaptureResult | null>(null);
```
to:
```tsx
  const [captured, setCaptured] = useState<WatermarkCaptureResult | null>(null);
```

Change line 45 from:
```tsx
  const { videoRef, error, capturing, retry, handleCapture } = usePatroliCameraCapture({
```
to:
```tsx
  const { videoRef, error, capturing, retry, handleCapture } = useWatermarkCameraCapture({
```

No other line in this file changes. `label: titikPatroli ?? "tambahan"` and everything else stays exactly as-is.

- [ ] **Step 4: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean. Also grep for any leftover reference to the old names to be certain the rename is total:
```bash
grep -rn "usePatroliCameraCapture\|PatroliCaptureResult\|use-patroli-camera-capture" src/
```
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-watermark-camera-capture.ts src/components/satpam-app/patroli-foto-client.tsx
git commit -m "refactor: rename the watermark camera hook to a feature-neutral name"
```

---

### Task 2: `DashboardSatpamTamu` table and query layer

**Files:**
- Create: `scripts/create-satpam-tamu-table.ts`
- Create: `src/lib/queries/satpam-tamu.ts`

**Interfaces:**
- Produces (consumed by Tasks 4, 5, 7): `TamuKunjunganRow` interface, `getTamuDiDalam(): Promise<TamuKunjunganRow[]>`, `getTamuRiwayat(): Promise<TamuKunjunganRow[]>`, `getTamuById(kunjunganId: number): Promise<TamuKunjunganRow | null>`, `createTamuMasuk(input): Promise<number>`, `recordTamuKeluar(kunjunganId, fotoKeluarPath, latitude, longitude): Promise<void>` (throws `AppError` if the visit is already checked out or doesn't exist).

- [ ] **Step 1: Write `scripts/create-satpam-tamu-table.ts`**

```ts
// One-off table creation for the satpam-app Tamu feature -- idempotent,
// safe to re-run.
// Usage: npx tsx scripts/create-satpam-tamu-table.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardSatpamTamu' AND xtype='U')
    CREATE TABLE DashboardSatpamTamu (
      KunjunganID         INT IDENTITY PRIMARY KEY,
      NamaTamu            VARCHAR(128) NOT NULL,
      AsalInstansi        VARCHAR(128) NULL,
      TujuanKunjungan     VARCHAR(256) NOT NULL,
      Dikunjungi          VARCHAR(128) NOT NULL,
      NomorKendaraan      VARCHAR(32) NULL,
      FotoMasukPath       VARCHAR(256) NOT NULL,
      FotoMasukLatitude   DECIMAL(10,7) NULL,
      FotoMasukLongitude  DECIMAL(10,7) NULL,
      WaktuMasuk          DATETIME NOT NULL DEFAULT GETDATE(),
      FotoKeluarPath      VARCHAR(256) NULL,
      FotoKeluarLatitude  DECIMAL(10,7) NULL,
      FotoKeluarLongitude DECIMAL(10,7) NULL,
      WaktuKeluar         DATETIME NULL,
      IsDeleted           BIT NOT NULL DEFAULT 0,
      ModifiedDate        DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  console.log("DashboardSatpamTamu ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the migration**

```bash
npx tsx scripts/create-satpam-tamu-table.ts
```
Expected: `DashboardSatpamTamu ready.` printed, exit code 0. Safe to re-run (idempotent `IF NOT EXISTS` guard).

- [ ] **Step 3: Write `src/lib/queries/satpam-tamu.ts`**

```ts
import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";

export interface TamuKunjunganRow {
  kunjunganId: number;
  namaTamu: string;
  asalInstansi: string | null;
  tujuanKunjungan: string;
  dikunjungi: string;
  nomorKendaraan: string | null;
  fotoMasukPath: string;
  fotoMasukLatitude: number | null;
  fotoMasukLongitude: number | null;
  waktuMasuk: Date;
  fotoKeluarPath: string | null;
  fotoKeluarLatitude: number | null;
  fotoKeluarLongitude: number | null;
  waktuKeluar: Date | null;
}

interface TamuDbRow {
  KunjunganID: number;
  NamaTamu: string;
  AsalInstansi: string | null;
  TujuanKunjungan: string;
  Dikunjungi: string;
  NomorKendaraan: string | null;
  FotoMasukPath: string;
  FotoMasukLatitude: number | null;
  FotoMasukLongitude: number | null;
  WaktuMasuk: Date;
  FotoKeluarPath: string | null;
  FotoKeluarLatitude: number | null;
  FotoKeluarLongitude: number | null;
  WaktuKeluar: Date | null;
}

const SELECT_COLUMNS = `
  KunjunganID, NamaTamu, AsalInstansi, TujuanKunjungan, Dikunjungi, NomorKendaraan,
  FotoMasukPath, FotoMasukLatitude, FotoMasukLongitude, WaktuMasuk,
  FotoKeluarPath, FotoKeluarLatitude, FotoKeluarLongitude, WaktuKeluar
`;

function mapTamuRow(r: TamuDbRow): TamuKunjunganRow {
  return {
    kunjunganId: r.KunjunganID,
    namaTamu: r.NamaTamu,
    asalInstansi: r.AsalInstansi,
    tujuanKunjungan: r.TujuanKunjungan,
    dikunjungi: r.Dikunjungi,
    nomorKendaraan: r.NomorKendaraan,
    fotoMasukPath: r.FotoMasukPath,
    fotoMasukLatitude: r.FotoMasukLatitude,
    fotoMasukLongitude: r.FotoMasukLongitude,
    waktuMasuk: r.WaktuMasuk,
    fotoKeluarPath: r.FotoKeluarPath,
    fotoKeluarLatitude: r.FotoKeluarLatitude,
    fotoKeluarLongitude: r.FotoKeluarLongitude,
    waktuKeluar: r.WaktuKeluar,
  };
}

// Shared/tidak dibatasi per-akun satpam -- siapa pun yang login melihat
// baris yang sama, sesuai keputusan desain (serah-terima antar-shift).
export async function getTamuDiDalam(): Promise<TamuKunjunganRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ${SELECT_COLUMNS}
    FROM DashboardSatpamTamu
    WHERE WaktuKeluar IS NULL AND IsDeleted = 0
    ORDER BY WaktuMasuk DESC
  `);
  return (result.recordset as TamuDbRow[]).map(mapTamuRow);
}

export async function getTamuRiwayat(): Promise<TamuKunjunganRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP 50 ${SELECT_COLUMNS}
    FROM DashboardSatpamTamu
    WHERE WaktuKeluar IS NOT NULL AND IsDeleted = 0
    ORDER BY WaktuKeluar DESC
  `);
  return (result.recordset as TamuDbRow[]).map(mapTamuRow);
}

export async function getTamuById(kunjunganId: number): Promise<TamuKunjunganRow | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("kunjunganId", sql.Int, kunjunganId)
    .query(`
      SELECT ${SELECT_COLUMNS}
      FROM DashboardSatpamTamu
      WHERE KunjunganID = @kunjunganId AND IsDeleted = 0
    `);
  const row = (result.recordset as TamuDbRow[])[0];
  return row ? mapTamuRow(row) : null;
}

export async function createTamuMasuk(input: {
  namaTamu: string;
  asalInstansi: string | null;
  tujuanKunjungan: string;
  dikunjungi: string;
  nomorKendaraan: string | null;
  fotoMasukPath: string;
  latitude: number | null;
  longitude: number | null;
}): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("namaTamu", sql.VarChar(128), input.namaTamu)
    .input("asalInstansi", sql.VarChar(128), input.asalInstansi)
    .input("tujuanKunjungan", sql.VarChar(256), input.tujuanKunjungan)
    .input("dikunjungi", sql.VarChar(128), input.dikunjungi)
    .input("nomorKendaraan", sql.VarChar(32), input.nomorKendaraan)
    .input("fotoMasukPath", sql.VarChar(256), input.fotoMasukPath)
    .input("latitude", sql.Decimal(10, 7), input.latitude)
    .input("longitude", sql.Decimal(10, 7), input.longitude)
    .query(`
      INSERT INTO DashboardSatpamTamu
        (NamaTamu, AsalInstansi, TujuanKunjungan, Dikunjungi, NomorKendaraan, FotoMasukPath, FotoMasukLatitude, FotoMasukLongitude)
      OUTPUT INSERTED.KunjunganID
      VALUES (@namaTamu, @asalInstansi, @tujuanKunjungan, @dikunjungi, @nomorKendaraan, @fotoMasukPath, @latitude, @longitude)
    `);
  return (result.recordset[0] as { KunjunganID: number }).KunjunganID;
}

// Guard `WaktuKeluar IS NULL` mencegah double-checkout: kalau dua satpam
// menekan "Konfirmasi Keluar" pada tamu yang sama nyaris bersamaan, hanya
// UPDATE pertama yang mengenai baris (rowsAffected[0] === 1); yang kedua
// mendapat 0 baris dan action-nya melempar error jelas -- pola sama seperti
// updateFuelLog di src/lib/queries/driver-fuel.ts.
export async function recordTamuKeluar(
  kunjunganId: number,
  fotoKeluarPath: string,
  latitude: number | null,
  longitude: number | null
): Promise<void> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("kunjunganId", sql.Int, kunjunganId)
    .input("fotoKeluarPath", sql.VarChar(256), fotoKeluarPath)
    .input("latitude", sql.Decimal(10, 7), latitude)
    .input("longitude", sql.Decimal(10, 7), longitude)
    .query(`
      UPDATE DashboardSatpamTamu
      SET FotoKeluarPath = @fotoKeluarPath, FotoKeluarLatitude = @latitude, FotoKeluarLongitude = @longitude,
          WaktuKeluar = GETDATE(), ModifiedDate = GETDATE()
      WHERE KunjunganID = @kunjunganId AND WaktuKeluar IS NULL
    `);
  if (result.rowsAffected[0] === 0) {
    throw new AppError("Tamu ini sudah dicatat keluar sebelumnya.");
  }
}
```

- [ ] **Step 4: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/create-satpam-tamu-table.ts src/lib/queries/satpam-tamu.ts
git commit -m "feat: add the DashboardSatpamTamu table and its query layer"
```

---

### Task 3: Tamu photo upload route

**Files:**
- Create: `src/app/api/mkesindo/upload/satpam-tamu/route.ts`

**Interfaces:**
- Produces (consumed by Tasks 6 and 7): `POST /api/mkesindo/upload/satpam-tamu` — form fields `file` (required), `jenis` (required, `"masuk"|"keluar"`), `kunjunganId` (required only when `jenis === "keluar"`, ignored otherwise). Response: `{ path: string }` on success, `{ error: string }` on failure.

Per this plan's Global Constraints deviation note: this route always uploads to the flat Drive category `["satpam-tamu"]` (never `["satpam-tamu", kunjunganId]`), because the entry photo is uploaded *before* the `DashboardSatpamTamu` row (and its `KunjunganID`) exists. `jenis` and, when present, `kunjunganId` are baked into the filename instead.

- [ ] **Step 1: Write `src/app/api/mkesindo/upload/satpam-tamu/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { uploadFile } from "@/lib/storage/google-drive";
import { requireModuleAccess } from "@/lib/require-access";
import { auth } from "@/lib/auth";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  await requireModuleAccess("delivery");

  // Evidentiary gate-check photos -- checked independently of the
  // page-level module gate above, deliberately NOT bypassed by
  // isSuperAdmin. Mirrors satpam-check/route.ts and satpam-patroli/route.ts's
  // own identical gate.
  const session = await auth();
  if (!session?.user?.isSatpam) {
    return NextResponse.json({ error: "Hanya Satpam yang dapat mengunggah foto ini." }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  const jenis = formData.get("jenis");
  const kunjunganIdRaw = formData.get("kunjunganId");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File tidak ditemukan" }, { status: 400 });
  }
  if (jenis !== "masuk" && jenis !== "keluar") {
    return NextResponse.json({ error: 'jenis wajib "masuk" atau "keluar"' }, { status: 400 });
  }
  if (
    jenis === "keluar" &&
    (typeof kunjunganIdRaw !== "string" || !kunjunganIdRaw.trim() || !Number.isInteger(Number(kunjunganIdRaw)))
  ) {
    return NextResponse.json({ error: "kunjunganId wajib diisi untuk foto keluar" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Format file harus JPG, PNG, atau WEBP" }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "Ukuran file maksimal 5MB" }, { status: 400 });
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const now = new Date();
  const stamp =
    [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join(
      ""
    ) +
    "-" +
    [
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join("");
  const kunjunganSuffix =
    jenis === "keluar" && typeof kunjunganIdRaw === "string" ? `-${kunjunganIdRaw.replace(/[^0-9]/g, "")}` : "";
  const fileName = `${stamp}-${jenis}${kunjunganSuffix}.${ext}`;

  try {
    const bytes = await file.arrayBuffer();
    const uploaded = await uploadFile("mkesindo", ["satpam-tamu"], fileName, Buffer.from(bytes), file.type);
    return NextResponse.json({ path: uploaded.publicPath });
  } catch (err) {
    console.error("[upload/satpam-tamu] gagal mengunggah ke Google Drive:", err);
    return NextResponse.json({ error: "Gagal menyimpan foto" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/mkesindo/upload/satpam-tamu/route.ts
git commit -m "feat: add the Tamu photo upload route"
```

---

### Task 4: Server Actions for the Tamu visitor-log flow

**Files:**
- Modify: `src/app/mkesindo/satpam-app/actions.ts`

**Interfaces:**
- Consumes: from Task 2, `TamuKunjunganRow`, `getTamuDiDalam`, `getTamuRiwayat`, `getTamuById`, `createTamuMasuk`, `recordTamuKeluar` (from `@/lib/queries/satpam-tamu`).
- Produces (consumed by Tasks 5, 6, 7): `createTamuMasukAction(input): Promise<ActionResult<{ kunjunganId: number }>>`, `getTamuDiDalamAction(): Promise<ActionResult<TamuKunjunganRow[]>>`, `getTamuRiwayatAction(): Promise<ActionResult<TamuKunjunganRow[]>>`, `getTamuByIdAction(kunjunganId: number): Promise<ActionResult<TamuKunjunganRow | null>>`, `recordTamuKeluarAction(input): Promise<ActionResult<void>>`.

None of the existing Patroli exports in this file (`startPatroliSesiAction`, `getActivePatroliSesiAction`, `getPatroliRiwayatAction`, `addPatroliFotoAction`, `selesaiPatroliSesiAction`) change in any way — this task only appends new imports and new exported functions.

- [ ] **Step 1: Add the new import block to `src/app/mkesindo/satpam-app/actions.ts`**

Add this import alongside the existing `@/lib/queries/satpam-patroli` import (do not touch that import or anything else already in the file):

```ts
import {
  getTamuDiDalam,
  getTamuRiwayat,
  getTamuById,
  createTamuMasuk,
  recordTamuKeluar,
  type TamuKunjunganRow,
} from "@/lib/queries/satpam-tamu";
```

- [ ] **Step 2: Append the 5 new exported functions to the end of the file**

```ts

export async function createTamuMasukAction(input: {
  namaTamu: string;
  asalInstansi: string | null;
  tujuanKunjungan: string;
  dikunjungi: string;
  nomorKendaraan: string | null;
  fotoPath: string;
  latitude: number | null;
  longitude: number | null;
}): Promise<ActionResult<{ kunjunganId: number }>> {
  return runAction(async () => {
    await requireSatpam();
    const namaTamu = input.namaTamu.trim();
    const tujuanKunjungan = input.tujuanKunjungan.trim();
    const dikunjungi = input.dikunjungi.trim();
    if (!namaTamu || !tujuanKunjungan || !dikunjungi) {
      throw new AppError("Nama Tamu, Tujuan Kunjungan, dan Dikunjungi wajib diisi.");
    }
    const kunjunganId = await createTamuMasuk({
      namaTamu,
      asalInstansi: input.asalInstansi?.trim() || null,
      tujuanKunjungan,
      dikunjungi,
      nomorKendaraan: input.nomorKendaraan?.trim() || null,
      fotoMasukPath: input.fotoPath,
      latitude: input.latitude,
      longitude: input.longitude,
    });
    revalidatePath("/mkesindo/satpam-app/tamu");
    return { kunjunganId };
  });
}

export async function getTamuDiDalamAction(): Promise<ActionResult<TamuKunjunganRow[]>> {
  return runAction(async () => {
    await requireSatpam();
    return getTamuDiDalam();
  });
}

export async function getTamuRiwayatAction(): Promise<ActionResult<TamuKunjunganRow[]>> {
  return runAction(async () => {
    await requireSatpam();
    return getTamuRiwayat();
  });
}

export async function getTamuByIdAction(kunjunganId: number): Promise<ActionResult<TamuKunjunganRow | null>> {
  return runAction(async () => {
    await requireSatpam();
    return getTamuById(kunjunganId);
  });
}

export async function recordTamuKeluarAction(input: {
  kunjunganId: number;
  fotoPath: string;
  latitude: number | null;
  longitude: number | null;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireSatpam();
    await recordTamuKeluar(input.kunjunganId, input.fotoPath, input.latitude, input.longitude);
    revalidatePath("/mkesindo/satpam-app/tamu");
  });
}
```

- [ ] **Step 3: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/mkesindo/satpam-app/actions.ts
git commit -m "feat: add Server Actions for the Tamu visitor-log flow"
```

---

### Task 5: `TamuPanel`, wired into the tab shell

**Files:**
- Create: `src/components/satpam-app/tamu-panel.tsx`
- Modify: `src/components/satpam-app/satpam-tab-shell.tsx`
- Modify: `src/app/mkesindo/satpam-app/(tabs)/page.tsx`
- Modify: `src/app/mkesindo/satpam-app/(tabs)/patroli/page.tsx`
- Modify: `src/app/mkesindo/satpam-app/(tabs)/tamu/page.tsx`
- Delete: `src/components/satpam-app/coming-soon-panel.tsx`

**Interfaces:**
- Consumes: from Task 2, `TamuKunjunganRow` (`@/lib/queries/satpam-tamu`). From Task 4, `getTamuDiDalamAction`, `getTamuRiwayatAction` (`@/app/mkesindo/satpam-app/actions`) — used by the three `page.tsx` files for their initial server-side fetch. `formatDate`/`formatTime` (already exist, `@/lib/format`).
- Produces (consumed by Tasks 6 and 7): `TamuPanel`'s "Tamu Baru" button navigates to `router.push("/mkesindo/satpam-app/tamu/masuk")`; tapping a "Tamu di Dalam" card navigates to `router.push(\`/mkesindo/satpam-app/tamu/keluar/${kunjunganId}\`)`.

This task follows the SAME Global Constraint already established by the tab-shell and Patroli plans: every one of the 3 `(tabs)/*/page.tsx` files fetches the SAME full dataset (Inspeksi + Patroli + now Tamu) regardless of which tab it represents. Do not remove or alter the existing Inspeksi or Patroli fetches/props in any of the 3 files.

- [ ] **Step 1: Write `src/components/satpam-app/tamu-panel.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TamuKunjunganRow } from "@/lib/queries/satpam-tamu";
import { formatDate, formatTime } from "@/lib/format";

// Konten tab "Tamu" -- tombol "Tamu Baru" (navigasi ke layar penuh-layar
// terpisah, Task 6), daftar "Tamu di Dalam" (belum checkout, tap membuka
// layar konfirmasi keluar, Task 7), dan "Riwayat" (sudah checkout). Semua
// data ini SHARED antar-satpam -- tidak difilter per akun yang login, sesuai
// keputusan desain (serah-terima shift).
export function TamuPanel({
  initialDiDalam,
  initialRiwayat,
}: {
  initialDiDalam: TamuKunjunganRow[];
  initialRiwayat: TamuKunjunganRow[];
}) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-4 p-4">
      <Button size="lg" className="h-14" onClick={() => router.push("/mkesindo/satpam-app/tamu/masuk")}>
        <UserPlus className="size-5" /> Tamu Baru
      </Button>

      <div className="flex flex-col gap-2">
        <h2 className="font-display text-base font-semibold">Tamu di Dalam</h2>
        {initialDiDalam.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Tidak ada tamu di dalam.</p>
        ) : (
          initialDiDalam.map((tamu) => (
            <button
              key={tamu.kunjunganId}
              type="button"
              className="flex flex-col gap-1 rounded-lg border p-3 text-left"
              onClick={() => router.push(`/mkesindo/satpam-app/tamu/keluar/${tamu.kunjunganId}`)}
            >
              <span className="text-sm font-medium">{tamu.namaTamu}</span>
              <span className="text-xs text-muted-foreground">
                {tamu.tujuanKunjungan} — {tamu.dikunjungi}
              </span>
              <span className="text-xs text-muted-foreground">Masuk {formatTime(tamu.waktuMasuk)}</span>
            </button>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-display text-base font-semibold">Riwayat</h2>
        {initialRiwayat.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Belum ada riwayat tamu.</p>
        ) : (
          initialRiwayat.map((tamu) => (
            <div key={tamu.kunjunganId} className="rounded-lg border p-3 text-sm">
              <p className="font-medium">{tamu.namaTamu}</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(tamu.waktuMasuk)} — {formatTime(tamu.waktuMasuk)} s/d{" "}
                {tamu.waktuKeluar ? formatTime(tamu.waktuKeluar) : "-"}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Modify `src/components/satpam-app/satpam-tab-shell.tsx`**

Add the import (alongside the existing `PatroliPanel` import):
```tsx
import { TamuPanel } from "@/components/satpam-app/tamu-panel";
import type { TamuKunjunganRow } from "@/lib/queries/satpam-tamu";
```

Remove the now-unused `ComingSoonPanel` import line entirely. `coming-soon-panel.tsx` was only ever consumed by the "tamu" branch this task replaces — confirmed via `grep -rn "ComingSoonPanel" src/` returning only `satpam-tab-shell.tsx` (the consumer) and `coming-soon-panel.tsx` (the definition) before this task's edit. Once this task removes that one usage, the component becomes fully dead code, so delete its file too:
```bash
git rm src/components/satpam-app/coming-soon-panel.tsx
```

Add two new REQUIRED props (alongside the existing Patroli ones, in the same props-type object):
```tsx
  initialTamuDiDalam: TamuKunjunganRow[];
  initialTamuRiwayat: TamuKunjunganRow[];
```
and destructure them the same way `initialActivePatroliSesi`/`initialPatroliRiwayat` are already destructured.

Change the Tamu tab's render branch from:
```tsx
        {visited.has("tamu") && (
          <div className={cn("h-full", activeTab !== "tamu" && "hidden")}>
            <ComingSoonPanel title="Tamu" />
          </div>
        )}
```
to:
```tsx
        {visited.has("tamu") && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "tamu" && "hidden")}>
            <TamuPanel initialDiDalam={initialTamuDiDalam} initialRiwayat={initialTamuRiwayat} />
          </div>
        )}
```
(note the wrapper div also gains `overflow-y-auto`, matching the Inspeksi and Patroli tabs' own wrappers — `TamuPanel`'s content can be taller than one screen, unlike the static "Segera Hadir" placeholder it replaces.)

- [ ] **Step 3: Modify `src/app/mkesindo/satpam-app/(tabs)/page.tsx`**

Add the import:
```tsx
import { getTamuDiDalamAction, getTamuRiwayatAction } from "@/app/mkesindo/satpam-app/actions";
```
Change the `Promise.all` to also fetch Tamu data (alongside the existing `cards`/`timeline`/`profile`/Patroli fetches — do not remove those):
```tsx
  const [cards, timeline, profile, activePatroliResult, patroliRiwayatResult, tamuDiDalamResult, tamuRiwayatResult] =
    await Promise.all([
      getSatpamInspectionList(businessDateISO),
      getSatpamTimeline(businessDateISO),
      getUserById(Number(session.user.id)),
      getActivePatroliSesiAction(),
      getPatroliRiwayatAction(),
      getTamuDiDalamAction(),
      getTamuRiwayatAction(),
    ]);
  const activePatroliSesi = activePatroliResult.success ? activePatroliResult.data : null;
  const patroliRiwayat = patroliRiwayatResult.success ? patroliRiwayatResult.data : [];
  const tamuDiDalam = tamuDiDalamResult.success ? tamuDiDalamResult.data : [];
  const tamuRiwayat = tamuRiwayatResult.success ? tamuRiwayatResult.data : [];
```
Pass the two new props to `SatpamTabShell` (alongside the existing ones):
```tsx
      initialTamuDiDalam={tamuDiDalam}
      initialTamuRiwayat={tamuRiwayat}
```

- [ ] **Step 4: Modify `src/app/mkesindo/satpam-app/(tabs)/patroli/page.tsx`** and **Step 5: Modify `src/app/mkesindo/satpam-app/(tabs)/tamu/page.tsx`**

Apply the EXACT same change as Step 3 to both of these files — same new import, same two extra `Promise.all` entries, same two extra props passed to `SatpamTabShell`. Only each file's own `initialTab` literal and `metadata.title` stay different from one another, as they already are.

- [ ] **Step 6: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/satpam-app/tamu-panel.tsx src/components/satpam-app/satpam-tab-shell.tsx "src/app/mkesindo/satpam-app/(tabs)" src/components/satpam-app/coming-soon-panel.tsx
git commit -m "feat: wire the Tamu panel into the satpam-app tab shell"
```

---

### Task 6: Tamu Baru (entry) screen

**Files:**
- Create: `src/app/mkesindo/satpam-app/tamu/masuk/page.tsx`
- Create: `src/components/satpam-app/tamu-masuk-client.tsx`

**Interfaces:**
- Consumes: `requireSatpam` (`@/lib/require-access`). From Task 1, `useWatermarkCameraCapture`, `WatermarkCaptureResult` (`@/hooks/use-watermark-camera-capture`). From Task 3, the upload route `/api/mkesindo/upload/satpam-tamu` (fields `file`, `jenis="masuk"`, no `kunjunganId`). From Task 4, `createTamuMasukAction` (`@/app/mkesindo/satpam-app/actions`).
- Produces: nothing further downstream.

Unlike Patroli's dedicated full-screen black camera route, this screen shows the text form and the camera in the SAME component — there is no separate photo-only screen for entry, because there is exactly one photo per visit and it belongs together with the form that creates the row. The camera preview is rendered inline (`aspect-video` box), not as a `fixed inset-0` overlay. This is an intentional styling difference from `patroli-foto-client.tsx`, not an oversight.

- [ ] **Step 1: Write `src/app/mkesindo/satpam-app/tamu/masuk/page.tsx`**

```tsx
import type { Metadata } from "next";
import { requireSatpam } from "@/lib/require-access";
import { TamuMasukClient } from "@/components/satpam-app/tamu-masuk-client";

export const metadata: Metadata = { title: "Tamu Baru" };

export default async function TamuMasukPage() {
  await requireSatpam();
  return <TamuMasukClient />;
}
```

- [ ] **Step 2: Write `src/components/satpam-app/tamu-masuk-client.tsx`**

```tsx
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
            <Button variant="outline" onClick={() => setCaptured(null)}>
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
```

- [ ] **Step 3: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean.

- [ ] **Step 4: Manual browser verification**

Open `/mkesindo/satpam-app`, switch to the Tamu tab, logged in as an `isSatpam` account. Confirm:
1. "Tamu Baru" opens the entry form; "Simpan" stays disabled until Nama Tamu, Tujuan Kunjungan, and Dikunjungi are all filled AND a photo has been captured.
2. "Buka Kamera" → "Ambil Foto" produces a preview with a watermark (address/coordinates/WIB time/weather) baked into the image; "Ambil Ulang" discards it and reopens the camera.
3. Leaving "Asal Instansi" and "Nomor Kendaraan" empty still allows saving.
4. Saving returns to the Tamu tab with the new guest now listed under "Tamu di Dalam".

If no `isSatpam` test credentials are available in this environment, fall back to a careful, itemized code-review trace against this same 4-item checklist instead of skipping this step silently.

- [ ] **Step 5: Commit**

```bash
git add src/app/mkesindo/satpam-app/tamu/masuk src/components/satpam-app/tamu-masuk-client.tsx
git commit -m "feat: add the Tamu Baru (entry) screen"
```

---

### Task 7: Tamu Keluar (exit) confirmation screen

**Files:**
- Create: `src/app/mkesindo/satpam-app/tamu/keluar/[kunjunganId]/page.tsx`
- Create: `src/components/satpam-app/tamu-keluar-client.tsx`

**Interfaces:**
- Consumes: `requireSatpam` (`@/lib/require-access`). From Task 2, `TamuKunjunganRow` (`@/lib/queries/satpam-tamu`, type only). From Task 1, `useWatermarkCameraCapture`, `WatermarkCaptureResult` (`@/hooks/use-watermark-camera-capture`). From Task 3, the upload route `/api/mkesindo/upload/satpam-tamu` (fields `file`, `jenis="keluar"`, `kunjunganId`). From Task 4, `getTamuByIdAction`, `recordTamuKeluarAction` (`@/app/mkesindo/satpam-app/actions`). `formatTime` (already exists, `@/lib/format`).
- Produces: nothing further downstream — this is the final task.

This route lives OUTSIDE the `(tabs)/` route group (a sibling, same as `inspeksi/[jadwalId]/page.tsx` and `patroli/foto/[sesiId]/page.tsx`) — reached via real Next.js navigation, so visiting it correctly unmounts the whole `SatpamTabShell` tree. If the visit is already checked out (or doesn't exist), the page calls `notFound()` rather than rendering a broken form — this can legitimately happen if two satpam tap the same "Tamu di Dalam" card at nearly the same moment and one of them finishes first.

- [ ] **Step 1: Write `src/app/mkesindo/satpam-app/tamu/keluar/[kunjunganId]/page.tsx`**

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSatpam } from "@/lib/require-access";
import { getTamuByIdAction } from "@/app/mkesindo/satpam-app/actions";
import { TamuKeluarClient } from "@/components/satpam-app/tamu-keluar-client";

export const metadata: Metadata = { title: "Konfirmasi Tamu Keluar" };

export default async function TamuKeluarPage({ params }: { params: Promise<{ kunjunganId: string }> }) {
  await requireSatpam();
  const { kunjunganId: kunjunganIdParam } = await params;
  const kunjunganId = Number(kunjunganIdParam);
  if (!Number.isInteger(kunjunganId)) notFound();

  const result = await getTamuByIdAction(kunjunganId);
  const tamu = result.success ? result.data : null;
  if (!tamu || tamu.waktuKeluar) notFound();

  return <TamuKeluarClient tamu={tamu} />;
}
```

- [ ] **Step 2: Write `src/components/satpam-app/tamu-keluar-client.tsx`**

```tsx
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
```

- [ ] **Step 3: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean.

- [ ] **Step 4: Manual browser verification**

Continuing from a guest already created in Task 6's verification (or creating one now), logged in as an `isSatpam` account. Confirm:
1. Tapping that guest's card under "Tamu di Dalam" opens the exit-confirmation screen, showing the guest's name/tujuan/dikunjungi/jam masuk correctly.
2. "Ambil Foto" produces a preview with a watermark baked in; "Ambil Ulang" retakes it.
3. "Simpan" returns to the Tamu tab with the guest now moved from "Tamu di Dalam" to "Riwayat", showing both jam masuk and jam keluar.
4. Navigating directly to `/mkesindo/satpam-app/tamu/keluar/<kunjunganId>` for a guest who has ALREADY been checked out (or an invalid id) shows a 404, not a broken form.

If no `isSatpam` test credentials are available in this environment, fall back to a careful, itemized code-review trace against this same 4-item checklist instead of skipping this step silently.

- [ ] **Step 5: Commit**

```bash
git add "src/app/mkesindo/satpam-app/tamu/keluar" src/components/satpam-app/tamu-keluar-client.tsx
git commit -m "feat: add the Tamu Keluar (exit) confirmation screen"
```
