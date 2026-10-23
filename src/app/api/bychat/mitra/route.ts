import { NextResponse } from "next/server";
import { autentikasi, bacaBody, jsonGalat } from "@/lib/bychat/auth-request";
import { ambilKartu, cariMitraUntukKontak, kirimTerakhir24Jam } from "@/lib/bychat/kirim";

// POST { token } -> ringkasan mitra yang cocok dengan nomor kontak percakapan
// (nomor dari KLAIM token), dibatasi database PT akun ByChat itu.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { token } = await bacaBody(req);
    const { claims, koneksi } = await autentikasi(token);
    const { nomor, mitra } = await cariMitraUntukKontak(koneksi, claims);

    const ringkasan = await Promise.all(
      mitra.slice(0, 5).map(async (m) => {
        const [kartu, terakhir] = await Promise.all([ambilKartu(koneksi, claims, m.id), kirimTerakhir24Jam(koneksi.perusahaanKode, m.id)]);
        const urut = [...kartu.faktur].sort((a, b) => b.hariLewat - a.hariLewat);
        return {
          id: m.id,
          nama: m.nama,
          wilayah: m.wilayah,
          lokasi: m.lokasi ?? [],
          totalPiutang: kartu.totalPiutang,
          jumlahFaktur: kartu.faktur.length,
          aging: kartu.aging,
          fakturTeratas: urut.slice(0, 5),
          pembelianTerbaru: kartu.pembelianTerbaru,
          pembelian30Hari: kartu.pembelian30Hari,
          pembelian90Hari: kartu.pembelian90Hari,
          terakhirKirim: terakhir ? { agenNama: terakhir.agenNama, waktu: terakhir.waktu.toISOString() } : null,
        };
      })
    );

    return NextResponse.json(
      {
        pt: { kode: koneksi.perusahaanKode, nama: koneksi.perusahaanNama },
        kontak: { nama: claims.contact.name, nomor: nomor ? `+${nomor}` : null },
        agen: { nama: claims.agent.name, peran: claims.agent.role },
        inbox: { diatur: koneksi.inboxId != null, sesuai: koneksi.inboxId != null && koneksi.inboxId === claims.inboxId },
        totalCocok: mitra.length,
        mitra: ringkasan,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return jsonGalat(err);
  }
}
