import { RiwayatShiftGroupCard } from "@/components/produksi/riwayat-shift-group-card";
import type { RiwayatShiftGroup } from "@/lib/queries/produksi-riwayat-detail";

// Riwayat Produksi versi detail: dikelompokkan per (Tanggal, Shift) --
// urutan shift dalam satu tanggal selalu kronologis 2 -> 3 -> 1 (sudah
// diurutkan dari query, lihat produksi-riwayat-detail.ts), grup ter-baru
// paling atas. Rendering tiap kartu grup (header collapsible + statistik +
// daftar entri) didelegasikan ke RiwayatShiftGroupCard (client component,
// butuh useState untuk toggle collapse) -- file ini sengaja tetap Server
// Component murni. Sesuai permintaan user 2026-09-19.
export function RiwayatProduksi({ riwayatGrup }: { riwayatGrup: RiwayatShiftGroup[] }) {
  if (riwayatGrup.length === 0) {
    return <p className="text-sm text-muted-foreground">Belum ada riwayat produksi.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {riwayatGrup.map((g) => (
        <RiwayatShiftGroupCard key={`${g.tanggalUsaha}-${g.shift}`} group={g} />
      ))}
    </div>
  );
}
