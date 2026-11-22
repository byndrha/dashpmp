import { NextRequest, NextResponse } from "next/server";
import { uploadFile } from "@/lib/storage/google-drive";
import { AppError } from "@/lib/action-result";
import { sesiListrik } from "@/lib/listrik-akses";
import { wib } from "@/lib/listrik";

// Unggah foto meter PLN (modul Kelistrikan). Disimpan di Google Drive
// perusahaan yang bersangkutan: listrik-meter/<YYYY-MM>/<tanggal>-<jam>.jpg.
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");
  const kode = formData.get("kode");
  if (typeof kode !== "string" || !/^[a-z0-9]+$/.test(kode)) {
    return NextResponse.json(
      { error: "Perusahaan tidak valid" },
      { status: 400 }
    );
  }
  try {
    await sesiListrik(kode, "catat");
  } catch (err) {
    const pesan = err instanceof AppError ? err.message : "Tidak diizinkan";
    return NextResponse.json({ error: pesan }, { status: 403 });
  }
  if (!(file instanceof File))
    return NextResponse.json(
      { error: "File tidak ditemukan" },
      { status: 400 }
    );
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: "Format file harus JPG, PNG, atau WEBP" },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE_BYTES)
    return NextResponse.json(
      { error: "Ukuran file maksimal 5MB" },
      { status: 400 }
    );

  const ext =
    file.type === "image/png"
      ? "png"
      : file.type === "image/webp"
      ? "webp"
      : "jpg";
  const sekarang = new Date();
  const { tanggal, menit } = wib(sekarang);
  const jam = `${String(Math.floor(menit / 60)).padStart(2, "0")}${String(
    menit % 60
  ).padStart(2, "0")}${String(sekarang.getUTCSeconds()).padStart(2, "0")}`;
  try {
    const uploaded = await uploadFile(
      kode,
      ["listrik-meter", tanggal.slice(0, 7)],
      `${tanggal}-${jam}.${ext}`,
      Buffer.from(await file.arrayBuffer()),
      file.type
    );
    return NextResponse.json({ path: uploaded.publicPath });
  } catch (err) {
    console.error("[upload/listrik-meter] gagal mengunggah:", err);
    return NextResponse.json(
      { error: "Gagal menyimpan foto" },
      { status: 500 }
    );
  }
}
