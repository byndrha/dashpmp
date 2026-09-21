import { NextRequest, NextResponse } from "next/server";
import { uploadFile } from "@/lib/storage/google-drive";
import { requireMarketing } from "@/lib/require-access";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_SLOTS = ["depan", "penagihan"] as const;

export async function POST(req: NextRequest) {
  await requireMarketing();

  const formData = await req.formData();
  const file = formData.get("file");
  const businessPartnerId = formData.get("businessPartnerId");
  const slot = formData.get("slot");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File tidak ditemukan" }, { status: 400 });
  }
  if (typeof businessPartnerId !== "string" || !businessPartnerId) {
    return NextResponse.json({ error: "businessPartnerId wajib diisi" }, { status: 400 });
  }
  if (typeof slot !== "string" || !ALLOWED_SLOTS.includes(slot as (typeof ALLOWED_SLOTS)[number])) {
    return NextResponse.json({ error: "slot harus 'depan' atau 'penagihan'" }, { status: 400 });
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
    [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("") +
    "-" +
    [String(now.getHours()).padStart(2, "0"), String(now.getMinutes()).padStart(2, "0"), String(now.getSeconds()).padStart(2, "0")].join("");
  const fileName = `${stamp}-${slot}.${ext}`;

  try {
    const bytes = await file.arrayBuffer();
    const uploaded = await uploadFile("mkesindo", ["marketing-kunjungan", businessPartnerId], fileName, Buffer.from(bytes), file.type);
    return NextResponse.json({ path: uploaded.publicPath });
  } catch (err) {
    console.error("[upload/marketing-kunjungan] gagal mengunggah ke Google Drive:", err);
    return NextResponse.json({ error: "Gagal menyimpan foto" }, { status: 500 });
  }
}
