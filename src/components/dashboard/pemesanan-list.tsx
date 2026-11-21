"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, Truck } from "lucide-react";
import { formatDateWib, formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SalesOrderListRow } from "@/lib/queries/pemesanan";
import type { ArmadaRow } from "@/lib/queries/armada";
import type { DriverOption } from "@/lib/queries/delivery";
import { UbahPemesananDialog, type UbahPemesananTarget } from "@/components/dashboard/ubah-pemesanan-dialog";
import {
  UbahTanggalPemesananDialog,
  type UbahTanggalPemesananTarget,
} from "@/components/dashboard/ubah-tanggal-pemesanan-dialog";
import { SalesReturnDetailDialog } from "@/components/dashboard/sales-return-detail-dialog";
import { PemesananAksi, type PemesananAksiHandlers } from "@/components/dashboard/pemesanan-aksi";
import {
  NomorCocok,
  PemesananPapan,
  SorotSo,
  TahapBadge,
  infoPengiriman,
  labelRetur,
  tahapPesanan,
  tanggalISO,
} from "@/components/dashboard/pemesanan-papan";
import { SiPreviewDialog, type SiPreviewTarget } from "@/components/dashboard/si-preview-dialog";
import { useTampilanPemesanan } from "@/components/dashboard/pemesanan-tampilan";
import { useKueriPemesanan } from "@/components/dashboard/pemesanan-cari";
import { cocokkanPesanan, parseKueriPemesanan, type KodeDokumen } from "@/lib/pencarian-pemesanan";
import { cariPemesananDokumenAction } from "@/app/mkesindo/(dashboard)/pemesanan/actions";

// Kolom bersama kepala tabel & baris (layar lebar); di HP tiap baris jadi
// kartu bertumpuk. Tahap memakai lencana yang sama dengan kolom Papan.
const KOLOM_DAFTAR =
  "md:grid md:grid-cols-[minmax(0,2.2fr)_150px_minmax(0,1fr)_minmax(0,1.6fr)_130px_auto] md:items-center md:gap-4";

function KepalaDaftar() {
  return (
    <div
      className={cn(
        "hidden border-b bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
        KOLOM_DAFTAR
      )}
    >
      <span>Pesanan</span>
      <span>Tahap</span>
      <span>Qty</span>
      <span>Pengiriman</span>
      <span className="text-right">Nominal</span>
      <span className="w-[4.5rem]" />
    </div>
  );
}

function PemesananRow({
  row,
  terlambat,
  aksi,
  cocok,
}: {
  row: SalesOrderListRow;
  terlambat: boolean;
  aksi: PemesananAksiHandlers;
  cocok?: KodeDokumen[];
}) {
  const kirim = infoPengiriman(row);
  return (
    <div className={cn("flex flex-col gap-2 px-3 py-2.5 text-sm hover:bg-muted/30", KOLOM_DAFTAR)}>
      {/* Pesanan */}
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2 md:block">
          <p className="truncate font-medium" title={row.CustomerName}>
            {row.CustomerName}
          </p>
          <p className="shrink-0 font-display text-sm font-semibold tabular-nums md:hidden">{formatRupiah(row.Amount)}</p>
        </div>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <SorotSo row={row} cocok={cocok} />
          <span>&middot;</span>
          <span>{formatDateWib(row.TransDate)}</span>
          {terlambat && (
            <span
              className="rounded bg-destructive/15 px-1.5 py-px text-[10px] font-medium text-destructive"
              title="Usang: tanggal pesanan sudah lewat, tetapi belum dikirim"
            >
              Usang
            </span>
          )}
          <span>&middot;</span>
          <span>{row.Wilayah}</span>
        </p>
        <NomorCocok row={row} cocok={cocok} />
      </div>

      {/* Tahap */}
      <div className="flex flex-wrap items-center gap-1">
        <TahapBadge row={row} />
        {row.SalesReturnId && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-medium",
              row.InvoiceToken ? "bg-warning/15 text-warning" : "bg-destructive/15 text-destructive"
            )}
            title={row.InvoiceToken ? "Sebagian barang dikembalikan; sisanya tetap ditagih" : "Semua barang dikembalikan; tidak ada tagihan"}
          >
            {labelRetur(row)}
          </span>
        )}
      </div>

      {/* Qty */}
      <div className="flex flex-wrap gap-1">
        {row.Qty10KG > 0 && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            10KG <span className="font-semibold text-foreground">{row.Qty10KG.toLocaleString("id-ID")}</span>
          </span>
        )}
        {row.Qty5KG > 0 && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            5KG <span className="font-semibold text-foreground">{row.Qty5KG.toLocaleString("id-ID")}</span>
          </span>
        )}
        {row.Qty10KG === 0 && row.Qty5KG === 0 && <span className="text-xs text-muted-foreground">-</span>}
      </div>

      {/* Pengiriman — dari jadwal Papan Pengiriman dashboard, atau dari DO
          itu sendiri bila DO dibuat tanpa jadwal (lihat infoPengiriman). */}
      <div className="min-w-0 text-xs text-muted-foreground" title={kirim?.judul ?? undefined}>
        {kirim ? (
          <>
            <p className="flex min-w-0 items-center gap-1">
              <Truck className="size-3 shrink-0" />
              <span className="truncate">{kirim.utama}</span>
            </p>
            {kirim.waktu && <p className="tabular-nums">{kirim.waktu}</p>}
          </>
        ) : (
          <span>Belum ada pengiriman</span>
        )}
      </div>

      {/* Nominal (layar lebar; di HP sudah tampil di samping nama) */}
      <p className="hidden text-right font-display text-sm font-semibold tabular-nums md:block">{formatRupiah(row.Amount)}</p>

      <div className="flex justify-end border-t pt-1.5 md:border-0 md:pt-0">
        <PemesananAksi row={row} {...aksi} />
      </div>
    </div>
  );
}

// Hasil pencarian nomor dokumen ke server — disimpan bersama kata kuncinya,
// jadi "sedang memuat" cukup diturunkan (kunci hasil ≠ kunci sekarang) tanpa
// setState di dalam effect.
interface HasilCariServer {
  kunci: string;
  rows: SalesOrderListRow[];
  error: string | null;
}

export function PemesananList({
  rows,
  armadaList,
  drivers,
  todayISO,
}: {
  rows: SalesOrderListRow[];
  armadaList: ArmadaRow[];
  drivers: DriverOption[];
  todayISO: string;
}) {
  const router = useRouter();
  const tampilan = useTampilanPemesanan();
  const [editingTarget, setEditingTarget] = useState<UbahPemesananTarget | null>(null);
  const [editingTransDateTarget, setEditingTransDateTarget] = useState<UbahTanggalPemesananTarget | null>(null);
  const [openSalesReturnId, setOpenSalesReturnId] = useState<string | null>(null);
  const [siPreview, setSiPreview] = useState<SiPreviewTarget | null>(null);

  // Pencarian: nama mitra & nomor tanpa periode disaring dari data yang
  // tampil; nomor berperiode dicari ke server di semua tanggal (lihat
  // lib/pencarian-pemesanan.ts).
  const teksCari = useKueriPemesanan();
  const kueri = useMemo(() => parseKueriPemesanan(teksCari), [teksCari]);
  const kunciServer = kueri.jenis === "dokumen" && kueri.periode ? teksCari.trim() : null;
  const [hasilServer, setHasilServer] = useState<HasilCariServer | null>(null);
  useEffect(() => {
    if (!kunciServer) return;
    let batal = false;
    const t = setTimeout(async () => {
      const res = await cariPemesananDokumenAction(kunciServer).catch(() => null);
      if (batal) return;
      setHasilServer(
        res?.success
          ? { kunci: kunciServer, rows: res.data, error: null }
          : { kunci: kunciServer, rows: [], error: res && !res.success ? res.error : "Gagal mencari dokumen." }
      );
    }, 400);
    return () => {
      batal = true;
      clearTimeout(t);
    };
  }, [kunciServer]);
  const hasilSiap = kunciServer != null && hasilServer?.kunci === kunciServer ? hasilServer : null;
  const memuatServer = kunciServer != null && !hasilSiap;

  const { tampilRows, cocokPer } = useMemo(() => {
    const sumber = kunciServer ? (hasilSiap?.rows ?? []) : rows;
    const cocokPer = new Map<string, KodeDokumen[]>();
    const tampilRows = sumber.filter((r) => {
      const c = cocokkanPesanan(r, kueri);
      if (c) cocokPer.set(r.SalesOrderID, c);
      return c != null;
    });
    return { tampilRows, cocokPer };
  }, [rows, kueri, kunciServer, hasilSiap]);
  const mencari = kueri.jenis !== "kosong";

  function aksiFor(r: SalesOrderListRow): PemesananAksiHandlers {
    return {
      onEdit: () =>
        setEditingTarget({
          salesOrderId: r.SalesOrderID,
          customerName: r.CustomerName,
          wilayah: r.Wilayah,
          qty: r.Qty,
          qty10KG: r.Qty10KG,
          qty5KG: r.Qty5KG,
        }),
      onEditTransDate: () =>
        setEditingTransDateTarget({
          salesOrderId: r.SalesOrderID,
          customerName: r.CustomerName,
          voucherNo: r.VoucherNo,
          transDate: r.TransDate,
        }),
      onOpenSr: () => setOpenSalesReturnId(r.SalesReturnId),
      onOpenSi: () => r.InvoiceToken && setSiPreview({ token: r.InvoiceToken, customerName: r.CustomerName, voucherNo: r.VoucherNo }),
      onDeleted: () => {
        setHasilServer(null);
        router.refresh();
      },
    };
  }

  return (
    <>
      {mencari && (
        <InfoPencarian
          teks={teksCari}
          jumlah={tampilRows.length}
          semuaTanggal={kunciServer != null}
          memuat={memuatServer}
          error={hasilSiap?.error ?? null}
        />
      )}
      {tampilan === "papan" ? (
        <PemesananPapan rows={tampilRows} todayISO={todayISO} aksiFor={aksiFor} cocokPer={cocokPer} adaInfo={mencari} />
      ) : (
        <div className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
          <KepalaDaftar />
          {tampilRows.map((r) => {
            const t = tahapPesanan(r);
            return (
              <PemesananRow
                key={r.SalesOrderID}
                row={r}
                terlambat={(t === "belum" || t === "dijadwalkan") && tanggalISO(r.TransDate) < todayISO}
                aksi={aksiFor(r)}
                cocok={cocokPer.get(r.SalesOrderID)}
              />
            );
          })}
          {tampilRows.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {memuatServer
                ? "Mencari dokumen..."
                : mencari
                  ? "Tidak ada pesanan yang cocok."
                  : "Tidak ada Sales Order pada rentang ini."}
            </p>
          )}
        </div>
      )}

      <UbahPemesananDialog
        target={editingTarget}
        onOpenChange={(open) => !open && setEditingTarget(null)}
        armadaList={armadaList}
        drivers={drivers}
      />
      <UbahTanggalPemesananDialog
        target={editingTransDateTarget}
        onOpenChange={(open) => !open && setEditingTransDateTarget(null)}
      />
      <SalesReturnDetailDialog
        salesReturnId={openSalesReturnId}
        onOpenChange={(open) => !open && setOpenSalesReturnId(null)}
      />
      <SiPreviewDialog target={siPreview} onOpenChange={(open) => !open && setSiPreview(null)} />
    </>
  );
}

// Satu baris keterangan di atas hasil saat kotak pencarian terisi.
function InfoPencarian({
  teks,
  jumlah,
  semuaTanggal,
  memuat,
  error,
}: {
  teks: string;
  jumlah: number;
  semuaTanggal: boolean;
  memuat: boolean;
  error: string | null;
}) {
  return (
    <p className="-mt-2 flex h-5 min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      {memuat ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <Search className="size-3.5 shrink-0" />}
      <span className="truncate">
        {memuat ? (
          <>Mencari &ldquo;{teks.trim()}&rdquo; di semua tanggal...</>
        ) : error ? (
          <span className="text-destructive">{error}</span>
        ) : (
          <>
            <span className="font-medium text-foreground">{jumlah.toLocaleString("id-ID")}</span>
            {" pesanan cocok dengan "}&ldquo;{teks.trim()}&rdquo;
            {semuaTanggal ? " — semua tanggal & wilayah (filter diabaikan)" : " — dalam filter tanggal & wilayah"}
          </>
        )}
      </span>
    </p>
  );
}
