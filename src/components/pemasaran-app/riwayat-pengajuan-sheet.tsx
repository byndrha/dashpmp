"use client";

import { X } from "lucide-react";
import { PengajuanSubTab } from "@/components/pemasaran-app/pengajuan-sub-tab";

// Sheet layar-penuh untuk "Riwayat Pengajuan" -- membungkus PengajuanSubTab
// apa adanya (sudah lengkap: tombol "Pengajuan Baru" + daftar riwayat +
// dialog peta lokasi), dipicu dari ikon di sebelah tombol "Ajukan Mitra"
// pada tab Mitra. Menggantikan sub-tab "Pengajuan" yang sebelumnya ada di
// tab "Pemasaran" (dihapus, lihat pemasaran-tab.tsx). Pola fixed inset-0
// sama seperti tambah-kunjungan-sheet.tsx, sesuai permintaan user 2026-09-23.
export function RiwayatPengajuanSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="font-display text-base font-semibold">Riwayat Pengajuan</h2>
        <button type="button" onClick={onClose}>
          <X className="size-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        <PengajuanSubTab />
      </div>
    </div>
  );
}
