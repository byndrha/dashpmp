import { OAuth2Client } from "google-auth-library";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
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

async function uploadToLocalDiskFallback(
  categoryPath: string[],
  filename: string,
  buffer: Buffer
): Promise<UploadedFile> {
  const uploadDir = path.join(process.cwd(), "public", "uploads", ...categoryPath);
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, filename), buffer);
  return { fileId: "", publicPath: `/uploads/${categoryPath.join("/")}/${filename}` };
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
    console.warn(`[google-drive] Belum terhubung untuk "${perusahaanKode}" — menyimpan ke disk lokal sebagai fallback. Hubungkan Google Drive di /grup/perusahaan.`);
    return uploadToLocalDiskFallback(categoryPath, filename, buffer);
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
