"use client";

import { KinerjaMarketingSubTab } from "@/components/pemasaran-app/kinerja-marketing-sub-tab";

// Dulu punya 2 sub-tab ("Kinerja Marketing" + "Pengajuan") -- "Pengajuan"
// dipindah jadi "Riwayat Pengajuan" (ikon di sebelah tombol "Ajukan Mitra"
// di tab Mitra, lihat mitra-tab.tsx/riwayat-pengajuan-sheet.tsx), sehingga
// tab ini sekarang hanya berisi Kinerja Marketing -- bar sub-tab jadi tidak
// perlu lagi (cuma 1 pilihan). Sesuai permintaan user 2026-09-23.
export function PemasaranTab() {
  return (
    <div className="h-full">
      <KinerjaMarketingSubTab />
    </div>
  );
}
