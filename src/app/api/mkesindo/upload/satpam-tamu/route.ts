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
  // isSuperAdmin. Mirrors satpam-check/route.ts and satpam-patroli/route.ts's
  // own identical gate.
  const session = await auth();
  if (!session?.user?.isSatpam) {
    return NextResponse.json({ error: "Hanya Satpam yang dapat mengunggah foto ini." }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  const jenis = formData.get("jenis");
  const kunjunganIdRaw = formData.get("kunjunganId");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File tidak ditemukan" }, { status: 400 });
  }
  if (jenis !== "masuk" && jenis !== "keluar") {
    return NextResponse.json({ error: 'jenis wajib "masuk" atau "keluar"' }, { status: 400 });
  }
  if (
    jenis === "keluar" &&
    (typeof kunjunganIdRaw !== "string" || !kunjunganIdRaw.trim() || !Number.isInteger(Number(kunjunganIdRaw)))
  ) {
    return NextResponse.json({ error: "kunjunganId wajib diisi untuk foto keluar" }, { status: 400 });
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
    [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join(
      ""
    ) +
    "-" +
    [
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join("");
  const kunjunganSuffix =
    jenis === "keluar" && typeof kunjunganIdRaw === "string" ? `-${kunjunganIdRaw.replace(/[^0-9]/g, "")}` : "";
  const fileName = `${stamp}-${jenis}${kunjunganSuffix}.${ext}`;

  try {
    const bytes = await file.arrayBuffer();
    const uploaded = await uploadFile("mkesindo", ["satpam-tamu"], fileName, Buffer.from(bytes), file.type);
    return NextResponse.json({ path: uploaded.publicPath });
  } catch (err) {
    console.error("[upload/satpam-tamu] gagal mengunggah ke Google Drive:", err);
    return NextResponse.json({ error: "Gagal menyimpan foto" }, { status: 500 });
  }
}
