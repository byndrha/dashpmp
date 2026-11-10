"use client";

// "Tugas sekarang" (spec slot can §4): urutan dari tugasSekarang() di server —
// panen (FIFO tertua), isi air (paling lama kosong), Babonan lama. Tombol aksi
// langsung di baris: Panen membuka formulir panen, Isi Air = SATU ketukan
// (semua slot kosong tak rusak, tanpa layar konfirmasi), Babonan → lembar rek.
// ≥ AMBANG_KELOMPOK tugas isi air → satu baris kelompok "n rek kosong — Isi
// semua" (dengan dialog konfirmasi) di posisi tugas isi air pertama; baris
// per rek dibuka lewat "Lihat n rek kosong" (selalu lengkap, tidak ikut
// dipotong BATAS_AWAL). Rek yang slotnya belum dicatat (slotBelumSiap) tidak
// masuk tugas — tampil sebagai baris peringatan di atas.

import { useState } from "react";
import { AlertTriangle, ChevronRight, CircleCheck, Droplets } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PESAN_SLOT_BELUM_SIAP, type KeadaanRek, type Tugas } from "@/lib/produksi-operasional";
import { formatUsiaRingkas, singkatVarian, WARNA_TAHAP } from "../warna-tahap";

const BATAS_AWAL = 8;
const AMBANG_KELOMPOK = 5;

type Baris = { jenis: "tugas"; tugas: Tugas } | { jenis: "kelompok-isi" };

export function DaftarTugas({
  tugas,
  rekSlotBelumSiap = [],
  keadaan,
  sekarang,
  sibuk,
  onPanen,
  onIsiAir,
  onIsiAirSemua,
  onBuka,
}: {
  tugas: Tugas[];
  /** Rek bak ini yang slot can-nya belum dicatat (ditampilkan sebagai peringatan). */
  rekSlotBelumSiap?: KeadaanRek[];
  keadaan: Map<string, KeadaanRek>;
  sekarang: string;
  sibuk: boolean;
  onPanen: (kolomId: string) => void;
  onIsiAir: (rek: KeadaanRek) => void;
  /** Isi Air semua rek kelompok, berurutan (pemanggil memegang kunci permintaan). */
  onIsiAirSemua: (rek: KeadaanRek[]) => void;
  onBuka: (kolomId: string) => void;
}) {
  const [semua, setSemua] = useState(false);
  const [rinciIsi, setRinciIsi] = useState(false);
  const [konfirmasi, setKonfirmasi] = useState<{ rek: KeadaanRek[]; can: number } | null>(null);
  const now = sekarang ? Date.parse(sekarang) : null;

  const rekIsi = tugas
    .filter((t) => t.jenis === "isi-air")
    .map((t) => keadaan.get(t.kolomId))
    .filter((k): k is KeadaanRek => k !== undefined && k.slotKosong.length > 0);
  const kelompok = rekIsi.length >= AMBANG_KELOMPOK;
  // Baris utama (kelompok dihitung satu baris) dipotong BATAS_AWAL; rincian
  // kelompok disisipkan utuh sesudah baris kelompok bila dibuka.
  const barisUtama: Baris[] = [];
  const rincian: Baris[] = [];
  for (const t of tugas) {
    if (kelompok && t.jenis === "isi-air") {
      if (rincian.length === 0) barisUtama.push({ jenis: "kelompok-isi" });
      rincian.push({ jenis: "tugas", tugas: t });
      continue;
    }
    barisUtama.push({ jenis: "tugas", tugas: t });
  }
  const tampil = (semua ? barisUtama : barisUtama.slice(0, BATAS_AWAL)).flatMap((b) =>
    b.jenis === "kelompok-isi" && rinciIsi ? [b, ...rincian] : [b],
  );
  const canKosong = rekIsi.reduce((s, k) => s + k.slotKosong.length, 0);

  return (
    <section className="flex flex-col">
      <h2 className="px-3 pt-3 pb-1.5 text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
        Tugas sekarang {tugas.length > 0 && <span className="tabular-nums">({tugas.length})</span>}
      </h2>
      {rekSlotBelumSiap.length > 0 && (
        <ul className="mx-3 mb-1.5 flex flex-col gap-1">
          {rekSlotBelumSiap.map((k) => (
            <li key={k.kolomId}>
              <button
                type="button"
                onClick={() => onBuka(k.kolomId)}
                className="flex w-full items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-left text-xs text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  <b>Rek {k.nomor}</b>: {PESAN_SLOT_BELUM_SIAP}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {tugas.length === 0 ? (
        <p className="mx-3 flex items-center gap-2 rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
          <CircleCheck className="size-4 text-green-600" /> Tidak ada tugas di bak ini.
        </p>
      ) : (
        <ul className="divide-y border-y">
          {tampil.map((b) => {
            if (b.jenis === "kelompok-isi") {
              return (
                <li key="kelompok-isi" className="flex flex-col bg-red-50/50 dark:bg-red-950/20">
                  <div className="flex min-h-12 items-center gap-2 px-3 py-1.5">
                    <span className="min-w-0 flex-1 text-sm">
                      <b className="tabular-nums">{rekIsi.length}</b> rek kosong
                      <span className="text-xs text-muted-foreground tabular-nums"> · {canKosong} can</span>
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 shrink-0 border-red-400 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950"
                      disabled={sibuk}
                      onClick={() => setKonfirmasi({ rek: rekIsi, can: canKosong })}
                    >
                      <Droplets className="size-4" /> Isi semua
                    </Button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRinciIsi((r) => !r)}
                    aria-expanded={rinciIsi}
                    className="self-start px-3 pb-1.5 text-xs font-medium text-primary"
                  >
                    {rinciIsi ? "Sembunyikan rincian" : `Lihat ${rekIsi.length} rek kosong`}
                  </button>
                </li>
              );
            }
            const t = b.tugas;
            const rek = keadaan.get(t.kolomId);
            if (!rek) return null;
            const usia = now === null ? 0 : Math.max(0, Math.floor((now - Date.parse(t.sejak)) / 60_000));
            return (
              <li key={`${t.jenis}:${t.kolomId}`} className="flex min-h-12 items-center gap-2 px-3 py-1.5">
                <button
                  type="button"
                  onClick={() => onBuka(t.kolomId)}
                  className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
                >
                  <span className="w-14 shrink-0 text-sm font-bold">Rek {rek.nomor}</span>
                  <span className="w-5 shrink-0 text-[10px] font-semibold text-muted-foreground">{singkatVarian(rek.varian)}</span>
                  <Keterangan tugas={t} rek={rek} usia={usia} />
                </button>
                {t.jenis === "panen" && (
                  <Button size="sm" className="h-9 min-w-20 shrink-0" disabled={sibuk} onClick={() => onPanen(t.kolomId)}>
                    Panen
                  </Button>
                )}
                {t.jenis === "isi-air" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 min-w-20 shrink-0 border-red-400 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950"
                    disabled={sibuk}
                    onClick={() => onIsiAir(rek)}
                  >
                    <Droplets className="size-4" /> Isi {rek.slotKosong.length}
                  </Button>
                )}
                {t.jenis === "babonan-lama" && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
              </li>
            );
          })}
        </ul>
      )}
      {barisUtama.length > BATAS_AWAL && (
        <button
          type="button"
          onClick={() => setSemua((s) => !s)}
          className="self-center py-2 text-xs font-medium text-primary"
        >
          {semua ? "Ringkas" : `Tampilkan semua tugas (${tugas.length})`}
        </button>
      )}
      <Dialog open={konfirmasi !== null} onOpenChange={(o) => !o && setKonfirmasi(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Isi {konfirmasi?.rek.length ?? 0} rek (total {konfirmasi?.can ?? 0} can)?
            </DialogTitle>
            <DialogDescription>Semua can kosong yang tidak rusak di rek-rek ini diisi air sekarang.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKonfirmasi(null)}>
              Batal
            </Button>
            <Button
              disabled={sibuk}
              onClick={() => {
                const k = konfirmasi;
                setKonfirmasi(null);
                if (k) onIsiAirSemua(k.rek);
              }}
            >
              <Droplets className="size-4" /> Isi semua
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Keterangan({ tugas, rek, usia }: { tugas: Tugas; rek: KeadaanRek; usia: number }) {
  if (tugas.jenis === "panen") {
    const w = rek.tahap ? WARNA_TAHAP[rek.tahap] : WARNA_TAHAP.siap;
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-xs">
        <span className={cn("rounded px-1.5 py-0.5 font-bold tabular-nums", w.latar, w.teks)}>{tugas.pct ?? rek.pct}%</span>
        <span className="text-muted-foreground tabular-nums">{formatUsiaRingkas(usia)}</span>
      </span>
    );
  }
  if (tugas.jenis === "isi-air") {
    return (
      <span className="min-w-0 truncate text-xs text-muted-foreground">
        kosong {rek.slotKosong.length} can{usia > 0 && ` · ${formatUsiaRingkas(usia)}`}
      </span>
    );
  }
  return (
    <span className="min-w-0 truncate text-xs font-semibold text-stone-600 dark:text-stone-300">
      ◆ Babonan {rek.babonan} · {formatUsiaRingkas(usia)}
    </span>
  );
}
