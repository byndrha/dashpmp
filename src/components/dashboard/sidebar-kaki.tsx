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
// Tombol ikut menempel saat digulir; judul pertama halaman diberi ruang di kirinya lewat
// KELAS_HALAMAN (lib/kelas-halaman.ts, dipasang di <main>) — halaman tidak perlu
// diubah satu per satu. Halaman yang baris pertamanya bukan <h1> menandai
// barisnya dengan atribut data-awal-halaman.
const TOMBOL_HALAMAN = "size-8 rounded-lg border bg-card text-muted-foreground shadow-xs hover:text-foreground";

// Jarak kepala halaman yang menempel dari tepi atas layar (= top-3 pada
// [data-kepala-halaman] di KELAS_HALAMAN).
const JARAK_MENEMPEL = 12;

// Baris kepala halaman = leluhur judul yang menjadi anak langsung kontainer
// kolom halaman (div flex-col teratas). Contoh: <div flex-col> › <div baris>
// › (<h1> + filter) → yang menempel adalah <div baris>, sehingga filter di
// samping judul ikut menempel. Dicari otomatis supaya puluhan halaman tidak
// perlu diubah satu per satu.
// React menandai node DOM yang sudah terhidrasi dengan properti
// "__reactFiber$…". Bila <main> (yang pasti sudah terhidrasi saat efek ini
// jalan) tidak punya penanda itu, berarti internal React berubah — anggap
// semua sudah terhidrasi supaya fitur tetap jalan.
function punyaFiber(el: Element): boolean {
  return Object.keys(el).some((k) => k.startsWith("__reactFiber$"));
}
function sudahTerhidrasi(main: HTMLElement, el: HTMLElement): boolean {
  return !punyaFiber(main) || punyaFiber(el);
}

function cariBarisKepala(
  main: HTMLElement,
  judul: HTMLElement
): HTMLElement | null {
  let el: HTMLElement = judul;
  while (el.parentElement && el.parentElement !== main) {
    let induk: HTMLElement = el.parentElement;
    // Pembungkus `display: contents` (mis. panel ringkasan Piutang Es Balok)
    // tidak membentuk kotak — baris di dalamnya secara tata letak adalah anak
    // langsung induk di atasnya, dan sticky-nya berlaku sepanjang induk itu.
    while (getComputedStyle(induk).display === "contents" && induk.parentElement && induk.parentElement !== main) {
      induk = induk.parentElement;
    }
    const cs = getComputedStyle(induk);
    if (
      cs.display.includes("flex") &&
      cs.flexDirection.startsWith("column") &&
      induk.children.length > 1
    )
      return el;
    el = induk;
  }
  return null;
}

// Menyejajarkan tombol dengan tengah baris pertama judul halaman (baris judul
// bisa lebih tinggi karena ada filter di sampingnya, atau judul baru muncul
// setelah data dimuat), menandai baris kepala agar menempel saat digulir, dan
// menyiarkan tingginya lewat --tinggi-kepala-halaman di <html> supaya elemen
// sticky lain di halaman (mis. kepala papan Pengiriman) menempel DI BAWAHNYA.
// Ditulis langsung ke DOM (tanpa state) seperti useStickyBelow.
// Fungsi biasa (bukan hook) — seluruh kerja DOM imperatif ada di sini;
// mengembalikan fungsi pembersih.
function pasangKepalaHalaman(isi: HTMLElement): (() => void) | undefined {
  const penahan = isi.parentElement;
  const main = penahan?.parentElement;
  if (!penahan || !main) return;
  let baris: HTMLElement | null = null;
  let frame = 0;
  let ulang = 0;

  function lepasBaris() {
    baris?.removeAttribute("data-kepala-halaman");
    baris?.removeAttribute("data-menempel");
    baris = null;
  }

  function tandaiMenempel() {
    if (!baris) return;
    const menempel =
      window.scrollY > 0 &&
      baris.getBoundingClientRect().top <= JARAK_MENEMPEL + 0.5;
    baris.toggleAttribute("data-menempel", menempel);
  }

  function sync() {
    if (!penahan || !main) return;
    const judul =
      main.querySelector<HTMLElement>("[data-awal-halaman]") ??
      [...main.querySelectorAll<HTMLElement>("h1")].find(
        (h) => !h.classList.contains("sr-only")
      );
    // data-tanpa-menempel pada judul/data-awal-halaman: halaman yang baris
    // kepalanya bukan baris tipis (mis. Produksi — leluhurnya grid peta +
    // panel Korelasi, yang akan ikut menempel seluruhnya) cukup menempelkan
    // tombolnya saja; tidak ada baris yang ditandai data-kepala-halaman.
    let barisBaru =
      judul && !judul.hasAttribute("data-tanpa-menempel") ? cariBarisKepala(main, judul) : null;
    // Atribut baru boleh dipasang hanya setelah React menghidrasi baris itu:
    // HTML halaman yang di-stream bisa sudah ada di DOM sebelum terhidrasi,
    // dan atribut tambahan saat itu memicu peringatan hydration mismatch.
    // Belum terhidrasi → coba lagi sebentar lagi.
    if (barisBaru && !sudahTerhidrasi(main, barisBaru)) {
      barisBaru = null;
      clearTimeout(ulang);
      ulang = window.setTimeout(sync, 150);
    }
    if (barisBaru !== baris) {
      lepasBaris();
      baris = barisBaru;
      baris?.setAttribute("data-kepala-halaman", "");
    }
    const rp = penahan.getBoundingClientRect();
    if (!judul) {
      // Tanpa judul: hanya tombol yang menempel. Bila ada elemen
      // data-tanpa-ruang (mis. peta Mitra), tombol diletakkan di dalam pojok
      // kiri atasnya; selain itu di pojok kiri atas halaman.
      const latar = main.querySelector<HTMLElement>("[data-tanpa-ruang]");
      const rl = latar?.getBoundingClientRect();
      penahan.style.top = `${JARAK_MENEMPEL}px`;
      // Diukur terhadap <main> (tidak menempel), bukan penahan — penahan
      // bisa sedang tertempel saat sync dipicu di tengah guliran (mis. baris
      // daftar yang dimuat bertahap), yang membuat selisihnya salah.
      const rm = main.getBoundingClientRect();
      const padAtas = parseFloat(getComputedStyle(main).paddingTop) || 0;
      isi.style.top = rl ? `${Math.round(rl.top - rm.top - padAtas + 10)}px` : "0px";
      isi.style.left = rl ? `${Math.round(rl.left - rp.left + 10)}px` : "0px";
      document.documentElement.style.removeProperty("--tinggi-kepala-halaman");
      return;
    }
    isi.style.left = "0px";
    const rj = judul.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(judul).lineHeight);
    const tengah =
      judul.hasAttribute("data-awal-halaman") || !Number.isFinite(lh)
        ? rj.height / 2
        : Math.min(lh, rj.height) / 2;
    // Titik acuan posisi tombol, harus "bergerak bersama" judul agar sync di
    // tengah guliran (mis. isi panjang selesai dimuat) tetap benar:
    // - Ada baris kepala menempel: judul ikut menempel bersama penahan
    //   (keduanya mulai menempel pada posisi gulir yang sama), jadi acuannya
    //   penahan itu sendiri (rp) — selisih keduanya tetap.
    // - Tanpa baris menempel (data-tanpa-menempel, mis. Produksi): judul ikut
    //   tergulir sementara penahan menempel, jadi acuannya posisi ASLI
    //   penahan (puncak isi <main>). Memakai rp di sini membuat tombol
    //   hilang ribuan piksel ke atas; memakai <main> di kasus pertama
    //   membuat tombol "nyangkut" di tengah halaman (bug 2026-11-25).
    const rmJ = main.getBoundingClientRect();
    const padAtasJ = parseFloat(getComputedStyle(main).paddingTop) || 0;
    const acuanAtas = baris ? rp.top : rmJ.top + padAtasJ;
    isi.style.top = `${Math.round(rj.top - acuanAtas + tengah - isi.offsetHeight / 2)}px`;
    if (baris) {
      // Penahan tombol & baris kepala harus mulai menempel pada posisi
      // gulir yang sama: bila baris tidak tepat di puncak halaman (jarak
      // d dari penahan), penahan menempel d piksel lebih tinggi.
      const rb = baris.getBoundingClientRect();
      penahan.style.top = `${Math.round(JARAK_MENEMPEL - (rb.top - rp.top))}px`;
      document.documentElement.style.setProperty(
        "--tinggi-kepala-halaman",
        `${Math.round(JARAK_MENEMPEL + rb.height + 12)}px`
      );
    } else {
      penahan.style.top = `${JARAK_MENEMPEL}px`;
      document.documentElement.style.removeProperty("--tinggi-kepala-halaman");
    }
    tandaiMenempel();
  }

  function onScroll() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(tandaiMenempel);
  }

  sync();
  const ro = new ResizeObserver(sync);
  ro.observe(main);
  // Judul yang baru muncul setelah data dimuat (atau halaman berganti
  // lewat navigasi klien tanpa perubahan ukuran) juga harus terdeteksi.
  const mo = new MutationObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(sync);
  });
  mo.observe(main, { childList: true, subtree: true });
  window.addEventListener("resize", sync);
  window.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(ulang);
    ro.disconnect();
    mo.disconnect();
    window.removeEventListener("resize", sync);
    window.removeEventListener("scroll", onScroll);
    lepasBaris();
    document.documentElement.style.removeProperty("--tinggi-kepala-halaman");
  };
}

function useKepalaHalaman(
  ref: React.RefObject<HTMLDivElement | null>,
  kunci: string
) {
  useEffect(() => {
    const isi = ref.current;
    if (!isi) return;
    return pasangKepalaHalaman(isi);
  }, [ref, kunci]);
}

export function TombolHalaman({
  notifikasi = false,
}: {
  notifikasi?: boolean;
}) {
  const { isMobile } = useSidebar();
  const ref = useRef<HTMLDivElement>(null);
  useKepalaHalaman(ref, usePathname() ?? "");
  // Penahan setinggi 0 yang sticky (bukan absolute) supaya tombol tetap
  // terlihat saat halaman digulir; -mb-4 meniadakan gap-4 <main> yang
  // ditambahkannya. Posisi top penahan & tombol diatur useKepalaHalaman.
  return (
    <div className="pointer-events-none sticky top-3 z-30 -mb-4 h-0">
      <div
        ref={ref}
        className="pointer-events-auto absolute left-0 top-0 flex items-center gap-1.5"
      >
        <SidebarTrigger className={TOMBOL_HALAMAN} />
        {notifikasi && isMobile && (
          <NotificationBell triggerClassName={TOMBOL_HALAMAN} align="start" />
        )}
      </div>
    </div>
  );
}
