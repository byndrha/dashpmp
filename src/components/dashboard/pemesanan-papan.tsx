"use client";

// Tampilan Papan (kanban) /mkesindo/pemesanan: setiap Sales Order sebagai
// kartu di kolom tahap prosesnya. Tahap DITURUNKAN dari dokumen ERP yang
// sudah ada (status Jadwal, DO, SI) — tidak ada status manual, dan kartu
// sengaja TIDAK bisa digeser: memindah tahap berarti membuat dokumen ERP
// (jadwal/DO/SI), jadi tetap lewat aksi & Papan Pengiriman yang sudah ada.
import { useState } from "react";
import { CircleDashed, CalendarClock, Truck, ReceiptText, FileText, CalendarDays, MapPin, Undo2, type LucideIcon } from "lucide-react";
import { formatDate, formatDateWib, formatRupiah, formatTime, formatTimeWib } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SalesOrderListRow } from "@/lib/queries/pemesanan";
import { PemesananAksi, type PemesananAksiHandlers } from "@/components/dashboard/pemesanan-aksi";
import { nomorPerKode, type KodeDokumen } from "@/lib/pencarian-pemesanan";

export type TahapKey = "belum" | "dijadwalkan" | "dikirim" | "terfaktur" | "retur";

interface TandaDokumen {
  kode: "SO" | "DO" | "SI" | "SR";
  // ok = dokumen sudah ada (centang hijau); tanya = belum pasti (tanda tanya
  // oranye): SO di Belum Dijadwalkan (menunggu jadwal), dan SI di Retur (ada
  // retur sebagian yang tetap ber-SI, ada retur penuh tanpa SI — status
  // pastinya ada di label tiap kartu).
  tanda: "ok" | "tanya";
}

// Ikon kertas bersudut lipat (17x20 px) dengan kode dokumen sebagai chip
// gelap bertulisan terang di tengahnya — chip boleh melebihi tepi kertas
// supaya kodenya bisa besar tanpa memperbesar ikon. Tanda di pojok kanan
// bawah TANPA lingkaran, digambar paling atas dengan "halo" warna latar.
// Warna chip per jenis dokumen (tulisan putih): SO abu-abu, DO biru,
// SI hijau, SR merah — sama di mode terang dan gelap.
const WARNA_KODE: Record<TandaDokumen["kode"], string> = {
  SO: "bg-slate-500",
  DO: "bg-blue-600",
  SI: "bg-emerald-600",
  SR: "bg-red-600",
};

export function IkonDokumen({ kode, tanda }: TandaDokumen) {
  return (
    <span
      className="relative inline-flex h-[20px] w-[17px] shrink-0 items-center justify-center"
      role="img"
      aria-label={`${kode} ${tanda === "ok" ? "sudah ada" : "belum"}`}
    >
      <svg viewBox="0 0 22 26" className="absolute inset-0 size-full" aria-hidden>
        <path
          d="M2.5 1h10.5l5.5 5.5v17a1.5 1.5 0 0 1-1.5 1.5h-14.5A1.5 1.5 0 0 1 1 23.5v-21A1.5 1.5 0 0 1 2.5 1z"
          fill="var(--background)"
          stroke="var(--muted-foreground)"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
        <path d="M13 1v4a1.5 1.5 0 0 0 1.5 1.5h4" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
      <span
        className={cn(
          "relative -translate-x-px translate-y-px rounded-[3px] px-[2.5px] py-px text-[9px] font-extrabold leading-none tracking-tight text-white",
          WARNA_KODE[kode]
        )}
      >
        {kode}
      </span>
      <svg viewBox="0 0 22 26" className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
        {tanda === "ok" ? (
          <>
            {/* Centang besar yang boleh keluar dari pojok kertas (svg overflow-visible). */}
            <path d="M12.6 21.2l3.4 3.6 7-8.2" fill="none" stroke="var(--background)" strokeWidth="5.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M12.6 21.2l3.4 3.6 7-8.2" fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </>
        ) : (
          <text
            x="19.2"
            y="27.6"
            textAnchor="middle"
            fontSize="15"
            fontWeight="900"
            fill="var(--warning)"
            stroke="var(--background)"
            strokeWidth="3.2"
            paintOrder="stroke"
            style={{ fontFamily: "inherit" }}
          >
            ?
          </text>
        )}
      </svg>
    </span>
  );
}

interface Tahap {
  key: TahapKey;
  label: string;
  keterangan: string; // tooltip kepala kolom
  dokumen: TandaDokumen[]; // ikon dokumen di kepala kolom
  icon: LucideIcon;
  aksen: string; // warna ikon/garis atas kolom
  lencana: string; // latar+teks lencana tahap (dipakai juga mode Daftar)
}

export const TAHAP: Tahap[] = [
  { key: "belum", label: "Belum Dijadwalkan", keterangan: "SO masuk, belum ada jadwal armada", dokumen: [{ kode: "SO", tanda: "tanya" }], icon: CircleDashed, aksen: "text-muted-foreground", lencana: "bg-muted text-muted-foreground" },
  { key: "dijadwalkan", label: "Dijadwalkan", keterangan: "Sudah dijadwalkan di Papan Pengiriman (Draft), DO belum terbit", dokumen: [{ kode: "SO", tanda: "ok" }], icon: CalendarClock, aksen: "text-warning", lencana: "bg-warning/15 text-warning" },
  { key: "dikirim", label: "Dikirim", keterangan: "DO terbit, SI (faktur) belum", dokumen: [{ kode: "SO", tanda: "ok" }, { kode: "DO", tanda: "ok" }], icon: Truck, aksen: "text-chart-3", lencana: "bg-chart-3/15 text-chart-3" },
  { key: "terfaktur", label: "Terfaktur", keterangan: "DO dan SI sudah terbit", dokumen: [{ kode: "SO", tanda: "ok" }, { kode: "DO", tanda: "ok" }, { kode: "SI", tanda: "ok" }], icon: ReceiptText, aksen: "text-primary", lencana: "bg-primary/15 text-primary" },
  { key: "retur", label: "Retur", keterangan: "Ada pesanan kembali (SR). Retur sebagian: SI tetap terbit untuk sisanya. Retur penuh: tidak ada SI.", dokumen: [{ kode: "SO", tanda: "ok" }, { kode: "DO", tanda: "ok" }, { kode: "SI", tanda: "tanya" }, { kode: "SR", tanda: "ok" }], icon: Undo2, aksen: "text-destructive", lencana: "bg-destructive/15 text-destructive" },
];

// Retur menang: SR hanya bisa dibuat atas DO yang sudah terbit, jadi pesanan
// ber-SR selalu sudah melewati Dikirim — kolom Retur menampilkannya terpisah
// supaya tindak lanjutnya (cek SR, faktur) tidak tenggelam di Terfaktur.
export function tahapPesanan(row: SalesOrderListRow): TahapKey {
  if (row.SalesReturnId) return "retur";
  if (row.Status === "Belum Dijadwalkan") return "belum";
  if (row.Status === "Draft") return "dijadwalkan";
  return row.InvoiceToken ? "terfaktur" : "dikirim";
}

// TransDate/ShippedAt = naive WIB (komponen UTC = jam dinding WIB), sama
// dengan formatDateWib — jadi tanggal kalendernya cukup dari toISOString().
export function tanggalISO(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

// Info pengiriman satu pesanan, dipakai kartu Papan & kolom Daftar.
// Utama: jadwal Papan Pengiriman dashboard (armada · driver, jam berangkat
// sebenarnya). Cadangan: DO itu sendiri, untuk SO yang DO-nya dibuat
// langsung tanpa jadwal dashboard (mis. "Diambil sendiri") — tanpa ini kartu
// menulis "Belum ada pengiriman" padahal DO sudah terbit. Waktu DO adalah
// tanggal dokumen (naive WIB), bukan jam berangkat, jadi diberi label "DO".
export interface InfoPengiriman {
  utama: string; // "TRUK 52 · HENDRI" / "Diambil sendiri"
  waktu: string | null; // "Berangkat 20 Nov 2026 17.29" / "DO 22 Nov 2026 23.07"
  judul: string | null; // tooltip — nomor DO bila sumbernya DO
}

export function infoPengiriman(row: SalesOrderListRow): InfoPengiriman | null {
  if (row.ArmadaName || row.DriverName || row.ShippedAt) {
    return {
      utama: [row.ArmadaName, row.DriverName].filter(Boolean).join(" · ") || "-",
      waktu: row.ShippedAt ? `Berangkat ${formatDate(row.ShippedAt)} ${formatTime(row.ShippedAt)}` : null,
      judul: null,
    };
  }
  if (row.DoVoucherNo) {
    return {
      utama: [row.DoVehicleNo, row.DoSalesmanName].filter(Boolean).join(" · ") || "Tanpa jadwal armada",
      waktu: row.DoTransDate ? `DO ${formatDateWib(row.DoTransDate)} ${formatTimeWib(row.DoTransDate)}` : null,
      judul: `${row.DoVoucherNo} — dibuat tanpa jadwal Papan Pengiriman`,
    };
  }
  return null;
}

// Label retur: jumlah kantong yang diretur + apakah SI tetap terbit
// (retur sebagian) atau tidak (retur penuh). Contoh: "Retur 5 · SI terbit".
export function labelRetur(row: SalesOrderListRow): string {
  const qty = row.ReturQty != null ? ` ${row.ReturQty.toLocaleString("id-ID", { maximumFractionDigits: 1 })}` : "";
  return `Retur${qty} · ${row.InvoiceToken ? "SI terbit" : "tanpa SI"}`;
}

// Lencana tahap satu pesanan — warna/ikon sama dengan kepala kolom Papan.
// Hasil pencarian nomor dokumen: nomor DO/SI/SR yang cocok ditampilkan di
// kartu/baris (nomor SO sudah selalu tampil — cukup disorot, lihat
// SorotSo), dengan chip kode berwarna sama seperti ikon dokumen.
export function NomorCocok({ row, cocok }: { row: SalesOrderListRow; cocok?: KodeDokumen[] }) {
  const nomor = nomorPerKode(row);
  const lain = (cocok ?? []).filter((k) => k !== "SO" && nomor[k]);
  if (lain.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col gap-0.5">
      {lain.map((k) => (
        <p key={k} className="flex min-w-0 items-center gap-1.5 text-[11px]">
          <span className={cn("rounded-[3px] px-1 py-px text-[9px] font-extrabold leading-none text-white", WARNA_KODE[k])}>{k}</span>
          <span className="truncate rounded bg-warning/20 px-1 font-medium text-foreground">{nomor[k]}</span>
        </p>
      ))}
    </div>
  );
}

// Nomor SO pada kartu/baris, disorot bila nomor inilah yang cocok dengan pencarian.
export function SorotSo({ row, cocok }: { row: SalesOrderListRow; cocok?: KodeDokumen[] }) {
  return (
    <span className={cn(cocok?.includes("SO") && "rounded bg-warning/20 px-1 font-medium text-foreground")}>{row.VoucherNo}</span>
  );
}

export function TahapBadge({ row }: { row: SalesOrderListRow }) {
  const t = TAHAP.find((x) => x.key === tahapPesanan(row))!;
  const Icon = t.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium", t.lencana)}>
      <Icon className="size-3" />
      {t.label}
    </span>
  );
}

function waktu(value: string | Date | null): number {
  return value ? new Date(value).getTime() : 0;
}

// Kolom tidak punya scrollbar sendiri (memanjang mengikuti isi, halaman yang
// digulir) — jadi kartu dibatasi per "halaman" dengan tombol Tampilkan lagi.
const HALAMAN = 20;

function KartuPesanan({
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
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-2.5 text-sm shadow-xs">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-medium" title={row.CustomerName}>
          {row.CustomerName}
        </p>
        <p className="shrink-0 font-display text-xs font-semibold tabular-nums">{formatRupiah(row.Amount)}</p>
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <FileText className="size-3" />
          <SorotSo row={row} cocok={cocok} />
        </span>
        <span className="inline-flex items-center gap-1">
          <CalendarDays className="size-3" />
          {formatDateWib(row.TransDate)}
          {terlambat && (
            <span
              className="ml-0.5 rounded bg-destructive/15 px-1.5 py-px text-[10px] font-medium text-destructive"
              title="Usang: tanggal pesanan sudah lewat, tetapi belum dikirim"
            >
              Usang
            </span>
          )}
        </span>
      </p>
      <NomorCocok row={row} cocok={cocok} />
      <div className="flex flex-wrap items-center gap-1">
        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          <MapPin className="size-3" />
          {row.Wilayah}
        </span>
        {row.Qty10KG > 0 && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            10KG <span className="font-semibold text-foreground">{row.Qty10KG.toLocaleString("id-ID")}</span>
          </span>
        )}
        {row.Qty5KG > 0 && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            5KG <span className="font-semibold text-foreground">{row.Qty5KG.toLocaleString("id-ID")}</span>
          </span>
        )}
        {tahapPesanan(row) === "terfaktur" && (
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">SI terbit</span>
        )}
        {row.SalesReturnId && (
          // Retur sebagian: mitra menolak sebagian, sisanya tetap ditagih (SI
          // terbit). Retur penuh: semua ditolak, tidak ada SI.
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium",
              row.InvoiceToken ? "bg-warning/15 text-warning" : "bg-destructive/15 text-destructive"
            )}
            title={row.InvoiceToken ? "Sebagian barang dikembalikan; sisanya tetap ditagih" : "Semua barang dikembalikan; tidak ada tagihan"}
          >
            {labelRetur(row)}
          </span>
        )}
        {/* Belum ada info pengiriman (mis. Belum Dijadwalkan): aksi Ubah/Hapus
            langsung di baris chip, rata kanan — tanpa baris bawah kosong. */}
        {!kirim && (
          <span className="ml-auto">
            <PemesananAksi row={row} {...aksi} />
          </span>
        )}
      </div>
      {kirim && (
        <div className="flex items-center justify-between gap-2 border-t pt-1.5">
          <p className="min-w-0 truncate text-[11px] text-muted-foreground" title={kirim.judul ?? undefined}>
            <Truck className="mr-1 inline size-3" />
            {[kirim.utama, kirim.waktu].filter(Boolean).join(" · ")}
          </p>
          <PemesananAksi row={row} {...aksi} />
        </div>
      )}
    </div>
  );
}

function KolomTahap({
  tahap,
  rows,
  todayISO,
  aksiFor,
  cocokPer,
}: {
  tahap: Tahap;
  rows: SalesOrderListRow[];
  todayISO: string;
  aksiFor: (row: SalesOrderListRow) => PemesananAksiHandlers;
  cocokPer?: Map<string, KodeDokumen[]>;
}) {
  const [tampil, setTampil] = useState(HALAMAN);
  const total = rows.reduce((s, r) => s + r.Amount, 0);
  const kantong10 = rows.reduce((s, r) => s + r.Qty10KG, 0);
  const kantong5 = rows.reduce((s, r) => s + r.Qty5KG, 0);
  const belumKirim = tahap.key === "belum" || tahap.key === "dijadwalkan";
  const Icon = tahap.icon;

  return (
    <section
      className="flex min-h-0 flex-col rounded-xl border bg-muted/30 shadow-[0_1px_2px_rgb(0_0_0/0.06),0_4px_12px_rgb(0_0_0/0.07)] dark:shadow-[0_1px_2px_rgb(0_0_0/0.4),0_4px_14px_rgb(0_0_0/0.35)]"
      aria-label={tahap.label}
    >
      {/* Sticky di puncak area gulir papan — yang bergulir hanya isi kolom.
          Garis tepi sendiri (-mx-px -mt-px border) menimpa garis kotak kolom,
          jadi garis atas & samping tetap ada saat kotak kolom sudah tergulir.
          Latar pekat (background + tint muted yang sama dengan kolom) supaya
          kartu yang lewat di bawahnya tidak tembus. */}
      <div className="sticky top-0 z-20 -mx-px -mt-px">
      {/* Lapisan persegi warna latar halaman di belakang kepala kolom: menutup
          celah di luar lengkungan sudut, supaya garis kotak kolom & kartu yang
          tergulir di belakangnya tidak "bocor" lewat sudut membulat. */}
      <span aria-hidden className="absolute inset-0 bg-background" />
      <header className="relative flex flex-col gap-1 rounded-t-xl border bg-background bg-[image:linear-gradient(color-mix(in_oklab,var(--muted)_30%,transparent),color-mix(in_oklab,var(--muted)_30%,transparent))] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Icon className={cn("size-4 shrink-0", tahap.aksen)} />
          <h3 className="truncate text-sm font-semibold">{tahap.label}</h3>
          <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
            {rows.length.toLocaleString("id-ID")}
          </span>
          {/* Ikon dokumen sebaris dengan judul, rata kanan. */}
          <div className="ml-auto flex shrink-0 items-center gap-1" title={tahap.keterangan}>
            {tahap.dokumen.map((d) => (
              <IkonDokumen key={d.kode} {...d} />
            ))}
          </div>
        </div>
        {/* Chip kantong per kemasan (gaya sama dengan chip qty di kartu), lalu total nominal. */}
        <div className="flex flex-wrap items-center gap-1 text-[11px] tabular-nums">
          {kantong10 > 0 && (
            <span className="rounded border border-foreground/20 bg-background px-1.5 py-0.5 text-[10px] font-medium text-foreground/70">
              10KG · <span className="font-semibold text-foreground">{kantong10.toLocaleString("id-ID")}</span>
            </span>
          )}
          {kantong5 > 0 && (
            <span className="rounded border border-foreground/20 bg-background px-1.5 py-0.5 text-[10px] font-medium text-foreground/70">
              5KG · <span className="font-semibold text-foreground">{kantong5.toLocaleString("id-ID")}</span>
            </span>
          )}
          {/* Nominal di akhir, setelah chip qty; rata kanan bila muat sebaris. */}
          <span className="ml-auto text-[10px] font-semibold text-foreground">{formatRupiah(total)}</span>
        </div>
      </header>
      </div>
      <div className="flex flex-col gap-2 p-2">
        {rows.slice(0, tampil).map((r) => (
          <KartuPesanan
            key={r.SalesOrderID}
            row={r}
            terlambat={belumKirim && tanggalISO(r.TransDate) < todayISO}
            aksi={aksiFor(r)}
            cocok={cocokPer?.get(r.SalesOrderID)}
          />
        ))}
        {rows.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">Tidak ada pesanan.</p>}
        {rows.length > tampil && (
          <button
            type="button"
            onClick={() => setTampil((n) => n + HALAMAN)}
            className="rounded-md border border-dashed py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Tampilkan {Math.min(HALAMAN, rows.length - tampil)} lagi ({(rows.length - tampil).toLocaleString("id-ID")} tersisa)
          </button>
        )}
      </div>
    </section>
  );
}

export function PemesananPapan({
  rows,
  todayISO,
  aksiFor,
  cocokPer,
  adaInfo = false,
}: {
  rows: SalesOrderListRow[];
  todayISO: string;
  aksiFor: (row: SalesOrderListRow) => PemesananAksiHandlers;
  cocokPer?: Map<string, KodeDokumen[]>;
  adaInfo?: boolean; // baris keterangan pencarian tampil di atas papan → papan dipendekkan
}) {
  const perTahap: Record<TahapKey, SalesOrderListRow[]> = { belum: [], dijadwalkan: [], dikirim: [], terfaktur: [], retur: [] };
  for (const r of rows) perTahap[tahapPesanan(r)].push(r);
  // Semua kolom: terbaru di atas. Pesanan yang menunggu terlalu lama tetap
  // terlihat lewat lencana "Lewat tanggal" di kartunya.
  perTahap.belum.sort((a, b) => waktu(b.TransDate) - waktu(a.TransDate));
  perTahap.dijadwalkan.sort((a, b) => waktu(b.TransDate) - waktu(a.TransDate));
  perTahap.dikirim.sort((a, b) => waktu(b.ShippedAt ?? b.TransDate) - waktu(a.ShippedAt ?? a.TransDate));
  perTahap.terfaktur.sort((a, b) => waktu(b.ShippedAt ?? b.TransDate) - waktu(a.ShippedAt ?? a.TransDate));
  perTahap.retur.sort((a, b) => waktu(b.ShippedAt ?? b.TransDate) - waktu(a.ShippedAt ?? a.TransDate));

  return (
    <div
      className={cn(
        "-mx-3 min-h-96 overflow-auto overscroll-contain px-3 pb-4",
        adaInfo ? "h-[calc(100dvh-11.25rem)]" : "h-[calc(100dvh-9.5rem)]"
      )}
    >
      {/* Papan = SATU area gulir (bukan per kolom) setinggi sisa layar:
          kepala kolom sticky top-0 di dalamnya, yang bergulir hanya isi
          kolom, dan gulir samping tetap bisa saat lima kolom tidak muat.
          (Sticky terhadap guliran halaman tidak mungkin selama pembungkus
          ini perlu overflow-x untuk gulir samping.) */}
      <div className="grid auto-cols-[minmax(260px,1fr)] grid-flow-col gap-3">
        {TAHAP.map((t) => (
          <KolomTahap
            key={t.key}
            tahap={t}
            rows={perTahap[t.key]}
            todayISO={todayISO}
            aksiFor={aksiFor}
            cocokPer={cocokPer}
          />
        ))}
      </div>
    </div>
  );
}
