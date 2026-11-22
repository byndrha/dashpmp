"use client";

// Angka KPI yang "berjalan" naik ke nilainya saat pertama tampil dan saat
// nilainya berubah (mis. setelah AutoRefresh). Menerima teks yang SUDAH
// diformat ("Rp 3.966.000", "16,4%", "682") — bagian angka pertama yang
// dianimasikan, awalan/akhiran dibiarkan. Format angka mengikuti id-ID
// (titik ribuan, koma desimal).
//
// Server merender teks akhir apa adanya (tanpa beda HTML server/klien); di
// browser angka ditulis langsung ke DOM tiap frame (tanpa setState) selama
// ±600 ms ease-out, lalu kembali persis ke teks akhir. Dilewati bila
// pengguna meminta gerak dikurangi (prefers-reduced-motion) atau teks tidak
// mengandung angka.
import { useEffect, useRef } from "react";

const POLA_ANGKA = /-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:,\d+)?/;
const DURASI_MS = 600;

function urai(teks: string): { awal: string; nilai: number; desimal: number; akhir: string } | null {
  const m = POLA_ANGKA.exec(teks);
  if (!m) return null;
  const angka = m[0];
  const desimal = angka.includes(",") ? angka.split(",")[1].length : 0;
  const nilai = Number(angka.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(nilai)) return null;
  return { awal: teks.slice(0, m.index), nilai, desimal, akhir: teks.slice(m.index + angka.length) };
}

export function AngkaBerjalan({ teks, className }: { teks: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const sebelumnya = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    const u = urai(teks);
    if (!el || !u) return;
    const dari = sebelumnya.current ?? 0;
    sebelumnya.current = u.nilai;
    if (dari === u.nilai || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const fmt = new Intl.NumberFormat("id-ID", { minimumFractionDigits: u.desimal, maximumFractionDigits: u.desimal });
    const mulai = performance.now();
    let id = 0;
    const langkah = (t: number) => {
      const p = Math.min(1, (t - mulai) / DURASI_MS);
      const e = 1 - Math.pow(1 - p, 3); // ease-out cubic
      el.textContent = p < 1 ? u.awal + fmt.format(dari + (u.nilai - dari) * e) + u.akhir : teks;
      if (p < 1) id = requestAnimationFrame(langkah);
    };
    id = requestAnimationFrame(langkah);
    return () => {
      cancelAnimationFrame(id);
      el.textContent = teks;
    };
  }, [teks]);

  return (
    <span ref={ref} className={className}>
      {teks}
    </span>
  );
}
