import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { requireModuleAccess } from "@/lib/require-access";
import { auth } from "@/lib/auth";
import { JENIS_FOTO_LIST, type JenisFotoKendaraan } from "@/lib/queries/vehicle-check";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  await requireModuleAccess("delivery");

  // Evidentiary gate-check photos — checked independently of the page-level
  // module gate above, deliberately NOT bypassed by isSuperAdmin. See
  // docs/superpowers/specs/2026-08-03-satpam-vehicle-check-design.md.
  const session = await auth();
  if (!session?.user?.isSatpam) {
    return NextResponse.json({ error: "Hanya Satpam yang dapat mengunggah foto ini." }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  const armadaId = formData.get("armadaId");
  const jenisFoto = formData.get("jenisFoto");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "File tidak ditemukan" }, { status: 400 });
  }
  if (typeof armadaId !== "string" || !armadaId.trim()) {
    return NextResponse.json({ error: "armadaId wajib diisi" }, { status: 400 });
  }
  if (typeof jenisFoto !== "string" || !JENIS_FOTO_LIST.includes(jenisFoto as JenisFotoKendaraan)) {
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
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("") + "-" + [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  const fileName = `${stamp}-${jenisFoto}.${ext}`;
  const safeArmadaId = armadaId.replace(/[^a-zA-Z0-9_-]/g, "");
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
}
