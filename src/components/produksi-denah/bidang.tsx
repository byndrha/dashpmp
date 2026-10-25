"use client";

// Bidang isian kecil untuk panel Builder Denah + toko nilai mini
// (useSyncExternalStore) untuk data berfrekuensi tinggi (posisi kursor,
// tampilan kanvas) agar hanya komponen pelanggan yang dirender ulang.

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------- Toko mini ----------

export interface Toko<T> {
  get(): T;
  set(nilai: T): void;
  sub(fn: () => void): () => void;
}

export function buatToko<T>(awal: T): Toko<T> {
  let nilai = awal;
  const pendengar = new Set<() => void>();
  return {
    get: () => nilai,
    set: (n) => {
      if (Object.is(n, nilai)) return;
      nilai = n;
      for (const f of pendengar) f();
    },
    sub: (f) => {
      pendengar.add(f);
      return () => {
        pendengar.delete(f);
      };
    },
  };
}

export function useToko<T>(toko: Toko<T>): T {
  return useSyncExternalStore(toko.sub, toko.get, toko.get);
}

// ---------- Bidang ----------

const KELAS_INPUT =
  "h-7 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 dark:bg-input/30";

export function Bidang({ label, children, className, petunjuk }: { label: string; children: ReactNode; className?: string; petunjuk?: string }) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
      {petunjuk && <span className="text-[10px] leading-tight text-muted-foreground">{petunjuk}</span>}
    </label>
  );
}

export function Judul({ children, aksi }: { children: ReactNode; aksi?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{children}</h3>
      {aksi}
    </div>
  );
}

/** Teks: setiap ketikan langsung diterapkan (riwayat digabung per bidang lewat `onSelesai`). */
export function InputTeks({
  nilai,
  onUbah,
  onSelesai,
  placeholder,
  multiBaris,
  invalid,
}: {
  nilai: string;
  onUbah: (v: string) => void;
  onSelesai?: () => void;
  placeholder?: string;
  multiBaris?: boolean;
  invalid?: boolean;
}) {
  if (multiBaris) {
    return (
      <textarea
        value={nilai}
        placeholder={placeholder}
        rows={3}
        onChange={(e) => onUbah(e.target.value)}
        onBlur={onSelesai}
        className={cn(KELAS_INPUT, "h-auto resize-y py-1.5")}
      />
    );
  }
  return (
    <input
      type="text"
      value={nilai}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      onChange={(e) => onUbah(e.target.value)}
      onBlur={onSelesai}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={cn(KELAS_INPUT, invalid && "border-destructive")}
    />
  );
}

/**
 * Angka: draf lokal, diterapkan saat Enter/blur (bukan per ketikan) — penting
 * untuk jumlah kolom: mengetik "66" tidak boleh sempat menjadi 6 kolom lalu
 * menambah 60 kolom ber-ID baru.
 */
export function InputAngka({
  nilai,
  onUbah,
  min,
  max,
  langkah = 1,
  bulat = true,
  placeholder,
  satuan,
  stepper,
  disabled,
  onKosong,
}: {
  nilai: number | null; // null = campuran
  onUbah: (v: number) => void;
  /** Bila diisi, mengosongkan isian memanggil ini (mis. kembali ke "otomatis"). */
  onKosong?: () => void;
  min?: number;
  max?: number;
  langkah?: number;
  bulat?: boolean;
  placeholder?: string;
  satuan?: string;
  stepper?: boolean;
  disabled?: boolean;
}) {
  const [draf, setDraf] = useState<string | null>(null);
  const tampil = draf ?? (nilai === null ? "" : String(Math.round(nilai * 1000) / 1000));
  const terapkan = (teks: string) => {
    setDraf(null);
    const t = teks.trim().replace(",", ".");
    if (t === "") {
      if (onKosong && nilai !== null) onKosong();
      return;
    }
    let n = Number(t);
    if (!Number.isFinite(n)) return;
    if (bulat) n = Math.round(n);
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    if (n !== nilai) onUbah(n);
  };
  const ubahLangkah = (arah: number) => {
    const dasar = nilai ?? min ?? 0;
    let n = dasar + arah * langkah;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    if (n !== nilai) onUbah(n);
  };
  return (
    <div className="flex items-center gap-1">
      {stepper && (
        <button type="button" disabled={disabled} onClick={() => ubahLangkah(-1)} className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-50" aria-label="Kurangi">
          <Minus className="size-3" />
        </button>
      )}
      <div className="relative min-w-0 flex-1">
        <input
          type="text"
          inputMode="decimal"
          disabled={disabled}
          value={tampil}
          placeholder={nilai === null ? "campuran" : placeholder}
          onChange={(e) => setDraf(e.target.value)}
          onBlur={(e) => terapkan(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") {
              setDraf(null);
              requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              setDraf(null);
              ubahLangkah(e.key === "ArrowUp" ? (e.shiftKey ? 10 : 1) : e.shiftKey ? -10 : -1);
            }
          }}
          className={cn(KELAS_INPUT, "tabular-nums", satuan && "pr-8")}
        />
        {satuan && <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-muted-foreground">{satuan}</span>}
      </div>
      {stepper && (
        <button type="button" disabled={disabled} onClick={() => ubahLangkah(1)} className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-50" aria-label="Tambah">
          <Plus className="size-3" />
        </button>
      )}
    </div>
  );
}

/** Tombol segmen (pilihan tunggal). nilai null = campuran. */
export function Segmen<T extends string>({ nilai, pilihan, onUbah }: { nilai: T | null; pilihan: { nilai: T; label: string }[]; onUbah: (v: T) => void }) {
  return (
    <div className="flex rounded-md border p-0.5" role="radiogroup">
      {pilihan.map((p) => (
        <button
          key={p.nilai}
          type="button"
          role="radio"
          aria-checked={nilai === p.nilai}
          onClick={() => onUbah(p.nilai)}
          className={cn(
            "flex-1 rounded px-2 py-0.5 text-xs transition-colors",
            nilai === p.nilai ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

export function Centang({ nilai, onUbah, label }: { nilai: boolean | null; onUbah: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={nilai === true}
        ref={(el) => {
          if (el) el.indeterminate = nilai === null;
        }}
        onChange={(e) => onUbah(e.target.checked)}
        className="size-3.5 accent-primary"
      />
      <span className="min-w-0 truncate">{label}</span>
    </label>
  );
}

export function TombolKecil({
  onClick,
  children,
  title,
  disabled,
  bahaya,
  aktif,
}: {
  onClick: () => void;
  children: ReactNode;
  title?: string;
  disabled?: boolean;
  bahaya?: boolean;
  aktif?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center justify-center gap-1 rounded-md border px-2 text-xs transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5",
        bahaya ? "text-destructive hover:bg-destructive/10" : "hover:bg-muted",
        aktif && "border-primary bg-primary/10 text-primary"
      )}
    >
      {children}
    </button>
  );
}
