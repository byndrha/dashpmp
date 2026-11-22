import { cache } from "react";
import { FileText } from "lucide-react";
import { getTrenPiutangBulananEsKristal } from "@/lib/queries/piutang-tren-es-kristal";
import { RingkasanPiutang, type EmberUmurPiutang, type StatusPiutang } from "@/components/dashboard/ringkasan-piutang";
import { TrenPiutangBulanan } from "@/components/dashboard/tren-piutang-bulanan";
import { getAgingReceivables } from "@/lib/queries/aging";
import { getPiutangPeriodSummary } from "@/lib/queries/piutang-summary";
import { getTodayReceivablePayments } from "@/lib/queries/piutang-payments";
import { getCollectionPriority } from "@/lib/queries/collection-priority";
import { AgingTable } from "@/components/dashboard/aging-table";
import { PiutangPaymentsPanel } from "@/components/dashboard/piutang-payments-panel";
import { CollectionPriorityTable } from "@/components/dashboard/collection-priority-table";
import type { DateRangeFilter } from "@/types/dashboard";

// Setiap seksi di bawah adalah async Server Component-nya sendiri, dirender
// lewat <Suspense> terpisah di page.tsx -- supaya boks "Periode" (query
// ringan, getPiutangPeriodSummary) bisa langsung tampil begitu siap, tanpa
// menunggu boks "Outstanding" dan tabel Invoice yang keduanya bergantung
// pada getAgingReceivables() (query terberat di halaman ini -- lihat
// komentarnya sendiri soal scan ~221k baris vCustomerStatement).
//
// getAgingReceivables/getCollectionPriority dibungkus cache() dari `react`
// supaya dipanggil dari 2 seksi berbeda (boks KPI + tab detail yang sama)
// tetap hanya menjalankan SATU query per request -- bukan query dobel.
// React men-dedupe otomatis berdasarkan argumen yang identik, dalam satu
// request yang sama.
const getAgingReceivablesCached = cache(getAgingReceivables);
const getCollectionPriorityCached = cache(getCollectionPriority);

export async function PiutangInvoiceTablePanel({ wilayah, perusahaanId }: { wilayah?: string; perusahaanId: number }) {
  const rows = await getAgingReceivablesCached(wilayah);
  return <AgingTable rows={rows} perusahaanId={perusahaanId} />;
}

export async function PiutangPrioritasPanel() {
  const priorityRows = await getCollectionPriorityCached();
  return <CollectionPriorityTable rows={priorityRows} />;
}

export async function PiutangPembayaranPanel({
  businessPaymentsDate,
  paymentsDate,
  todayISO,
}: {
  businessPaymentsDate: Date;
  paymentsDate: string;
  todayISO: string;
}) {
  const paymentsRows = await getTodayReceivablePayments(businessPaymentsDate);
  return <PiutangPaymentsPanel rows={paymentsRows} businessDate={paymentsDate} todayISO={todayISO} />;
}

// ---------------------------------------------------------------------------
// Ringkasan Piutang Es Kristal (desain 2026-11-22) — pengganti 2 baris KPI +
// panel status. Data per invoice ERP (vCustomerStatement) sudah konsisten:
// Total = Σ umur = Σ status = saldo awal + penjualan − pembayaran (dicek
// scripts/diag-ringkasan-piutang-es-kristal-2026-11-22.ts). Posisi, umur, dan
// status dihitung dari getAgingReceivables sehingga IKUT filter wilayah
// (dulu kotak status tidak ikut filter); status per mitra = umur invoice
// terburuknya — aturan sama dengan getCollectionPriority (98/98 cocok).
// Pergerakan periode & rasio = seluruh wilayah (query periode tidak punya
// filter wilayah), dan disebut demikian bila filter wilayah aktif.
const URUTAN_EMBER: EmberUmurPiutang[] = ["Belum Jatuh Tempo", "1-30 Hari", "31-60 Hari", "61-90 Hari", ">90 Hari"];
const FORMAT_TANGGAL = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function statusDariHari(hari: number): StatusPiutang {
  return hari <= 30 ? "Sehat" : hari <= 60 ? "Perhatian" : "Kritis";
}

export async function PiutangRingkasanEsKristal({ filter, wilayah }: { filter: DateRangeFilter; wilayah?: string }) {
  const [rows, periode] = await Promise.all([getAgingReceivablesCached(wilayah), getPiutangPeriodSummary(filter)]);

  const total = rows.reduce((t, r) => t + r.Outstanding, 0);
  const ember = new Map<EmberUmurPiutang, number>(URUTAN_EMBER.map((e) => [e, 0]));
  const terburuk = new Map<string, { hari: number; nominal: number }>();
  for (const r of rows) {
    ember.set(r.AgingBucket as EmberUmurPiutang, (ember.get(r.AgingBucket as EmberUmurPiutang) ?? 0) + r.Outstanding);
    const m = terburuk.get(r.BusinessPartnerID);
    terburuk.set(r.BusinessPartnerID, { hari: Math.max(m?.hari ?? -Infinity, r.DaysOverdue), nominal: (m?.nominal ?? 0) + r.Outstanding });
  }
  const status = (["Kritis", "Perhatian", "Sehat"] as StatusPiutang[]).map((st) => {
    const cocok = [...terburuk.values()].filter((m) => statusDariHari(m.hari) === st);
    return { status: st, mitra: cocok.length, nominal: cocok.reduce((t, m) => t + m.nominal, 0) };
  });

  // filter.endDate eksklusif → tanggal terakhir yang ikut = endDate − 1 hari.
  const akhirInklusif = new Date(`${filter.endDate}T00:00:00Z`);
  akhirInklusif.setUTCDate(akhirInklusif.getUTCDate() - 1);
  const periodeLabel = `${FORMAT_TANGGAL.format(new Date(`${filter.startDate}T00:00:00Z`))} – ${FORMAT_TANGGAL.format(akhirInklusif)}${wilayah ? " · seluruh wilayah" : ""}`;
  const penyesuaian =
    periode.SaldoAkhirPeriode - (periode.SaldoAwalPeriode + periode.TotalPenjualanPeriode - periode.TotalPembayaranPeriode);

  return (
    <RingkasanPiutang
      totalHutang={total}
      jumlahMitra={terburuk.size}
      infoPosisi={{ ikon: <FileText className="size-3" />, label: "Invoice belum lunas", nilai: rows.length.toLocaleString("id-ID") }}
      rasio={periode.RatioPiutangOmzetPct}
      periodeLabel={periodeLabel}
      cakupan={wilayah ? `Wilayah ${wilayah}` : null}
      alur={{
        saldoAwal: periode.SaldoAwalPeriode,
        penjualan: periode.TotalPenjualanPeriode,
        pembayaran: periode.TotalPembayaranPeriode,
        penyesuaian: {
          label: "Penyesuaian lain",
          nilai: penyesuaian,
          keterangan: "Selisih yang tidak berasal dari invoice atau pembayaran periode ini (mis. invoice lebih bayar atau koreksi).",
        },
        saldoAkhir: periode.SaldoAkhirPeriode,
        catatan: "Rumus sama dengan tabel tren bulanan di bawah.",
      }}
      umur={{
        total,
        ember: URUTAN_EMBER.map((e) => ({ ember: e, nominal: ember.get(e) ?? 0 })),
        status,
        catatan:
          "Dihitung per invoice dari jatuh tempo ERP. Status mitra mengikuti invoice belum lunas yang paling lama lewat jatuh tempo — sama dengan tab Prioritas Pemulihan.",
      }}
    />
  );
}

export async function PiutangTrenEsKristal({ bulanBerjalan }: { bulanBerjalan: string }) {
  const months = await getTrenPiutangBulananEsKristal();
  return <TrenPiutangBulanan months={months} bulanBerjalan={bulanBerjalan} />;
}
