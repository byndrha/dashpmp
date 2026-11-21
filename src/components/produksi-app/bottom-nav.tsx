"use client";

import { Snowflake, ShieldCheck, Package, Users, ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProduksiTabKey } from "./produksi-tab-shell";

const TABS: { key: ProduksiTabKey; label: string; icon: typeof Snowflake }[] = [
  { key: "warehouse", label: "Stok Es", icon: Snowflake },
  { key: "kualitas", label: "Kualitas", icon: ShieldCheck },
  { key: "bahan-baku", label: "Bahan Baku", icon: Package },
  { key: "aktivitas-produksi", label: "Aktivitas", icon: Users },
];

// Potongan tengah bilah (lebar 120, tinggi 64): lekukan berbahu melengkung
// halus tempat tombol tengah "duduk" — ±10 px dari tepi tombol (Ø56,
// pusat 1 px di atas tepi bilah) di sepanjang lengkungnya. Sisi kiri & kanan bilah berupa kotak
// biasa yang melebar, jadi bentuk lekukan tidak ikut terdistorsi.
const LEKUK_PATH =
  "M0,0 H6 C18,0 22,5 26,13 C33,29 45,38 60,38 C75,38 87,29 94,13 C98,5 102,0 114,0 H120 V64 H0 Z";

// Bilah navigasi bawah yang MELAYANG (berjarak dari tepi bawah & samping —
// isi halaman terlihat di sekitarnya; ProduksiTabShell memberi ruang bawah
// di area gulir). Empat tab + tombol bulat di tengah untuk aksi utama tiap
// shift, Tambah Pemeriksaan kualitas. Warna aksen mengikuti palet tema
// (primary). Disembunyikan selama sesi Mulai Muat (locked) — panel ambil
// palet menempel di dasar layar saat itu dan tidak boleh tertutup.
export function ProduksiBottomNav({
  activeTab,
  onChange,
  onTambahPemeriksaan,
  locked = false,
}: {
  activeTab: ProduksiTabKey;
  onChange: (tab: ProduksiTabKey) => void;
  onTambahPemeriksaan: () => void;
  // Sesi Mulai Muat sedang berlangsung di tab Stok Es — berpindah tab
  // mid-alokasi cuma bikin bingung. Lihat WarehouseView.onPickingChange.
  locked?: boolean;
}) {
  if (locked) return null;

  function tombolTab(tab: (typeof TABS)[number]) {
    const active = activeTab === tab.key;
    return (
      <button
        key={tab.key}
        type="button"
        onClick={() => onChange(tab.key)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 whitespace-nowrap text-[10.5px] transition-colors",
          active ? "font-semibold text-primary" : "text-muted-foreground"
        )}
      >
        <tab.icon className="size-[22px]" strokeWidth={active ? 2.4 : 1.8} />
        {tab.label}
      </button>
    );
  }

  return (
    <nav
      className="pointer-events-none absolute inset-x-2.5 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-30 drop-shadow-[0_6px_18px_rgb(0_0_0/0.14)]"
      aria-label="Navigasi"
    >
      <div className="pointer-events-auto relative flex h-16">
        <div className="flex flex-1 rounded-l-[1.75rem] bg-card">
          {tombolTab(TABS[0])}
          {tombolTab(TABS[1])}
        </div>
        <svg viewBox="0 0 120 64" className="-mx-px h-16 w-[122px] shrink-0 fill-card" preserveAspectRatio="none" aria-hidden>
          <path d={LEKUK_PATH} />
        </svg>
        <div className="flex flex-1 rounded-r-[1.75rem] bg-card">
          {tombolTab(TABS[2])}
          {tombolTab(TABS[3])}
        </div>

        <span className="pointer-events-none absolute bottom-2.5 left-1/2 -translate-x-1/2 text-[10.5px] text-muted-foreground">
          Periksa
        </span>
        <button
          type="button"
          onClick={onTambahPemeriksaan}
          aria-label="Tambah Pemeriksaan"
          title="Tambah Pemeriksaan"
          className="absolute -top-[29px] left-1/2 flex size-14 -translate-x-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform active:scale-95"
        >
          <ScanSearch className="size-6" />
        </button>
      </div>
    </nav>
  );
}
