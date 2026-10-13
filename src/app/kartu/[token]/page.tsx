import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { batasTokenGagal, batasUmum, ipDari } from "@/lib/bychat/rate-limit";
import { muatKartuDariTautan } from "@/lib/bychat/tautan";
import { KartuPublik } from "@/components/kartu/kartu-publik";

// Tautan publik kartu piutang: dapat dibuka tanpa login, tanpa tombol bayar.
// Data selalu terkini (per hari ini); tautan kedaluwarsa 30 hari dan bisa dicabut.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kartu Piutang", robots: { index: false, follow: false } };

export default async function KartuPiutangPublikPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = ipDari(await headers());
  if (!batasUmum.coba(ip)) notFound();
  const kartu = await muatKartuDariTautan(token, ip);
  // Respons seragam (404) untuk token salah/kedaluwarsa/dicabut; percobaan gagal dibatasi per IP.
  if (!kartu) {
    batasTokenGagal.coba(ip);
    notFound();
  }
  return <KartuPublik data={kartu} token={token} />;
}
