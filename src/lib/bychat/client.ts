import { AppError } from "@/lib/action-result";

// Klien HTTP ke API ByChat (Chatwoot fork). Token API hanya dipakai di server
// dan TIDAK PERNAH ikut ke pesan galat/log.

const TIMEOUT_MS = 20000;

// Admin menyimpan URL ini; tetap dibatasi supaya tidak menjadi jalur SSRF
// sembarangan: https wajib, kecuali localhost (uji lokal).
export function normalizeBaseUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new AppError("URL ByChat tidak valid.");
  }
  const lokal = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(lokal && u.protocol === "http:")) {
    throw new AppError("URL ByChat harus memakai https.");
  }
  if (u.username || u.password) throw new AppError("URL ByChat tidak boleh memuat kredensial.");
  return `${u.protocol}//${u.host}`;
}

export interface ByChatAkunInfo {
  id: number;
  name: string;
  role: string;
}
export interface ByChatInboxInfo {
  id: number;
  name: string;
  channelType: string;
}
export interface ByChatProfil {
  nama: string;
  akun: ByChatAkunInfo[];
}

async function getJson(url: string, token: string): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { api_access_token: token, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new AppError("Tidak dapat menghubungi server ByChat. Periksa URL dan koneksi.");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

export async function ambilProfil(baseUrl: string, token: string): Promise<ByChatProfil> {
  const { status, body } = await getJson(`${normalizeBaseUrl(baseUrl)}/api/v1/profile`, token);
  if (status === 401 || status === 403) throw new AppError("Token API ByChat ditolak (tidak valid atau tidak berhak).");
  if (status !== 200 || !body || typeof body !== "object") throw new AppError(`ByChat membalas status ${status} saat membaca profil.`);
  const b = body as { name?: unknown; accounts?: unknown };
  const akun = Array.isArray(b.accounts)
    ? (b.accounts as Record<string, unknown>[])
        .map((a) => ({ id: Number(a.id), name: String(a.name ?? ""), role: String(a.role ?? "") }))
        .filter((a) => Number.isInteger(a.id))
    : [];
  return { nama: typeof b.name === "string" ? b.name : "", akun };
}

export async function ambilInbox(baseUrl: string, token: string, accountId: number): Promise<ByChatInboxInfo[]> {
  const { status, body } = await getJson(`${normalizeBaseUrl(baseUrl)}/api/v1/accounts/${accountId}/inboxes`, token);
  if (status === 401 || status === 403) throw new AppError("Token ByChat tidak boleh membaca daftar inbox akun ini.");
  if (status !== 200 || !body || typeof body !== "object") throw new AppError(`ByChat membalas status ${status} saat membaca inbox.`);
  const payload = (body as { payload?: unknown }).payload;
  if (!Array.isArray(payload)) return [];
  return (payload as Record<string, unknown>[])
    .map((i) => ({ id: Number(i.id), name: String(i.name ?? ""), channelType: String(i.channel_type ?? "") }))
    .filter((i) => Number.isInteger(i.id));
}

export interface UjiKoneksiHasil {
  ok: boolean;
  pesan: string;
  namaAkun: string | null;
  peran: string | null;
  inbox: ByChatInboxInfo[];
}

// Pemeriksaan wajib "Uji koneksi": token sah, ID akun yang diketik ada di
// daftar akun milik token itu (mencegah salah ketik yang menukar PT), dan
// perannya BUKAN administrator (token integrasi harus berhak minimum).
export async function ujiKoneksi(baseUrl: string, token: string, accountId: number): Promise<UjiKoneksiHasil> {
  const profil = await ambilProfil(baseUrl, token);
  const akun = profil.akun.find((a) => a.id === accountId);
  if (!akun) {
    return {
      ok: false,
      pesan: `Token ini tidak punya akses ke akun ByChat ID ${accountId}. Akun yang dimiliki token: ${
        profil.akun.map((a) => `${a.id} (${a.name})`).join(", ") || "(tidak ada)"
      }.`,
      namaAkun: null,
      peran: null,
      inbox: [],
    };
  }
  if (akun.role.toLowerCase() === "administrator") {
    return {
      ok: false,
      pesan: "Token ini berperan administrator. Pakai token pengguna khusus berperan agen (hak minimum), bukan administrator.",
      namaAkun: akun.name,
      peran: akun.role,
      inbox: [],
    };
  }
  const inbox = await ambilInbox(baseUrl, token, accountId);
  return {
    ok: true,
    pesan: `Terhubung ke akun "${akun.name}" sebagai ${akun.role || "agen"}. ${inbox.length} inbox dapat diakses.`,
    namaAkun: akun.name,
    peran: akun.role,
    inbox,
  };
}

// ------------------------------------------------------------- kirim pesan

export interface HasilKirim {
  status: number;
  replayed: boolean;
  conversationId: number | null;
  contactId: number | null;
  messageId: number | null;
  createdConversation: boolean;
}

const KIRIM_TIMEOUT_MS = 45000;

function detailGalat(body: unknown): string {
  if (body && typeof body === "object") {
    const b = body as { error?: unknown; message?: unknown; errors?: unknown };
    const t = [b.error, b.message].find((x) => typeof x === "string") as string | undefined;
    if (t) return t.slice(0, 200);
    if (Array.isArray(b.errors)) return b.errors.filter((x) => typeof x === "string").join("; ").slice(0, 200);
  }
  return "data tidak valid";
}

// Kontrak: POST <url>/api/v1/accounts/<id>/kanban/integration_messages
// (multipart). 201 = terkirim, 200 + replayed:true = kunci idempoten sama
// dalam 24 jam (tidak dikirim ulang). Semua galat diterjemahkan ke Bahasa
// Indonesia; token tidak pernah masuk ke pesan.
export async function postIntegrationMessage(baseUrl: string, token: string, accountId: number, form: FormData): Promise<HasilKirim> {
  const url = `${normalizeBaseUrl(baseUrl)}/api/v1/accounts/${accountId}/kanban/integration_messages`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { api_access_token: token, Accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(KIRIM_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new AppError("Tidak dapat menghubungi server ByChat. Kartu belum terkirim; coba lagi.");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.status === 200 || res.status === 201) {
    const b = (body && typeof body === "object" ? body : {}) as { replayed?: unknown; data?: Record<string, unknown> };
    const d = b.data ?? {};
    const n = (v: unknown) => (typeof v === "number" ? v : null);
    return {
      status: res.status,
      replayed: b.replayed === true,
      conversationId: n(d.conversation_id),
      contactId: n(d.contact_id),
      messageId: n(d.message_id),
      createdConversation: d.created_conversation === true,
    };
  }
  switch (res.status) {
    case 401:
      throw new AppError("Token API ByChat PT ini ditolak. Hubungi admin dashpmp untuk memperbarui token.");
    case 403:
      throw new AppError("Pengguna integrasi bukan anggota inbox WhatsApp PT ini di ByChat.");
    case 404:
      throw new AppError("Inbox WhatsApp tidak ditemukan di ByChat. Periksa ID inbox di pengaturan PT.");
    case 409:
      throw new AppError("Pengiriman yang sama sedang diproses. Coba lagi sebentar.");
    case 422:
      throw new AppError(`Permintaan ditolak ByChat: ${detailGalat(body)}.`);
    case 429: {
      const ra = Number(res.headers.get("retry-after"));
      throw new AppError(`Terlalu banyak permintaan ke ByChat. Coba lagi dalam ${Number.isFinite(ra) && ra > 0 ? ra : 60} detik.`);
    }
    default:
      throw new AppError(`ByChat membalas status ${res.status}. Kartu belum terkirim.`);
  }
}

// ------------------------------------------------------------- status pesan

export type StatusPesan = "sent" | "delivered" | "read" | "failed";
export interface HasilStatusPesan {
  status: StatusPesan | "tidak_ditemukan";
  galat: string | null;
}

const NAMA_STATUS: StatusPesan[] = ["sent", "delivered", "read", "failed"];

// Baca status satu pesan (GET .../conversations/<id>/messages, cari message_id).
// "sent" TIDAK menjamin sampai ke WhatsApp; hanya delivered/read yang menjamin.
// Alasan gagal ada di content_attributes.external_error.
export async function ambilStatusPesan(baseUrl: string, token: string, accountId: number, conversationId: number, messageId: number): Promise<HasilStatusPesan> {
  const { status, body } = await getJson(`${normalizeBaseUrl(baseUrl)}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`, token);
  if (status === 401 || status === 403) throw new AppError("Token ByChat tidak boleh membaca pesan percakapan.");
  if (status !== 200 || !body || typeof body !== "object") throw new AppError(`ByChat membalas status ${status} saat membaca status pesan.`);
  const payload = (body as { payload?: unknown }).payload;
  const daftar = Array.isArray(payload) ? (payload as Record<string, unknown>[]) : [];
  const m = daftar.find((x) => Number(x.id) === messageId && x.private !== true);
  if (!m) return { status: "tidak_ditemukan", galat: null };
  const mentah = m.status;
  const nama = typeof mentah === "number" ? NAMA_STATUS[mentah] : typeof mentah === "string" ? (mentah as StatusPesan) : undefined;
  if (!nama || !NAMA_STATUS.includes(nama)) return { status: "sent", galat: null };
  const ca = (m.content_attributes ?? {}) as { external_error?: unknown };
  return { status: nama, galat: nama === "failed" && typeof ca.external_error === "string" ? ca.external_error.slice(0, 300) : null };
}
