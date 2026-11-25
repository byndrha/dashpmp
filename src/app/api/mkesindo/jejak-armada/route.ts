import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canView } from "@/lib/permissions";
import { canAccessAllPT } from "@/lib/require-access";
import { getArmadaList } from "@/lib/queries/armada";
import { getJejakAktualJadwal, type JejakAktual } from "@/lib/queries/jejak-armada";

// Validasi Rute — jejak rute yang BENAR-BENAR ditempuh armada untuk satu
// Jadwal (riwayat provider GPS, lihat jejak-armada.ts).
//
// Sengaja route handler, BUKAN server action: Next.js menjalankan server
// action dari satu halaman satu per satu, jadi permintaan ke provider GPS
// (bisa beberapa detik saat login pertama) akan menahan semua aksi lain di
// dialog — dan sebaliknya. fetch() biasa berjalan paralel.
//
// GET ?jadwalId&armadaId&berangkat=<ISO>&kembali=<ISO, opsional>
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Belum masuk" }, { status: 401 });
  if (!canAccessAllPT(session.user) && !canView(session.user.permissions, "delivery")) {
    return NextResponse.json({ error: "Tidak diizinkan" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const jadwalId = Number(sp.get("jadwalId"));
  const armadaId = Number(sp.get("armadaId"));
  const berangkat = new Date(sp.get("berangkat") ?? "");
  const kembaliRaw = sp.get("kembali");
  const kembali = kembaliRaw ? new Date(kembaliRaw) : null;
  if (!Number.isInteger(jadwalId) || !Number.isInteger(armadaId) || Number.isNaN(berangkat.getTime()) || (kembali && Number.isNaN(kembali.getTime()))) {
    return NextResponse.json({ error: "Parameter tidak valid" }, { status: 400 });
  }
  const ujung = kembali ?? new Date();
  // Batas 24 jam supaya permintaan liar tidak menarik riwayat berhari-hari.
  if (ujung.getTime() - berangkat.getTime() > 24 * 3600_000) {
    return NextResponse.json({ error: "Rentang perjalanan lebih dari 24 jam" }, { status: 400 });
  }

  try {
    const armada = (await getArmadaList()).find((a) => a.ArmadaID === armadaId);
    if (!armada) return NextResponse.json({ error: "Armada tidak ditemukan" }, { status: 404 });
    if (!armada.PlatNomor) {
      const kosong: JejakAktual = {
        status: "tanpa_alat",
        sumber: null,
        titik: [],
        jarakKm: null,
        berhenti: [],
        waktu: [],
        kecepatan: [],
        dari: berangkat.toISOString(),
        sampai: ujung.toISOString(),
        final: false,
        diambilAt: new Date().toISOString(),
      };
      return NextResponse.json(kosong);
    }
    const jejak = await getJejakAktualJadwal({ jadwalId, armadaId, platNomor: armada.PlatNomor, berangkat, kembali });
    return NextResponse.json(jejak);
  } catch (err) {
    console.error("[jejak-armada] gagal:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Gagal mengambil jejak GPS dari provider" }, { status: 502 });
  }
}
