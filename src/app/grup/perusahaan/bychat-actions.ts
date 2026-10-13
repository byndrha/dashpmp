"use server";

import { requireGrupAccess } from "@/lib/require-access";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";
import { ujiKoneksi, type UjiKoneksiHasil } from "@/lib/bychat/client";
import { adaWebhookSecret, simpanWebhookSecret } from "@/lib/queries/perusahaan-bychat";
import { getPenagihanAktif, setPenagihanAktif } from "@/lib/penagihan/repo";
import { defaultAudience } from "@/lib/bychat/token";
import {
  BYCHAT_URL_DEFAULT,
  deleteByChatKoneksi,
  getByChatKoneksi,
  getStoredApiToken,
  upsertByChatKoneksi,
  type ByChatKoneksiRow,
} from "@/lib/queries/perusahaan-bychat";

// Pengaturan "Integrasi ByChat" per PT (Ubah PT). Hanya peran grup
// (requireGrupAccess). Token tidak pernah dikembalikan ke klien.

export interface ByChatIntegrasiState {
  konfigurasi: ByChatKoneksiRow | null;
  urlDefault: string;
  penagihanAktif: boolean;
  webhookSecretAda: boolean;
  webhookUrl: string;
  embedUrl: string; // didaftarkan sebagai Dashboard App di tiap akun ByChat
}

export async function getByChatIntegrasiAction(perusahaanId: number): Promise<ActionResult<ByChatIntegrasiState>> {
  return runAction(async () => {
    await requireGrupAccess();
    return {
      konfigurasi: await getByChatKoneksi(perusahaanId),
      penagihanAktif: await getPenagihanAktif(perusahaanId),
      webhookSecretAda: await adaWebhookSecret(perusahaanId),
      webhookUrl: `${defaultAudience()}/api/bychat/webhook`,
      urlDefault: BYCHAT_URL_DEFAULT,
      embedUrl: `${defaultAudience()}/embed/mitra`,
    };
  });
}

interface UjiInput {
  perusahaanId: number;
  url: string;
  accountId: number;
  token: string | null; // kosong = pakai token yang sudah tersimpan
}

async function jalankanUji(input: UjiInput): Promise<UjiKoneksiHasil> {
  const token = (input.token ?? "").trim() || (await getStoredApiToken(input.perusahaanId));
  if (!token) throw new AppError("Token Akses API ByChat belum diisi.");
  if (!Number.isInteger(input.accountId) || input.accountId <= 0) throw new AppError("ID akun ByChat harus berupa angka positif.");
  return ujiKoneksi(input.url || BYCHAT_URL_DEFAULT, token, input.accountId);
}

export async function ujiKoneksiByChatAction(input: UjiInput): Promise<ActionResult<UjiKoneksiHasil>> {
  return runAction(async () => {
    await requireGrupAccess();
    return jalankanUji(input);
  });
}

export async function simpanByChatIntegrasiAction(
  input: UjiInput & { inboxId: number | null; aktif: boolean }
): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    // Uji wajib lulus sebelum menyimpan: token sah, ID akun milik token itu,
    // perannya bukan administrator (mencegah salah ketik yang menukar PT).
    const uji = await jalankanUji(input);
    if (!uji.ok) throw new AppError(uji.pesan);
    if (input.inboxId != null && !uji.inbox.some((i) => i.id === input.inboxId)) {
      throw new AppError("ID inbox tidak ditemukan pada akun ByChat ini. Pilih dari daftar hasil Uji koneksi.");
    }
    await upsertByChatKoneksi({
      perusahaanId: input.perusahaanId,
      bychatUrl: input.url,
      bychatAccountId: input.accountId,
      apiToken: input.token,
      inboxId: input.inboxId,
      aktif: input.aktif,
    });
  });
}

export async function hapusByChatIntegrasiAction(perusahaanId: number): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    await deleteByChatKoneksi(perusahaanId);
  });
}

// Tombol "Penagihan otomatis" per PT. Bawaan MATI; seluruh pengaturannya ada di
// tab "Penagihan ByChat" modul Piutang.
export async function setPenagihanAktifAction(perusahaanId: number, aktif: boolean): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    if (aktif) {
      const k = await getByChatKoneksi(perusahaanId);
      if (!k || !k.aktif) throw new AppError("Aktifkan dan simpan koneksi ByChat PT ini lebih dulu.");
      if (k.inboxId == null) throw new AppError("Pilih inbox WhatsApp lebih dulu sebelum mengaktifkan penagihan otomatis.");
    }
    await setPenagihanAktif(perusahaanId, aktif);
  });
}

// Rahasia webhook pesan masuk (disalin admin dari ByChat). Kosong = hapus.
export async function simpanWebhookSecretAction(perusahaanId: number, secret: string): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireGrupAccess();
    await simpanWebhookSecret(perusahaanId, secret);
  });
}
