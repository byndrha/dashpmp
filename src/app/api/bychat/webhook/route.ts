import { NextResponse } from "next/server";
import { getWebhookSecretByAccountId } from "@/lib/queries/perusahaan-bychat";
import { tambahOptout } from "@/lib/penagihan/repo";
import { adalahPermintaanOptOut, bacaPesanMasuk, verifikasiTandaTangan } from "@/lib/penagihan/webhook-util";

// Webhook ByChat (message_created). Tanda tangan diverifikasi dengan rahasia
// per PT atas body MENTAH; balasan mitra yang tegas meminta berhenti ("stop",
// "berhenti", "jangan kirim"...) masuk daftar opt-out. Pesan lain diabaikan.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const mentah = await req.text();
  if (mentah.length > 256_000) return new NextResponse(null, { status: 413 });
  let payload: unknown;
  try {
    payload = JSON.parse(mentah);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  // PT ditentukan dari account.id pada payload, tetapi payload baru dipercaya
  // setelah tanda tangan dengan rahasia PT itu terverifikasi.
  const akunId = Number((payload as { account?: { id?: unknown } })?.account?.id);
  const rahasia = Number.isInteger(akunId) ? await getWebhookSecretByAccountId(akunId) : null;
  const sah =
    rahasia != null &&
    verifikasiTandaTangan({
      secret: rahasia.secret,
      timestamp: req.headers.get("x-chatwoot-timestamp"),
      tandaTangan: req.headers.get("x-chatwoot-signature"),
      bodyMentah: mentah,
    });
  if (!sah) return new NextResponse(null, { status: 401 });

  const pesan = bacaPesanMasuk(payload);
  if (pesan && pesan.nomor && adalahPermintaanOptOut(pesan.teks)) {
    await tambahOptout(rahasia.perusahaanId, pesan.nomor, `Balasan mitra: "${pesan.teks.slice(0, 80)}"`, "ByChat", "whatsapp");
  }
  return NextResponse.json({ ok: true });
}
