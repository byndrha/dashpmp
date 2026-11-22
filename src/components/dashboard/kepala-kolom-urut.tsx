"use client";

// Kepala kolom tabel yang bisa diklik untuk mengurutkan. Satu klik = naik
// (A→Z / kecil→besar), klik lagi = turun, klik ketiga = kembali ke urutan
// bawaan. Nilai kosong (null / "") selalu di bawah, apa pun arahnya.
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type ArahUrut = "asc" | "desc";
export interface Urutan<K extends string> {
  kolom: K;
  arah: ArahUrut;
}

export function urutanBerikutnya<K extends string>(sekarang: Urutan<K> | null, kolom: K): Urutan<K> | null {
  if (!sekarang || sekarang.kolom !== kolom) return { kolom, arah: "asc" };
  if (sekarang.arah === "asc") return { kolom, arah: "desc" };
  return null;
}

type NilaiUrut = string | number | null | undefined;

function kosong(v: NilaiUrut): boolean {
  return v == null || v === "" || (typeof v === "number" && !Number.isFinite(v));
}

const PEMBANDING_TEKS = new Intl.Collator("id-ID", { sensitivity: "base", numeric: true });

// Mengurutkan salinan larik; stabil (urutan bawaan dipertahankan untuk nilai sama).
export function urutkan<T, K extends string>(
  baris: T[],
  urut: Urutan<K> | null,
  nilai: (b: T, kolom: K) => NilaiUrut
): T[] {
  if (!urut) return baris;
  const faktor = urut.arah === "asc" ? 1 : -1;
  return baris
    .map((b, i) => ({ b, i, v: nilai(b, urut.kolom) }))
    .sort((x, y) => {
      const kx = kosong(x.v);
      const ky = kosong(y.v);
      if (kx || ky) return kx === ky ? x.i - y.i : kx ? 1 : -1;
      const beda =
        typeof x.v === "number" && typeof y.v === "number"
          ? x.v - y.v
          : PEMBANDING_TEKS.compare(String(x.v), String(y.v));
      return beda !== 0 ? beda * faktor : x.i - y.i;
    })
    .map((x) => x.b);
}

export function KepalaKolomUrut<K extends string>({
  label,
  kolom,
  urut,
  onUrut,
  kanan = false,
}: {
  label: string;
  kolom: K;
  urut: Urutan<K> | null;
  onUrut: (kolom: K) => void;
  kanan?: boolean;
}) {
  const aktif = urut?.kolom === kolom ? urut.arah : null;
  const Ikon = aktif === "asc" ? ArrowUp : aktif === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <span className={cn("flex min-w-0", kanan && "justify-end")}>
      <button
        type="button"
        onClick={() => onUrut(kolom)}
        title={`Urutkan menurut ${label.toLowerCase()}`}
        aria-label={`${label}${aktif === "asc" ? ", urut naik" : aktif === "desc" ? ", urut turun" : ""} — klik untuk mengurutkan`}
        className={cn(
          "group/urut -mx-1 inline-flex min-w-0 items-center gap-1 rounded px-1 py-0.5 uppercase tracking-wide transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          kanan && "flex-row-reverse",
          aktif && "text-foreground"
        )}
      >
        <span className="truncate">{label}</span>
        <Ikon
          className={cn(
            "size-3 shrink-0 transition-opacity",
            aktif ? "text-primary" : "opacity-0 group-hover/urut:opacity-60 group-focus-visible/urut:opacity-60"
          )}
        />
      </button>
    </span>
  );
}
