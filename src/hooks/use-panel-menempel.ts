"use client";

import { useEffect } from "react";

// Panel alat menempel di atas saat daftar digulir, MENGGANTIKAN baris judul
// halaman (z lebih tinggi + latar selebar <main> menutupinya); tombol ☰
// (TombolHalaman, z-30) tetap di atasnya, jadi panel memberi ruang kiri
// selebar --ruang-tombol selama menempel. Atribut data-menempel ditulis
// langsung ke DOM (bukan state) supaya guliran tidak me-render ulang daftar.
const JARAK_MENEMPEL = 12; // = top-3

export function usePanelMenempel(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    let frame = 0;
    function periksa() {
      const el = ref.current;
      if (!el) return;
      const menempel =
        getComputedStyle(el).position === "sticky" &&
        window.scrollY > 0 &&
        el.getBoundingClientRect().top <= JARAK_MENEMPEL + 0.5;
      el.toggleAttribute("data-menempel", menempel);
    }
    function saatGulir() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(periksa);
    }
    periksa();
    window.addEventListener("scroll", saatGulir, { passive: true });
    window.addEventListener("resize", saatGulir);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", saatGulir);
      window.removeEventListener("resize", saatGulir);
    };
  }, [ref]);
}


// Kelas panel alat yang menempel (dipakai Rincian per Mitra Es Balok &
// Invoice Outstanding Es Kristal): latar selebar <main> + ruang tombol ☰.
export const KELAS_PANEL_MENEMPEL =
  "sticky top-3 z-[25] transition-[margin,box-shadow] duration-200 before:pointer-events-none before:absolute before:-inset-x-4 before:-top-4 before:-bottom-2 before:-z-10 before:hidden before:bg-background before:content-[''] data-menempel:ml-(--ruang-tombol) data-menempel:shadow-md data-menempel:before:block data-menempel:before:-left-[calc(1rem+var(--ruang-tombol))]";
