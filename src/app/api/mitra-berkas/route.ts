// Unggah (POST) dan hapus (DELETE) berkas identitas mitra (NIK & SK).
// Berkas ini SENSITIF: wajib Google Drive (tanpa fallback disk publik),
// tidak pernah lewat /api/files (tanpa cek login + cache publik).
// Middleware meloloskan semua /api, jadi cek sesi & izin ada di sini.
// Spec: docs/superpowers/specs/2026-10-23-mitra-identitas-lokasi-pengiriman-design.md §7.
import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { AppError } from "@/lib/action-result";
import { aksesIdentitasMitra } from "@/lib/permissions";
import { currentEskristalKode } from "@/lib/tenant-request";
import { isPmpDeployment, isPmpScope } from "@/lib/tenant";
import { setBerkasIdentitas, type IdentitasKunci } from "@/lib/queries/mitra-identitas";
import { deleteFile, uploadFileWajibDrive } from "@/lib/storage/google-drive";
import { rapikanNamaBerkas, validasiBerkas, validasiKunciBerkas } from "@/lib/mitra-berkas";

const TANPA_CACHE = { "Cache-Control": "private, no-store" };

function galat(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: TANPA_CACHE });
}

type HasilGerbang = { ok: true; user: Session["user"] } | { ok: false; res: NextResponse };

async function gerbangUbah(): Promise<HasilGerbang> {
  const session = await auth();
  if (!session?.user) return { ok: false, res: galat(401, "Silakan login terlebih dahulu") };
  if (!aksesIdentitasMitra(session.user).ubah) {
    return { ok: false, res: galat(403, "Anda tidak berhak mengubah berkas identitas mitra") };
  }
  return { ok: true, user: session.user };
}

async function konteksAkses(user: Session["user"]) {
  return {
    eskristalKode: await currentEskristalKode(),
    pmpScope: isPmpScope(user.accountScope),
    pmpDeployment: isPmpDeployment(),
  };
}

// Hapus berkas lama dari Drive setelah DB diperbarui. Gagal di sini tidak
// membatalkan operasi (DB sudah benar); berkas yatim hanya dicatat di log.
async function hapusDariDrive(kunci: IdentitasKunci, fileId: string | null) {
  if (!fileId) return;
  try {
    await deleteFile(kunci.perusahaanKode, fileId);
  } catch (err) {
    console.error("[api/mitra-berkas] gagal menghapus berkas lama dari Google Drive:", kunci.perusahaanKode, fileId, err);
  }
}

function capWaktu(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

export async function POST(req: NextRequest) {
  const g = await gerbangUbah();
  if (!g.ok) return g.res;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return galat(400, "Data unggahan tidak valid");
  }
  const kunciHasil = validasiKunciBerkas(
    { kode: formData.get("kode"), sumber: formData.get("sumber"), partnerId: formData.get("partnerId"), jenis: formData.get("jenis") },
    await konteksAkses(g.user)
  );
  if (!kunciHasil.ok) return galat(kunciHasil.status, kunciHasil.error);
  const { kunci, jenis } = kunciHasil;

  const file = formData.get("file");
  if (!(file instanceof File)) return galat(400, "Berkas tidak ditemukan");
  const cek = validasiBerkas(file);
  if (!cek.ok) return galat(400, cek.error);

  const nama = rapikanNamaBerkas(file.name, `${jenis}.${cek.ext}`);
  const namaDrive = `${capWaktu(new Date())}-${jenis}.${cek.ext}`;

  let fileIdBaru: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    ({ fileId: fileIdBaru } = await uploadFileWajibDrive(
      kunci.perusahaanKode,
      ["mitra-identitas", kunci.perusahaanKode, kunci.partnerId],
      namaDrive,
      buffer,
      file.type
    ));
  } catch (err) {
    if (err instanceof AppError) return galat(409, err.message);
    console.error("[api/mitra-berkas] gagal mengunggah ke Google Drive:", err);
    return galat(500, "Gagal menyimpan berkas ke Google Drive");
  }

  let fileIdLama: string | null;
  try {
    ({ fileIdLama } = await setBerkasIdentitas(kunci, jenis, { fileId: fileIdBaru, nama, mime: file.type }, g.user.id));
  } catch (err) {
    console.error("[api/mitra-berkas] gagal menyimpan berkas ke database:", err);
    // DB gagal -> berkas baru tidak dirujuk siapa pun; bersihkan dari Drive.
    await hapusDariDrive(kunci, fileIdBaru);
    return galat(500, "Gagal menyimpan data berkas");
  }
  if (fileIdLama !== fileIdBaru) await hapusDariDrive(kunci, fileIdLama);

  return NextResponse.json({ ok: true, nama }, { headers: TANPA_CACHE });
}

export async function DELETE(req: NextRequest) {
  const g = await gerbangUbah();
  if (!g.ok) return g.res;

  const q = req.nextUrl.searchParams;
  const kunciHasil = validasiKunciBerkas(
    { kode: q.get("kode"), sumber: q.get("sumber"), partnerId: q.get("partnerId"), jenis: q.get("jenis") },
    await konteksAkses(g.user)
  );
  if (!kunciHasil.ok) return galat(kunciHasil.status, kunciHasil.error);
  const { kunci, jenis } = kunciHasil;

  let fileIdLama: string | null;
  try {
    ({ fileIdLama } = await setBerkasIdentitas(kunci, jenis, null, g.user.id));
  } catch (err) {
    console.error("[api/mitra-berkas] gagal mengosongkan berkas di database:", err);
    return galat(500, "Gagal menghapus berkas");
  }
  await hapusDariDrive(kunci, fileIdLama);

  return NextResponse.json({ ok: true }, { headers: TANPA_CACHE });
}
