"use client";

// Kaki sidebar bersama (semua dashboard): kontrol pribadi yang dulu ada di
// header kanan atas.
//   baris 1: [ambil-alih] [tampilan] [notifikasi]  — yang tersedia saja
//   baris 2: [akun ........] [keluar]
// Di sidebar ciut (mode ikon) semua jadi tumpukan ikon. Lonceng notifikasi
// di HP ada di area halaman (TombolHalaman) karena sidebar HP tersembunyi di
// balik ☰ — hanya SATU lonceng yang dipasang pada satu waktu supaya tidak
// ada dua koneksi SSE / notifikasi ganda.
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { LogOut, User } from "lucide-react";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AppearanceMenu } from "@/components/dashboard/appearance-menu";
import { NotificationBell } from "@/components/dashboard/notification-bell";
import { KodeAmbilAlihButton } from "@/components/dashboard/kode-ambil-alih-button";
import { AccountSettingsDialog, type OwnProfile } from "@/components/dashboard/account-settings-dialog";

const TOMBOL_IKON = "h-8 flex-1 rounded-lg text-muted-foreground hover:text-foreground group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:flex-none";

export function KakiSidebar({
  nama,
  profile = null,
  notifikasi = false,
  ambilAlih = false,
}: {
  nama: string;
  // Hanya akun MKEsindo (punya baris DashboardUser) yang punya Pengaturan Akun.
  profile?: OwnProfile | null;
  notifikasi?: boolean;
  ambilAlih?: boolean;
}) {
  const { isMobile } = useSidebar();
  const [pengaturan, setPengaturan] = useState(false);
  const [konfirmasiKeluar, setKonfirmasiKeluar] = useState(false);
  // Di HP (sidebar = sheet) popup dibuka ke atas; di desktop ke kanan.
  const sisi = isMobile ? "top" : "right";

  return (
    <div className="flex flex-col gap-1.5 border-t border-sidebar-border pt-2 group-data-[collapsible=icon]:items-center">
      <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
        {ambilAlih && <KodeAmbilAlihButton className={TOMBOL_IKON} />}
        <AppearanceMenu triggerClassName={TOMBOL_IKON} side={sisi} align="end" />
        {notifikasi && !isMobile && <NotificationBell triggerClassName={TOMBOL_IKON} side={sisi} align="end" />}
      </div>

      <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
        <button
          type="button"
          disabled={!profile}
          onClick={() => setPengaturan(true)}
          title={profile ? "Pengaturan Akun" : nama}
          className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 text-left text-sm transition-colors enabled:hover:bg-sidebar-accent disabled:cursor-default group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:flex-none group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <User className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <span className="block truncate text-[13px] font-medium leading-tight">{nama}</span>
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 rounded-lg text-muted-foreground hover:text-destructive"
          onClick={() => setKonfirmasiKeluar(true)}
          title="Keluar"
          aria-label="Keluar"
        >
          <LogOut className="size-4" />
        </Button>
      </div>

      {profile && <AccountSettingsDialog open={pengaturan} onOpenChange={setPengaturan} profile={profile} />}
      <Dialog open={konfirmasiKeluar} onOpenChange={setKonfirmasiKeluar}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Keluar dari dashboard?</DialogTitle>
            <DialogDescription>Anda perlu masuk lagi untuk membuka dashboard.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKonfirmasiKeluar(false)}>
              Batal
            </Button>
            <Button variant="destructive" onClick={() => signOut({ callbackUrl: "/login" })}>
              <LogOut className="size-3.5" />
              Keluar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Tombol di pojok kiri atas area halaman (top bar sudah dihapus):
// ☰ ciut/buka sidebar, plus lonceng notifikasi KHUSUS HP (di desktop lonceng
// ada di KakiSidebar — hanya satu lonceng terpasang pada satu waktu).
// Posisinya absolut; judul pertama halaman diberi ruang di kirinya lewat
// KELAS_HALAMAN (lib/kelas-halaman.ts, dipasang di <main>) — halaman tidak perlu
// diubah satu per satu. Halaman yang baris pertamanya bukan <h1> menandai
// barisnya dengan atribut data-awal-halaman.
const TOMBOL_HALAMAN = "size-8 rounded-lg border bg-card text-muted-foreground shadow-xs hover:text-foreground";

// Tengah baris pertama judul halaman, relatif terhadap <main> — dipakai
// untuk menyejajarkan tombol secara vertikal (baris judul bisa lebih tinggi
// karena ada filter/tombol di sampingnya, atau judul baru muncul setelah
// data dimuat). Ditulis langsung ke DOM (tanpa state) seperti useStickyBelow.
function useSejajarkanDenganJudul(ref: React.RefObject<HTMLDivElement | null>, kunci: string) {
  useEffect(() => {
    const box = ref.current;
    const main = box?.parentElement;
    if (!box || !main) return;
    function sync() {
      if (!box || !main) return;
      const judul =
        main.querySelector<HTMLElement>("[data-awal-halaman]") ??
        [...main.querySelectorAll<HTMLElement>("h1")].find((h) => !h.classList.contains("sr-only"));
      const rm = main.getBoundingClientRect();
      if (!judul) {
        // Tanpa judul: bila ada elemen data-tanpa-ruang (mis. peta Mitra),
        // tombol diletakkan di dalam pojok kiri atasnya; selain itu bawaan.
        const latar = main.querySelector<HTMLElement>("[data-tanpa-ruang]");
        const rl = latar?.getBoundingClientRect();
        box.style.top = rl ? `${Math.round(rl.top - rm.top + 10)}px` : "";
        box.style.left = rl ? `${Math.round(rl.left - rm.left + 10)}px` : "";
        return;
      }
      box.style.left = "";
      const rj = judul.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(judul).lineHeight);
      const tengah = judul.hasAttribute("data-awal-halaman") || !Number.isFinite(lh) ? rj.height / 2 : Math.min(lh, rj.height) / 2;
      const top = rj.top - rm.top + tengah - box.offsetHeight / 2;
      box.style.top = `${Math.max(8, Math.round(top))}px`;
    }
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(main);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [ref, kunci]);
}

export function TombolHalaman({ notifikasi = false }: { notifikasi?: boolean }) {
  const { isMobile } = useSidebar();
  const ref = useRef<HTMLDivElement>(null);
  useSejajarkanDenganJudul(ref, usePathname() ?? "");
  return (
    <div ref={ref} className="absolute left-4 top-4 z-30 flex items-center gap-1.5">
      <SidebarTrigger className={TOMBOL_HALAMAN} />
      {notifikasi && isMobile && <NotificationBell triggerClassName={TOMBOL_HALAMAN} align="start" />}
    </div>
  );
}
