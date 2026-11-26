"use client";

// Ikon status Health Check driver untuk SATU pengiriman (jadwal+driver),
// dipakai di Validasi Rute dan Papan Pengiriman. Lingkaran berwarna berisi
// tanda + tebal (atau ikon orang di blok driver papan):
// - hijau : lolos (atau diambil alih dengan kode);
// - merah : tidak lolos — data kesehatan pengiriman ini perlu diperiksa ulang;
// - kuning: belum dilakukan cek kesehatan;
// - abu-abu "?" : status gagal dimuat;
// - kosong: status masih dimuat (`dimuat` false) — supaya status pengiriman
//   lain tidak sempat tampil saat berpindah pengiriman.
// Tooltip (komponen Tooltip aplikasi, bukan title bawaan browser) memuat
// status, waktu pemeriksaan, dan alasan. File terpisah dari dialog supaya
// papan tidak ikut memuat kode dialog/aksi server.
import type { ReactNode } from "react";
import { Plus, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatTime } from "@/lib/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface RingkasHealthCheck {
  Lolos: boolean;
  AmbilAlih: boolean;
  DiperiksaPada: string;
  AlasanGagal: string | null;
  AmbilAlihAlasan: string | null;
}

type Nada = "lolos" | "gagal" | "belum" | "galat";

const WARNA: Record<Nada, { lencana: string; teks: string }> = {
  lolos: { lencana: "bg-emerald-600 text-white", teks: "text-emerald-600 dark:text-emerald-400" },
  gagal: { lencana: "bg-red-600 text-white", teks: "text-red-600 dark:text-red-400" },
  belum: { lencana: "bg-amber-400 text-amber-950", teks: "text-amber-600 dark:text-amber-400" },
  galat: { lencana: "bg-muted-foreground/40 text-background", teks: "text-muted-foreground" },
};

function Lencana({
  nada,
  judul,
  waktu,
  rincian,
  className,
  ikon,
}: {
  nada: Nada;
  judul: string;
  waktu?: string;
  rincian?: ReactNode;
  className?: string;
  ikon: "plus" | "orang";
}) {
  const w = WARNA[nada];
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span />}
        aria-label={`Health Check: ${judul}`}
        className={cn(
          "inline-flex size-4 shrink-0 cursor-help items-center justify-center rounded-full shadow-sm",
          w.lencana,
          className
        )}
      >
        {nada === "galat" ? (
          <span className="text-[10px] leading-none font-black">?</span>
        ) : ikon === "orang" ? (
          <User className="size-3" strokeWidth={2.75} />
        ) : (
          <Plus className="size-3" strokeWidth={4} />
        )}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72">
        <p className="flex items-center gap-1.5 font-semibold">
          <span className={cn("size-2 shrink-0 rounded-full", w.lencana)} />
          <span className="text-muted-foreground">Health Check</span>
          <span className={w.teks}>{judul}</span>
        </p>
        {waktu && <p className="text-muted-foreground tabular-nums">Diperiksa {waktu}</p>}
        {rincian}
      </TooltipContent>
    </Tooltip>
  );
}

export function StatusHealthCheck({
  row,
  dimuat = true,
  galat = null,
  className,
  ikon = "plus",
}: {
  row: RingkasHealthCheck | null;
  className?: string;
  /** "orang": lingkaran status berisi ikon orang (dipakai di blok driver papan). */
  ikon?: "plus" | "orang";
  dimuat?: boolean;
  /** Status gagal dimuat dari server — abu-abu, bukan "belum dicek". */
  galat?: string | null;
}) {
  if (!dimuat) return null;
  const umum = { className, ikon };
  if (galat) {
    return <Lencana {...umum} nada="galat" judul="Gagal dimuat" rincian={<p className="text-muted-foreground">{galat}</p>} />;
  }
  if (!row) {
    return (
      <Lencana
        {...umum}
        nada="belum"
        judul="Belum dicek"
        rincian={<p className="text-muted-foreground">Belum dilakukan cek kesehatan untuk pengiriman ini.</p>}
      />
    );
  }
  const waktu = `${formatDate(row.DiperiksaPada)} ${formatTime(row.DiperiksaPada)}`;
  if (row.Lolos) return <Lencana {...umum} nada="lolos" judul="Lolos" waktu={waktu} />;
  if (row.AmbilAlih) {
    return (
      <Lencana
        {...umum}
        nada="lolos"
        judul="Diambil alih"
        waktu={waktu}
        rincian={
          <p className="text-muted-foreground">
            Lolos lewat kode ambil alih{row.AmbilAlihAlasan ? ` — ${row.AmbilAlihAlasan}` : ""}
          </p>
        }
      />
    );
  }
  const alasan = (row.AlasanGagal ?? "").split("; ").filter(Boolean);
  return (
    <Lencana
      {...umum}
      nada="gagal"
      judul="Tidak lolos"
      waktu={waktu}
      rincian={
        <>
          {alasan.length > 0 && (
            <ul className="list-disc pl-4 text-foreground">
              {alasan.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          <p className="text-muted-foreground">Perlu periksa ulang data kesehatan pengiriman ini.</p>
        </>
      }
    />
  );
}
