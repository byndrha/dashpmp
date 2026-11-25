"use client";

import { useState } from "react";
import { Check, Layers, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { formatDate } from "@/lib/format";
import { formatQty } from "@/lib/korelasi-format";
import { REPORT_SHIFT_ROLLOVER_HOUR } from "@/lib/report-shift";
import { STATUS_MESIN_LABEL, type StatusMesin } from "@/lib/produksi-mesin-status";
import type { MesinRow } from "@/lib/queries/produksi-mesin";
import type { RiwayatKualitasEntry, RiwayatShiftGroup } from "@/lib/queries/produksi-riwayat-detail";
import { PENYEBAB_JEDA_LABEL, PENYEBAB_JEDA_SINGKAT, type JedaMesinRow, type PenyebabJeda } from "@/lib/produksi-mesin-jeda";
import { DialogJedaMesin, type DraftJeda } from "@/components/produksi/dialog-jeda-mesin";

const STATUS_BADGE_CLASS: Record<StatusMesin, string> = {
  AKTIF: "bg-emerald-500/15 text-emerald-600",
  MAINTENANCE: "bg-amber-500/15 text-amber-600",
  RUSAK: "bg-destructive/15 text-destructive",
};

// --- Ukuran linimasa -------------------------------------------------------
// Kartu bertinggi TETAP supaya tata letak berbasis waktu bisa dihitung tanpa
// mengukur DOM. Jarak antar kartu sebanding dengan selisih jam panennya
// (PX_PER_MENIT), tetapi kartu yang waktunya berdekatan tetap ditumpuk rapat
// (JARAK_MIN), dan jeda yang sangat panjang dipadatkan (JEDA_MAKS_PX) dengan
// penanda "jeda" supaya satu shift tidak menjadi sangat tinggi.
// Tinggi kartu per entri (desain sama dengan kartu Kualitas di aplikasi
// produksi HP); kotak catatan menambah tinggi.
const TINGGI_KARTU_DASAR = 144;
const TINGGI_CATATAN = 36;
function tinggiKartu(e: RiwayatKualitasEntry): number {
  return TINGGI_KARTU_DASAR + (e.catatan ? TINGGI_CATATAN : 0);
}
const JARAK_MIN = 8;
const PX_PER_MENIT = 3;
const JEDA_MAKS_PX = 240;
const PAD_ATAS = 10;
const PAD_BAWAH = 12;
const LEBAR_SUMBU = 64;
const TINGGI_KEPALA_KOLOM = 60;

// Kolom papan: satu per mesin (urutan sama dengan kartu mesin di Peta Cold
// Storage, 3 -> 2 -> 1), plus "Tanpa mesin" hanya bila ada entri lama yang
// mesinnya kosong/terhapus.
interface KolomPapan {
  kunci: string;
  mesinId: number | null;
  nama: string;
  status: StatusMesin | null;
  cocok: (e: RiwayatKualitasEntry) => boolean;
}

// Menit absolut sejak 1970 untuk jam panen di hari usaha (tanggalUsaha).
// Hari usaha produksi berganti 15.00 WIB: jam >= 15 (Shift 2 dan awal
// Shift 3) jatuh pada tanggal kalender SEBELUM tanggalUsaha.
function menitAbsolut(tanggalUsaha: string, waktu: string): number {
  const [j, m] = waktu.slice(0, 5).split(":").map(Number);
  const hari = Date.parse(`${tanggalUsaha}T00:00:00Z`) / 60_000;
  const menit = (j || 0) * 60 + (m || 0);
  return hari + (j >= REPORT_SHIFT_ROLLOVER_HOUR.work ? menit - 1440 : menit);
}

function formatJeda(menit: number): string {
  if (menit < 60) return `${menit} mnt`;
  const j = Math.floor(menit / 60);
  const m = menit % 60;
  return m ? `${j}j ${m}m` : `${j} jam`;
}

interface PosisiKartu {
  entri: RiwayatKualitasEntry;
  kolom: number;
  y: number;
  menit: number;
}

interface TitikSumbu {
  y: number;
  waktu: string;
}

interface Pemadatan {
  yAtas: number;
  yBawah: number;
  menit: number;
}

// Tata letak satu shift, dipakai BERSAMA oleh semua kolom supaya panen pada
// jam yang sama di mesin berbeda sejajar mendatar. Diproses dari jam
// terbaru (atas) ke terlama (bawah).
function tataLetakShift(g: RiwayatShiftGroup, kolom: KolomPapan[]) {
  const item = g.entries
    .map((e) => ({ e, kolom: kolom.findIndex((k) => k.cocok(e)), menit: menitAbsolut(g.tanggalUsaha, e.waktu) }))
    .filter((x) => x.kolom >= 0)
    .sort((a, b) => b.menit - a.menit || a.kolom - b.kolom);

  const kartu: PosisiKartu[] = [];
  const sumbu: TitikSumbu[] = [];
  const pemadatan: Pemadatan[] = [];
  const bawahKolom = kolom.map(() => -Infinity);
  let yPrev = PAD_ATAS;
  let menitPrev: number | null = null;

  let i = 0;
  while (i < item.length) {
    const menit = item[i].menit;
    const sekelompok: typeof item = [];
    while (i < item.length && item[i].menit === menit) sekelompok.push(item[i++]);

    let y = PAD_ATAS;
    if (menitPrev != null) {
      const selisih = menitPrev - menit;
      const ideal = selisih * PX_PER_MENIT;
      const dipadatkan = ideal > JEDA_MAKS_PX;
      y = yPrev + Math.min(ideal, JEDA_MAKS_PX);
      if (dipadatkan) pemadatan.push({ yAtas: yPrev, yBawah: y, menit: selisih });
    }
    // Kartu dalam kolom yang sama tidak boleh bertumpuk.
    for (const x of sekelompok) y = Math.max(y, bawahKolom[x.kolom] + JARAK_MIN);
    // Dua entri pada menit yang sama di satu kolom: tumpuk ke bawah.
    for (const x of sekelompok) {
      const yKartu = Math.max(y, bawahKolom[x.kolom] + JARAK_MIN);
      kartu.push({ entri: x.e, kolom: x.kolom, y: yKartu, menit });
      bawahKolom[x.kolom] = yKartu + tinggiKartu(x.e);
    }
    sumbu.push({ y, waktu: sekelompok[0].e.waktu.slice(0, 5) });
    yPrev = y;
    menitPrev = menit;
  }

  const tinggi = Math.max(PAD_ATAS, ...bawahKolom.filter(Number.isFinite)) + PAD_BAWAH;
  return { kartu, sumbu, pemadatan, tinggi };
}

function totalKantong(entries: RiwayatKualitasEntry[]) {
  let kg10 = 0;
  let kg5 = 0;
  for (const e of entries) {
    if (e.variant === "10kg") kg10 += e.qty10KG ?? 0;
    else kg5 += e.qty10KG ?? 0;
  }
  return { kg10, kg5 };
}

// Jam kerja tiap shift produksi (lihat getShiftNumber, kind "work"):
// Shift 1 07.00–15.00, Shift 2 15.00–23.00, Shift 3 23.00–07.00.
const JAM_GANTI = REPORT_SHIFT_ROLLOVER_HOUR.work;
const jam2 = (j: number) => `${String(j).padStart(2, "0")}.00`;
const JAM_SHIFT: Record<1 | 2 | 3, string> = {
  1: `${jam2(7)}–${jam2(JAM_GANTI)}`,
  2: `${jam2(JAM_GANTI)}–${jam2(23)}`,
  3: `${jam2(23)}–${jam2(7)}`,
};

// Chip angka berlabel ("10 KG · 676", "15 QC") untuk rincian per mesin.
const KELAS_CHIP_ANGKA =
  "rounded border border-foreground/20 bg-background px-1.5 py-0.5 text-[10px] font-medium text-foreground/70 tabular-nums";

function ChipRincianMesin({ entries }: { entries: RiwayatKualitasEntry[] }) {
  const { kg10, kg5 } = totalKantong(entries);
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className={KELAS_CHIP_ANGKA}>
        10 KG · <b className="font-semibold text-foreground">{formatQty(kg10)}</b>
      </span>
      <span className={KELAS_CHIP_ANGKA}>
        5 KG · <b className="font-semibold text-foreground">{formatQty(kg5)}</b>
      </span>
      <span className={KELAS_CHIP_ANGKA}>
        <b className="font-semibold text-foreground">{entries.length}</b> QC
      </span>
    </span>
  );
}

function TotalChip({ entries, className, selalu5 = false }: { entries: RiwayatKualitasEntry[]; className?: string; selalu5?: boolean }) {
  const { kg10, kg5 } = totalKantong(entries);
  return (
    <span className={cn("flex items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground", className)}>
      <span>
        10 KG <b className="text-foreground">{formatQty(kg10)}</b>
      </span>
      {(kg5 > 0 || selalu5) && (
        <span>
          5 KG <b className="text-foreground">{formatQty(kg5)}</b>
        </span>
      )}
    </span>
  );
}

// Ringkasan pabrik satu shift (semua mesin) — tooltip kepala shift.
function ringkasanShift(g: RiwayatShiftGroup) {
  const s = g.stats;
  return [
    `Ringkasan pabrik ${formatDate(g.tanggalUsaha)} · Shift ${g.shift}`,
    `Stok Awal ${formatQty(s.stokAwal)}`,
    `Produksi ${formatQty(s.totalProduksi)} · 5KG ${formatQty(s.totalProduksi5KG)} · Gabungan ${formatQty(s.totalProduksiGabungan)}`,
    `Masuk Pallet ${formatQty(s.masukPallet)} · Terkirim ${formatQty(s.terkirim)}`,
    `Sisa Stok Akhir ${formatQty(s.sisaStokAkhir)}${s.sisaStokAkhirFinal ? "" : " (live)"} · Retur ${formatQty(s.retur)}`,
  ].join("\n");
}

// Foto persegi berpita label (Sampel / Berat), ketuk untuk perbesar — sama
// dengan FotoThumbnail di aplikasi produksi (produksi-app/kualitas-view.tsx).
function FotoBerlabel({ path, alt, label }: { path: string | null; alt: string; label: string }) {
  const pita = (
    <span className="absolute inset-x-0 bottom-0 rounded-b-md bg-black/55 py-0.5 text-center text-[10px] font-medium text-white">
      {label}
    </span>
  );
  if (!path) {
    return (
      <div className="relative flex size-[88px] shrink-0 items-center justify-center rounded-md border bg-muted pb-3 text-center text-[9px] leading-tight text-muted-foreground">
        Tidak ada foto
        {pita}
      </div>
    );
  }
  return (
    <Dialog>
      <DialogTrigger
        type="button"
        className="relative block size-[88px] shrink-0 cursor-zoom-in overflow-hidden rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- served from public/uploads, not a static build asset */}
        <img src={path} alt={alt} className="size-full object-cover" />
        {pita}
      </DialogTrigger>
      <DialogContent className="max-w-3xl p-2 sm:p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- served from public/uploads, not a static build asset */}
        <img src={path} alt={alt} className="max-h-[80vh] w-full rounded object-contain" />
      </DialogContent>
    </Dialog>
  );
}

// Kartu satu hasil panen — mengikuti kartu Kualitas di aplikasi produksi HP
// (nama mesin & shift tidak diulang: sudah jadi kolom & bagian linimasa):
//   11:36                                   [✓ Lolos]
//   Rendi Andika Putra
//   [foto][foto]  10 KG · 45 kantong (sisa 25)
//                 ✓ Kejernihan  ✓ Ukuran/Bentuk
//                 Diameter dalam 72 mm
//                 ▤ [U2A] [T1F]
//   Catatan ...
const MAKS_CHIP_PALET = 2;
function keteranganPalet(a: RiwayatKualitasEntry["alokasiPallet"][number]): string {
  return `${a.posisiKode}: ${a.qty10KG} kantong${a.sisaQty10KG !== a.qty10KG ? ` (sisa ${a.sisaQty10KG})` : ""}`;
}

function KartuEntri({ e, y }: { e: RiwayatKualitasEntry; y: number }) {
  const items = [
    { label: "Kejernihan", pass: e.cekKejernihan },
    { label: "Ukuran/Bentuk", pass: e.cekUkuranBentuk },
  ];
  const allPass = items.every((i) => i.pass);
  const varian = e.variant === "10kg" ? "10 KG" : "5 KG";
  const sisa = e.sisaBelumDialokasikan;

  return (
    <div
      className={cn(
        "absolute inset-x-2 flex flex-col gap-2 overflow-hidden rounded-xl border bg-card p-2.5 shadow-xs",
        !allPass && "border-destructive/40 bg-destructive/5"
      )}
      style={{ top: y, height: tinggiKartu(e) }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 font-semibold leading-tight tabular-nums">{e.waktu.slice(0, 5)}</span>
          <span className="truncate text-[11px] text-muted-foreground" title={`Pemeriksa: ${e.dicatatOlehNama}`}>
            {e.dicatatOlehNama}
          </span>
        </p>
        <span className="flex shrink-0 items-center gap-1">
          <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-sky-600">{varian}</span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
              allPass ? "bg-emerald-500/15 text-emerald-600" : "bg-destructive/15 text-destructive"
            )}
          >
            {allPass ? <Check className="size-3" /> : <X className="size-3" />}
            {allPass ? "Lolos" : "Ada temuan"}
          </span>
        </span>
      </div>

      <div className="flex shrink-0 gap-2.5">
        <div className="flex shrink-0 gap-1.5">
          <FotoBerlabel path={e.fotoPath} alt="Foto sampel" label="Sampel" />
          <FotoBerlabel path={e.fotoBeratKemasanPath} alt="Foto berat kemasan" label="Berat" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs">
            {e.qty10KG != null && (
              <span className="text-muted-foreground">
                <span className="font-semibold text-foreground tabular-nums">{e.qty10KG}</span> kantong
                {sisa != null && (
                  <span className={cn("tabular-nums", sisa > 0 && "font-medium text-amber-600")}> (sisa {sisa})</span>
                )}
              </span>
            )}
          </p>
          <div className="flex flex-col gap-0.5">
            {items.map((i) => (
              <span
                key={i.label}
                className={cn("inline-flex items-center gap-1 text-xs", i.pass ? "text-emerald-600" : "font-medium text-destructive")}
              >
                {i.pass ? <Check className="size-3.5 shrink-0" /> : <X className="size-3.5 shrink-0" />}
                {i.label}
              </span>
            ))}
          </div>
          {e.diameterDalamMm != null && <p className="text-xs text-muted-foreground">Diameter dalam {e.diameterDalamMm} mm</p>}
          <div className="flex items-center gap-1 overflow-hidden whitespace-nowrap">
            <Layers className="size-3.5 shrink-0 text-muted-foreground" aria-label="Palet" />
            {/* Lebar terbatas di samping foto: 2 palet pertama, sisanya "+N"
                dengan daftar lengkap di tooltip. */}
            {e.alokasiPallet.slice(0, MAKS_CHIP_PALET).map((a) => (
              <span
                key={a.batchId}
                title={keteranganPalet(a)}
                className="shrink-0 rounded bg-foreground px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-background"
              >
                {a.posisiKode}
              </span>
            ))}
            {e.alokasiPallet.length > MAKS_CHIP_PALET && (
              <span
                title={e.alokasiPallet.map(keteranganPalet).join("\n")}
                className="shrink-0 rounded border border-foreground/40 px-1.5 py-px text-[11px] font-bold text-foreground"
              >
                +{e.alokasiPallet.length - MAKS_CHIP_PALET}
              </span>
            )}
            {e.alokasiPallet.length === 0 && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Belum di palet</span>
            )}
          </div>
        </div>
      </div>

      {e.catatan && (
        <p className="truncate rounded-md bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground" title={e.catatan}>
          <span className="font-medium text-foreground">Catatan:</span> {e.catatan}
        </p>
      )}
    </div>
  );
}

// Penghubung antar dua kartu berurutan dalam satu kolom: garis tipis dari
// bawah kartu atas ke atas kartu bawah, berlabel jedanya bila cukup ruang.
// Menit (skala linimasa) <-> "YYYY-MM-DDTHH:mm" naive-WIB.
function menitKeNaif(menit: number): string {
  return new Date(menit * 60_000).toISOString().slice(0, 16);
}
function naifKeMenit(naif: string): number {
  return Date.parse(`${naif}:00Z`) / 60_000;
}

const WARNA_PENYEBAB: Record<PenyebabJeda, string> = {
  SENGAJA_MATI: "border-slate-400/60 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  PERBAIKAN: "border-orange-400/60 bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  KENDALA: "border-red-400/60 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  PERAWATAN: "border-sky-400/60 bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  LAINNYA: "border-violet-400/60 bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
};

// Penghubung antar dua kartu berurutan dalam satu kolom: garis tipis dari
// bawah kartu atas ke atas kartu bawah, berlabel jedanya, tombol "+" untuk
// mencatat penyebab jeda, dan pil catatan jeda yang sudah ada.
function Penghubung({
  dari,
  ke,
  menit,
  catatan,
  onTambah,
  onBuka,
}: {
  dari: number;
  ke: number;
  menit: number;
  catatan: JedaMesinRow[];
  onTambah?: () => void;
  onBuka: (j: JedaMesinRow) => void;
}) {
  const tinggi = ke - dari;
  if (tinggi <= 2) return null;
  const adaRuang = tinggi >= 22;
  return (
    <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 justify-center" style={{ top: dari, height: tinggi }}>
      <span aria-hidden className="h-full w-px bg-border" />
      {adaRuang && menit > 0 && (
        <div className="absolute top-1/2 flex -translate-y-1/2 flex-col items-center gap-1">
          <span className="flex items-center gap-1">
            <span className="rounded-full border border-border bg-background px-1.5 text-[10px] whitespace-nowrap text-muted-foreground tabular-nums">
              {formatJeda(menit)}
            </span>
            {onTambah && (
              <button
                type="button"
                onClick={onTambah}
                title="Catat penyebab jeda"
                aria-label="Catat penyebab jeda"
                className="pointer-events-auto flex size-4 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground"
              >
                <Plus className="size-3" />
              </button>
            )}
          </span>
          {catatan.map((c) => (
            <button
              key={c.jedaId}
              type="button"
              onClick={() => onBuka(c)}
              title={`${PENYEBAB_JEDA_LABEL[c.penyebab]} · ${c.waktuMulai.slice(11)}–${c.waktuSelesai.slice(11)}${c.keterangan ? `\n${c.keterangan}` : ""}`}
              className={cn(
                "pointer-events-auto max-w-56 truncate rounded-full border px-2 py-px text-[10px] font-medium whitespace-nowrap shadow-xs",
                WARNA_PENYEBAB[c.penyebab]
              )}
            >
              {PENYEBAB_JEDA_SINGKAT[c.penyebab]} · {c.waktuMulai.slice(11)}–{c.waktuSelesai.slice(11)}
              {c.keterangan && <span className="font-normal opacity-80"> · {c.keterangan}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BagianShift({
  g,
  kolom,
  templat,
  jedaPerMesin,
  onTambahJeda,
  onBukaJeda,
}: {
  g: RiwayatShiftGroup;
  kolom: KolomPapan[];
  templat: string;
  jedaPerMesin: Map<number, JedaMesinRow[]>;
  onTambahJeda: (k: KolomPapan, mulaiMenit: number, selesaiMenit: number) => void;
  onBukaJeda: (j: JedaMesinRow, k: KolomPapan) => void;
}) {
  const { kartu, sumbu, pemadatan, tinggi } = tataLetakShift(g, kolom);
  const kosong = g.entries.length === 0;

  // Label jam di sumbu: lewati yang terlalu rapat dengan label sebelumnya.
  const labelSumbu: TitikSumbu[] = [];
  for (const t of sumbu) {
    const akhir = labelSumbu[labelSumbu.length - 1];
    if (!akhir || t.y - akhir.y >= 16) labelSumbu.push(t);
  }

  return (
    <section>
      {/* Kepala shift (menempel di bawah kepala kolom): baris 1 = shift + jam
          kerjanya, tanggal, tim, total pabrik (10 KG & 5 KG); baris 2 =
          rincian produksi tiap mesin, tepat di atas kolom mesinnya. */}
      <div
        title={ringkasanShift(g)}
        className="sticky z-10 grid border-y border-border bg-muted/95 backdrop-blur-sm"
        style={{ gridTemplateColumns: templat, top: TINGGI_KEPALA_KOLOM }}
      >
        <div className="row-span-2 flex flex-col items-center justify-center gap-0.5 px-1 leading-tight">
          <span className="rounded bg-primary/10 px-1 py-px text-[11px] font-semibold text-primary">Shift {g.shift}</span>
        </div>
        <div
          className="flex min-w-0 items-center gap-2 border-b border-border/70 px-2 py-1.5 text-xs"
          style={{ gridColumn: `2 / span ${kolom.length}` }}
        >
          <span className="font-semibold">{formatDate(g.tanggalUsaha)}</span>
          <span className="tabular-nums text-muted-foreground">{JAM_SHIFT[g.shift]}</span>
          <span className="truncate text-muted-foreground">· {g.timNama ?? "Tim belum ditentukan"}</span>
          {kosong ? (
            <span className="ml-auto font-medium text-destructive">Tidak ada Cek Kualitas — SOP tidak dijalankan.</span>
          ) : (
            <TotalChip entries={g.entries} selalu5 className="ml-auto" />
          )}
        </div>
        {kolom.map((k, i) => {
          const milik = g.entries.filter(k.cocok);
          return (
            <div
              key={k.kunci}
              className="flex min-w-0 items-center border-l border-border/70 px-3 py-1.5"
              style={{ gridColumn: i + 2 }}
            >
              {milik.length > 0 ? (
                <ChipRincianMesin entries={milik} />
              ) : (
                <span className="text-[10px] text-muted-foreground">Tidak ada panen</span>
              )}
            </div>
          );
        })}
      </div>
      {!kosong && (
        <div className="grid" style={{ gridTemplateColumns: templat }}>
          {/* Sumbu waktu: garis tegak + label jam tiap titik panen; jeda yang
              dipadatkan ditandai garis putus-putus berlabel. */}
          <div className="relative" style={{ height: tinggi }}>
            <span aria-hidden className="absolute inset-y-0 right-3 w-px bg-border" />
            {pemadatan.map((p, i) => (
              <span
                key={i}
                title={`Jeda ${formatJeda(p.menit)} dipadatkan`}
                className="absolute right-0 left-0 flex items-center justify-end pr-1"
                style={{ top: p.yAtas + TINGGI_KARTU_DASAR / 2, height: Math.max(0, p.yBawah - p.yAtas) }}
              >
                <span className="absolute right-[11px] inset-y-0 w-[3px] border-x border-dashed border-amber-400/80 bg-background" />
                <span className="relative rounded border border-amber-400/60 bg-amber-50 px-1 text-[9px] leading-4 font-semibold whitespace-nowrap text-amber-700 tabular-nums dark:bg-amber-950 dark:text-amber-300">
                  {formatJeda(p.menit)}
                </span>
              </span>
            ))}
            {labelSumbu.map((t) => (
              <span key={`${t.y}-${t.waktu}`} className="absolute right-0 flex items-center gap-1" style={{ top: t.y + 4 }}>
                <span className="text-[11px] font-semibold tabular-nums text-foreground/80">{t.waktu}</span>
                <span className="mr-[9px] size-2 rounded-full border-2 border-primary bg-background" />
              </span>
            ))}
          </div>
          {kolom.map((k, ki) => {
            const milik = kartu.filter((p) => p.kolom === ki);
            return (
              <div key={k.kunci} className="relative border-l border-border/60" style={{ height: tinggi }}>
                {milik.length === 0 && <p className="px-3 pt-3 text-[11px] text-muted-foreground">Tidak ada panen di mesin ini.</p>}
                {milik.map((p, i) => {
                  const berikut = milik[i + 1];
                  return (
                    <div key={p.entri.kualitasId}>
                      <KartuEntri e={p.entri} y={p.y} />
                      {berikut && (
                        <Penghubung
                          dari={p.y + tinggiKartu(p.entri)}
                          ke={berikut.y}
                          menit={p.menit - berikut.menit}
                          // Catatan jeda mesin ini yang beririsan dengan rentang
                          // jeda (jam kartu bawah -> jam kartu atas).
                          catatan={(k.mesinId != null ? (jedaPerMesin.get(k.mesinId) ?? []) : []).filter(
                            (c) => naifKeMenit(c.waktuMulai) < p.menit && naifKeMenit(c.waktuSelesai) > berikut.menit
                          )}
                          onTambah={k.mesinId != null ? () => onTambahJeda(k, berikut.menit, p.menit) : undefined}
                          onBuka={(c) => onBukaJeda(c, k)}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// Riwayat Produksi sebagai linimasa vertikal per mesin: satu kolom per mesin
// (dari DashboardProduksiMesin — mesin yang ditambahkan lewat tombol "+" di
// Peta Cold Storage otomatis menjadi kolom baru), sumbu waktu di kiri,
// terbaru di atas, dibagi per (Tanggal, Shift). Satu area gulir untuk
// seluruh papan (seperti Pemesanan) dengan kepala kolom menempel di atasnya.
export function RiwayatProduksiLinimasa({
  riwayatGrup,
  mesinList,
  jedaList,
}: {
  riwayatGrup: RiwayatShiftGroup[];
  mesinList: MesinRow[];
  jedaList: JedaMesinRow[];
}) {
  // Dialog Catatan Jeda: satu untuk seluruh papan. `kunciDialog` naik tiap
  // kali dibuka supaya isian dialog mulai dari draft terbaru.
  const [draftJeda, setDraftJeda] = useState<DraftJeda | null>(null);
  const [kunciDialog, setKunciDialog] = useState(0);
  function bukaDialog(d: DraftJeda) {
    setKunciDialog((n) => n + 1);
    setDraftJeda(d);
  }

  if (riwayatGrup.length === 0) {
    return <p className="text-sm text-muted-foreground">Belum ada riwayat produksi.</p>;
  }

  const idMesin = new Set(mesinList.map((m) => m.MesinID));
  const kolom: KolomPapan[] = [...mesinList].reverse().map((m) => ({
    kunci: `m-${m.MesinID}`,
    mesinId: m.MesinID,
    nama: m.Nama,
    status: m.Status,
    cocok: (e) => e.mesinId === m.MesinID,
  }));
  if (riwayatGrup.some((g) => g.entries.some((e) => e.mesinId == null || !idMesin.has(e.mesinId)))) {
    kolom.push({
      kunci: "tanpa-mesin",
      mesinId: null,
      nama: "Tanpa mesin",
      status: null,
      cocok: (e) => e.mesinId == null || !idMesin.has(e.mesinId),
    });
  }
  const templat = `${LEBAR_SUMBU}px repeat(${kolom.length}, minmax(260px, 1fr))`;

  const jedaPerMesin = new Map<number, JedaMesinRow[]>();
  for (const j of jedaList) {
    const daftar = jedaPerMesin.get(j.mesinId) ?? [];
    daftar.push(j);
    jedaPerMesin.set(j.mesinId, daftar);
  }
  for (const daftar of jedaPerMesin.values()) daftar.sort((a, b) => a.waktuMulai.localeCompare(b.waktuMulai));

  function tambahJeda(k: KolomPapan, mulaiMenit: number, selesaiMenit: number) {
    if (k.mesinId == null) return;
    bukaDialog({
      jedaId: null,
      mesinId: k.mesinId,
      mesinNama: k.nama,
      waktuMulai: menitKeNaif(mulaiMenit),
      waktuSelesai: menitKeNaif(selesaiMenit),
      penyebab: "SENGAJA_MATI",
      keterangan: "",
    });
  }
  function bukaJeda(j: JedaMesinRow, k: KolomPapan) {
    bukaDialog({
      jedaId: j.jedaId,
      mesinId: j.mesinId,
      mesinNama: k.nama,
      waktuMulai: j.waktuMulai,
      waktuSelesai: j.waktuSelesai,
      penyebab: j.penyebab,
      keterangan: j.keterangan ?? "",
    });
  }

  return (
    // Ikut gulir halaman (bukan area gulir sendiri — dua scrollbar bertumpuk).
    // overflow-clip, BUKAN overflow-auto/hidden: memotong sudut membulat
    // tanpa membuat kontainer gulir, jadi kepala kolom & kepala shift tetap
    // menempel terhadap guliran halaman.
    <div className="overflow-clip rounded-xl border border-border bg-muted/20">
      <div className="min-w-fit">
        <div
          className="sticky top-0 z-20 grid border-b border-border bg-background"
          style={{ gridTemplateColumns: templat, height: TINGGI_KEPALA_KOLOM }}
        >
          <div className="flex items-end justify-center pb-1.5 text-[10px] font-medium text-muted-foreground">Jam</div>
          {kolom.map((k) => {
            const semua = riwayatGrup.flatMap((g) => g.entries.filter(k.cocok));
            return (
              <div key={k.kunci} className="flex min-w-0 flex-col justify-center gap-1 border-l border-border/60 px-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold">{k.nama}</p>
                  {k.status && (
                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", STATUS_BADGE_CLASS[k.status])}>
                      {STATUS_MESIN_LABEL[k.status]}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <TotalChip entries={semua} />
                  <span className="text-[11px] text-muted-foreground tabular-nums">{semua.length} QC</span>
                </div>
              </div>
            );
          })}
        </div>
        {riwayatGrup.map((g) => (
          <BagianShift
            key={`${g.tanggalUsaha}-${g.shift}`}
            g={g}
            kolom={kolom}
            templat={templat}
            jedaPerMesin={jedaPerMesin}
            onTambahJeda={tambahJeda}
            onBukaJeda={bukaJeda}
          />
        ))}
      </div>
      <DialogJedaMesin key={kunciDialog} draft={draftJeda} onTutup={() => setDraftJeda(null)} />
    </div>
  );
}
