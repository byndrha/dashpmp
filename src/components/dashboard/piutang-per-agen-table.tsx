"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Banknote, ChevronDown, Clock, Copy, CreditCard, Download, FileText, Info, MapPin, Package, Search, Share2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Pagination } from "@/components/dashboard/pagination";
import { ExportXlsxButton } from "@/components/dashboard/export-xlsx-button";
import { PiutangBayarDialog } from "@/components/dashboard/piutang-bayar-dialog";
import { formatRupiah } from "@/lib/format";
import { usePanelMenempel } from "@/hooks/use-panel-menempel";
import { Petunjuk } from "@/components/ui/petunjuk";
import { utcInstantToWibDisplay } from "@/lib/business-date";
import { cn } from "@/lib/utils";
import { SEGMENTASI_OPTIONS } from "@/lib/segmentasi-mitra";
import type { XlsxColumn } from "@/lib/export-xlsx";
import type { PiutangPerAgenRow, PiutangTransaksiRow } from "@/lib/queries/penjualan-piutang";
import type { PiutangBayarContext, PiutangTarikContext, BayarPiutangResult } from "@/lib/queries/piutang-pembayaran";
import type { KomponenSelisih } from "@/lib/queries/piutang-invoice-outstanding";
import {
  esBalokStatus,
  ES_BALOK_JATUH_TEMPO_HARI,
  type EsBalokPiutangStatus,
  type PiutangTerbukaRingkas,
  type RingkasanPiutangTerbuka,
} from "@/lib/piutang-es-balok-status";

const EXPORT_COLUMNS: XlsxColumn[] = [
  { header: "Mitra", key: "nama", width: 26 },
  { header: "Tabungan Awal", key: "tabunganAwal", type: "number", width: 16 },
  { header: "Hutang Awal", key: "hutangAwal", type: "number", width: 16 },
  { header: "Pesanan", key: "pesanan", type: "number", width: 16 },
  { header: "Retur", key: "retur", type: "number", width: 14 },
  { header: "Pembayaran", key: "pembayaran", type: "number", width: 16 },
  { header: "Tarikan", key: "tarikan", type: "number", width: 14 },
  { header: "Saldo Akhir", key: "saldoAkhir", type: "number", width: 16 },
  // Sama dengan chip di kartu: status dari piutang terbuka terburuk; usia =
  // hari sejak tanggal pesanan belum lunas yang paling lama. Kosong bila
  // Agen tidak punya piutang terbuka.
  { header: "Status Piutang", key: "statusPiutang", width: 14 },
  { header: "Piutang Terbuka", key: "piutangTerbuka", type: "number", width: 16 },
  { header: "Usia Piutang Terlama (hari)", key: "usiaTerlama", type: "number", numFmt: "0", width: 26 },
  { header: "Lewat Jatuh Tempo (hari)", key: "lewatJatuhTempo", type: "number", numFmt: "0", width: 24 },
];

const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

type SortKey = "Nama" | "SaldoAkhir" | "Pesanan";
// "Jenis" saldo Agen (Hutang/Tabungan/Lunas) — nama tipenya dibiarkan
// StatusFilter agar diff kecil; filter "Status" kesehatan piutang terpisah.
type StatusFilter = "all" | "hutang" | "tabungan" | "lunas";
type StatusPiutangFilter = "all" | EsBalokPiutangStatus;

const PAGE_SIZE = 12;

function statusOf(row: PiutangPerAgenRow): StatusFilter {
  if (row.saldoAkhir > 0) return "hutang";
  if (row.saldoAkhir < 0) return "tabungan";
  return "lunas";
}

// "dd/MM/yyyy • HH:mm" for a TRUE UTC instant (e.g. `new Date()` at fetch
// time) -- utcInstantToWibDisplay shifts it +7h so reading its raw
// UTC-component getters below gives the correct WIB wall-clock, same
// pattern formatDateWib/formatTimeWib rely on for naive-WIB values.
function formatUpdateStamp(date: Date): string {
  const wib = utcInstantToWibDisplay(date);
  const y = wib.getUTCFullYear();
  const m = String(wib.getUTCMonth() + 1).padStart(2, "0");
  const d = String(wib.getUTCDate()).padStart(2, "0");
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mm = String(wib.getUTCMinutes()).padStart(2, "0");
  return `${d}/${m}/${y} • ${hh}:${mm}`;
}

// "September 2026" for a single-month range, or "dd/MM/yy - dd/MM/yy" when
// the chosen range spans more than one calendar month.
function formatPeriodeLabel(startISO: string, endISO: string): string {
  const [sy, sm] = startISO.split("-").map(Number);
  const [ey, em] = endISO.split("-").map(Number);
  if (sy === ey && sm === em) return `${MONTH_NAMES[sm - 1]} ${sy}`;
  const short = (iso: string) => {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };
  return `${short(startISO)} - ${short(endISO)}`;
}

function SortToggle({
  label,
  sortKey,
  active,
  direction,
  onSort,
  penuh = false,
}: {
  label: string;
  sortKey: SortKey;
  active: boolean;
  direction: "asc" | "desc";
  onSort: (key: SortKey) => void;
  // Satu baris selebar popup (menu urutan di HP), bukan pil kecil.
  penuh?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 text-xs transition-colors hover:text-foreground",
        penuh ? "h-8 w-full justify-between text-sm" : "h-6",
        active ? "bg-primary/10 font-medium text-foreground" : "text-muted-foreground"
      )}
    >
      {label}
      {active ? (
        direction === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
      ) : (
        <ArrowUpDown className="size-3 opacity-40" />
      )}
    </button>
  );
}

const COLLAPSED_PREVIEW_COUNT = 2;

function segmentasiLabel(value: PiutangPerAgenRow["segmentasi"]): string | null {
  if (!value) return null;
  return SEGMENTASI_OPTIONS.find((s) => s.value === value)?.label ?? null;
}

function formatTanggalPendek(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const TIPE_LABEL: Record<PiutangTransaksiRow["tipe"], string> = {
  pesanan: "Pemesanan",
  pembayaran: "Pembayaran",
  tarikan: "Tarikan",
};

// Pemesanan = order fulfilled (primary/green), Pembayaran = payment
// received (warning/amber), Tarikan = savings withdrawal, i.e. debt goes
// up (destructive/red) -- three semantic tokens already used elsewhere in
// this app (see aging-table.tsx's STATUS_BADGE), not new custom colors.
const TIPE_BADGE_CLASS: Record<PiutangTransaksiRow["tipe"], string> = {
  pesanan: "bg-primary/15 text-primary",
  pembayaran: "bg-warning/15 text-warning",
  tarikan: "bg-destructive/15 text-destructive",
};

// Sisa piutang terbuka hasil alokasi FIFO (getEsBalokInvoiceOutstanding),
// sudah diringkas di server per Agen dan per (Agen, NoDokumen) — lihat
// ringkasPiutangTerbuka di lib/piutang-es-balok-status.ts.
interface PiutangTerbuka {
  outstanding: number;
  maxDaysOverdue: number;
}

function bacaTerbuka(v: PiutangTerbukaRingkas | undefined): PiutangTerbuka | undefined {
  return v ? { outstanding: v[0], maxDaysOverdue: v[1] } : undefined;
}

const STATUS_PIUTANG_CLASS: Record<EsBalokPiutangStatus, { badge: string; dot: string }> = {
  Sehat: { badge: "border-primary/40 text-primary", dot: "bg-primary" },
  Perhatian: { badge: "border-warning/40 text-warning", dot: "bg-warning" },
  Kritis: { badge: "border-destructive/40 text-destructive", dot: "bg-destructive" },
};

const UMUR_CHIP_CLASS: Record<EsBalokPiutangStatus, string> = {
  Sehat: "bg-primary/15 text-primary",
  Perhatian: "bg-warning/15 text-warning",
  Kritis: "bg-destructive/15 text-destructive",
};

function jatuhTempoISO(tanggalISO: string): string {
  const d = new Date(`${tanggalISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + ES_BALOK_JATUH_TEMPO_HARI);
  return d.toISOString().slice(0, 10);
}

// Indikator umur satu Pemesanan: "Lunas" bila sudah tertutup pembayaran
// (FIFO), atau usia pesanan dalam hari (sejak tanggal pesanan) bila masih
// ada sisa — warnanya mengikuti status Sehat/Perhatian/Kritis.
function UmurChip({ item, terbuka }: { item: PiutangTransaksiRow; terbuka: PiutangTerbuka | undefined }) {
  if (!terbuka) {
    return (
      <Petunjuk
        render={<span className="shrink-0 cursor-help rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground" />}
        judul="Lunas"
        isi="Sudah tertutup pembayaran (alokasi FIFO, pesanan terlama dulu)."
      >
        Lunas
      </Petunjuk>
    );
  }
  const usiaHari = Math.max(0, terbuka.maxDaysOverdue + ES_BALOK_JATUH_TEMPO_HARI);
  const status = esBalokStatus(terbuka.maxDaysOverdue);
  const keterangan =
    terbuka.maxDaysOverdue > 0
      ? `lewat ${terbuka.maxDaysOverdue} hari dari jatuh tempo`
      : `jatuh tempo ${formatTanggalPendek(jatuhTempoISO(item.tanggal))}`;
  return (
    <Petunjuk
      render={<span className={cn("shrink-0 cursor-help rounded px-1.5 py-0.5 text-[10px] font-semibold", UMUR_CHIP_CLASS[status])} />}
      judul={`Belum lunas ${formatRupiah(terbuka.outstanding)}`}
      isi={`Umur pesanan ${usiaHari} hari — ${keterangan} (jatuh tempo = tanggal + ${ES_BALOK_JATUH_TEMPO_HARI} hari).`}
    >
      {usiaHari} hari
    </Petunjuk>
  );
}

// Bordered card per transaction, per the reference design: doc icon + full
// NoDokumen and a colored tipe pill on top, date + a merged qty chip
// ("Kecil 230") and the signed amount below. Pesanan/Tarikan add to Hutang
// (shown plain), Pembayaran reduces it (shown negative, tinted primary like
// the Tabungan convention used elsewhere on this card). Padding kept tight
// (px-2/py-1.5, gap-1) so the box stays compact rather than tall.
function TransaksiRow({ item, terbuka }: { item: PiutangTransaksiRow; terbuka: PiutangTerbuka | undefined }) {
  const isReduction = item.jumlah < 0;
  return (
    <div className="flex flex-col gap-1 rounded-lg border px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1">
          <FileText className="size-3 shrink-0 text-muted-foreground" />
          <span className="font-data truncate text-[10px] text-muted-foreground">{item.noDokumen}</span>
        </span>
        <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium", TIPE_BADGE_CLASS[item.tipe])}>
          {TIPE_LABEL[item.tipe]}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="flex flex-nowrap items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-foreground">
          <span className="shrink-0">{formatTanggalPendek(item.tanggal)}</span>
          {item.balokKecil !== 0 && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
              Kecil <span className="font-semibold text-foreground">{item.balokKecil.toLocaleString("id-ID")}</span>
            </span>
          )}
          {item.balokBesar !== 0 && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
              Besar <span className="font-semibold text-foreground">{item.balokBesar.toLocaleString("id-ID")}</span>
            </span>
          )}
          {item.tipe === "pesanan" && <UmurChip item={item} terbuka={terbuka} />}
        </span>
        <span className={cn("font-data shrink-0 text-xs font-semibold tabular-nums", isReduction ? "text-primary" : "text-foreground")}>
          {isReduction ? "-" : ""}
          {formatRupiah(Math.abs(item.jumlah))}
        </span>
      </div>
    </div>
  );
}

// Satu pesanan yang masih punya sisa piutang (alokasi FIFO, semua periode) —
// dipakai mode "Semua belum lunas". Hanya data dari ringkasan piutang terbuka
// (NoDokumen, tanggal, sisa, umur); qty tidak tersedia di ringkasan itu.
export interface PesananBelumLunas {
  noDokumen: string;
  tanggal: string | null;
  terbuka: PiutangTerbuka;
}

function BelumLunasRow({ item }: { item: PesananBelumLunas }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1">
          <FileText className="size-3 shrink-0 text-muted-foreground" />
          <span className="font-data truncate text-[10px] text-muted-foreground">{item.noDokumen}</span>
        </span>
        <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-primary">Pemesanan</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="flex flex-nowrap items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-foreground">
          <span className="shrink-0">{item.tanggal ? formatTanggalPendek(item.tanggal) : "—"}</span>
          {item.tanggal && (
            <UmurChip
              item={{ tanggal: item.tanggal } as PiutangTransaksiRow}
              terbuka={item.terbuka}
            />
          )}
        </span>
        <Petunjuk
          render={<span className="font-data shrink-0 cursor-help text-xs font-semibold tabular-nums text-foreground" />}
          isi="Sisa belum lunas pesanan ini"
        >
          {formatRupiah(item.terbuka.outstanding)}
        </Petunjuk>
      </div>
    </div>
  );
}

// Asal selisih Sisa Hutang vs total pesanan belum lunas, per komponen
// (getKomponenSelisihPiutang). Dimuat saat dibuka supaya tidak menambah
// query untuk setiap kartu. Komponen yang tidak terurai (mis. beda filter
// cabang) ditampilkan sebagai "Lainnya" agar jumlahnya selalu tepat.
function RincianSelisih({
  selisih,
  totalBelumLunas,
  sisaHutang,
  muat,
}: {
  selisih: number;
  totalBelumLunas: number;
  sisaHutang: number;
  muat: () => Promise<KomponenSelisih[]>;
}) {
  const [buka, setBuka] = useState(false);
  const [komponen, setKomponen] = useState<KomponenSelisih[] | null>(null);
  const [galat, setGalat] = useState(false);
  const [memuat, setMemuat] = useState(false);

  function alihkan() {
    const berikut = !buka;
    setBuka(berikut);
    if (berikut && !komponen && !memuat) {
      setMemuat(true);
      setGalat(false);
      muat()
        .then(setKomponen)
        .catch(() => setGalat(true))
        .finally(() => setMemuat(false));
    }
  }

  const lainnya = komponen ? selisih - komponen.reduce((t, k) => t + k.nilai, 0) : 0;
  const baris = komponen
    ? [...komponen, ...(Math.abs(lainnya) >= 1 ? [{ label: "Lainnya", nilai: Math.round(lainnya), keterangan: "Selisih kecil di luar komponen di atas (mis. beda filter cabang)" }] : [])]
    : [];
  const tanda = (n: number) => `${n < 0 ? "−" : "+"}${formatRupiah(Math.abs(n))}`;

  return (
    <div className="flex flex-col gap-1 px-1">
      <button
        type="button"
        onClick={alihkan}
        aria-expanded={buka}
        className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <span className="inline-flex items-center gap-1">
          <ChevronDown className={cn("size-3 transition-transform", !buka && "-rotate-90")} />
          Selisih ke Sisa Hutang
        </span>
        <span className="font-data font-semibold tabular-nums text-foreground">{tanda(selisih)}</span>
      </button>
      {buka && (
        <div className="flex flex-col gap-0.5 rounded-md bg-muted/50 px-2 py-1.5 text-[11px]">
          {memuat && <p className="text-muted-foreground">Memuat rincian…</p>}
          {galat && <p className="text-destructive">Gagal memuat rincian selisih.</p>}
          {baris.map((k) => (
            <Petunjuk
              key={k.label}
              render={<div className="flex cursor-help items-start justify-between gap-2" />}
              judul={k.label}
              isi={k.keterangan}
            >
              <span className="min-w-0 text-muted-foreground">{k.label}</span>
              <span className={cn("font-data shrink-0 tabular-nums", k.nilai < 0 ? "text-primary" : "text-foreground")}>
                {tanda(k.nilai)}
              </span>
            </Petunjuk>
          ))}
          {komponen && (
            <div className="mt-0.5 flex items-center justify-between gap-2 border-t pt-1 text-[10px] text-muted-foreground">
              <span>
                {formatRupiah(totalBelumLunas)} {selisih < 0 ? "−" : "+"} {formatRupiah(Math.abs(selisih))}
              </span>
              <span>
                = Sisa {sisaHutang >= 0 ? "Hutang" : "Tabungan"}{" "}
                <span className="font-data font-semibold text-foreground">{formatRupiah(Math.abs(sisaHutang))}</span>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AgenCard({
  row,
  terbukaAgen,
  terbukaDokumen,
  periodeLabel,
  lastUpdated,
  belumLunas,
  onLihatBelumLunas,
  fetchKomponenSelisih,
  fetchBayarContext,
  submitBayar,
  fetchTarikContext,
  submitTarik,
}: {
  row: PiutangPerAgenRow;
  terbukaAgen: PiutangTerbuka | undefined;
  terbukaDokumen: RingkasanPiutangTerbuka["dokumen"];
  periodeLabel: string;
  lastUpdated: Date;
  // Diisi saat mode "Semua belum lunas" aktif: pesanan terbuka Agen ini dari
  // SEMUA periode (menggantikan daftar transaksi rentang tanggal).
  belumLunas: PesananBelumLunas[] | null;
  onLihatBelumLunas: () => void;
  fetchKomponenSelisih: (agenId: string) => Promise<KomponenSelisih[]>;
  fetchBayarContext: (agenId: string) => Promise<PiutangBayarContext>;
  submitBayar: (
    agenId: string,
    jumlah: number,
    kasBank: { utama?: string; logistik?: string },
    catatan: string | null
  ) => Promise<BayarPiutangResult[]>;
  fetchTarikContext: (agenId: string) => Promise<PiutangTarikContext>;
  submitTarik: (
    agenId: string,
    jumlah: number,
    kasBank: { utama?: string; logistik?: string },
    catatan: string | null
  ) => Promise<BayarPiutangResult[]>;
}) {
  const status = statusOf(row);
  // Status kesehatan piutang Agen = umur piutang terbuka TERBURUK (sama
  // dengan Prioritas Penagihan); Agen tanpa piutang terbuka = Sehat.
  const statusPiutang = esBalokStatus(terbukaAgen ? terbukaAgen.maxDaysOverdue : null);
  const [expanded, setExpanded] = useState(false);
  const [bayarOpen, setBayarOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const captureRef = useRef<HTMLDivElement>(null);
  const jumlahDaftar = belumLunas ? belumLunas.length : row.transaksi.length;
  const hasMore = jumlahDaftar > COLLAPSED_PREVIEW_COUNT;
  const visibleTransaksi = expanded ? row.transaksi : row.transaksi.slice(0, COLLAPSED_PREVIEW_COUNT);
  const visibleBelumLunas = belumLunas ? (expanded ? belumLunas : belumLunas.slice(0, COLLAPSED_PREVIEW_COUNT)) : [];
  const totalBelumLunas = belumLunas ? belumLunas.reduce((jumlah, b) => jumlah + b.terbuka.outstanding, 0) : 0;
  const segLabel = segmentasiLabel(row.segmentasi);
  const hasPin = row.latitude != null && row.longitude != null;

  // Total quantity ordered (Balok Kecil/Besar), not a count of documents --
  // derived from the already-fetched transaksi list rather than a new
  // backend field, since each pesanan entry already carries its own
  // net-of-Retur qty.
  const pesananItems = row.transaksi.filter((t) => t.tipe === "pesanan");
  const totalKecil = pesananItems.reduce((sum, t) => sum + t.balokKecil, 0);
  const totalBesar = pesananItems.reduce((sum, t) => sum + t.balokBesar, 0);
  const pembayaranCount = row.transaksi.filter((t) => t.tipe === "pembayaran").length;

  async function captureCardPng(): Promise<Blob> {
    if (!captureRef.current) throw new Error("Kartu tidak ditemukan.");
    // The collapsed preview hides transaksi beyond COLLAPSED_PREVIEW_COUNT --
    // a shared card export should still show everything, so force-expand
    // before capturing and restore the user's own collapsed/expanded state
    // afterward. Double rAF waits for React to commit and the browser to
    // paint the taller layout before html-to-image reads it.
    const wasExpanded = expanded;
    if (hasMore && !wasExpanded) {
      setExpanded(true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }
    try {
      const { toBlob } = await import("html-to-image");
      // Read the Card's own actual rendered background instead of a
      // hardcoded color -- the app has multiple palettes and a light/dark
      // mode, so a fixed value (e.g. pure black) mismatches whenever the
      // viewer isn't on that one specific theme.
      const bg = getComputedStyle(captureRef.current).backgroundColor;
      const blob = await toBlob(captureRef.current, {
        pixelRatio: 2,
        backgroundColor: bg,
        filter: (node) => !(node instanceof HTMLElement && node.dataset.captureHide === "true"),
      });
      if (!blob) throw new Error("Gagal membuat gambar.");
      return blob;
    } finally {
      if (hasMore && !wasExpanded) setExpanded(false);
    }
  }

  async function handleCopyPng() {
    setExporting(true);
    try {
      const blob = await captureCardPng();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast.success("Gambar disalin ke clipboard.");
    } catch {
      toast.error("Gagal menyalin kartu ke clipboard.");
    } finally {
      setExporting(false);
    }
  }

  async function handleDownloadPng() {
    setExporting(true);
    try {
      const blob = await captureCardPng();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `piutang-${row.nama.toLowerCase().replace(/\s+/g, "-")}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Gagal mengunduh kartu.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
    <div className="relative">
      {/* A sibling of Card, not a descendant -- Card's own `overflow-hidden`
          (see components/ui/card.tsx) clips anything positioned outside its
          bounds, so a button meant to float over the corner has to live
          outside that clipped box to stay visible. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="icon"
              className="absolute -left-2 -top-2 z-10 size-6 rounded-full bg-background shadow-sm"
              title="Bagikan"
              data-capture-hide="true"
              disabled={exporting}
            />
          }
        >
          <Share2 className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" data-capture-hide="true">
          <DropdownMenuItem onClick={handleCopyPng}>
            <Copy className="size-3.5" />
            Salin
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDownloadPng}>
            <Download className="size-3.5" />
            Unduh
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Card className="pt-3.5 pb-0" ref={captureRef}>
      <CardContent className="flex flex-col gap-2 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{row.nama}</p>
              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="size-3" />
                {formatUpdateStamp(lastUpdated)}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <Badge variant={segLabel ? "secondary" : "outline"} className="h-5 px-1.5 text-[10px]">
                  {segLabel ?? "Belum Ditentukan"}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "h-5 gap-1 px-1.5 text-[10px]",
                    status === "hutang" && "border-destructive/40 text-destructive",
                    status === "tabungan" && "border-primary/40 text-primary"
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      status === "hutang" && "bg-destructive",
                      status === "tabungan" && "bg-primary",
                      status === "lunas" && "bg-muted-foreground"
                    )}
                  />
                  {status === "hutang" ? "Hutang" : status === "tabungan" ? "Tabungan" : "Lunas"}
                </Badge>
                <Petunjuk
                  render={<span className="inline-flex cursor-help" />}
                  judul={`Status ${statusPiutang}`}
                  isi={
                    terbukaAgen
                      ? `Piutang terbuka ${formatRupiah(terbukaAgen.outstanding)}; terlama ${
                          terbukaAgen.maxDaysOverdue > 0 ? `lewat ${terbukaAgen.maxDaysOverdue} hari dari jatuh tempo` : "belum jatuh tempo"
                        }.`
                      : "Tidak ada piutang terbuka."
                  }
                >
                  <Badge variant="outline" className={cn("h-5 gap-1 px-1.5 text-[10px]", STATUS_PIUTANG_CLASS[statusPiutang].badge)}>
                    <span className={cn("size-1.5 rounded-full", STATUS_PIUTANG_CLASS[statusPiutang].dot)} />
                    {statusPiutang}
                  </Badge>
                </Petunjuk>
                {hasPin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-5"
                    title="Lihat di Google Maps"
                    data-capture-hide="true"
                    onClick={() =>
                      window.open(`https://www.google.com/maps?q=${row.latitude},${row.longitude}`, "_blank", "noopener,noreferrer")
                    }
                  >
                    <MapPin className="size-3" />
                  </Button>
                )}
              </div>
            </div>
          <div className="shrink-0 border-l pl-2.5 text-right">
            <p className="text-[10px] text-muted-foreground">Piutang Awal</p>
            <p className="font-display text-sm font-semibold tabular-nums">{formatRupiah(row.hutangAwal)}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">Tabungan Awal</p>
            <p className="font-display text-sm font-semibold tabular-nums">{formatRupiah(row.tabunganAwal)}</p>
          </div>
        </div>

        {belumLunas && (
          <div className="-mx-4 border-t px-2 pt-2">
            <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
              <p className="min-w-0 truncate whitespace-nowrap text-[10px] font-semibold uppercase text-muted-foreground">
                {belumLunas.length} Pemesanan belum lunas
              </p>
              <p className="shrink-0 text-muted-foreground">Semua periode</p>
            </div>
            {belumLunas.length > 0 ? (
              <div className="flex flex-col gap-1">
                {visibleBelumLunas.map((item) => (
                  <BelumLunasRow key={item.noDokumen} item={item} />
                ))}
                <div className="flex items-center justify-between gap-2 px-1 pt-0.5 text-[11px]">
                  <span className="text-muted-foreground">Total sisa pesanan</span>
                  <span className="font-data font-semibold tabular-nums">{formatRupiah(totalBelumLunas)}</span>
                </div>
                {/* Total pesanan belum lunas (FIFO) bisa berbeda dari Sisa Hutang
                    di bawah — rinciannya (tarikan, saldo awal ERP, kelebihan
                    bayar, saldo database lain) dihitung tepat di
                    getKomponenSelisihPiutang dan dimuat saat diminta. */}
                {Math.abs(row.saldoAkhir - totalBelumLunas) >= 1 && (
                  <RincianSelisih
                    key={`${row.agenId}|${row.saldoAkhir}|${totalBelumLunas}`}
                    selisih={row.saldoAkhir - totalBelumLunas}
                    totalBelumLunas={totalBelumLunas}
                    sisaHutang={row.saldoAkhir}
                    muat={() => fetchKomponenSelisih(row.agenId)}
                  />
                )}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed px-2.5 py-2 text-[11px] text-muted-foreground">
                Tidak ada pemesanan yang belum lunas.
                {row.saldoAkhir > 0 && " Sisa hutangnya tidak terikat ke pesanan tertentu (mis. tarikan tabungan)."}
              </p>
            )}
          </div>
        )}
        {!belumLunas && row.transaksi.length === 0 && row.saldoAkhir > 0 && (
          // Periode terpilih tanpa transaksi sama sekali, padahal masih ada
          // hutang: hutangnya dari periode sebelumnya — beri tahu caranya
          // melihat rincian, alih-alih kartu yang tampak kosong.
          // Ringkas: satu kalimat + tautan; penjelasan lengkap di petunjuk ikon ⓘ.
          <div
            className="-mx-2 flex items-start gap-2 rounded-lg border border-dashed bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground"
            data-capture-hide="true"
          >
            <Petunjuk
              render={<span className="mt-0.5 shrink-0 cursor-help" />}
              judul="Hutang dari periode sebelumnya"
              isi="Mundurkan Tanggal Awal untuk melihat rinciannya, atau tampilkan semua pesanan yang belum lunas."
            >
              <Info className="size-3.5" />
            </Petunjuk>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p>Tidak ada transaksi di {periodeLabel}; hutang dari periode lalu.</p>
              <button
                type="button"
                onClick={onLihatBelumLunas}
                className="w-fit font-medium text-primary hover:underline"
              >
                Lihat pesanan belum lunas →
              </button>
            </div>
          </div>
        )}
        {!belumLunas && row.transaksi.length > 0 && (
          // -mx-4 cancels CardContent's own px-4 so these boxes sit snug
          // against the card's edge, then px-2 re-adds just enough inset to
          // avoid touching the border outright.
          <div className="-mx-4 border-t px-2 pt-2">
            <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
              <p className="min-w-0 truncate whitespace-nowrap text-[10px] font-semibold uppercase text-muted-foreground">
                {pesananItems.length} Pemesanan · {pembayaranCount} Pembayaran
              </p>
              <p className="shrink-0 text-muted-foreground">{periodeLabel}</p>
            </div>
            <div className="flex flex-col gap-1">
              {visibleTransaksi.map((item, i) => (
                <TransaksiRow
                  key={`${item.noDokumen}-${item.tipe}-${i}`}
                  item={item}
                  terbuka={bacaTerbuka(terbukaDokumen[`${row.agenId}|${item.noDokumen}`])}
                />
              ))}
            </div>
          </div>
        )}
        {hasMore && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center justify-center gap-1 pt-0.5 text-[11px] text-muted-foreground hover:text-foreground"
            data-capture-hide="true"
          >
            {expanded
              ? "Sembunyikan"
              : `+${jumlahDaftar - COLLAPSED_PREVIEW_COUNT} ${belumLunas ? "pesanan" : "transaksi"} lainnya`}
            <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
          </button>
        )}

        <div className="-mx-2 rounded-lg border px-2.5 py-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-semibold">
              <Package className="size-3.5 text-primary" />
              Total Pemesanan
            </span>
            <span className="font-data text-sm font-semibold tabular-nums">{formatRupiah(row.pesanan)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <div className="flex flex-1 items-center justify-between rounded border bg-muted/40 px-2.5 py-1.5">
              <span className="font-semibold tabular-nums">{totalKecil.toLocaleString("id-ID")}</span>
              <span className="text-[10px] text-muted-foreground">Es Balok Kecil</span>
            </div>
            <div className="flex flex-1 items-center justify-between rounded border bg-muted/40 px-2.5 py-1.5">
              <span className="font-semibold tabular-nums">{totalBesar.toLocaleString("id-ID")}</span>
              <span className="text-[10px] text-muted-foreground">Es Balok Besar</span>
            </div>
          </div>
          <div className="-mx-2.5 mt-2 grid grid-cols-2 divide-x border-t pt-1.5">
            <div className="flex items-center gap-1 pl-2.5">
              <span className="text-muted-foreground">Terbayar</span>
              <span className="font-semibold text-primary">{formatRupiah(row.pembayaran)}</span>
            </div>
            <div className="flex items-center justify-between gap-1 pl-2.5 pr-2.5">
              <span className="text-muted-foreground">Tarikan</span>
              <span className="font-semibold text-foreground">{formatRupiah(row.tarikan)}</span>
            </div>
          </div>
        </div>

        <div
          className={cn(
            // Card itself carries no bottom padding (pb-0, see its own
            // className) specifically so this bar can reach the card's
            // bottom edge without a negative-margin bleed -- html-to-image's
            // cloned-node export doesn't reliably reproduce negative-margin
            // overlap into a padding area, so the padding is removed at the
            // source instead. rounded-b-xl matches Card's own corner radius
            // since the bar now touches that edge.
            "-mx-4 flex items-center justify-between gap-2 rounded-b-xl px-4 py-2.5",
            row.saldoAkhir >= 0 ? "bg-destructive/10" : "bg-primary/10"
          )}
        >
          <div className="flex flex-wrap items-baseline gap-1.5">
            <span className={cn("size-1.5 shrink-0 self-center rounded-full", row.saldoAkhir >= 0 ? "bg-destructive" : "bg-primary")} />
            <span className={cn("text-[11px] font-semibold uppercase", row.saldoAkhir >= 0 ? "text-destructive" : "text-primary")}>
              {row.saldoAkhir >= 0 ? "Sisa Hutang" : "Tabungan"}
            </span>
            <span className={cn("font-data text-sm font-bold tabular-nums", row.saldoAkhir >= 0 ? "text-destructive" : "text-primary")}>
              {formatRupiah(Math.abs(row.saldoAkhir))}
            </span>
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="h-7 shrink-0 gap-1 bg-background px-2.5 text-[11px] text-foreground hover:bg-background/90"
            data-capture-hide="true"
            onClick={() => setBayarOpen(true)}
          >
            {row.saldoAkhir < 0 ? <Banknote className="size-3" /> : <CreditCard className="size-3" />}
            {row.saldoAkhir < 0 ? "Tarik" : "Bayar"}
          </Button>
        </div>
      </CardContent>
      </Card>
    </div>

    <PiutangBayarDialog
      open={bayarOpen}
      onOpenChange={setBayarOpen}
      mode={row.saldoAkhir < 0 ? "tarik" : "bayar"}
      agenNama={row.nama}
      fetchContext={async () => {
        if (row.saldoAkhir < 0) {
          const c = await fetchTarikContext(row.agenId);
          return { capacityUtama: c.tabunganUtama, capacityLogistik: c.tabunganLogistik, kasBankUtama: c.kasBankUtama, kasBankLogistik: c.kasBankLogistik };
        }
        const c = await fetchBayarContext(row.agenId);
        return { capacityUtama: c.hutangUtama, capacityLogistik: c.hutangLogistik, kasBankUtama: c.kasBankUtama, kasBankLogistik: c.kasBankLogistik };
      }}
      onSubmit={(jumlah, kasBank, catatan) =>
        row.saldoAkhir < 0
          ? submitTarik(row.agenId, jumlah, kasBank, catatan)
          : submitBayar(row.agenId, jumlah, kasBank, catatan)
      }
    />
    </>
  );
}

// Per-Agen breakdown matching the "Rekening Agen Gabungan" ERP export
// (Tabungan Awal / Hutang Awal / Pesanan / Retur / Pembayaran / Tarikan /
// Saldo Akhir per Agen), with a caller-adjustable date range -- same
// card-based search/sort/pagination/export pattern as MKEsindo's own
// aging-table.tsx. Loads its own data via a Server Action rather than
// through the page's server-side fetch, since the date range is
// client-adjustable after first load.
export function PiutangPerAgenTable({
  initialRows,
  initialTerbuka,
  awalISO,
  akhirISO,
  fetchTerbuka,
  fetchKomponenSelisih,
  fetchAction,
  fetchBayarContext,
  submitBayar,
  fetchTarikContext,
  submitTarik,
}: {
  initialRows: PiutangPerAgenRow[];
  // Sisa piutang terbuka per pesanan (FIFO) — sumber status Sehat/Perhatian/
  // Kritis per Agen dan indikator umur per transaksi. Tidak bergantung pada
  // rentang tanggal; dimuat ulang hanya setelah Bayar/Tarik.
  initialTerbuka: RingkasanPiutangTerbuka;
  // Periode yang dipakai server untuk initialRows (WIB, inklusif) — isian
  // tanggal diawali dari sini supaya selalu cocok dengan data awal.
  awalISO: string;
  akhirISO: string;
  fetchTerbuka: () => Promise<RingkasanPiutangTerbuka>;
  // Asal selisih Sisa Hutang vs pesanan belum lunas untuk satu Agen, dihitung
  // sampai tanggal akhir periode yang sedang diterapkan.
  fetchKomponenSelisih: (agenId: string, endDate: string) => Promise<KomponenSelisih[]>;
  fetchAction: (startDate: string, endDate: string) => Promise<PiutangPerAgenRow[]>;
  fetchBayarContext: (agenId: string) => Promise<PiutangBayarContext>;
  submitBayar: (
    agenId: string,
    jumlah: number,
    kasBank: { utama?: string; logistik?: string },
    catatan: string | null
  ) => Promise<BayarPiutangResult[]>;
  fetchTarikContext: (agenId: string) => Promise<PiutangTarikContext>;
  submitTarik: (
    agenId: string,
    jumlah: number,
    kasBank: { utama?: string; logistik?: string },
    catatan: string | null
  ) => Promise<BayarPiutangResult[]>;
}) {
  const [startDate, setStartDate] = useState(awalISO);
  const [endDate, setEndDate] = useState(akhirISO);
  const panelAlatRef = useRef<HTMLDivElement>(null);
  const [filterHpBuka, setFilterHpBuka] = useState(false);
  usePanelMenempel(panelAlatRef);
  const [rows, setRows] = useState(initialRows);
  // Tanggal akhir yang benar-benar dipakai data `rows` (bukan isian yang
  // mungkin sudah diubah tetapi belum diterapkan).
  const [akhirDiterapkan, setAkhirDiterapkan] = useState(endDate);
  const [terbuka, setTerbuka] = useState(initialTerbuka);
  const [lastUpdated, setLastUpdated] = useState(() => new Date());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [statusPiutang, setStatusPiutang] = useState<StatusPiutangFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("SaldoAkhir");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  // Mode "Semua belum lunas": tiap kartu menampilkan pesanan terbuka dari
  // SEMUA periode (bukan hanya rentang tanggal), dan hanya Agen yang masih
  // punya pesanan belum lunas yang ditampilkan.
  // Bawaan NYALA — kartu langsung menunjukkan pesanan yang masih terbuka,
  // tidak tampak kosong untuk Agen yang tak bertransaksi di periode ini.
  const [semuaBelumLunas, setSemuaBelumLunas] = useState(true);
  // Denyut (pulse) di sakelar sampai pengguna menyentuhnya sekali, supaya
  // fitur ini terlihat dan dicoba.
  const [sakelarDisentuh, setSakelarDisentuh] = useState(false);
  const [segmentasi, setSegmentasi] = useState<string>("all");

  // Pesanan terbuka per Agen dari ringkasan FIFO (sudah lintas periode),
  // diurutkan dari yang terlama.
  const belumLunasPerAgen = useMemo(() => {
    const peta = new Map<string, PesananBelumLunas[]>();
    for (const [kunci, nilai] of Object.entries(terbuka.dokumen)) {
      const pisah = kunci.indexOf("|");
      const agenId = kunci.slice(0, pisah);
      const daftar = peta.get(agenId) ?? [];
      daftar.push({ noDokumen: kunci.slice(pisah + 1), tanggal: nilai[2] ?? null, terbuka: { outstanding: nilai[0], maxDaysOverdue: nilai[1] } });
      peta.set(agenId, daftar);
    }
    for (const daftar of peta.values()) daftar.sort((a, b) => (a.tanggal ?? "").localeCompare(b.tanggal ?? ""));
    return peta;
  }, [terbuka]);

  function applyRange() {
    setError(null);
    startTransition(async () => {
      try {
        setRows(await fetchAction(startDate, endDate));
        setAkhirDiterapkan(endDate);
        setLastUpdated(new Date());
        setPage(1);
      } catch {
        setError("Gagal memuat data periode ini.");
      }
    });
  }

  // Refreshes the whole list after a successful payment -- Saldo Akhir and
  // the transaction list both change for the affected Agen, and re-running
  // the same fetchAction (current date range) is simpler than patching one
  // row's derived fields client-side.
  async function handleBayar(
    agenId: string,
    jumlah: number,
    kasBank: { utama?: string; logistik?: string },
    catatan: string | null
  ) {
    const results = await submitBayar(agenId, jumlah, kasBank, catatan);
    const [nextRows, nextTerbuka] = await Promise.all([fetchAction(startDate, endDate), fetchTerbuka()]);
    setRows(nextRows);
    setTerbuka(nextTerbuka);
    setLastUpdated(new Date());
    return results;
  }

  // Mirrors handleBayar for a Tabungan withdrawal -- same full-refresh
  // rationale (Saldo Akhir and the transaction list both change).
  async function handleTarik(
    agenId: string,
    jumlah: number,
    kasBank: { utama?: string; logistik?: string },
    catatan: string | null
  ) {
    const results = await submitTarik(agenId, jumlah, kasBank, catatan);
    const [nextRows, nextTerbuka] = await Promise.all([fetchAction(startDate, endDate), fetchTerbuka()]);
    setRows(nextRows);
    setTerbuka(nextTerbuka);
    setLastUpdated(new Date());
    return results;
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  // Status kesehatan piutang per Agen — aturan yang sama dengan chip di kartu.
  const statusPiutangOf = useCallback(
    (agenId: string): EsBalokPiutangStatus => {
      const t = terbuka.agen[agenId];
      return esBalokStatus(t ? t[1] : null);
    },
    [terbuka]
  );

  const filtered = useMemo(() => {
    let result = rows.filter((r) => {
      if (segmentasi === "none" ? r.segmentasi != null : segmentasi !== "all" && r.segmentasi !== segmentasi) return false;
      if (status !== "all" && statusOf(r) !== status) return false;
      if (statusPiutang !== "all" && statusPiutangOf(r.agenId) !== statusPiutang) return false;
      if (semuaBelumLunas && !belumLunasPerAgen.has(r.agenId)) return false;
      if (search && !r.nama.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    result = [...result].sort((a, b) => {
      if (sortKey === "Nama") return dir * a.nama.localeCompare(b.nama);
      if (sortKey === "Pesanan") return dir * (a.pesanan - b.pesanan);
      return dir * (a.saldoAkhir - b.saldoAkhir);
    });
    return result;
  }, [rows, search, segmentasi, status, statusPiutang, statusPiutangOf, sortKey, sortDir, semuaBelumLunas, belumLunasPerAgen]);

  const filterKey = `${search}|${segmentasi}|${status}|${statusPiutang}|${semuaBelumLunas}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const periodeLabel = formatPeriodeLabel(startDate, endDate);

  const exportRows = useMemo(
    () =>
      filtered.map((r) => {
        const t = terbuka.agen[r.agenId];
        return {
          nama: r.nama,
          tabunganAwal: r.tabunganAwal,
          hutangAwal: r.hutangAwal,
          pesanan: r.pesanan,
          retur: r.retur,
          pembayaran: r.pembayaran,
          tarikan: r.tarikan,
          saldoAkhir: r.saldoAkhir,
          statusPiutang: statusPiutangOf(r.agenId),
          piutangTerbuka: t ? t[0] : null,
          usiaTerlama: t ? Math.max(0, t[1] + ES_BALOK_JATUH_TEMPO_HARI) : null,
          lewatJatuhTempo: t ? Math.max(0, t[1]) : null,
        };
      }),
    [filtered, terbuka, statusPiutangOf]
  );

  const jumlahFilterAktif = [segmentasi !== "all", status !== "all", statusPiutang !== "all"].filter(Boolean).length;

  function pilihSegmentasi(kelas?: string) {
    return (
      <Select value={segmentasi} onValueChange={(v) => setSegmentasi(v ?? "all")}>
        <SelectTrigger aria-label="Segmentasi" className={kelas}>
          <SelectValue>
            {() =>
              segmentasi === "all"
                ? "Semua Segmentasi"
                : segmentasi === "none"
                  ? "Belum Ditentukan"
                  : (SEGMENTASI_OPTIONS.find((o) => o.value === segmentasi)?.label ?? "Segmentasi")
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="w-auto min-w-(--anchor-width)">
          <SelectItem value="all">Semua Segmentasi</SelectItem>
          {SEGMENTASI_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
          <SelectItem value="none">Belum Ditentukan</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  function pilihJenis(kelas?: string) {
    return (
      <Select value={status} onValueChange={(v) => setStatus((v as StatusFilter) ?? "all")}>
        <SelectTrigger aria-label="Jenis" className={kelas}>
          <SelectValue>
            {() => (status === "all" ? "Semua Jenis" : status === "hutang" ? "Hutang" : status === "tabungan" ? "Tabungan" : "Lunas")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="w-auto min-w-(--anchor-width)">
          <SelectItem value="all">Semua Jenis</SelectItem>
          <SelectItem value="hutang">Hutang</SelectItem>
          <SelectItem value="tabungan">Tabungan</SelectItem>
          <SelectItem value="lunas">Lunas</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  function pilihStatus(kelas?: string) {
    return (
      <Select value={statusPiutang} onValueChange={(v) => setStatusPiutang((v as StatusPiutangFilter) ?? "all")}>
        <SelectTrigger aria-label="Status" className={kelas}>
          <SelectValue>{() => (statusPiutang === "all" ? "Semua Status" : statusPiutang)}</SelectValue>
        </SelectTrigger>
        <SelectContent className="w-auto min-w-(--anchor-width)">
          <SelectItem value="all">Semua Status</SelectItem>
          <SelectItem value="Sehat">Sehat</SelectItem>
          <SelectItem value="Perhatian">Perhatian</SelectItem>
          <SelectItem value="Kritis">Kritis</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Satu panel alat, dua baris:
          1) cari + filter jenis/status | rentang tanggal + Terapkan
          2) sakelar Semua belum lunas + jumlah | urutan + ekspor */}
      <div
        ref={panelAlatRef}
        className="sticky top-3 z-[25] flex flex-col gap-2.5 rounded-xl border bg-card p-3 shadow-xs transition-[margin,box-shadow] duration-200 before:pointer-events-none before:absolute before:-inset-x-4 before:-top-4 before:-bottom-2 before:-z-10 before:hidden before:bg-background before:content-[''] data-menempel:ml-(--ruang-tombol) data-menempel:shadow-md data-menempel:before:block data-menempel:before:-left-[calc(1rem+var(--ruang-tombol))]"
      >
        <div className="flex items-center gap-2 sm:flex-wrap">
          <div className="relative min-w-0 flex-1 sm:min-w-48 sm:max-w-72">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Cari nama Mitra..."
              aria-label="Cari nama Mitra"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>

          {/* HP: filter & urutan diringkas ke dua ikon (popup), supaya panel
              yang menempel tetap pendek. Layar sm+: semua isian tampil. */}
          <Popover open={filterHpBuka} onOpenChange={setFilterHpBuka}>
            <PopoverTrigger
              render={
                <Button variant="outline" size="icon" className="relative size-8 shrink-0 sm:hidden" aria-label="Filter" title="Filter" />
              }
            >
              <SlidersHorizontal className="size-4" />
              {jumlahFilterAktif > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                  {jumlahFilterAktif}
                </span>
              )}
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[min(18rem,calc(100vw-2rem))]">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Segmentasi</span>
                  {pilihSegmentasi("w-full")}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Jenis</span>
                  {pilihJenis("w-full")}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Status</span>
                  {pilihStatus("w-full")}
                </div>
                <div className="grid grid-cols-2 gap-2 border-t pt-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Tanggal awal</span>
                    <Input type="date" aria-label="Tanggal Awal" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Tanggal akhir</span>
                    <Input type="date" aria-label="Tanggal Akhir" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  </div>
                </div>
                <Button
                  onClick={() => {
                    applyRange();
                    setFilterHpBuka(false);
                  }}
                  disabled={pending}
                >
                  {pending ? "Memuat..." : "Terapkan tanggal"}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger
              render={
                <Button variant="outline" size="icon" className="size-8 shrink-0 sm:hidden" aria-label="Urutkan" title="Urutkan" />
              }
            >
              <ArrowUpDown className="size-4" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56">
              <div className="flex flex-col gap-2">
                <span className="text-xs text-muted-foreground">Urutkan menurut</span>
                <div className="flex flex-col gap-0.5">
                  <SortToggle label="Saldo Akhir" sortKey="SaldoAkhir" active={sortKey === "SaldoAkhir"} direction={sortDir} onSort={handleSort} penuh />
                  <SortToggle label="Pesanan" sortKey="Pesanan" active={sortKey === "Pesanan"} direction={sortDir} onSort={handleSort} penuh />
                  <SortToggle label="Nama" sortKey="Nama" active={sortKey === "Nama"} direction={sortDir} onSort={handleSort} penuh />
                </div>
                <div className="border-t pt-2">
                  <ExportXlsxButton filename="rekening-mitra-gabungan" sheetName="Rekening Mitra" columns={EXPORT_COLUMNS} rows={exportRows} />
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <div className="hidden flex-wrap items-center gap-2 sm:flex">
            {pilihSegmentasi()}
            {pilihJenis()}
            {pilihStatus()}
          </div>

          <div className="hidden flex-wrap items-center gap-2 sm:flex lg:ml-auto">
            {/* Rentang tanggal sebagai satu kotak "awal – akhir". */}
            <div className="flex h-8 items-center rounded-lg border border-input bg-background dark:bg-input/30">
              <Input
                id="piutang-start"
                type="date"
                aria-label="Tanggal Awal"
                title="Tanggal Awal"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-full w-[8.5rem] border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
              />
              <span className="px-0.5 text-muted-foreground">–</span>
              <Input
                id="piutang-end"
                type="date"
                aria-label="Tanggal Akhir"
                title="Tanggal Akhir"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-full w-[8.5rem] border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
              />
            </div>
            <Button onClick={applyRange} disabled={pending}>
              {pending ? "Memuat..." : "Terapkan"}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-2.5">
          {/* Sakelar (switch), bukan tombol biasa: statusnya nyala/mati jelas
              terlihat dari posisi kenop. */}
          <button
            type="button"
            role="switch"
            aria-checked={semuaBelumLunas}
            onClick={() => {
              setSemuaBelumLunas((v) => !v);
              setSakelarDisentuh(true);
            }}
            className="group/sakelar inline-flex items-center gap-2 rounded-md text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span
              aria-hidden
              className={cn(
                "relative h-4 w-7 shrink-0 rounded-full transition-colors",
                // Cincin denyut di belakang track (motion-safe) sampai disentuh.
                !sakelarDisentuh &&
                  "motion-safe:before:absolute motion-safe:before:inset-0 motion-safe:before:animate-ping motion-safe:before:rounded-full motion-safe:before:bg-primary/40 motion-safe:before:content-['']",
                semuaBelumLunas ? "bg-primary" : "bg-muted-foreground/30 group-hover/sakelar:bg-muted-foreground/45"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 left-0.5 size-3 rounded-full bg-white shadow-sm transition-transform duration-200",
                  semuaBelumLunas && "translate-x-3"
                )}
              />
            </span>
            <span className={semuaBelumLunas ? "font-medium text-foreground" : "text-muted-foreground group-hover/sakelar:text-foreground"}>
              Semua belum lunas
            </span>
          </button>
          <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />
          <p className="ml-auto text-xs text-muted-foreground sm:ml-0">
            {pageRows.length} dari {filtered.length} Mitra
          </p>

          <div className="hidden flex-wrap items-center gap-2 sm:ml-auto sm:flex">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Urutkan</span>
              <div className="flex items-center gap-0.5 rounded-lg border p-0.5">
                <SortToggle label="Saldo Akhir" sortKey="SaldoAkhir" active={sortKey === "SaldoAkhir"} direction={sortDir} onSort={handleSort} />
                <SortToggle label="Pesanan" sortKey="Pesanan" active={sortKey === "Pesanan"} direction={sortDir} onSort={handleSort} />
                <SortToggle label="Nama" sortKey="Nama" active={sortKey === "Nama"} direction={sortDir} onSort={handleSort} />
              </div>
            </div>
            <ExportXlsxButton filename="rekening-mitra-gabungan" sheetName="Rekening Mitra" columns={EXPORT_COLUMNS} rows={exportRows} />
          </div>
        </div>
      </div>
      {semuaBelumLunas && (
        <p className="text-xs text-muted-foreground">
          Menampilkan semua pemesanan yang belum lunas dari periode mana pun (pesanan terlama dulu). Angka ringkasan di
          kartu tetap mengikuti periode {periodeLabel}.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {pageRows.map((r) => (
          <AgenCard
            key={r.agenId}
            row={r}
            terbukaAgen={bacaTerbuka(terbuka.agen[r.agenId])}
            terbukaDokumen={terbuka.dokumen}
            periodeLabel={periodeLabel}
            lastUpdated={lastUpdated}
            belumLunas={semuaBelumLunas ? (belumLunasPerAgen.get(r.agenId) ?? []) : null}
            onLihatBelumLunas={() => setSemuaBelumLunas(true)}
            fetchKomponenSelisih={(agenId) => fetchKomponenSelisih(agenId, akhirDiterapkan)}
            fetchBayarContext={fetchBayarContext}
            submitBayar={handleBayar}
            fetchTarikContext={fetchTarikContext}
            submitTarik={handleTarik}
          />
        ))}
        {pageRows.length === 0 && <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Tidak ada data.</p>}
      </div>

      <Pagination page={page} pageCount={pageCount} onChange={setPage} />
    </div>
  );
}
