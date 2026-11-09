"use client";

// Tab FIFO layar admin (spec §8): satu baris per isian aktif (produksi dan
// Babonan), diurutkan dari waktu isi tertua. Filter bak/varian/tahap/jenis +
// pencarian teks. Klik baris membuka DetailRek rek itu.

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { hitungKematangan, tahapDari, type IsianAktif, type JenisIsian, type KeadaanRek, type Tahap } from "@/lib/produksi-operasional";
import type { Varian } from "@/lib/produksi-denah";
import { formatUsia, RENTANG_TAHAP, singkatVarian, tanggalJamWib, WARNA_KEADAAN, WARNA_TAHAP } from "../warna-tahap";

const JAM_MS = 3_600_000;
const angka = new Intl.NumberFormat("id-ID");
const URUTAN_TAHAP: Tahap[] = ["air", "mulai", "kristal", "siap", "jadi"];
const KELAS_SELECT =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

interface BarisFifo {
  isian: IsianAktif;
  kolomId: string;
  bakId: string;
  lokasi: string;
  pct: number | null;
  tahap: Tahap | null;
  estimasiMatang: string | null;
  usiaMenit: number;
}

export function TabelFifo({
  keadaan,
  sekarang,
  namaBak,
  daftarBak,
  onPilihRek,
}: {
  keadaan: KeadaanRek[];
  sekarang: string;
  namaBak: ReadonlyMap<string, string>;
  /** Urutan bak di denah (untuk filter). */
  daftarBak: { id: string; nama: string }[];
  onPilihRek: (kolomId: string) => void;
}) {
  const [bak, setBak] = useState("");
  const [varian, setVarian] = useState<"" | Varian>("");
  const [tahap, setTahap] = useState<"" | Tahap>("");
  const [jenis, setJenis] = useState<"" | JenisIsian>("");
  const [cari, setCari] = useState("");

  const semua = useMemo<BarisFifo[]>(() => {
    const now = new Date(sekarang);
    const hasil: BarisFifo[] = [];
    for (const k of keadaan) {
      const lokasi = `${namaBak.get(k.bakId) ?? "Bak"} – Rek ${k.nomor}`;
      for (const i of [...k.isianProduksi, ...(k.isianBabonan ? [k.isianBabonan] : [])]) {
        const mulai = Date.parse(i.mulaiAt);
        const produksi = i.jenis === "produksi" && i.durasiBekuJam !== null;
        const pct = produksi ? hitungKematangan(new Date(mulai), i.durasiBekuJam ?? 0, now) : null;
        hasil.push({
          isian: i,
          kolomId: k.kolomId,
          bakId: k.bakId,
          lokasi,
          pct,
          tahap: pct === null ? null : tahapDari(pct),
          estimasiMatang: produksi ? new Date(mulai + (i.durasiBekuJam ?? 0) * JAM_MS).toISOString() : null,
          usiaMenit: Math.floor((now.getTime() - mulai) / 60_000),
        });
      }
    }
    return hasil.sort((a, b) => Date.parse(a.isian.mulaiAt) - Date.parse(b.isian.mulaiAt));
  }, [keadaan, sekarang, namaBak]);

  const q = cari.trim().toLowerCase();
  const baris = semua.filter(
    (b) =>
      (!bak || b.bakId === bak) &&
      (!varian || b.isian.varian === varian) &&
      (!tahap || b.tahap === tahap) &&
      (!jenis || b.isian.jenis === jenis) &&
      (!q || `${b.lokasi} ${b.isian.diisiOlehNama} ${singkatVarian(b.isian.varian)} ${b.isian.jenis}`.toLowerCase().includes(q)),
  );
  const totalSisa = baris.reduce((s, b) => s + b.isian.sisa, 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari rek atau operator…" className="pl-8" aria-label="Cari" />
        </div>
        <select className={KELAS_SELECT} value={bak} onChange={(e) => setBak(e.target.value)} aria-label="Filter bak">
          <option value="">Semua bak</option>
          {daftarBak.map((b) => (
            <option key={b.id} value={b.id}>
              {b.nama}
            </option>
          ))}
        </select>
        <select className={KELAS_SELECT} value={varian} onChange={(e) => setVarian(e.target.value as "" | Varian)} aria-label="Filter varian">
          <option value="">Semua varian</option>
          <option value="kecil">BK (kecil)</option>
          <option value="besar">BB (besar)</option>
        </select>
        <select className={KELAS_SELECT} value={tahap} onChange={(e) => setTahap(e.target.value as "" | Tahap)} aria-label="Filter tahap">
          <option value="">Semua tahap</option>
          {URUTAN_TAHAP.map((t) => (
            <option key={t} value={t}>
              {WARNA_TAHAP[t].label} ({RENTANG_TAHAP[t]})
            </option>
          ))}
        </select>
        <select className={KELAS_SELECT} value={jenis} onChange={(e) => setJenis(e.target.value as "" | JenisIsian)} aria-label="Filter jenis">
          <option value="">Semua jenis</option>
          <option value="produksi">Produksi</option>
          <option value="babonan">Babonan</option>
        </select>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {angka.format(baris.length)} isian · {angka.format(totalSisa)} can
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lokasi</TableHead>
              <TableHead>Varian</TableHead>
              <TableHead>Jenis</TableHead>
              <TableHead className="text-right">Sisa/awal</TableHead>
              <TableHead>Tahap</TableHead>
              <TableHead>Diisi oleh</TableHead>
              <TableHead>Waktu isi</TableHead>
              <TableHead>Estimasi matang</TableHead>
              <TableHead className="text-right">Usia</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {baris.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                  {semua.length === 0 ? "Belum ada isian aktif." : "Tidak ada isian yang cocok dengan filter."}
                </TableCell>
              </TableRow>
            )}
            {baris.map((b) => {
              const w = b.tahap ? WARNA_TAHAP[b.tahap] : WARNA_KEADAAN.babonan;
              return (
                <TableRow key={b.isian.id} className="cursor-pointer" onClick={() => onPilihRek(b.kolomId)}>
                  <TableCell className="font-medium">
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPilihRek(b.kolomId);
                      }}
                    >
                      {b.lokasi}
                    </button>
                  </TableCell>
                  <TableCell>{singkatVarian(b.isian.varian)}</TableCell>
                  <TableCell>{b.isian.jenis === "produksi" ? "Produksi" : "Babonan"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {angka.format(b.isian.sisa)}/{angka.format(b.isian.jumlahAwal)}
                    {b.isian.pecah > 0 && <span className="text-xs text-muted-foreground"> (pecah {b.isian.pecah})</span>}
                  </TableCell>
                  <TableCell>
                    <span className={cn("inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold whitespace-nowrap", w.latar, w.teks)}>
                      {b.pct === null ? w.label : `${b.pct}% ${w.label}`}
                    </span>
                  </TableCell>
                  <TableCell>{b.isian.diisiOlehNama}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{tanggalJamWib(b.isian.mulaiAt)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{b.estimasiMatang ? tanggalJamWib(b.estimasiMatang) : "—"}</TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">{formatUsia(b.usiaMenit)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">Semua waktu dalam WIB. Tertua di atas — panen yang lebih dulu diisi lebih dulu.</p>
    </div>
  );
}
