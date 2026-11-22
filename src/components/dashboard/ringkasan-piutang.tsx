"use client";

// Ringkasan Piutang bersama Es Kristal & Es Balok (desain 2026-11-22):
//   1. Posisi saat ini — total hutang, jumlah mitra, info tambahan, rasio.
//   2. Pergerakan periode sebagai alur Saldo awal → Saldo akhir; komponen
//      penyesuaian (mis. perpindahan hutang↔tabungan Es Balok) ditampilkan
//      terang-terangan bila ada, supaya alurnya selalu menjumlah tepat.
//   3. Umur hutang (batang bertumpuk) + status Sehat/Perhatian/Kritis yang
//      menjumlah tepat ke total.
// Komponen ini hanya menyajikan; setiap modul memetakan datanya sendiri
// (RingkasanPiutangEsBalok, RingkasanPiutangEsKristal).
import type { ReactNode } from "react";
import { ArrowRight, Landmark } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatRupiah } from "@/lib/format";
import { Petunjuk } from "@/components/ui/petunjuk";
import { cn } from "@/lib/utils";

export const BATAS_RASIO = 30; // % piutang terhadap omzet periode; di atas ini perlu perhatian

export type EmberUmurPiutang = "Belum Jatuh Tempo" | "1-30 Hari" | "31-60 Hari" | "61-90 Hari" | ">90 Hari" | "Saldo Awal";
export type StatusPiutang = "Sehat" | "Perhatian" | "Kritis";

const WARNA_EMBER: Record<EmberUmurPiutang, { bar: string; dot: string }> = {
  "Belum Jatuh Tempo": { bar: "bg-primary", dot: "bg-primary" },
  "1-30 Hari": { bar: "bg-primary/45", dot: "bg-primary/45" },
  "31-60 Hari": { bar: "bg-warning", dot: "bg-warning" },
  "61-90 Hari": { bar: "bg-destructive/60", dot: "bg-destructive/60" },
  ">90 Hari": { bar: "bg-destructive", dot: "bg-destructive" },
  "Saldo Awal": { bar: "bg-muted-foreground/50", dot: "bg-muted-foreground/50" },
};

const LABEL_EMBER: Record<EmberUmurPiutang, string> = {
  "Belum Jatuh Tempo": "Belum jatuh tempo",
  "1-30 Hari": "Lewat 1–30 hari",
  "31-60 Hari": "Lewat 31–60 hari",
  "61-90 Hari": "Lewat 61–90 hari",
  ">90 Hari": "Lewat > 90 hari",
  "Saldo Awal": "Saldo awal ERP",
};

const WARNA_STATUS: Record<StatusPiutang, string> = {
  Sehat: "text-primary",
  Perhatian: "text-warning",
  Kritis: "text-destructive",
};

const KET_STATUS: Record<StatusPiutang, string> = {
  Sehat: "terlama ≤ 30 hari lewat jatuh tempo",
  Perhatian: "terlama 31–60 hari",
  Kritis: "terlama > 60 hari",
};

function persen(bagian: number, total: number): string {
  if (total <= 0) return "0%";
  const p = (bagian / total) * 100;
  return `${p < 1 && p > 0 ? p.toFixed(1) : Math.round(p)}%`;
}

function LangkahAlur({
  label,
  nilai,
  tanda,
  kuat = false,
  nada,
}: {
  label: string;
  nilai: number;
  tanda?: "+" | "−";
  kuat?: boolean;
  nada?: "positif" | "negatif";
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5 rounded-lg px-3 py-2", kuat ? "bg-muted/60" : "")}>
      <span className="truncate text-[11px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-data truncate text-sm font-semibold tabular-nums",
          nada === "positif" && "text-primary",
          nada === "negatif" && "text-destructive",
          kuat && "text-base"
        )}
      >
        {tanda && <span className="mr-0.5 text-muted-foreground">{tanda}</span>}
        {formatRupiah(Math.abs(nilai))}
      </span>
    </div>
  );
}

export interface PropsRingkasanPiutang {
  totalHutang: number;
  jumlahMitra: number;
  // Satu info kecil di kiri bawah kartu posisi (Es Balok: tabungan mitra;
  // Es Kristal: jumlah invoice belum lunas).
  infoPosisi: { ikon?: ReactNode; label: string; nilai: string; nadaPositif?: boolean };
  // Total hutang ÷ penjualan periode × 100.
  rasio: number;
  periodeLabel: string;
  alur: {
    saldoAwal: number;
    penjualan: number;
    pembayaran: number;
    tarikan?: number;
    // Komponen yang membuat alur menjumlah tepat ke saldo akhir; null/±0 = tidak tampil.
    penyesuaian?: { label: string; nilai: number; keterangan: string } | null;
    saldoAkhir: number;
    catatan: string;
  };
  umur: {
    total: number;
    ember: { ember: EmberUmurPiutang; nominal: number }[];
    status: { status: StatusPiutang; mitra: number; nominal: number }[];
    catatan: string;
  };
  // Mis. "Wilayah Ponorogo" saat filter wilayah membatasi posisi & umur.
  cakupan?: string | null;
}

export function RingkasanPiutang({ totalHutang, jumlahMitra, infoPosisi, rasio, periodeLabel, alur, umur, cakupan }: PropsRingkasanPiutang) {
  const rasioTinggi = rasio > BATAS_RASIO;
  const ember = umur.ember.filter((e) => e.nominal >= 1 || e.ember !== "Saldo Awal");
  const lewatJatuhTempo = umur.ember.filter((e) => e.ember !== "Belum Jatuh Tempo").reduce((t, e) => t + e.nominal, 0);
  const penyesuaian = alur.penyesuaian && Math.abs(alur.penyesuaian.nilai) >= 1 ? alur.penyesuaian : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Posisi saat ini */}
        <Card className="py-4">
          <CardContent className="flex flex-col gap-3 px-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Total Hutang Mitra</p>
                <p className="font-display text-2xl font-semibold tabular-nums">{formatRupiah(totalHutang)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {jumlahMitra} mitra berhutang · {cakupan ?? "saat ini"}
                </p>
              </div>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
                <Landmark className="size-4" />
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 border-t pt-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  {infoPosisi.ikon} {infoPosisi.label}
                </p>
                <p className={cn("font-data truncate text-sm font-semibold tabular-nums", infoPosisi.nadaPositif && "text-primary")}>
                  {infoPosisi.nilai}
                </p>
              </div>
              <Petunjuk
                render={<div className="min-w-0 cursor-help" />}
                judul="Rasio hutang / omzet"
                isi={`Total Hutang saat ini dibanding penjualan ${periodeLabel}. Di atas ${BATAS_RASIO}% berarti piutang menumpuk relatif terhadap omzet.`}
              >
                <p className="text-[11px] text-muted-foreground">Rasio hutang / omzet</p>
                <p className="flex items-center gap-1.5">
                  <span className={cn("font-data text-sm font-semibold tabular-nums", rasioTinggi && "text-destructive")}>
                    {rasio.toLocaleString("id-ID", { maximumFractionDigits: 1 })}%
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                      rasioTinggi ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
                    )}
                  >
                    {rasioTinggi ? `> ${BATAS_RASIO}%` : "wajar"}
                  </span>
                </p>
              </Petunjuk>
            </div>
          </CardContent>
        </Card>

        {/* Pergerakan periode sebagai alur */}
        <Card className="py-4 lg:col-span-2">
          <CardContent className="flex flex-col gap-3 px-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">Pergerakan hutang</p>
              <p className="text-xs text-muted-foreground">{periodeLabel}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <LangkahAlur label="Saldo awal" nilai={alur.saldoAwal} kuat />
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
              <LangkahAlur label="Penjualan" nilai={alur.penjualan} tanda="+" />
              <LangkahAlur label="Pembayaran" nilai={alur.pembayaran} tanda="−" nada="positif" />
              {(alur.tarikan ?? 0) >= 1 && <LangkahAlur label="Tarikan tabungan" nilai={alur.tarikan ?? 0} tanda="+" />}
              {penyesuaian && (
                <Petunjuk render={<div className="cursor-help" />} judul={penyesuaian.label} isi={penyesuaian.keterangan}>
                  <LangkahAlur label={penyesuaian.label} nilai={penyesuaian.nilai} tanda={penyesuaian.nilai < 0 ? "−" : "+"} />
                </Petunjuk>
              )}
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
              <LangkahAlur
                label="Saldo akhir"
                nilai={alur.saldoAkhir}
                kuat
                nada={alur.saldoAkhir > alur.saldoAwal ? "negatif" : "positif"}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Hutang {alur.saldoAkhir >= alur.saldoAwal ? "naik" : "turun"}{" "}
              <span className="font-medium text-foreground">{formatRupiah(Math.abs(alur.saldoAkhir - alur.saldoAwal))}</span> selama
              periode ini. {alur.catatan}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Umur piutang — menjumlah tepat ke Total Hutang */}
      <Card className="py-4">
        <CardContent className="flex flex-col gap-3 px-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-semibold">Umur hutang mitra</p>
            <p className="text-xs text-muted-foreground">
              Lewat jatuh tempo <span className="font-medium text-foreground">{formatRupiah(lewatJatuhTempo)}</span> (
              {persen(lewatJatuhTempo, umur.total)}) dari {formatRupiah(umur.total)}
            </p>
          </div>

          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="Komposisi umur hutang">
            {ember.map((e) =>
              e.nominal > 0 ? (
                <Petunjuk
                  key={e.ember}
                  render={
                    <div
                      className={cn("h-full transition-[width] duration-500 ease-out", WARNA_EMBER[e.ember].bar)}
                      style={{ width: `${(e.nominal / Math.max(umur.total, 1)) * 100}%` }}
                    />
                  }
                  judul={LABEL_EMBER[e.ember]}
                  isi={`${formatRupiah(e.nominal)} · ${persen(e.nominal, umur.total)} dari total`}
                >
                  {null}
                </Petunjuk>
              ) : null
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 xl:grid-cols-5">
            {ember.map((e) => (
              <div key={e.ember} className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className={cn("size-2 shrink-0 rounded-full", WARNA_EMBER[e.ember].dot)} />
                  <span className="truncate">{LABEL_EMBER[e.ember]}</span>
                </span>
                <span className="font-data truncate text-sm font-semibold tabular-nums">
                  {formatRupiah(e.nominal)}{" "}
                  <span className="text-[11px] font-normal text-muted-foreground">{persen(e.nominal, umur.total)}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-2 border-t pt-3 sm:grid-cols-3">
            {umur.status.map((s) => (
              <Petunjuk
                key={s.status}
                render={<div className="flex cursor-help items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2" />}
                judul={s.status}
                isi={`Mitra dengan invoice/tagihan belum lunas ${KET_STATUS[s.status]}.`}
              >
                <div className="min-w-0">
                  <p className={cn("text-xs font-semibold", WARNA_STATUS[s.status])}>{s.status}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{s.mitra} mitra</p>
                </div>
                <p className="font-data shrink-0 text-sm font-semibold tabular-nums">{formatRupiah(s.nominal)}</p>
              </Petunjuk>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">{umur.catatan}</p>
        </CardContent>
      </Card>
    </div>
  );
}
