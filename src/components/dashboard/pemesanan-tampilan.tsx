"use client";

// Pilihan tampilan /mkesindo/pemesanan (Papan | Daftar), dipakai bersama oleh
// tombol di toolbar atas dan isi daftar — keduanya komponen terpisah, jadi
// state-nya disimpan di localStorage + event, dibaca lewat
// useSyncExternalStore (render server = Papan, bawaan; tanpa setState di
// effect). Ini kenyamanan per peramban, bukan data bersama. Semua akses
// localStorage dibungkus try karena bisa tidak tersedia (mode privat).
import { useSyncExternalStore } from "react";
import { KanbanSquare, List } from "lucide-react";
import { cn } from "@/lib/utils";

export type TampilanPemesanan = "papan" | "daftar";

const KEY = "pemesanan:tampilan";
const EVENT = "pemesanan:tampilan-berubah";
const BAWAAN: TampilanPemesanan = "papan";

function baca(): TampilanPemesanan {
  try {
    return localStorage.getItem(KEY) === "daftar" ? "daftar" : BAWAAN;
  } catch {
    return BAWAAN;
  }
}

function langganan(cb: () => void): () => void {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(EVENT, cb);
  };
}

function ganti(v: TampilanPemesanan) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // abaikan — event di bawah tetap mengganti tampilan untuk sesi ini
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useTampilanPemesanan(): TampilanPemesanan {
  return useSyncExternalStore(langganan, baca, () => BAWAAN);
}

export function TombolTampilanPemesanan() {
  const value = useTampilanPemesanan();
  const opsi: { v: TampilanPemesanan; label: string; icon: typeof List }[] = [
    { v: "papan", label: "Papan", icon: KanbanSquare },
    { v: "daftar", label: "Daftar", icon: List },
  ];
  return (
    <div className="inline-flex h-9 shrink-0 rounded-lg border bg-muted/40 p-0.5" role="group" aria-label="Tampilan">
      {opsi.map(({ v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => ganti(v)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
            value === v ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Icon className="size-3.5" />
          {/* Opsi aktif ditulis lengkap ("Papan Pemesanan"), yang lain singkat. */}
          {value === v ? `${label} Pemesanan` : label}
        </button>
      ))}
    </div>
  );
}
