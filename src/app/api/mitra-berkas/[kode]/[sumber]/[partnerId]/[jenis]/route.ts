// Baca berkas identitas mitra (NIK & SK) secara privat: cek sesi + izin
// lihat, file ID Drive dicari dari DB (client tidak pernah memegangnya),
// dan respons TIDAK boleh di-cache publik (beda dengan /api/files).
// Spec: docs/superpowers/specs/2026-10-23-mitra-identitas-lokasi-pengiriman-design.md §7.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { aksesIdentitasMitra } from "@/lib/permissions";
import { currentEskristalKode } from "@/lib/tenant-request";
import { isPmpDeployment, isPmpScope } from "@/lib/tenant";
import { getBerkasIdentitas } from "@/lib/queries/mitra-identitas";
import { getFileBuffer } from "@/lib/storage/google-drive";
import { contentDispositionInline, validasiKunciBerkas } from "@/lib/mitra-berkas";

const TANPA_CACHE = { "Cache-Control": "private, no-store" };

function galat(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: TANPA_CACHE });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ kode: string; sumber: string; partnerId: string; jenis: string }> }
) {
  const session = await auth();
  if (!session?.user) return galat(401, "Silakan login terlebih dahulu");
  if (!aksesIdentitasMitra(session.user).lihat) return galat(403, "Anda tidak berhak melihat berkas identitas mitra");

  const p = await params;
  const kunciHasil = validasiKunciBerkas(p, {
    eskristalKode: await currentEskristalKode(),
    pmpScope: isPmpScope(session.user.accountScope),
    pmpDeployment: isPmpDeployment(),
  });
  if (!kunciHasil.ok) return galat(kunciHasil.status, kunciHasil.error);
  const { kunci, jenis } = kunciHasil;

  const berkas = await getBerkasIdentitas(kunci, jenis);
  if (!berkas) return galat(404, "Berkas tidak ditemukan");

  try {
    const { buffer } = await getFileBuffer(kunci.perusahaanKode, berkas.fileId);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        ...TANPA_CACHE,
        // MIME dari DB (sudah divalidasi saat unggah), bukan dari Drive.
        "Content-Type": berkas.mime,
        "Content-Disposition": contentDispositionInline(berkas.nama),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[api/mitra-berkas] gagal mengambil berkas dari Google Drive:", kunci.perusahaanKode, berkas.fileId, err);
    return galat(404, "Berkas tidak ditemukan");
  }
}
