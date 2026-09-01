# Tab Patroli Satpam-App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Segera Hadir" placeholder on satpam-app's Patroli tab with a real 13-point facility photo checklist, each photo watermarked with location/weather/time, plus a flexible "Foto Tambahan" section, tied to an ad-hoc patrol session that snapshots the current on-duty shift.

**Architecture:** Two new MSSQL tables (session + photo) behind a dedicated query layer. A brand-new, fully independent camera hook (`usePatroliCameraCapture`) composites the watermark onto the canvas before upload — it does NOT touch or wrap the existing Inspeksi camera hook. A new server-side weather proxy mirrors the existing geocode proxy. The Patroli tab panel and a full-screen per-photo capture route are wired into the existing satpam-app tab-shell (built in an earlier plan) by extending its props.

**Tech Stack:** Next.js Server Components + Server Actions, MSSQL (`mssql` via `@/lib/db`), Google Drive upload (`@/lib/storage/google-drive`), Open-Meteo (free weather API), the existing `/api/geocode` reverse-geocoding proxy, shadcn/ui, Tailwind, `lucide-react`.

**Spec:** docs/superpowers/specs/2026-09-02-satpam-patroli-design.md

## Global Constraints

- **Never modify `src/hooks/use-live-camera-capture.ts` or `src/components/satpam-app/live-inspeksi-client.tsx`.** The new Patroli camera hook (`usePatroliCameraCapture`) is a fully separate file with its own `getUserMedia`/torch/retry logic — intentional small duplication, not a shared/generalized hook. Inspeksi's vehicle-check camera flow must be completely unaffected by this plan.
- **Never modify `src/lib/business-date.ts`.** The watermark's WIB date+time text is a purely cosmetic, client-side display formatter with exactly one consumer — write it inline in `use-patroli-camera-capture.ts`, built via an EXPLICIT `Intl.DateTimeFormat` with `timeZone: "Asia/Jakarta"` pinned (mirroring `getWibTimeHHmm`'s own technique in `business-date.ts`) — never via `formatDate`/`formatTime` from `src/lib/format.ts` (those read the browser's ambient/local timezone with no override, which is only correct by coincidence and is exactly the class of bug `business-date.ts` and this codebase's own project memory document extensively).
- A patrol session is genuinely ad-hoc (no shift-boundary gating on when one can start) — the shift snapshot (`ShiftType`/`TanggalUsahaShift` on `DashboardSatpamPatroliSesi`) is purely informational, captured once at session start by matching the CURRENT logged-in satpam's own `satpamAkunId` against `getSatpamOnDutyNowAction()`'s returned rows. If no match, both snapshot fields are `NULL` — not an error.
- Only one ACTIVE session (`SelesaiWaktu IS NULL`) is allowed per satpam at a time. `startPatroliSesiAction` must reject starting a second one with a clear error message.
- "Selesai Patroli" is blocked (both in the UI — button disabled — and re-validated server-side in `selesaiPatroliSesiAction`, defense-in-depth) until all 13 fixed `PATROLI_TITIK_LIST` spots have at least one photo. "Foto Tambahan" photos never count toward or block this.
- GPS/geocode/weather failures never block taking or saving a photo — the watermark renders "tidak tersedia" text for whichever piece failed, and the photo upload still proceeds.
- No automated test suite exists in this repo. The camera/watermark hook (Task 3) uses browser-only APIs (`canvas`, `navigator.geolocation`, `navigator.mediaDevices`) that cannot run in a Node/`tsx` scratch script — its verification is `tsc --noEmit` + `npm run lint` + manual browser testing (or a documented code-review fallback if no `isSatpam` credentials are available in this environment — an established, recurring, accepted limitation from every other satpam-app sub-project this session).
- New MSSQL tables follow this codebase's established `Dashboard`-prefixed convention (`INT IDENTITY PRIMARY KEY`, `IsDeleted BIT NOT NULL DEFAULT 0`, `CreatedDate`/`ModifiedDate DATETIME NOT NULL DEFAULT GETDATE()` where the spec's own DDL includes them), created via a one-off idempotent script under `scripts/`, run manually via `npx tsx scripts/...`.

---

### Task 1: Weather API proxy route

**Files:**
- Create: `src/app/api/weather/route.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (first task in this plan).
- Produces (consumed by Task 3): `GET /api/weather?lat=<number>&lng=<number>` → `{ cuaca: string; suhu: number }` on success, `{ error: string }` (with a non-200 status) on failure.

- [ ] **Step 1: Write `src/app/api/weather/route.ts`**

```ts
// app/api/weather/route.ts
// Server-side proxy for current weather at a coordinate, used by the Patroli
// photo watermark. Open-Meteo needs no API key and has no special header
// requirements (unlike Nominatim in /api/geocode) — this route exists purely
// to centralize the WMO-weathercode-to-Indonesian-label mapping in one place,
// not because the browser is blocked from calling Open-Meteo directly.
import { NextRequest, NextResponse } from "next/server";

const OPEN_METEO_BASE_URL = "https://api.open-meteo.com/v1/forecast";

interface OpenMeteoResponse {
  current_weather?: {
    temperature: number;
    weathercode: number;
  };
}

// Kode cuaca WMO (dipakai Open-Meteo) -> label singkat Indonesia. Kode yang
// tidak ada di tabel ini jatuh ke label generik "Tidak diketahui", bukan
// error — beberapa kode salju (71-77, 85-86) nyaris tidak pernah terjadi di
// Indonesia tapi tetap dipetakan untuk kelengkapan/keamanan.
const WEATHER_CODE_LABEL: Record<number, string> = {
  0: "Cerah",
  1: "Cerah Berawan",
  2: "Berawan Sebagian",
  3: "Berawan",
  45: "Berkabut",
  48: "Berkabut",
  51: "Gerimis Ringan",
  53: "Gerimis Sedang",
  55: "Gerimis Lebat",
  56: "Gerimis Beku",
  57: "Gerimis Beku Lebat",
  61: "Hujan Ringan",
  63: "Hujan Sedang",
  65: "Hujan Lebat",
  66: "Hujan Beku Ringan",
  67: "Hujan Beku Lebat",
  71: "Salju Ringan",
  73: "Salju Sedang",
  75: "Salju Lebat",
  77: "Salju",
  80: "Hujan Lebat Sesaat",
  81: "Hujan Lebat Sesaat",
  82: "Hujan Sangat Lebat Sesaat",
  85: "Salju Sesaat Ringan",
  86: "Salju Sesaat Lebat",
  95: "Badai Petir",
  96: "Badai Petir dengan Hujan Es",
  99: "Badai Petir dengan Hujan Es Lebat",
};

function labelForWeatherCode(code: number): string {
  return WEATHER_CODE_LABEL[code] ?? "Tidak diketahui";
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");

  if (!lat || !lng) {
    return NextResponse.json({ error: "Parameter lat & lng wajib diisi" }, { status: 400 });
  }

  try {
    const url = `${OPEN_METEO_BASE_URL}?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(
      lng
    )}&current_weather=true`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: "Gagal memuat cuaca" }, { status: 502 });
    }
    const data = (await res.json()) as OpenMeteoResponse;
    if (!data.current_weather) {
      return NextResponse.json({ error: "Data cuaca tidak tersedia" }, { status: 502 });
    }
    return NextResponse.json({
      cuaca: labelForWeatherCode(data.current_weather.weathercode),
      suhu: data.current_weather.temperature,
    });
  } catch (err) {
    console.error("Weather error:", err);
    return NextResponse.json({ error: "Gagal memuat cuaca" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Manually verify the route responds**

```bash
npm run dev
```
In another terminal (or a browser tab), once the dev server is up:
```bash
curl "http://localhost:3000/api/weather?lat=-7.797&lng=110.370"
```
Expected: a JSON body like `{"cuaca":"...","suhu":...}` (a real weather label and temperature for that coordinate, Yogyakarta). Stop the dev server after confirming.

- [ ] **Step 3: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/weather/route.ts
git commit -m "feat: add a weather API proxy for the Patroli photo watermark"
```

---

### Task 2: Database tables and query layer

**Files:**
- Create: `scripts/create-satpam-patroli-tables.ts`
- Create: `src/lib/queries/satpam-patroli.ts`

**Interfaces:**
- Consumes: `getPool`, `sql` from `@/lib/db`. `SatpamShiftType` (type, already exists) from `@/lib/satpam-shift`.
- Produces (consumed by Task 5): `PATROLI_TITIK_LIST: string[]` (13 fixed spot names). `PatroliFotoRow`, `PatroliSesiRow`, `PatroliSesiDetail` (`PatroliSesiRow & { fotos: PatroliFotoRow[] }`), `PatroliSesiRingkas` (interfaces). `getActivePatroliSesi(satpamAkunId: number): Promise<PatroliSesiDetail | null>`, `getPatroliRiwayat(satpamAkunId: number): Promise<PatroliSesiRingkas[]>`, `createPatroliSesi(input: { satpamAkunId: number; shiftType: SatpamShiftType | null; tanggalUsahaShift: Date | null }): Promise<number>`, `addPatroliFoto(input: { sesiId: number; titikPatroli: string | null; keterangan: string | null; fotoPath: string; latitude: number | null; longitude: number | null }): Promise<void>`, `selesaiPatroliSesi(sesiId: number): Promise<void>`.

- [ ] **Step 1: Write the migration script**

Create `scripts/create-satpam-patroli-tables.ts`:

```ts
// One-off table creation for the satpam-app Patroli feature -- idempotent,
// safe to re-run.
// Usage: npx tsx scripts/create-satpam-patroli-tables.ts
import "dotenv/config";
import { getPool } from "../src/lib/db";

async function main() {
  const pool = await getPool();

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardSatpamPatroliSesi' AND xtype='U')
    CREATE TABLE DashboardSatpamPatroliSesi (
      SesiID            INT IDENTITY PRIMARY KEY,
      SatpamAkunID      INT NOT NULL,
      ShiftType         VARCHAR(12) NULL,
      TanggalUsahaShift DATE NULL,
      MulaiWaktu        DATETIME NOT NULL DEFAULT GETDATE(),
      SelesaiWaktu      DATETIME NULL,
      IsDeleted         BIT NOT NULL DEFAULT 0,
      ModifiedDate      DATETIME NOT NULL DEFAULT GETDATE()
    )
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DashboardSatpamPatroliFoto' AND xtype='U')
    CREATE TABLE DashboardSatpamPatroliFoto (
      FotoID       INT IDENTITY PRIMARY KEY,
      SesiID       INT NOT NULL,
      TitikPatroli VARCHAR(50) NULL,
      Keterangan   VARCHAR(256) NULL,
      FotoPath     VARCHAR(256) NOT NULL,
      Latitude     DECIMAL(10,7) NULL,
      Longitude    DECIMAL(10,7) NULL,
      WaktuFoto    DATETIME NOT NULL DEFAULT GETDATE(),
      IsDeleted    BIT NOT NULL DEFAULT 0
    )
  `);

  console.log("DashboardSatpamPatroliSesi + DashboardSatpamPatroliFoto ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the script against the live MSSQL database**

```bash
npx tsx scripts/create-satpam-patroli-tables.ts
```
Expected: `DashboardSatpamPatroliSesi + DashboardSatpamPatroliFoto ready.` printed, exit code 0. Safe to re-run.

- [ ] **Step 3: Write `src/lib/queries/satpam-patroli.ts`**

```ts
import { getPool, sql } from "@/lib/db";
import type { SatpamShiftType } from "@/lib/satpam-shift";

export const PATROLI_TITIK_LIST: string[] = [
  "Area Produksi Es Balok-A",
  "Area Produksi Es Balok-B",
  "Area Produksi Es Balok-C",
  "Area Produksi Es Kristal-A",
  "Area Produksi Es Kristal-B",
  "Area Produksi Es Kristal-C",
  "Area Cuci Armada Es Kristal",
  "Gudang",
  "Distribusi",
  "Ruang Trafo Kelistrikan",
  "Tempat Parkir Kendaraan Karyawan",
  "Area Parkir Armada Operasional",
  "Area Luar Kantor",
];

export interface PatroliFotoRow {
  fotoId: number;
  sesiId: number;
  titikPatroli: string | null;
  keterangan: string | null;
  fotoPath: string;
  latitude: number | null;
  longitude: number | null;
  waktuFoto: Date;
}

export interface PatroliSesiRow {
  sesiId: number;
  satpamAkunId: number;
  shiftType: SatpamShiftType | null;
  tanggalUsahaShift: Date | null;
  mulaiWaktu: Date;
  selesaiWaktu: Date | null;
}

export interface PatroliSesiDetail extends PatroliSesiRow {
  fotos: PatroliFotoRow[];
}

export interface PatroliSesiRingkas {
  sesiId: number;
  mulaiWaktu: Date;
  selesaiWaktu: Date;
  jumlahFoto: number;
}

interface SesiDbRow {
  SesiID: number;
  SatpamAkunID: number;
  ShiftType: SatpamShiftType | null;
  TanggalUsahaShift: Date | null;
  MulaiWaktu: Date;
  SelesaiWaktu: Date | null;
}

interface FotoDbRow {
  FotoID: number;
  SesiID: number;
  TitikPatroli: string | null;
  Keterangan: string | null;
  FotoPath: string;
  Latitude: number | null;
  Longitude: number | null;
  WaktuFoto: Date;
}

function mapSesiRow(r: SesiDbRow): PatroliSesiRow {
  return {
    sesiId: r.SesiID,
    satpamAkunId: r.SatpamAkunID,
    shiftType: r.ShiftType,
    tanggalUsahaShift: r.TanggalUsahaShift,
    mulaiWaktu: r.MulaiWaktu,
    selesaiWaktu: r.SelesaiWaktu,
  };
}

function mapFotoRow(r: FotoDbRow): PatroliFotoRow {
  return {
    fotoId: r.FotoID,
    sesiId: r.SesiID,
    titikPatroli: r.TitikPatroli,
    keterangan: r.Keterangan,
    fotoPath: r.FotoPath,
    latitude: r.Latitude,
    longitude: r.Longitude,
    waktuFoto: r.WaktuFoto,
  };
}

export async function getActivePatroliSesi(satpamAkunId: number): Promise<PatroliSesiDetail | null> {
  const pool = await getPool();
  const sesiResult = await pool
    .request()
    .input("satpamAkunId", sql.Int, satpamAkunId)
    .query(`
      SELECT TOP 1 SesiID, SatpamAkunID, ShiftType, TanggalUsahaShift, MulaiWaktu, SelesaiWaktu
      FROM DashboardSatpamPatroliSesi
      WHERE SatpamAkunID = @satpamAkunId AND SelesaiWaktu IS NULL AND IsDeleted = 0
      ORDER BY MulaiWaktu DESC
    `);
  const sesiRow = (sesiResult.recordset as SesiDbRow[])[0];
  if (!sesiRow) return null;

  const fotoResult = await pool
    .request()
    .input("sesiId", sql.Int, sesiRow.SesiID)
    .query(`
      SELECT FotoID, SesiID, TitikPatroli, Keterangan, FotoPath, Latitude, Longitude, WaktuFoto
      FROM DashboardSatpamPatroliFoto
      WHERE SesiID = @sesiId AND IsDeleted = 0
      ORDER BY WaktuFoto ASC
    `);

  return {
    ...mapSesiRow(sesiRow),
    fotos: (fotoResult.recordset as FotoDbRow[]).map(mapFotoRow),
  };
}

export async function getPatroliRiwayat(satpamAkunId: number): Promise<PatroliSesiRingkas[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("satpamAkunId", sql.Int, satpamAkunId)
    .query(`
      SELECT s.SesiID, s.MulaiWaktu, s.SelesaiWaktu, COUNT(f.FotoID) AS JumlahFoto
      FROM DashboardSatpamPatroliSesi s
      LEFT JOIN DashboardSatpamPatroliFoto f ON f.SesiID = s.SesiID AND f.IsDeleted = 0
      WHERE s.SatpamAkunID = @satpamAkunId AND s.SelesaiWaktu IS NOT NULL AND s.IsDeleted = 0
      GROUP BY s.SesiID, s.MulaiWaktu, s.SelesaiWaktu
      ORDER BY s.SelesaiWaktu DESC
    `);
  return (result.recordset as (SesiDbRow & { JumlahFoto: number })[]).map((r) => ({
    sesiId: r.SesiID,
    mulaiWaktu: r.MulaiWaktu,
    selesaiWaktu: r.SelesaiWaktu as Date,
    jumlahFoto: r.JumlahFoto,
  }));
}

export async function createPatroliSesi(input: {
  satpamAkunId: number;
  shiftType: SatpamShiftType | null;
  tanggalUsahaShift: Date | null;
}): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("satpamAkunId", sql.Int, input.satpamAkunId)
    .input("shiftType", sql.VarChar(12), input.shiftType)
    .input("tanggalUsahaShift", sql.Date, input.tanggalUsahaShift)
    .query(`
      INSERT INTO DashboardSatpamPatroliSesi (SatpamAkunID, ShiftType, TanggalUsahaShift)
      OUTPUT INSERTED.SesiID
      VALUES (@satpamAkunId, @shiftType, @tanggalUsahaShift)
    `);
  return (result.recordset[0] as { SesiID: number }).SesiID;
}

export async function addPatroliFoto(input: {
  sesiId: number;
  titikPatroli: string | null;
  keterangan: string | null;
  fotoPath: string;
  latitude: number | null;
  longitude: number | null;
}): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("sesiId", sql.Int, input.sesiId)
    .input("titikPatroli", sql.VarChar(50), input.titikPatroli)
    .input("keterangan", sql.VarChar(256), input.keterangan)
    .input("fotoPath", sql.VarChar(256), input.fotoPath)
    .input("latitude", sql.Decimal(10, 7), input.latitude)
    .input("longitude", sql.Decimal(10, 7), input.longitude)
    .query(`
      INSERT INTO DashboardSatpamPatroliFoto (SesiID, TitikPatroli, Keterangan, FotoPath, Latitude, Longitude)
      VALUES (@sesiId, @titikPatroli, @keterangan, @fotoPath, @latitude, @longitude)
    `);
}

export async function selesaiPatroliSesi(sesiId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("sesiId", sql.Int, sesiId)
    .query(`UPDATE DashboardSatpamPatroliSesi SET SelesaiWaktu = GETDATE(), ModifiedDate = GETDATE() WHERE SesiID = @sesiId`);
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
git add scripts/create-satpam-patroli-tables.ts src/lib/queries/satpam-patroli.ts
git commit -m "feat: add Patroli session/photo tables and query layer"
```

---

### Task 3: Watermark camera-capture hook

**Files:**
- Create: `src/hooks/use-patroli-camera-capture.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks — a fully self-contained browser hook. Consumes the existing `/api/geocode` route (unchanged) and Task 1's new `/api/weather` route at runtime (via `fetch`, not an import).
- Produces (consumed by Task 7): `PatroliCaptureResult` (interface: `{ file: File; latitude: number | null; longitude: number | null }`), `usePatroliCameraCapture({ label: string; active: boolean; onCapture: (result: PatroliCaptureResult) => void }): { videoRef: React.RefObject<HTMLVideoElement | null>; error: string | null; capturing: boolean; retry: () => void; handleCapture: () => void }`.

- [ ] **Step 1: Write `src/hooks/use-patroli-camera-capture.ts`**

```ts
"use client";

import { useEffect, useRef, useState } from "react";

export interface PatroliCaptureResult {
  file: File;
  latitude: number | null;
  longitude: number | null;
}

export interface UsePatroliCameraCaptureOptions {
  label: string;
  active: boolean;
  onCapture: (result: PatroliCaptureResult) => void;
}

export interface UsePatroliCameraCaptureResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  error: string | null;
  capturing: boolean;
  retry: () => void;
  handleCapture: () => void;
}

// Format tanggal+jam WIB untuk watermark -- SENGAJA pin timeZone:"Asia/Jakarta"
// secara eksplisit (bukan mengandalkan zona waktu perangkat/browser), meniru
// teknik getWibTimeHHmm di business-date.ts. Ini murni formatter kosmetik
// untuk SATU pemakai (watermark foto), sehingga sengaja ditaruh di sini,
// bukan di business-date.ts yang jadi tumpuan logika penulisan tanggal ke
// database yang jauh lebih sensitif (lihat Global Constraints plan ini).
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

export function usePatroliCameraCapture({
  label,
  active,
  onCapture,
}: UsePatroliCameraCaptureOptions): UsePatroliCameraCaptureResult {
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

- [ ] **Step 2: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-patroli-camera-capture.ts
git commit -m "feat: add a watermarked camera-capture hook for Patroli photos"
```

(Manual browser verification of this hook happens in Task 7, once it has a screen to render inside.)

---

### Task 4: Photo upload route

**Files:**
- Create: `src/app/api/mkesindo/upload/satpam-patroli/route.ts`

**Interfaces:**
- Consumes: `uploadFile` from `@/lib/storage/google-drive` (already exists, signature `(perusahaanKode: string, categoryPath: string[], filename: string, buffer: Buffer, mimeType: string): Promise<{ fileId: string; publicPath: string }>`). `requireModuleAccess` from `@/lib/require-access`, `auth` from `@/lib/auth` (both already exist).
- Produces (consumed by Task 7): `POST /api/mkesindo/upload/satpam-patroli` (multipart form: `file`, `sesiId`, optional `titikPatroli`) → `{ path: string }` on success, `{ error: string }` on failure.

- [ ] **Step 1: Write `src/app/api/mkesindo/upload/satpam-patroli/route.ts`**

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
  // isSuperAdmin. Mirrors satpam-check/route.ts's own identical gate.
  const session = await auth();
  if (!session?.user?.isSatpam) {
    return NextResponse.json({ error: "Hanya Satpam yang dapat mengunggah foto ini." }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  const sesiId = formData.get("sesiId");
  const titikPatroli = formData.get("titikPatroli");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File tidak ditemukan" }, { status: 400 });
  }
  if (typeof sesiId !== "string" || !sesiId.trim() || !Number.isInteger(Number(sesiId))) {
    return NextResponse.json({ error: "sesiId wajib diisi" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Format file harus JPG, PNG, atau WEBP" }, { status: 400 });
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: "Ukuran file maksimal 5MB" }, { status: 400 });
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("") + "-" + [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  const safeTitik = typeof titikPatroli === "string" && titikPatroli.trim()
    ? titikPatroli.replace(/[^a-zA-Z0-9_-]/g, "-")
    : "tambahan";
  const fileName = `${stamp}-${safeTitik}.${ext}`;
  const safeSesiId = sesiId.replace(/[^0-9]/g, "");

  try {
    const bytes = await file.arrayBuffer();
    const uploaded = await uploadFile("mkesindo", ["satpam-patroli", safeSesiId], fileName, Buffer.from(bytes), file.type);
    return NextResponse.json({ path: uploaded.publicPath });
  } catch (err) {
    console.error("[upload/satpam-patroli] gagal mengunggah ke Google Drive:", err);
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
git add src/app/api/mkesindo/upload/satpam-patroli/route.ts
git commit -m "feat: add the Patroli photo upload route"
```

---

### Task 5: Server Actions

**Files:**
- Create: `src/app/mkesindo/satpam-app/actions.ts`

**Interfaces:**
- Consumes: `requireSatpam` from `@/lib/require-access`. `AppError`, `runAction`, `ActionResult` from `@/lib/action-result`. `revalidatePath` from `next/cache`. From Task 2: `PATROLI_TITIK_LIST`, `PatroliSesiDetail`, `PatroliSesiRingkas`, `getActivePatroliSesi`, `getPatroliRiwayat`, `createPatroliSesi`, `addPatroliFoto`, `selesaiPatroliSesi` (from `@/lib/queries/satpam-patroli`). `getSatpamOnDutyNowAction` (already exists, from `@/app/mkesindo/(dashboard)/keamanan/actions`, returns `Promise<ActionResult<SatpamJadwalDisplayRow[]>>` where each row has `{ satpamAkunId: number; shiftType: SatpamShiftType; tanggalUsaha: Date; ... }`).
- Produces (consumed by Tasks 6 and 7): `startPatroliSesiAction(): Promise<ActionResult<{ sesiId: number }>>`, `getActivePatroliSesiAction(): Promise<ActionResult<PatroliSesiDetail | null>>`, `getPatroliRiwayatAction(): Promise<ActionResult<PatroliSesiRingkas[]>>`, `addPatroliFotoAction(input: { sesiId: number; titikPatroli: string | null; keterangan: string | null; fotoPath: string; latitude: number | null; longitude: number | null }): Promise<ActionResult<void>>`, `selesaiPatroliSesiAction(sesiId: number): Promise<ActionResult<void>>`.

- [ ] **Step 1: Write `src/app/mkesindo/satpam-app/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireSatpam } from "@/lib/require-access";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";
import {
  PATROLI_TITIK_LIST,
  getActivePatroliSesi,
  getPatroliRiwayat,
  createPatroliSesi,
  addPatroliFoto,
  selesaiPatroliSesi,
  type PatroliSesiDetail,
  type PatroliSesiRingkas,
} from "@/lib/queries/satpam-patroli";
import { getSatpamOnDutyNowAction } from "@/app/mkesindo/(dashboard)/keamanan/actions";

export async function startPatroliSesiAction(): Promise<ActionResult<{ sesiId: number }>> {
  return runAction(async () => {
    const session = await requireSatpam();
    const akunId = Number(session.user.id);

    const existing = await getActivePatroliSesi(akunId);
    if (existing) {
      throw new AppError("Anda sudah punya sesi Patroli yang sedang berjalan.");
    }

    const onDutyResult = await getSatpamOnDutyNowAction();
    const onDutyRow = onDutyResult.success ? onDutyResult.data.find((r) => r.satpamAkunId === akunId) : undefined;

    const sesiId = await createPatroliSesi({
      satpamAkunId: akunId,
      shiftType: onDutyRow?.shiftType ?? null,
      tanggalUsahaShift: onDutyRow?.tanggalUsaha ?? null,
    });
    revalidatePath("/mkesindo/satpam-app/patroli");
    return { sesiId };
  });
}

export async function getActivePatroliSesiAction(): Promise<ActionResult<PatroliSesiDetail | null>> {
  return runAction(async () => {
    const session = await requireSatpam();
    return getActivePatroliSesi(Number(session.user.id));
  });
}

export async function getPatroliRiwayatAction(): Promise<ActionResult<PatroliSesiRingkas[]>> {
  return runAction(async () => {
    const session = await requireSatpam();
    return getPatroliRiwayat(Number(session.user.id));
  });
}

export async function addPatroliFotoAction(input: {
  sesiId: number;
  titikPatroli: string | null;
  keterangan: string | null;
  fotoPath: string;
  latitude: number | null;
  longitude: number | null;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireSatpam();
    if (input.titikPatroli === null && !input.keterangan?.trim()) {
      throw new AppError("Foto Tambahan wajib diberi keterangan.");
    }
    await addPatroliFoto(input);
    revalidatePath("/mkesindo/satpam-app/patroli");
  });
}

export async function selesaiPatroliSesiAction(sesiId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireSatpam();
    const sesi = await getActivePatroliSesi(Number(session.user.id));
    if (!sesi || sesi.sesiId !== sesiId) {
      throw new AppError("Sesi Patroli tidak ditemukan atau sudah selesai.");
    }
    const titikTerisi = new Set(sesi.fotos.map((f) => f.titikPatroli).filter((t): t is string => t !== null));
    const belumLengkap = PATROLI_TITIK_LIST.filter((t) => !titikTerisi.has(t));
    if (belumLengkap.length > 0) {
      throw new AppError(`Masih ada ${belumLengkap.length} titik yang belum difoto: ${belumLengkap.join(", ")}.`);
    }
    await selesaiPatroliSesi(sesiId);
    revalidatePath("/mkesindo/satpam-app/patroli");
  });
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
git add src/app/mkesindo/satpam-app/actions.ts
git commit -m "feat: add Server Actions for the Patroli session/photo flow"
```

---

### Task 6: Patroli tab panel, wired into the tab shell

**Files:**
- Create: `src/components/satpam-app/patroli-panel.tsx`
- Modify: `src/components/satpam-app/satpam-tab-shell.tsx`
- Modify: `src/app/mkesindo/satpam-app/(tabs)/page.tsx`
- Modify: `src/app/mkesindo/satpam-app/(tabs)/patroli/page.tsx`
- Modify: `src/app/mkesindo/satpam-app/(tabs)/tamu/page.tsx`

**Interfaces:**
- Consumes: from Task 2, `PatroliSesiDetail`, `PatroliSesiRingkas`, `PATROLI_TITIK_LIST` (`@/lib/queries/satpam-patroli`). From Task 5, `startPatroliSesiAction`, `selesaiPatroliSesiAction` (`@/app/mkesindo/satpam-app/actions`) — used by the panel; `getActivePatroliSesiAction`, `getPatroliRiwayatAction` — used by the three page.tsx files for their initial server-side fetch. `formatDate`/`formatTime` (already exist, `@/lib/format`).
- Produces (consumed by Task 7): `PatroliPanel`'s "Tambah Foto"/checklist-tap buttons navigate to `router.push(\`/mkesindo/satpam-app/patroli/foto/${sesiId}?titik=${encodeURIComponent(titik)}\`)` for a fixed spot, or `router.push(\`/mkesindo/satpam-app/patroli/foto/${sesiId}\`)` (no `titik` query param at all) for Foto Tambahan — Task 7's route must read `titik` as `null`/absent to mean "Foto Tambahan mode".

This task follows the SAME Global Constraint already established by the earlier tab-shell plan: every one of the 3 `(tabs)/*/page.tsx` files fetches the SAME small dataset regardless of which tab it represents, so switching tabs never shows stale/missing data. This task extends that same principle to Patroli's own data (`getActivePatroliSesiAction`/`getPatroliRiwayatAction`), alongside the already-existing Inspeksi data fetch each of those 3 files already does — do not remove or alter the existing Inspeksi fetch in any of them.

- [ ] **Step 1: Write `src/components/satpam-app/patroli-panel.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Camera, CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startPatroliSesiAction, selesaiPatroliSesiAction } from "@/app/mkesindo/satpam-app/actions";
import { PATROLI_TITIK_LIST, type PatroliSesiDetail, type PatroliSesiRingkas } from "@/lib/queries/satpam-patroli";
import { formatDate, formatTime } from "@/lib/format";

// Konten tab "Patroli" -- dua kondisi: tidak ada sesi aktif (tombol Mulai +
// riwayat) atau ada sesi aktif (checklist 13 titik + Foto Tambahan + Selesai
// Patroli). Setiap tap titik/Foto Tambahan pindah ke route penuh-layar
// terpisah (Task 7) lewat navigasi Next.js sungguhan (bukan tab-switch di
// dalam shell) -- pola yang sama seperti tombol "Inspeksi" di InspeksiPanel.
export function PatroliPanel({
  initialActiveSesi,
  initialRiwayat,
}: {
  initialActiveSesi: PatroliSesiDetail | null;
  initialRiwayat: PatroliSesiRingkas[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleMulai() {
    startTransition(async () => {
      const result = await startPatroliSesiAction();
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.push("/mkesindo/satpam-app/patroli");
    });
  }

  function handleSelesai() {
    if (!initialActiveSesi) return;
    startTransition(async () => {
      const result = await selesaiPatroliSesiAction(initialActiveSesi.sesiId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.push("/mkesindo/satpam-app/patroli");
    });
  }

  if (!initialActiveSesi) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Button size="lg" className="h-14" disabled={pending} onClick={handleMulai}>
          Mulai Patroli
        </Button>
        <div className="flex flex-col gap-2">
          <h2 className="font-display text-base font-semibold">Riwayat Patroli</h2>
          {initialRiwayat.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Belum ada riwayat patroli.</p>
          ) : (
            initialRiwayat.map((sesi) => (
              <div key={sesi.sesiId} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">
                  {formatDate(sesi.mulaiWaktu)} — {formatTime(sesi.mulaiWaktu)} s/d {formatTime(sesi.selesaiWaktu)}
                </p>
                <p className="text-xs text-muted-foreground">{sesi.jumlahFoto} foto</p>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  const fotoByTitik = new Map(
    initialActiveSesi.fotos.filter((f) => f.titikPatroli != null).map((f) => [f.titikPatroli as string, f])
  );
  const fotoTambahan = initialActiveSesi.fotos.filter((f) => f.titikPatroli == null);
  const semuaTitikTerisi = PATROLI_TITIK_LIST.every((t) => fotoByTitik.has(t));

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-2">
        {PATROLI_TITIK_LIST.map((titik) => {
          const sudah = fotoByTitik.has(titik);
          return (
            <button
              key={titik}
              type="button"
              className="flex items-center justify-between gap-2 rounded-lg border p-3 text-left"
              onClick={() =>
                router.push(`/mkesindo/satpam-app/patroli/foto/${initialActiveSesi.sesiId}?titik=${encodeURIComponent(titik)}`)
              }
            >
              <span className="text-sm">{titik}</span>
              {sudah ? (
                <CheckCircle2 className="size-5 text-emerald-600" />
              ) : (
                <Circle className="size-5 text-muted-foreground" />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-display text-base font-semibold">Foto Tambahan</h2>
        {fotoTambahan.map((f) => (
          <div key={f.fotoId} className="rounded-lg border p-3 text-sm">
            {f.keterangan}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(`/mkesindo/satpam-app/patroli/foto/${initialActiveSesi.sesiId}`)}
        >
          <Camera className="size-4" /> Tambah Foto
        </Button>
      </div>

      <Button size="lg" className="h-14" disabled={pending || !semuaTitikTerisi} onClick={handleSelesai}>
        Selesai Patroli
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Modify `src/components/satpam-app/satpam-tab-shell.tsx`**

Add the import (alongside the existing `InspeksiPanel`/`ComingSoonPanel` imports):
```tsx
import { PatroliPanel } from "@/components/satpam-app/patroli-panel";
import type { PatroliSesiDetail, PatroliSesiRingkas } from "@/lib/queries/satpam-patroli";
```

Add two new REQUIRED props (alongside the existing `initialCards`/`initialTimeline`, in the same props-type object):
```tsx
  initialActivePatroliSesi: PatroliSesiDetail | null;
  initialPatroliRiwayat: PatroliSesiRingkas[];
```
and destructure them the same way `initialCards`/`initialTimeline` are already destructured.

Change the Patroli tab's render branch from:
```tsx
        {visited.has("patroli") && (
          <div className={cn("h-full", activeTab !== "patroli" && "hidden")}>
            <ComingSoonPanel title="Patroli" />
          </div>
        )}
```
to:
```tsx
        {visited.has("patroli") && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "patroli" && "hidden")}>
            <PatroliPanel initialActiveSesi={initialActivePatroliSesi} initialRiwayat={initialPatroliRiwayat} />
          </div>
        )}
```
(note the wrapper div also gains `overflow-y-auto`, matching the Inspeksi tab's own wrapper — `PatroliPanel`'s content can be taller than one screen once a session is active, unlike the static "Segera Hadir" placeholder it replaces.)

The "tamu" branch (still `ComingSoonPanel title="Tamu"`) is untouched — Tamu's real content is a separate, later sub-project.

- [ ] **Step 3: Modify `src/app/mkesindo/satpam-app/(tabs)/page.tsx`**

Add the import:
```tsx
import { getActivePatroliSesiAction, getPatroliRiwayatAction } from "@/app/mkesindo/satpam-app/actions";
```
Change the `Promise.all` to also fetch Patroli data (alongside the existing `cards`/`timeline`/`profile` fetch — do not remove those):
```tsx
  const [cards, timeline, profile, activePatroliResult, patroliRiwayatResult] = await Promise.all([
    getSatpamInspectionList(businessDateISO),
    getSatpamTimeline(businessDateISO),
    getUserById(Number(session.user.id)),
    getActivePatroliSesiAction(),
    getPatroliRiwayatAction(),
  ]);
  const activePatroliSesi = activePatroliResult.success ? activePatroliResult.data : null;
  const patroliRiwayat = patroliRiwayatResult.success ? patroliRiwayatResult.data : [];
```
Pass the two new props to `SatpamTabShell` (alongside the existing ones):
```tsx
      initialActivePatroliSesi={activePatroliSesi}
      initialPatroliRiwayat={patroliRiwayat}
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
git add src/components/satpam-app/patroli-panel.tsx src/components/satpam-app/satpam-tab-shell.tsx "src/app/mkesindo/satpam-app/(tabs)"
git commit -m "feat: wire the Patroli checklist panel into the satpam-app tab shell"
```

---

### Task 7: Full-screen photo capture screen

**Files:**
- Create: `src/app/mkesindo/satpam-app/patroli/foto/[sesiId]/page.tsx`
- Create: `src/components/satpam-app/patroli-foto-client.tsx`

**Interfaces:**
- Consumes: `requireSatpam` (`@/lib/require-access`). From Task 3, `usePatroliCameraCapture`, `PatroliCaptureResult` (`@/hooks/use-patroli-camera-capture`). From Task 4, the upload route `/api/mkesindo/upload/satpam-patroli`. From Task 5, `addPatroliFotoAction` (`@/app/mkesindo/satpam-app/actions`).
- Produces: nothing further downstream — this is the final task.

This route lives OUTSIDE the `(tabs)/` route group (a sibling, same as the existing `inspeksi/[jadwalId]/page.tsx`) — it is reached via a real Next.js navigation (`router.push`, not a tab switch), so it is expected and correct that visiting it unmounts the whole `SatpamTabShell` tree; this exactly mirrors how the existing Inspeksi capture route already behaves, and is not something to "fix."

- [ ] **Step 1: Write `src/app/mkesindo/satpam-app/patroli/foto/[sesiId]/page.tsx`**

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSatpam } from "@/lib/require-access";
import { PatroliFotoClient } from "@/components/satpam-app/patroli-foto-client";

export const metadata: Metadata = { title: "Foto Patroli" };

export default async function PatroliFotoPage({
  params,
  searchParams,
}: {
  params: Promise<{ sesiId: string }>;
  searchParams: Promise<{ titik?: string }>;
}) {
  await requireSatpam();
  const { sesiId: sesiIdParam } = await params;
  const { titik } = await searchParams;
  const sesiId = Number(sesiIdParam);
  if (!Number.isInteger(sesiId)) notFound();

  return <PatroliFotoClient sesiId={sesiId} titikPatroli={titik ?? null} />;
}
```

- [ ] **Step 2: Write `src/components/satpam-app/patroli-foto-client.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePatroliCameraCapture, type PatroliCaptureResult } from "@/hooks/use-patroli-camera-capture";
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
  const [captured, setCaptured] = useState<PatroliCaptureResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [keterangan, setKeterangan] = useState("");
  const [saving, setSaving] = useState(false);

  // Object URL untuk pratinjau hasil jepretan -- dibuat/dihapus lewat effect
  // (bukan langsung di JSX) supaya tidak membuat URL baru di setiap render
  // dan tidak bocor memori (pola yang sama seperti use-live-camera-capture.ts
  // dan live-inspeksi-client.tsx yang sudah ada).
  useEffect(() => {
    if (!captured) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(captured.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [captured]);

  const { videoRef, error, capturing, retry, handleCapture } = usePatroliCameraCapture({
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
```

- [ ] **Step 3: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean.

- [ ] **Step 4: Manual browser verification**

Open `/mkesindo/satpam-app`, switch to the Patroli tab, logged in as an `isSatpam` account. Confirm:
1. "Mulai Patroli" creates a session and shows the 13-item checklist, all unchecked, plus a "Foto Tambahan" section and a disabled "Selesai Patroli" button.
2. Tapping a checklist item opens the full-screen camera, taking a photo shows a preview with "Ambil Ulang"/"Simpan" buttons, and the resulting saved photo (check via the uploaded file itself, or the visible watermark box) shows an address/coordinates/WIB date-time/weather watermark baked into the image.
3. Saving returns to the Patroli tab with that item now checked.
4. Tapping "+ Tambah Foto" requires a caption before "Simpan" succeeds, and the saved item appears listed under "Foto Tambahan" without affecting the 13-item checklist's completion state.
5. "Selesai Patroli" stays disabled until all 13 items are checked, then completes the session and returns to the "Mulai Patroli" + riwayat view, with the just-completed session now listed in Riwayat Patroli.
6. Denying camera or location permission still allows taking and saving a photo — the watermark shows "tidak tersedia" text for whichever piece failed, and the checklist item still gets marked done.

If no `isSatpam` test credentials are available in this environment, fall back to a careful, itemized code-review trace against this same 6-item checklist instead of skipping this step silently (the established, accepted pattern from every prior satpam-app sub-project this session).

- [ ] **Step 5: Commit**

```bash
git add src/app/mkesindo/satpam-app/patroli src/components/satpam-app/patroli-foto-client.tsx
git commit -m "feat: add the full-screen watermarked photo capture screen for Patroli"
```
