# Google Drive File Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace local-VPS-disk file storage (`public/uploads/...`) with per-company Google Drive
(OAuth2, one Google account per PT), for 5 of the app's 6 upload categories — everything except
`doc-template`, which stays on local disk (excluded per explicit user decision).

**Architecture:** A new storage module (`src/lib/storage/google-drive.ts`) wraps the Drive v3 REST
API directly via `fetch` + `google-auth-library`'s `OAuth2Client` for token refresh. Each of the 5
upload routes calls `uploadFile()` instead of writing to disk; a new proxy route
(`/api/files/[perusahaan]/[fileId]/[filename]`) serves files back with a long-lived
`Cache-Control` header. Per-company refresh tokens live encrypted in a new Postgres table,
connected via a one-time OAuth flow from the existing `/grup/perusahaan` admin page.

**Tech Stack:** Next.js route handlers, `google-auth-library` (new dependency), Postgres (`pg`,
already in use for the `pmp_directory` DB), existing AES-256-GCM secret encryption
(`src/lib/crypto-secret.ts`).

**Spec:** `docs/superpowers/specs/2026-08-19-gdrive-file-storage-design.md`

## Global Constraints

- Every MSSQL table/column that currently stores an upload path keeps its existing schema — only
  the string *format* written into it changes. No MSSQL DDL in this plan.
- `doc-template` (`src/app/api/mkesindo/upload/doc-template/route.ts`,
  `DashboardDocTemplate.LogoPath`) is untouched — out of scope, stays on local disk.
- All 5 in-scope upload routes are hardcoded to `perusahaanKode = "mkesindo"` — matches the
  existing hardcoding already present in `src/lib/db.ts`'s `getPool()` (`resolveKoneksi("mkesindo", "utama")`).
- The Drive Google account is personal Gmail — OAuth2 refresh-token flow only, no service account,
  no Shared Drive.
- OAuth scope is `https://www.googleapis.com/auth/drive.file` (files-created-by-this-app only,
  not full Drive access).
- No auth gate on the new file-serving route — matches today's `public/uploads` static-serving
  behavior exactly (unauthenticated), not a regression or an improvement.
- This repo has no automated test framework (`package.json` has no `test` script, no
  vitest/jest). Every task's verification step is `npx tsc --noEmit` + `npx eslint <changed files>`
  plus a live check (SQL query via the project's SQL MCP tool, or a manual browser check) —
  matching how every other change this session has actually been verified, not a fabricated
  TDD unit-test cycle this codebase doesn't have.

---

## Prerequisite (not a task — the user's own action, outside this codebase)

Before Task 4 can be verified end-to-end, a Google Cloud OAuth Client must exist:

1. Google Cloud Console → new (or existing) project → enable "Google Drive API".
2. OAuth consent screen: External, scope `https://www.googleapis.com/auth/drive.file`. Publish to
   "In production" (see spec's "Known risk" section — Testing-mode refresh tokens expire in 7
   days).
3. Credentials → Create OAuth Client ID → Web application → Authorized redirect URI:
   `<NEXTAUTH_URL>/api/gdrive/oauth/callback` (e.g. `https://dash.pabrikespmp.com/api/gdrive/oauth/callback`).
4. Add to `.env` (and Coolify env config): `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`.

Task 4's live verification (actually connecting MKEsindo's Google account) cannot happen until
this exists. Tasks 1-3 and 5-8 don't depend on it being done first.

---

### Task 1: Google Drive token encryption + dependency

**Files:**
- Modify: `src/lib/crypto-secret.ts`
- Modify: `package.json` (add `google-auth-library`)

**Interfaces:**
- Produces: `encryptGDriveToken(plaintext: string): string`, `decryptGDriveToken(ciphertext: string): string` — consumed by Task 2.

- [ ] **Step 1: Install the dependency**

```bash
npm install google-auth-library
```

- [ ] **Step 2: Add the new key-derivation + encrypt/decrypt pair**

Append to `src/lib/crypto-secret.ts` (reusing the same `ALGORITHM`/`IV_LENGTH`/`AUTH_TAG_LENGTH`
constants already at the top of the file — do not redeclare them):

```ts
// Separate derived key from getKey()'s "perusahaan-db-credential:" prefix —
// a leaked Google Drive refresh token must not also unlock DB credentials,
// and vice versa (same principle as this file's existing getKey() comment).
function getGDriveKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured — cannot encrypt/decrypt stored secrets");
  return createHash("sha256").update(`gdrive-refresh-token:${secret}`).digest();
}

export function encryptGDriveToken(plaintext: string): string {
  const key = getGDriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64url");
}

export function decryptGDriveToken(ciphertext: string): string {
  const key = getGDriveKey();
  const buf = Buffer.from(ciphertext, "base64url");
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — expect clean (no errors). Run: `npx eslint src/lib/crypto-secret.ts` —
expect clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/crypto-secret.ts package.json package-lock.json
git commit -m "feat: add Google Drive refresh-token encryption helpers"
```

---

### Task 2: Postgres schema + `perusahaan-gdrive.ts` query module

**Files:**
- Create: `scripts/create-gdrive-koneksi-table.ts`
- Create: `src/lib/queries/perusahaan-gdrive.ts`

**Interfaces:**
- Consumes: `encryptGDriveToken`/`decryptGDriveToken` (Task 1), `getPgPool` (`@/lib/pg`, existing).
- Produces: `resolveGDriveKoneksi(perusahaanKode: string): Promise<ResolvedGDriveKoneksi | null>`,
  `listAllGDriveKoneksi(): Promise<GDriveKoneksiRow[]>`, `saveGDriveKoneksi(input): Promise<void>`,
  `deleteGDriveKoneksi(perusahaanId: number): Promise<void>`, `getPerusahaanNama(perusahaanId: number): Promise<string | null>`
  — consumed by Task 3 (`resolveGDriveKoneksi`), Task 4 (`saveGDriveKoneksi`, `getPerusahaanNama`),
  Task 7 (`listAllGDriveKoneksi`, `deleteGDriveKoneksi`).

- [ ] **Step 1: Write the one-off schema script**

```ts
// One-off table creation for perusahaan_gdrive_koneksi (pmp_directory DB).
// Idempotent — safe to re-run. Usage: npx tsx scripts/create-gdrive-koneksi-table.ts
import "dotenv/config";
import { Client } from "pg";

async function main() {
  const client = new Client({
    host: process.env.DIRECTORY_DB_HOST,
    port: Number(process.env.DIRECTORY_DB_PORT || 5432),
    user: process.env.DIRECTORY_DB_USER,
    password: process.env.DIRECTORY_DB_PASSWORD,
    database: process.env.DIRECTORY_DB_NAME || "pmp_directory",
    ssl: process.env.DIRECTORY_DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS perusahaan_gdrive_koneksi (
        id SERIAL PRIMARY KEY,
        perusahaan_id INTEGER NOT NULL REFERENCES perusahaan(id) ON DELETE CASCADE,
        connected_email VARCHAR(255) NOT NULL,
        refresh_token_encrypted VARCHAR(512) NOT NULL,
        root_folder_id VARCHAR(128) NOT NULL,
        connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (perusahaan_id)
      )
    `);
    console.log("perusahaan_gdrive_koneksi ready.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it against the real directory DB**

Run: `npx tsx scripts/create-gdrive-koneksi-table.ts`
Expected: prints "perusahaan_gdrive_koneksi ready." with no errors.

- [ ] **Step 3: Write the query module**

```ts
import { getPgPool } from "@/lib/pg";
import { encryptGDriveToken, decryptGDriveToken } from "@/lib/crypto-secret";

export interface GDriveKoneksiRow {
  perusahaanId: number;
  connectedEmail: string;
  connectedAt: string;
}

export interface ResolvedGDriveKoneksi {
  refreshToken: string;
  rootFolderId: string;
}

// Used by the storage module (Task 3) on every upload/read — looks up by
// the same human-readable `kode` the MSSQL side already hardcodes
// ("mkesindo"), not a Postgres perusahaan.id, mirroring resolveKoneksi()'s
// own resolution path in perusahaan-koneksi.ts.
export async function resolveGDriveKoneksi(perusahaanKode: string): Promise<ResolvedGDriveKoneksi | null> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT gk.refresh_token_encrypted, gk.root_folder_id
     FROM perusahaan_gdrive_koneksi gk
     JOIN perusahaan p ON p.id = gk.perusahaan_id
     WHERE p.kode = $1`,
    [perusahaanKode]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { refreshToken: decryptGDriveToken(row.refresh_token_encrypted), rootFolderId: row.root_folder_id };
}

// Feeds the admin UI (Task 7) — small table, no per-company filtering
// needed server-side, same pattern as perusahaan-koneksi.ts's listAllKoneksi().
export async function listAllGDriveKoneksi(): Promise<GDriveKoneksiRow[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT perusahaan_id, connected_email, connected_at FROM perusahaan_gdrive_koneksi ORDER BY perusahaan_id`
  );
  return result.rows.map((r) => ({
    perusahaanId: r.perusahaan_id,
    connectedEmail: r.connected_email,
    connectedAt: (r.connected_at as Date).toISOString(),
  }));
}

export async function saveGDriveKoneksi(input: {
  perusahaanId: number;
  connectedEmail: string;
  refreshToken: string;
  rootFolderId: string;
}): Promise<void> {
  const pool = getPgPool();
  const encrypted = encryptGDriveToken(input.refreshToken);
  await pool.query(
    `INSERT INTO perusahaan_gdrive_koneksi (perusahaan_id, connected_email, refresh_token_encrypted, root_folder_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (perusahaan_id) DO UPDATE
     SET connected_email = EXCLUDED.connected_email, refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
         root_folder_id = EXCLUDED.root_folder_id, updated_at = now()`,
    [input.perusahaanId, input.connectedEmail, encrypted, input.rootFolderId]
  );
}

export async function deleteGDriveKoneksi(perusahaanId: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM perusahaan_gdrive_koneksi WHERE perusahaan_id = $1`, [perusahaanId]);
}

// Used once by the OAuth callback (Task 4) to name the root Drive folder
// ("Dashboard PMP — <nama> Uploads").
export async function getPerusahaanNama(perusahaanId: number): Promise<string | null> {
  const pool = getPgPool();
  const result = await pool.query(`SELECT nama FROM perusahaan WHERE id = $1`, [perusahaanId]);
  return result.rows[0]?.nama ?? null;
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/lib/queries/perusahaan-gdrive.ts scripts/create-gdrive-koneksi-table.ts` — both clean.
Then verify the table exists live via the project's SQL MCP tool (or `psql`) against the
`pmp_directory` Postgres DB: `SELECT * FROM perusahaan_gdrive_koneksi;` — expect an empty result
set with no error (table exists, 0 rows).

- [ ] **Step 5: Commit**

```bash
git add scripts/create-gdrive-koneksi-table.ts src/lib/queries/perusahaan-gdrive.ts
git commit -m "feat: add perusahaan_gdrive_koneksi table and query module"
```

---

### Task 3: Storage module — `src/lib/storage/google-drive.ts`

**Files:**
- Create: `src/lib/storage/google-drive.ts`

**Interfaces:**
- Consumes: `resolveGDriveKoneksi` (Task 2).
- Produces: `uploadFile(perusahaanKode, categoryPath, filename, buffer, mimeType): Promise<UploadedFile>`,
  `getFileBuffer(perusahaanKode, fileId): Promise<{buffer: Buffer; mimeType: string}>`,
  `createRootFolderForConnect(refreshToken, perusahaanNama): Promise<string>`,
  `getConnectedAccountEmail(refreshToken): Promise<string>` — the last two consumed by Task 4;
  the first two consumed by Tasks 5, 6, 8.

- [ ] **Step 1: Write the module**

```ts
import { OAuth2Client } from "google-auth-library";
import { resolveGDriveKoneksi } from "@/lib/queries/perusahaan-gdrive";

export interface UploadedFile {
  fileId: string;
  publicPath: string;
}

function buildOAuthClient(refreshToken: string): OAuth2Client {
  const client = new OAuth2Client(process.env.GOOGLE_OAUTH_CLIENT_ID, process.env.GOOGLE_OAUTH_CLIENT_SECRET);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

async function getAccessToken(client: OAuth2Client): Promise<string> {
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Gagal mendapatkan access token Google Drive");
  return token;
}

// Escapes a single-quote for Drive's `q` query-string syntax — folder/file
// names here are our own category segments (e.g. "satpam-check") or a
// sanitized armadaId, never raw user text, but escaping is cheap insurance.
function escapeDriveQueryValue(value: string): string {
  return value.replace(/'/g, "\\'");
}

async function findOrCreateFolder(accessToken: string, name: string, parentId: string): Promise<string> {
  const q = `name='${escapeDriveQueryValue(name)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) throw new Error(`Gagal mencari folder Google Drive "${name}": ${listRes.status}`);
  const listJson = (await listRes.json()) as { files?: { id: string }[] };
  if (listJson.files?.[0]) return listJson.files[0].id;

  const createRes = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  if (!createRes.ok) throw new Error(`Gagal membuat folder Google Drive "${name}": ${createRes.status}`);
  const createJson = (await createRes.json()) as { id: string };
  return createJson.id;
}

async function resolveFolderId(accessToken: string, rootFolderId: string, segments: string[]): Promise<string> {
  let parentId = rootFolderId;
  for (const segment of segments) {
    parentId = await findOrCreateFolder(accessToken, segment, parentId);
  }
  return parentId;
}

async function uploadToParent(
  accessToken: string,
  parentId: string,
  filename: string,
  buffer: Buffer,
  mimeType: string
): Promise<string> {
  const boundary = `gdrive-upload-${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({ name: filename, parents: [parentId] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Gagal mengunggah ke Google Drive: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { id: string };
  return json.id;
}

export async function uploadFile(
  perusahaanKode: string,
  categoryPath: string[],
  filename: string,
  buffer: Buffer,
  mimeType: string
): Promise<UploadedFile> {
  const conn = await resolveGDriveKoneksi(perusahaanKode);
  if (!conn) {
    throw new Error(`Google Drive belum terhubung untuk perusahaan "${perusahaanKode}" — hubungkan dulu di /grup/perusahaan.`);
  }
  const client = buildOAuthClient(conn.refreshToken);
  const accessToken = await getAccessToken(client);
  const folderId = await resolveFolderId(accessToken, conn.rootFolderId, categoryPath);
  const fileId = await uploadToParent(accessToken, folderId, filename, buffer, mimeType);
  return { fileId, publicPath: `/api/files/${perusahaanKode}/${fileId}/${encodeURIComponent(filename)}` };
}

export async function getFileBuffer(perusahaanKode: string, fileId: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const conn = await resolveGDriveKoneksi(perusahaanKode);
  if (!conn) throw new Error(`Google Drive belum terhubung untuk perusahaan "${perusahaanKode}"`);
  const client = buildOAuthClient(conn.refreshToken);
  const accessToken = await getAccessToken(client);

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gagal mengambil file Google Drive (${fileId}): ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get("content-type") || "application/octet-stream";
  return { buffer, mimeType };
}

// Both used only by the OAuth callback (Task 4), directly with a fresh
// refresh token — no perusahaan_gdrive_koneksi row exists yet at that point
// (this call is what creates it), so these take the token directly instead
// of resolving through resolveGDriveKoneksi().
export async function createRootFolderForConnect(refreshToken: string, perusahaanNama: string): Promise<string> {
  const client = buildOAuthClient(refreshToken);
  const accessToken = await getAccessToken(client);
  return findOrCreateFolder(accessToken, `Dashboard PMP — ${perusahaanNama} Uploads`, "root");
}

export async function getConnectedAccountEmail(refreshToken: string): Promise<string> {
  const client = buildOAuthClient(refreshToken);
  const accessToken = await getAccessToken(client);
  const res = await fetch("https://www.googleapis.com/drive/v3/about?fields=user", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Gagal membaca info akun Google Drive");
  const json = (await res.json()) as { user?: { emailAddress?: string } };
  return json.user?.emailAddress ?? "unknown";
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` and `npx eslint src/lib/storage/google-drive.ts` — both clean. Live
verification of this module's actual Drive calls happens in Task 4 (nothing to run standalone yet
— no connected account exists until then).

- [ ] **Step 3: Commit**

```bash
git add src/lib/storage/google-drive.ts
git commit -m "feat: add Google Drive storage module (upload, download, folder resolution)"
```

---

### Task 4: OAuth connect routes

**Files:**
- Create: `src/app/api/gdrive/oauth/start/route.ts`
- Create: `src/app/api/gdrive/oauth/callback/route.ts`

**Interfaces:**
- Consumes: `createRootFolderForConnect`, `getConnectedAccountEmail` (Task 3),
  `saveGDriveKoneksi`, `getPerusahaanNama` (Task 2), `requireGrupAccess` (`@/lib/require-access`, existing).

- [ ] **Step 1: Write the start route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireGrupAccess } from "@/lib/require-access";

export async function GET(req: NextRequest) {
  await requireGrupAccess();
  const perusahaanId = req.nextUrl.searchParams.get("perusahaanId");
  if (!perusahaanId) {
    return NextResponse.json({ error: "perusahaanId wajib diisi" }, { status: 400 });
  }

  const redirectUri = `${process.env.NEXTAUTH_URL}/api/gdrive/oauth/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file",
    // offline is required to receive a refresh_token at all; prompt=consent
    // is required to receive one again on a reconnect (Google only issues
    // it on first-ever consent otherwise).
    access_type: "offline",
    prompt: "consent",
    state: perusahaanId,
  });
  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
```

- [ ] **Step 2: Write the callback route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireGrupAccess } from "@/lib/require-access";
import { createRootFolderForConnect, getConnectedAccountEmail } from "@/lib/storage/google-drive";
import { saveGDriveKoneksi, getPerusahaanNama } from "@/lib/queries/perusahaan-gdrive";

export async function GET(req: NextRequest) {
  await requireGrupAccess();
  const code = req.nextUrl.searchParams.get("code");
  const perusahaanIdRaw = req.nextUrl.searchParams.get("state");
  if (!code || !perusahaanIdRaw) {
    return NextResponse.redirect(new URL("/grup/perusahaan?gdrive=error", req.url));
  }
  const perusahaanId = Number(perusahaanIdRaw);

  const redirectUri = `${process.env.NEXTAUTH_URL}/api/gdrive/oauth/callback`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    console.error("[gdrive/oauth/callback] token exchange failed:", await tokenRes.text());
    return NextResponse.redirect(new URL("/grup/perusahaan?gdrive=error", req.url));
  }
  const tokenJson = (await tokenRes.json()) as { refresh_token?: string };
  if (!tokenJson.refresh_token) {
    console.error("[gdrive/oauth/callback] no refresh_token in response (unexpected — prompt=consent was sent)");
    return NextResponse.redirect(new URL("/grup/perusahaan?gdrive=error", req.url));
  }
  const refreshToken = tokenJson.refresh_token;

  const perusahaanNama = (await getPerusahaanNama(perusahaanId)) ?? `PT #${perusahaanId}`;
  const [email, rootFolderId] = await Promise.all([
    getConnectedAccountEmail(refreshToken),
    createRootFolderForConnect(refreshToken, perusahaanNama),
  ]);

  await saveGDriveKoneksi({ perusahaanId, connectedEmail: email, refreshToken, rootFolderId });

  return NextResponse.redirect(new URL("/grup/perusahaan?gdrive=connected", req.url));
}
```

- [ ] **Step 3: Verify — static**

Run: `npx tsc --noEmit` and `npx eslint src/app/api/gdrive/oauth/start/route.ts src/app/api/gdrive/oauth/callback/route.ts` — both clean.

- [ ] **Step 4: Verify — live (requires the Prerequisite section done first)**

With `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` set and the dev server running, open
`http://localhost:3000/api/gdrive/oauth/start?perusahaanId=<MKEsindo's real Postgres perusahaan.id>`
in a browser, sign in with MKEsindo's Google account, approve. Expect a redirect back to
`/grup/perusahaan?gdrive=connected`. Then verify live via the SQL MCP tool against `pmp_directory`:
`SELECT perusahaan_id, connected_email, root_folder_id FROM perusahaan_gdrive_koneksi;` — expect
one row with the connected email and a non-null `root_folder_id`. Also open Drive in a browser
under that account and confirm the "Dashboard PMP — PT Mitra Kelola Esindo Uploads" folder exists.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/gdrive/oauth/start/route.ts src/app/api/gdrive/oauth/callback/route.ts
git commit -m "feat: add Google Drive OAuth connect flow"
```

---

### Task 5: File-serving proxy route

**Files:**
- Create: `src/app/api/files/[perusahaan]/[fileId]/[filename]/route.ts`

**Interfaces:**
- Consumes: `getFileBuffer` (Task 3).

- [ ] **Step 1: Write the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getFileBuffer } from "@/lib/storage/google-drive";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ perusahaan: string; fileId: string; filename: string }> }
) {
  const { perusahaan, fileId } = await params;
  try {
    const { buffer, mimeType } = await getFileBuffer(perusahaan, fileId);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mimeType,
        // Uploaded files never change after creation — safe to cache
        // indefinitely at the browser and at Cloudflare's edge (already in
        // front of this domain), which is what actually keeps Drive API
        // call volume low under repeat views, not per-request logic here.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    console.error("[api/files] gagal mengambil file:", perusahaan, fileId, err);
    return NextResponse.json({ error: "File tidak ditemukan" }, { status: 404 });
  }
}
```

- [ ] **Step 2: Verify — static**

Run: `npx tsc --noEmit` and `npx eslint "src/app/api/files/[perusahaan]/[fileId]/[filename]/route.ts"` — both clean.

- [ ] **Step 3: Verify — live**

Only meaningfully testable once Task 6 has uploaded at least one real file to Drive. Note as a
carry-forward check into Task 6's own verification step rather than duplicating it here.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/files/[perusahaan]/[fileId]/[filename]/route.ts"
git commit -m "feat: add Google Drive file-serving proxy route"
```

---

### Task 6: Rewire the 5 upload routes

**Files:**
- Modify: `src/app/api/mkesindo/upload/satpam-check/route.ts`
- Modify: `src/app/api/mkesindo/upload/produksi-kualitas/route.ts`
- Modify: `src/app/api/mkesindo/upload/driver-app/route.ts`
- Modify: `src/app/api/mkesindo/upload/site-asset/route.ts`
- Modify: `src/app/api/mkesindo/upload/armada-foto/route.ts`

**Interfaces:**
- Consumes: `uploadFile` (Task 3).

Each route keeps its existing imports, auth gate, and validation exactly as-is — only the block
between "validation passed" and "return the path" changes. Using `satpam-check` as the concrete
example (the others follow the identical shape, swapping the category path and variable names):

- [ ] **Step 1: Rewrite `satpam-check/route.ts`'s storage block**

Replace:
```ts
  const uploadDir = path.join(process.cwd(), "public", "uploads", "satpam-check", safeArmadaId);

  try {
    await mkdir(uploadDir, { recursive: true });
    const bytes = await file.arrayBuffer();
    await writeFile(path.join(uploadDir, fileName), Buffer.from(bytes));
  } catch (err) {
    console.error("[upload/satpam-check] gagal menulis file:", uploadDir, err);
    return NextResponse.json({ error: "Gagal menyimpan foto" }, { status: 500 });
  }

  return NextResponse.json({ path: `/uploads/satpam-check/${safeArmadaId}/${fileName}` });
```

With:
```ts
  try {
    const bytes = await file.arrayBuffer();
    const uploaded = await uploadFile("mkesindo", ["satpam-check", safeArmadaId], fileName, Buffer.from(bytes), file.type);
    return NextResponse.json({ path: uploaded.publicPath });
  } catch (err) {
    console.error("[upload/satpam-check] gagal mengunggah ke Google Drive:", err);
    return NextResponse.json({ error: "Gagal menyimpan foto" }, { status: 500 });
  }
```

Remove the now-unused `import { writeFile, mkdir } from "fs/promises";` and `import path from
"path";` lines; add `import { uploadFile } from "@/lib/storage/google-drive";`.

- [ ] **Step 2: Apply the same shape to the other 4 routes**

- `produksi-kualitas/route.ts`: category path `["produksi-kualitas"]`.
- `driver-app/route.ts`: category path `["driver-app", safeJadwalDetailId]` — confirmed exact
  variable name already in that file (`const safeJadwalDetailId = jadwalDetailId.replace(/[^a-zA-Z0-9_-]/g, "")`,
  same sanitization as `satpam-check`'s `safeArmadaId`).
- `site-asset/route.ts`: category path `["site"]`.
- `armada-foto/route.ts`: category path `["armada"]`.

Same removal of `fs/promises`/`path` imports, same `uploadFile` import, same try/catch shape, same
unchanged response JSON key (`path`).

- [ ] **Step 3: Verify — static**

Run: `npx tsc --noEmit` and
`npx eslint src/app/api/mkesindo/upload/{satpam-check,produksi-kualitas,driver-app,site-asset,armada-foto}/route.ts`
— both clean.

- [ ] **Step 4: Verify — live**

Requires Task 4's live OAuth connect already done (a real `perusahaan_gdrive_koneksi` row for
`mkesindo`). Using the running app (Browser pane tool), perform one real upload through each of
the 5 flows if practical (at minimum: a satpam Cek Berangkat photo, since that's the
highest-traffic category) and confirm:
- The upload succeeds and the UI shows the photo.
- The returned path looks like `/api/files/mkesindo/<fileId>/<filename>`.
- Opening that path directly in the browser renders the image (proxy route from Task 5 works
  end-to-end).
- The file appears inside the correct subfolder in MKEsindo's connected Google Drive.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/mkesindo/upload/satpam-check/route.ts src/app/api/mkesindo/upload/produksi-kualitas/route.ts src/app/api/mkesindo/upload/driver-app/route.ts src/app/api/mkesindo/upload/site-asset/route.ts src/app/api/mkesindo/upload/armada-foto/route.ts
git commit -m "feat: switch 5 upload routes from local disk to Google Drive"
```

---

### Task 7: Admin UI — connect/disconnect Google Drive per company

**Files:**
- Modify: `src/app/grup/perusahaan/page.tsx`
- Modify: `src/components/dashboard/perusahaan-list.tsx`
- Modify: `src/components/dashboard/perusahaan-form-dialog.tsx`
- Modify: `src/app/grup/perusahaan/actions.ts`

**Interfaces:**
- Consumes: `listAllGDriveKoneksi`, `deleteGDriveKoneksi` (Task 2).

- [ ] **Step 1: Wire the new data through the page**

In `page.tsx`, add `listAllGDriveKoneksi()` to the existing `Promise.all`, pass the result to
`<PerusahaanList>` as a new `gdriveKoneksi` prop (same shape as the existing `koneksi` prop).

- [ ] **Step 2: Add the disconnect action**

In `actions.ts`, add:
```ts
import { deleteGDriveKoneksi } from "@/lib/queries/perusahaan-gdrive";
// ...
export async function disconnectGDriveAction(perusahaanId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    await deleteGDriveKoneksi(perusahaanId);
    revalidatePath("/grup/perusahaan");
  });
}
```

- [ ] **Step 3: Thread `gdriveKoneksi` through `perusahaan-list.tsx` into the dialog**

Add a `gdriveKoneksi: GDriveKoneksiRow[]` prop (import the type from
`@/lib/queries/perusahaan-gdrive`), pass it to `<PerusahaanFormDialog>` as
`existingGDrive={gdriveKoneksi}`, alongside the existing `existingKoneksi={koneksi}` line. Wire
`disconnectGDriveAction` in similarly to how `deleteKoneksiAction`/`upsertKoneksiAction` are
already wired into that component's submit handling.

- [ ] **Step 4: Add the Google Drive section to the dialog**

In `perusahaan-form-dialog.tsx`, add a new prop `existingGDrive: GDriveKoneksiRow[]` (import type
from `@/lib/queries/perusahaan-gdrive`) and a new prop `onDisconnectGDrive: (perusahaanId: number)
=> void`. Add a fieldset right after the existing "Tautan & Koneksi Database" fieldset, gated the
same way (`direktoriId != null`):

```tsx
{direktoriId != null && (
  <fieldset className="flex flex-col gap-2 rounded-lg border p-3">
    <legend className="px-1 text-xs font-medium text-muted-foreground">Google Drive</legend>
    {(() => {
      const connected = existingGDrive.find((g) => g.perusahaanId === direktoriId);
      if (!connected) {
        return (
          <a
            href={`/api/gdrive/oauth/start?perusahaanId=${direktoriId}`}
            className="inline-flex w-fit items-center rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
          >
            Hubungkan Google Drive
          </a>
        );
      }
      return (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span>
            Terhubung: <span className="font-medium">{connected.connectedEmail}</span>
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => onDisconnectGDrive(direktoriId)}>
            Putuskan
          </Button>
        </div>
      );
    })()}
  </fieldset>
)}
```

Note the `<a href>` — this is a real full-page navigation to Google's consent screen (OAuth
requires it), not a client-side action call, unlike every other control in this dialog.

- [ ] **Step 5: Verify — static**

Run: `npx tsc --noEmit` and
`npx eslint src/app/grup/perusahaan/page.tsx src/app/grup/perusahaan/actions.ts src/components/dashboard/perusahaan-list.tsx src/components/dashboard/perusahaan-form-dialog.tsx`
— both clean.

- [ ] **Step 6: Verify — live**

Open `/grup/perusahaan` in the Browser pane tool, edit MKEsindo (or whichever PT was connected in
Task 4), confirm the Google Drive fieldset shows the connected email and a working "Putuskan"
button (click it, confirm the row disappears from `perusahaan_gdrive_koneksi` via the SQL MCP tool,
then reconnect via Task 4's flow again to leave the row restored for Task 6/8's own live checks).

- [ ] **Step 7: Commit**

```bash
git add src/app/grup/perusahaan/page.tsx src/app/grup/perusahaan/actions.ts src/components/dashboard/perusahaan-list.tsx src/components/dashboard/perusahaan-form-dialog.tsx
git commit -m "feat: add Google Drive connect/disconnect UI to perusahaan admin"
```

---

### Task 8: Migrate existing local files

**Files:**
- Create: `scripts/migrate-uploads-to-gdrive.ts`

**Interfaces:**
- Consumes: `uploadFile` (Task 3).

- [ ] **Step 1: Write the migration script**

Walks `public/uploads/{satpam-check,produksi-kualitas,driver-app,site,armada}/**` (skip
`doc-template` entirely — excluded from scope), uploads each file found, and updates the matching
MSSQL row(s). Structure (one pass per category, since each maps to a different table/column
shape):

```ts
// One-off migration: uploads existing public/uploads files to Google Drive
// and rewrites the DB paths that point at them. Usage:
// npx tsx scripts/migrate-uploads-to-gdrive.ts
// Requires MKEsindo's Google Drive already connected (Task 4) before running.
import "dotenv/config";
import { readdir, readFile } from "fs/promises";
import path from "path";
import { getPool, sql } from "../src/lib/db";
import { uploadFile } from "../src/lib/storage/google-drive";

const UPLOADS_ROOT = path.join(process.cwd(), "public", "uploads");

async function migrateFlatCategory(
  category: string,
  updateRow: (oldPath: string, newPath: string) => Promise<void>
) {
  const dir = path.join(UPLOADS_ROOT, category);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    console.log(`(skip) no local directory for "${category}"`);
    return;
  }
  for (const filename of entries) {
    const buffer = await readFile(path.join(dir, filename));
    const uploaded = await uploadFile("mkesindo", [category], filename, buffer, "application/octet-stream");
    const oldPath = `/uploads/${category}/${filename}`;
    await updateRow(oldPath, uploaded.publicPath);
    console.log(`migrated ${oldPath} -> ${uploaded.publicPath}`);
  }
}

async function migrateNestedCategory(
  category: string,
  updateRow: (oldPath: string, newPath: string) => Promise<void>
) {
  const dir = path.join(UPLOADS_ROOT, category);
  let subdirs: string[];
  try {
    subdirs = await readdir(dir);
  } catch {
    console.log(`(skip) no local directory for "${category}"`);
    return;
  }
  for (const subdir of subdirs) {
    const files = await readdir(path.join(dir, subdir));
    for (const filename of files) {
      const buffer = await readFile(path.join(dir, subdir, filename));
      const uploaded = await uploadFile("mkesindo", [category, subdir], filename, buffer, "application/octet-stream");
      const oldPath = `/uploads/${category}/${subdir}/${filename}`;
      await updateRow(oldPath, uploaded.publicPath);
      console.log(`migrated ${oldPath} -> ${uploaded.publicPath}`);
    }
  }
}

async function main() {
  const pool = await getPool();

  await migrateFlatCategory("produksi-kualitas", async (oldPath, newPath) => {
    await pool.request().input("old", sql.VarChar, oldPath).input("new", sql.VarChar, newPath)
      .query(`UPDATE DashboardProduksiKualitas SET FotoPath = @new WHERE FotoPath = @old`);
  });

  await migrateFlatCategory("site", async (oldPath, newPath) => {
    await pool.request().input("old", sql.VarChar, oldPath).input("new", sql.VarChar, newPath)
      .query(`UPDATE DashboardSiteSettings SET FaviconPath = @new WHERE FaviconPath = @old`);
    await pool.request().input("old", sql.VarChar, oldPath).input("new", sql.VarChar, newPath)
      .query(`UPDATE DashboardSiteSettings SET OgImagePath = @new WHERE OgImagePath = @old`);
  });

  await migrateFlatCategory("armada", async (oldPath, newPath) => {
    await pool.request().input("old", sql.VarChar, oldPath).input("new", sql.VarChar, newPath)
      .query(`UPDATE DashboardArmada SET FotoPath = @new WHERE FotoPath = @old`);
    await pool.request().input("old", sql.VarChar, oldPath).input("new", sql.VarChar, newPath)
      .query(`UPDATE DashboardArmada SET QrMyPertaminaPath = @new WHERE QrMyPertaminaPath = @old`);
  });

  await migrateNestedCategory("satpam-check", async (oldPath, newPath) => {
    await pool.request().input("old", sql.VarChar, oldPath).input("new", sql.VarChar, newPath)
      .query(`UPDATE DashboardVehicleCheckPhoto SET FilePath = @new WHERE FilePath = @old`);
  });

  // driver-app: FotoBuktiUrls is a JSON array string (multi-photo per row) —
  // needs parse/map/re-serialize, not a straight column value match.
  const driverAppDir = path.join(UPLOADS_ROOT, "driver-app");
  let jadwalDetailDirs: string[] = [];
  try {
    jadwalDetailDirs = await readdir(driverAppDir);
  } catch {
    console.log('(skip) no local directory for "driver-app"');
  }
  for (const jadwalDetailId of jadwalDetailDirs) {
    const files = await readdir(path.join(driverAppDir, jadwalDetailId));
    const pathMap = new Map<string, string>();
    for (const filename of files) {
      const buffer = await readFile(path.join(driverAppDir, jadwalDetailId, filename));
      const uploaded = await uploadFile("mkesindo", ["driver-app", jadwalDetailId], filename, buffer, "application/octet-stream");
      pathMap.set(`/uploads/driver-app/${jadwalDetailId}/${filename}`, uploaded.publicPath);
    }

    const stopResult = await pool.request().input("jadwalDetailId", sql.VarChar, jadwalDetailId)
      .query(`SELECT FotoBuktiUrls, TandaTanganUrl FROM DashboardPengirimanStopDelivery WHERE JadwalDetailID = @jadwalDetailId`);
    for (const row of stopResult.recordset as { FotoBuktiUrls: string | null; TandaTanganUrl: string | null }[]) {
      const oldUrls: string[] = row.FotoBuktiUrls ? JSON.parse(row.FotoBuktiUrls) : [];
      const newUrls = oldUrls.map((u) => pathMap.get(u) ?? u);
      const newTandaTangan = row.TandaTanganUrl ? (pathMap.get(row.TandaTanganUrl) ?? row.TandaTanganUrl) : row.TandaTanganUrl;
      await pool.request()
        .input("jadwalDetailId", sql.VarChar, jadwalDetailId)
        .input("fotoBuktiUrls", sql.VarChar(sql.MAX), JSON.stringify(newUrls))
        .input("tandaTanganUrl", sql.VarChar, newTandaTangan)
        .query(`UPDATE DashboardPengirimanStopDelivery SET FotoBuktiUrls = @fotoBuktiUrls, TandaTanganUrl = @tandaTanganUrl WHERE JadwalDetailID = @jadwalDetailId`);
    }

    const itemResult = await pool.request().query(`
      SELECT sdi.JadwalDetailItemID, sdi.FotoReturUrl
      FROM DashboardPengirimanStopDeliveryItem sdi
      WHERE sdi.FotoReturUrl LIKE '/uploads/driver-app/${jadwalDetailId}/%'
    `);
    for (const row of itemResult.recordset as { JadwalDetailItemID: number; FotoReturUrl: string }[]) {
      const newUrl = pathMap.get(row.FotoReturUrl) ?? row.FotoReturUrl;
      await pool.request().input("id", sql.Int, row.JadwalDetailItemID).input("url", sql.VarChar, newUrl)
        .query(`UPDATE DashboardPengirimanStopDeliveryItem SET FotoReturUrl = @url WHERE JadwalDetailItemID = @id`);
    }
  }

  console.log("Migration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify — static**

Run: `npx tsc --noEmit` and `npx eslint scripts/migrate-uploads-to-gdrive.ts` — both clean.

- [ ] **Step 3: Verify — live (run against production data, after a backup/confidence check)**

Before running for real: `SELECT COUNT(*) FROM DashboardVehicleCheckPhoto WHERE FilePath LIKE '/uploads/%'`
(and the equivalent for the other tables) via the SQL MCP tool, to know how many rows should
change. Run `npx tsx scripts/migrate-uploads-to-gdrive.ts`. After it finishes, re-run those same
COUNT queries filtered on `LIKE '/uploads/%'` — expect 0 (everything migrated to `/api/files/...`
paths). Spot-check 2-3 photos in the live app (e.g. Validasi Rute's vehicle-check summary) to
confirm they still render.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-uploads-to-gdrive.ts
git commit -m "feat: add one-off migration script for existing local uploads to Google Drive"
```

---

## Final check

After all 8 tasks: `npx tsc --noEmit` and a full `npx eslint .` (or the project's usual lint
command) across the whole repo, then a walkthrough in the Browser pane tool of at least one
end-to-end flow per migrated category (satpam Cek Berangkat photo, produksi-app QC photo, one
driver-app delivery photo, armada foto in `/mkesindo/delivery`, site favicon in `/grup/pengaturan`
if that page exists) confirming each renders correctly from its new `/api/files/...` path.
