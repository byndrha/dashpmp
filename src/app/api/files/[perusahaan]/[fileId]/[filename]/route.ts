import { NextRequest, NextResponse } from "next/server";
import { getFileBuffer } from "@/lib/storage/google-drive";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ perusahaan: string; fileId: string; filename: string }> }
) {
  const { perusahaan, fileId } = await params;
  try {
    const { buffer, mimeType } = await getFileBuffer(perusahaan, fileId);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": mimeType,
        // Uploaded files never change after creation — safe to cache
        // indefinitely at the browser and at Cloudflare's edge (already in
        // front of this domain), which is what actually keeps Drive API
        // call volume low under repeat views, not per-request logic here.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    console.error("[api/files] gagal mengambil file:", perusahaan, fileId, err);
    return NextResponse.json({ error: "File tidak ditemukan" }, { status: 404 });
  }
}
