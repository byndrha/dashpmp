# Move file-upload storage from local VPS disk to per-company Google Drive

## Context

Every uploaded file in this app (satpam vehicle-check photos, produksi QC photos, driver-app
delivery/retur photos, site branding assets, armada photos, doc-template logos) is written to
`public/uploads/<category>/...` on the VPS's local disk (`fs/promises` `writeFile`, duplicated
across 6 near-identical route handlers under `src/app/api/mkesindo/upload/`) and served back by
Next's static file serving. This has two standing problems, both already hit in production:

- **Files vanish on redeploy** unless a persistent volume is correctly mounted at
  `/app/public/uploads` in the container — already caused one real incident (photos 404ing for
  dates as old as Aug 4), and remains fragile (a container started before the volume was attached
  won't have it until the next redeploy).
- **No per-company separation.** Every upload — regardless of which PT it logically belongs to —
  lands in the same shared disk tree.

Goal: replace local disk with **Google Drive**, one Google account per PT (personal Gmail, not
Workspace), so each company's files live in that company's own Drive — easy to browse/download by
staff, no VPS storage config, no redeploy data loss (Drive is Google's problem, not ours).

## Decisions made during brainstorming

- **Google Drive, not S3-compatible object storage.** Explicitly chosen over Cloudflare
  R2/Backblaze/S3 — the user wants each PT's files to be *directly browsable* in a normal Google
  Drive folder by that PT's own staff, not just machine-readable object storage.
- **One Google account per PT, not one shared account with folders-per-PT.** Full account-level
  isolation — a credential leak or quota issue on one PT's account doesn't touch another's.
- **Personal Gmail, not Workspace** — confirmed by the user. This rules out Shared Drives (a
  Workspace-only feature) and service-account domain-wide delegation. The only viable mechanism is
  **OAuth2 with a stored refresh token**, authorized once per company by whoever owns that PT's
  Google account.
- **Server-side proxy + HTTP caching, not direct Drive links.** Chosen after estimating real
  request volume (a few hundred uploads/day; view volume potentially higher but dominated by
  repeat views of the same photo) against Drive API's default quota (~1,000 queries/100s/user) —
  comfortably safe, especially with `Cache-Control: immutable` letting the browser and Cloudflare
  (already in front of `dash.pabrikespmp.com`) absorb almost all repeat reads at the edge, without
  a second Drive API call. Proxying also means files can stay **private** in Drive (never set to
  "anyone with link"), which direct-linking would have required.
- **`doc-template` (DO PDF logo) explicitly excluded from this migration.** Deferred at the user's
  request. `src/lib/pdf/delivery-order-pdf.ts` reads `LogoPath` directly off local disk (not
  through a browser) to embed it in a generated PDF; moving it to Drive needs a
  server-side-buffer-fetch integration into the PDF pipeline that's out of scope for now. This
  route and its `DashboardDocTemplate.LogoPath` column are untouched — still local disk, still
  working exactly as today.
- **`google-auth-library` for OAuth/token-refresh, raw `fetch` for the Drive REST API** — not the
  full `googleapis` SDK. `OAuth2Client` handles refresh-token → access-token exchange; the Drive
  v3 REST surface needed here (`files.create` multipart upload, `files.get?alt=media`,
  `files.list`/`files.create` for folders) is small enough not to justify the much heavier
  `googleapis` package.

## Known risk to validate during implementation

An unverified Google Cloud OAuth app in "Testing" publish status issues refresh tokens that
**expire after 7 days** — unusable for a "authorize once, use forever" flow. Moving the OAuth
consent screen to "In production" avoids this; the `drive.file` scope this design uses (access
only to files the app itself creates — not the account's whole Drive) is a *non-sensitive* scope,
which historically hasn't required Google's full security-assessment verification to publish, but
may still show a one-time "Google hasn't verified this app" warning during each company's
connect flow (dismissible via "Advanced → Go to [app] (unsafe)"). This should be confirmed live
during setup — cannot be verified from here.

**Storage-quota risk**: personal Gmail's free tier is 15GB, shared with that account's Gmail +
Photos. At an estimated ~200-500 photo uploads/day for MKEsindo (satpam vehicle-check alone is up
to 12 photos × dozens of trips/day, each up to 5MB), the free tier could fill in weeks, not
months. Each connected company will likely need a Google One storage upgrade (~Rp30rb/month for
100GB) — worth budgeting for at connect time, not treated as a later surprise.

## Data model changes

**Postgres (`pmp_directory` DB) — new table**, same DB/encryption convention as the existing
`perusahaan_koneksi` table (see `docs/superpowers/specs/2026-07-30-perusahaan-db-koneksi-design.md`),
but one row per company (a Drive connection isn't labeled `utama`/`logistik` like DB connections
are):

```sql
CREATE TABLE perusahaan_gdrive_koneksi (
  id SERIAL PRIMARY KEY,
  perusahaan_id INTEGER NOT NULL REFERENCES perusahaan(id) ON DELETE CASCADE,
  connected_email VARCHAR(255) NOT NULL,
  refresh_token_encrypted VARCHAR(512) NOT NULL,
  root_folder_id VARCHAR(128) NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (perusahaan_id)
);
```

`refresh_token_encrypted` uses AES-256-GCM via a **new** key-derivation prefix in
`src/lib/crypto-secret.ts` (`encryptGDriveToken`/`decryptGDriveToken`, keyed off
`"gdrive-refresh-token:" + AUTH_SECRET`) — deliberately not reusing the DB-credential prefix, per
that file's own stated principle that a leaked value from one purpose shouldn't unlock another.

**MSSQL — no schema changes.** The 5 in-scope upload categories keep their existing string
columns (`DashboardVehicleCheckPhoto.FilePath`, `DashboardProduksiKualitas.FotoPath`,
`DashboardPengirimanStopDelivery.FotoBuktiUrls`/`TandaTanganUrl`,
`DashboardPengirimanStopDeliveryItem.FotoReturUrl`, `DashboardSiteSettings.FaviconPath`/
`OgImagePath`, `DashboardArmada.FotoPath`/`QrMyPertaminaPath`) — only the *format* of the string
written into them changes, from a local static path (`/uploads/satpam-check/123/x.jpg`) to a
proxy path (`/api/files/mkesindo/<fileId>/x.jpg`). Every existing frontend call site
(`vehicle-check-summary.tsx`, `kualitas-view.tsx`, `pengiriman-board.tsx`, `armada-dialog.tsx`,
`driver-app/*`, `site-settings-panel.tsx`, etc.) keeps rendering that column value as
`<img src>`/a link href unmodified — none of them need to change.

`doc-template`'s `DashboardDocTemplate.LogoPath` is excluded, per the decision above — stays a
local `/uploads/doc-template/...` path.

## OAuth connect flow

One shared Google Cloud OAuth Client (Web application type), `GOOGLE_OAUTH_CLIENT_ID` /
`GOOGLE_OAUTH_CLIENT_SECRET` as app-level env vars (not per-company — the *application* is one
thing; what's per-company is which Google account grants it access). Redirect URI:
`https://dash.pabrikespmp.com/api/gdrive/oauth/callback`. Scope: `drive.file` only.

1. Admin clicks "Hubungkan Google Drive" for a company on `/grup/perusahaan` → redirected to
   `https://accounts.google.com/o/oauth2/v2/auth?...&access_type=offline&prompt=consent&state=<perusahaanId>`.
   `access_type=offline` is required to receive a `refresh_token` at all; `prompt=consent` is
   required to receive one *again* on a re-connect (Google only issues it on first-ever consent
   otherwise).
2. The signed-in Google account owner approves.
3. Callback route (`/api/gdrive/oauth/callback`) exchanges the returned `code` for
   `{access_token, refresh_token}` (`POST https://oauth2.googleapis.com/token`), calls Drive's
   `about.get?fields=user` to read the connected account's email, creates (or finds, if
   reconnecting) a root folder named `Dashboard PMP — <PT name> Uploads`, and upserts the
   `perusahaan_gdrive_koneksi` row (refresh token encrypted).
4. Admin UI shows the connected email + a "Putuskan" (disconnect → delete the row) action.

## Storage module — `src/lib/storage/google-drive.ts`

```ts
export interface UploadedFile { fileId: string; publicPath: string; }

export async function uploadFile(
  perusahaanKode: string,
  categoryPath: string[],   // e.g. ["satpam-check", safeArmadaId] or ["produksi-kualitas"]
  filename: string,
  buffer: Buffer,
  mimeType: string
): Promise<UploadedFile>

export async function getFileBuffer(
  perusahaanKode: string,
  fileId: string
): Promise<{ buffer: Buffer; mimeType: string }>
```

Internals:

- `getOAuthClientFor(perusahaanKode)` — looks up `perusahaan_gdrive_koneksi` by joining through
  `perusahaan.kode`, decrypts the refresh token, returns a `google-auth-library` `OAuth2Client`
  (its `getAccessToken()` handles refresh transparently; not cached across requests beyond the
  library's own in-memory token cache per call — acceptable at this volume).
- `resolveFolderId(client, rootFolderId, categoryPath)` — walks `categoryPath` one segment at a
  time under `rootFolderId`, using `files.list` (`q: name='X' and 'parent' in parents and
  mimeType='application/vnd.google-apps.folder'`) to find an existing folder or `files.create` to
  make one. No caching layer for folder IDs in this first pass — at a few hundred uploads/day the
  extra lookup call per upload is well within quota; can be added later if it matters.
- `uploadFile` resolves the folder, then `POST
  https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart` with the file bytes,
  returns `{fileId, publicPath: "/api/files/${perusahaanKode}/${fileId}/${filename}"}`.
- `getFileBuffer` does `GET
  https://www.googleapis.com/drive/v3/files/${fileId}?alt=media` with the Bearer token.

## Upload route changes (5 of 6 routes)

`satpam-check`, `produksi-kualitas`, `driver-app`, `site-asset`, `armada-foto` — each route keeps
its existing validation (auth gate, mime/size checks) and just replaces its `mkdir`+`writeFile`
block with a call to `uploadFile("mkesindo", [...], filename, buffer, file.type)`, returning
`{ path: result.publicPath }` exactly as today (response shape unchanged, so no frontend upload
call site needs touching either). `"mkesindo"` is hardcoded the same way `getPool()` already
hardcodes it — all 6 routes only ever run under `/mkesindo/...` today.

`doc-template` is untouched (see Context/Decisions).

## Serving route — `src/app/api/files/[perusahaan]/[fileId]/[filename]/route.ts`

```ts
export async function GET(req, { params }) {
  const { buffer, mimeType } = await getFileBuffer(params.perusahaan, params.fileId);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": mimeType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
```

No auth gate on this route — matches today's behavior exactly (files under `public/uploads` are
currently served by Next's static handler with zero access control; this is a lateral move, not a
security regression *or* an improvement). Tightening this later is a separate, explicit decision
if wanted.

## Migration script (one-off, run then discarded — matches this repo's convention for one-time
DDL/seed scripts)

Walks `public/uploads/{satpam-check,produksi-kualitas,driver-app,site,armada}/**`, uploads each
file via the new `uploadFile()` (mirroring each category's existing folder nesting), then updates
the corresponding MSSQL rows to the new proxy path. `driver-app`'s `FotoBuktiUrls` (a JSON array
string) needs parse → map each URL → re-serialize, rather than a straight string replace like the
other columns. `doc-template` is skipped entirely (excluded from scope).

## Admin UI changes

`/grup/perusahaan` (existing admin page) — extend `PerusahaanFormDialog`/`perusahaan-list.tsx`
with a "Google Drive" section per company, shown for every company (not just MKEsindo) so
PMPutra/PMPersada are ready to connect whenever they get real upload features — same
build-ahead-of-need precedent as `getPmputraPool()`. Shows: not connected → "Hubungkan Google
Drive" button; connected → the connected email + "Putuskan" button.

New server actions in `src/app/grup/perusahaan/actions.ts`: `disconnectGDriveAction` (delete the
row). The connect action isn't a normal server action — it's a real redirect to Google's OAuth
URL, so it's a plain link/`<a href>`, not a `useTransition`-wrapped action call.

## Non-goals (explicitly out of scope)

- `doc-template`/DO-PDF logo migration — deferred, stays on local disk.
- Any auth/access-control tightening on the new serving route beyond parity with today.
- Folder-ID caching for `resolveFolderId` — revisit only if upload volume grows enough to matter.
- Cross-account file moves if a company's connected Google account is ever changed — reconnecting
  points new uploads at the new account; old files already uploaded stay wherever they are.
- PMPutra/PMPersada real upload routes — the connect UI is built for them, but no actual upload
  category exists for those PTs yet (matches their current "database belum terhubung" state).

## Risks

- The 7-day refresh-token-expiry risk and the Drive API's exact current verification requirements
  for an unpublished app (see "Known risk" above) — needs live validation during setup, not
  assumed solved by this document.
- Storage quota — see "Known risk" above; likely needs a paid Google One tier per connected
  account within weeks at MKEsindo's current photo volume.
- Every upload now depends on an external network call (Drive API) instead of a local disk write
  — slower per-upload, and a Drive outage or an expired/revoked refresh token would block new
  uploads entirely (versus today's local-disk write, which only fails on disk-full/permission
  errors). No offline-queue/retry fallback is in scope for this first pass.
- `resolveFolderId`'s repeated `files.list` lookups add Drive API calls proportional to upload
  volume (not just view volume) — still well within quota at current scale, but worth knowing this
  isn't purely a "one call per view, cached" system; it's "one-to-a-few calls per upload too."

## Files touched (implementation plan will detail exact steps)

- New: `src/lib/storage/google-drive.ts`, `src/app/api/gdrive/oauth/callback/route.ts`,
  `src/app/api/files/[perusahaan]/[fileId]/[filename]/route.ts`, `src/lib/queries/perusahaan-gdrive.ts`,
  one-off migration script.
- Modified: `src/lib/crypto-secret.ts` (new encrypt/decrypt pair), `src/app/api/mkesindo/upload/{satpam-check,produksi-kualitas,driver-app,site-asset,armada-foto}/route.ts`,
  `src/app/grup/perusahaan/actions.ts`, `src/components/dashboard/perusahaan-form-dialog.tsx` (or
  `perusahaan-list.tsx`, whichever already renders per-company admin actions), `package.json`
  (add `google-auth-library`).
- Postgres DDL: new `perusahaan_gdrive_koneksi` table (one-off script, run then discarded, per
  this repo's existing convention).
