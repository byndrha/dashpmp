"use client";

// Kotak pencarian /mkesindo/pemesanan (di kiri tombol Buat Pemesanan).
// Kata kunci disimpan di URL (?q=) lewat history.replaceState — terhubung
// dengan useSearchParams Next tanpa memicu render ulang server (yang akan
// menjalankan ulang query daftar beberapa detik di tiap ketikan). Isi
// daftar/papan membaca ?q= yang sama (useKueriPemesanan) dan menyaring di
// browser; aturan kata kunci ada di lib/pencarian-pemesanan.ts.
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export const PARAM_CARI = "q";

export function useKueriPemesanan(): string {
  return useSearchParams().get(PARAM_CARI) ?? "";
}

function tulisKeUrl(teks: string) {
  const params = new URLSearchParams(window.location.search);
  if (teks.trim()) params.set(PARAM_CARI, teks);
  else params.delete(PARAM_CARI);
  const qs = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
}

export function KotakCariPemesanan({ className }: { className?: string }) {
  const awal = useKueriPemesanan();
  const [teks, setTeks] = useState(awal);

  function ubah(v: string) {
    setTeks(v);
    tulisKeUrl(v);
  }

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={teks}
        onChange={(e) => ubah(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && ubah("")}
        placeholder="Cari mitra atau no. SO/DO/SI/SR"
        aria-label="Cari pemesanan"
        title={'Nama mitra, atau nomor dokumen: "3646", "si 3646", "MKE/SI/003449/2026-11/003/001"'}
        className="h-9 w-full rounded-lg border bg-background pl-8 pr-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
      />
      {teks && (
        <button
          type="button"
          onClick={() => ubah("")}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label="Hapus pencarian"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
