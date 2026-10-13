import type { Metadata } from "next";
import { muatKartuDariTautan } from "@/lib/bychat/tautan";
import { KartuPublik } from "@/components/kartu/kartu-publik";

// Tautan publik kartu piutang: dapat dibuka tanpa login, tanpa tombol bayar.
// Data selalu terkini (per hari ini); tautan kedaluwarsa 30 hari dan bisa dicabut.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kartu Piutang", robots: { index: false, follow: false } };

export default async function KartuPiutangPublikPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const kartu = await muatKartuDariTautan(token);
  if (!kartu) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center justify-center p-6 text-center">
        <p className="text-sm text-muted-foreground">Tautan kartu piutang tidak ditemukan atau sudah kedaluwarsa. Hubungi admin untuk meminta tautan baru.</p>
      </main>
    );
  }
  return <KartuPublik data={kartu} token={token} />;
}
