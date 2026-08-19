import { NextRequest, NextResponse } from "next/server";
import { uploadFile } from "@/lib/storage/google-drive";
import { requireDriver } from "@/lib/require-access";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
// jenisFoto identifies which slot a photo fills (bukti-pengiriman,
// bukti-muatan, tanda-tangan, or retur-<salesOrderDetailId> for a
// per-item retur photo) — unlike satpam-check's fixed JENIS_FOTO_LIST,
// this set is open-ended per stop item, so it's validated by shape
// (safe filename characters only) rather than membership in a fixed list.
const JENIS_FOTO_PATTERN = /^[a-zA-Z0-9-]{1,64}$/;

export async function POST(req: NextRequest) {
  await requireDriver();

  const formData = await req.formData();
  const file = formData.get("file");
  const jadwalDetailId = formData.get("jadwalDetailId");
  const jenisFoto = formData.get("jenisFoto");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File tidak ditemukan" }, { status: 400 });
  }
  if (typeof jadwalDetailId !== "string" || !jadwalDetailId.trim()) {
    return NextResponse.json({ error: "jadwalDetailId wajib diisi" }, { status: 400 });
  }
  if (typeof jenisFoto !== "string" || !JENIS_FOTO_PATTERN.test(jenisFoto)) {
    return NextResponse.json({ error: "jenisFoto tidak valid" }, { status: 400 });
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
    [String(now.getHours()).padStart(2, "0"), String(now.getMinutes()).padStart(2, "0"), String(now.getSeconds()).padStart(2, "0")].join(
      ""
    );
  const fileName = `${stamp}-${jenisFoto}.${ext}`;
  const safeJadwalDetailId = jadwalDetailId.replace(/[^a-zA-Z0-9_-]/g, "");

  try {
    const bytes = await file.arrayBuffer();
    const uploaded = await uploadFile("mkesindo", ["driver-app", safeJadwalDetailId], fileName, Buffer.from(bytes), file.type);
    return NextResponse.json({ path: uploaded.publicPath });
  } catch (err) {
    console.error("[upload/driver-app] gagal mengunggah ke Google Drive:", err);
    return NextResponse.json({ error: "Gagal menyimpan foto" }, { status: 500 });
  }
}
