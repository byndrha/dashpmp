"use client";

// Navigasi sidebar bersama untuk semua dashboard (MKEsindo, PMPutra,
// PMPersada, PMPakis, Grup): menu dikelompokkan dengan label kecil
// berhuruf kapital, menu aktif berupa "pil" (gayanya di ui/sidebar.tsx),
// dan kotak "Cari modul" dengan pintasan Ctrl/⌘+K yang membuka daftar
// modul yang boleh dibuka akun ini — cara cepat pindah modul tanpa
// menggulir sidebar.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search, type LucideIcon } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { PTSwitcher, type PtSwitcherLocation } from "@/components/dashboard/pt-switcher";
import type { PerusahaanSwitcherEntry } from "@/lib/queries/perusahaan";
import { cn } from "@/lib/utils";

export interface ItemNav {
  href: string;
  label: string;
  icon: LucideIcon;
  aktif: boolean;
  kelompok: string;
}

// Pengelompokan & urutan baku modul PT (Es Kristal & Es Balok memakai nama
// modul yang sama), sesuai permintaan pengguna 2026-11-21. Modul yang tidak
// tercantum masuk "Lainnya" di paling bawah.
const URUTAN_MODUL: [label: string, kelompok: string][] = [
  ["Beranda", "Utama"],
  ["Penjualan", "Utama"],
  ["Mitra", "Utama"],
  ["Kinerja", "Utama"],
  ["Inventaris", "Utama"],
  ["Keuangan", "Keuangan"],
  ["Piutang", "Keuangan"],
  ["Transaksi", "Keuangan"],
  ["Pemasaran", "Keuangan"],
  ["Produksi", "Operasional"],
  ["Pemesanan", "Operasional"],
  ["Pengiriman", "Operasional"],
  ["Laporan", "Operasional"],
  ["Kelistrikan", "Operasional"],
  ["Keamanan", "Operasional"],
];

export function kelompokModul(label: string): string {
  return URUTAN_MODUL.find(([l]) => l === label)?.[1] ?? "Lainnya";
}

// Urutkan menu PT sesuai URUTAN_MODUL (modul tak dikenal di belakang,
// urutan aslinya dipertahankan). Tidak dipakai sidebar Grup, yang punya
// menu & kelompok sendiri.
export function urutkanModul<T extends { label: string }>(items: T[]): T[] {
  const posisi = (l: string) => {
    const i = URUTAN_MODUL.findIndex(([x]) => x === l);
    return i === -1 ? URUTAN_MODUL.length : i;
  };
  return [...items].sort((a, b) => posisi(a.label) - posisi(b.label));
}

function useTutupDiHp() {
  const { isMobile, setOpenMobile } = useSidebar();
  return () => {
    if (isMobile) setOpenMobile(false);
  };
}

// Kelompok tampil sesuai urutan kemunculan pertamanya di `items`.
export function NavKelompok({ items }: { items: ItemNav[] }) {
  const tutup = useTutupDiHp();
  const kelompok: { nama: string; items: ItemNav[] }[] = [];
  for (const item of items) {
    const k = kelompok.find((g) => g.nama === item.kelompok);
    if (k) k.items.push(item);
    else kelompok.push({ nama: item.kelompok, items: [item] });
  }
  return (
    <>
      {kelompok.map((g) => (
        <SidebarGroup key={g.nama}>
          <SidebarGroupLabel>{g.nama}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {g.items.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton render={<Link href={item.href} onClick={tutup} />} isActive={item.aktif} tooltip={item.label}>
                    <item.icon className="shrink-0" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}

const tanpaLangganan = () => () => {};

// Kotak pencarian modul di kepala sidebar + popup daftar modul.
export function CariModul({ items }: { items: ItemNav[] }) {
  const router = useRouter();
  const tutupSidebarHp = useTutupDiHp();
  const [buka, setBuka] = useState(false);
  const [teks, setTeks] = useState("");
  const [pilih, setPilih] = useState(0);
  const mac = useSyncExternalStore(
    tanpaLangganan,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => false
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setBuka((b) => !b);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hasil = useMemo(() => {
    const q = teks.trim().toLowerCase();
    return q ? items.filter((i) => i.label.toLowerCase().includes(q) || i.kelompok.toLowerCase().includes(q)) : items;
  }, [items, teks]);
  const indeks = Math.min(pilih, Math.max(hasil.length - 1, 0));

  function ubahBuka(b: boolean) {
    setBuka(b);
    if (!b) {
      setTeks("");
      setPilih(0);
    }
  }

  function pergi(item: ItemNav | undefined) {
    if (!item) return;
    ubahBuka(false);
    tutupSidebarHp();
    router.push(item.href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setBuka(true)}
        className="flex h-9 w-full items-center gap-2 rounded-lg border border-sidebar-border bg-background px-2.5 text-sm text-muted-foreground shadow-xs transition-colors hover:text-foreground group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        aria-label="Cari modul"
        title="Cari modul"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 text-left group-data-[collapsible=icon]:hidden">Cari modul</span>
        <kbd className="rounded border bg-muted px-1.5 py-px font-sans text-[10px] font-medium group-data-[collapsible=icon]:hidden">
          {mac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>

      <Dialog open={buka} onOpenChange={ubahBuka}>
        <DialogContent showCloseButton={false} className="top-[20%] translate-y-0 gap-0 p-0 sm:max-w-md">
          <DialogTitle className="sr-only">Cari modul</DialogTitle>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={teks}
              onChange={(e) => {
                setTeks(e.target.value);
                setPilih(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setPilih(Math.min(indeks + 1, hasil.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setPilih(Math.max(indeks - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  pergi(hasil[indeks]);
                }
              }}
              placeholder="Ketik nama modul..."
              className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="rounded border bg-muted px-1.5 py-px text-[10px] text-muted-foreground">Esc</kbd>
          </div>
          <ul className="max-h-80 overflow-y-auto p-1.5" role="listbox" aria-label="Modul">
            {hasil.map((item, i) => (
              <li key={item.href} role="option" aria-selected={i === indeks}>
                <button
                  type="button"
                  onMouseMove={() => setPilih(i)}
                  onClick={() => pergi(item)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm",
                    i === indeks ? "bg-accent text-accent-foreground" : "text-foreground"
                  )}
                >
                  <item.icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1">{item.label}</span>
                  <span className="text-[11px] text-muted-foreground">{item.kelompok}</span>
                  {i === indeks && <CornerDownLeft className="size-3.5 text-muted-foreground" />}
                </button>
              </li>
            ))}
            {hasil.length === 0 && <li className="px-2.5 py-6 text-center text-sm text-muted-foreground">Modul tidak ditemukan.</li>}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Blok merek di kepala sidebar: logo + nama PT + jenis usaha (+ kota).
// Untuk akun yang boleh berpindah PT (Direktur/superadmin), blok ini
// SEKALIGUS tombol pemilih PT — dulu nama PT tampil dua kali (blok merek
// dan tombol pemilih terpisah di bawahnya).
export function MerekSidebar({
  nama,
  jenis,
  lokasi,
  current,
  bolehPindah,
  perusahaanList,
}: {
  nama: string;
  jenis: string;
  lokasi?: string;
  current: PtSwitcherLocation;
  bolehPindah: boolean;
  perusahaanList: PerusahaanSwitcherEntry[];
}) {
  // Kota dari registry Perusahaan (/grup/perusahaan) bila terisi; `lokasi`
  // bawaan hanya cadangan.
  const kota = perusahaanList.find((p) => p.Kode === current)?.Wilayah ?? lokasi;
  const isi = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static brand asset, no next/image usage elsewhere in this codebase */}
      <img
        src="/brand/logo-pmp-group.png"
        alt="PMP Group"
        className="h-6 w-auto max-w-none shrink-0 dark:brightness-0 dark:invert"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 group-data-[collapsible=icon]:hidden">
        <p className="truncate font-display text-xs font-semibold leading-tight" title={nama}>{nama}</p>
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
            {jenis}
          </Badge>
          {kota && <p className="truncate text-[11px] leading-tight text-muted-foreground">{kota}</p>}
        </div>
      </div>
    </>
  );
  return bolehPindah ? (
    <div className="py-1">
      <PTSwitcher list={perusahaanList} current={current}>
        {isi}
      </PTSwitcher>
    </div>
  ) : (
    <div className="flex items-center gap-2 p-1.5 py-2.5">{isi}</div>
  );
}
