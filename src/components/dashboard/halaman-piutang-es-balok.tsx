// Halaman Piutang Es Balok bersama (PMPutra, PMPersada, PMPakis) — server
// component. Dipecah menjadi bagian yang tampil BERTAHAP (streaming):
//   1. Judul + ringkasan (posisi, pergerakan periode, umur hutang, tren) —
//      query ringan (~2–3 dtk), tampil lebih dulu.
//   2. Tab Rincian per Mitra / Pembayaran & Tarikan / Prioritas — masing-
//      masing <Suspense> sendiri; ketiganya butuh FIFO pesanan belum lunas
//      (~5 dtk) yang di-dedup per request lewat React cache().
// Data periode & umur diambil langsung di sini saat render (bukan Server
// Action dari browser yang antre berurutan); Server Action hanya untuk
// interaksi (Terapkan tanggal, Bayar/Tarik, target).
import { cache, Suspense, type ComponentProps } from "react";
import { getPiutangSummary, getPiutangPerAgen } from "@/lib/queries/penjualan-piutang";
import { getEsBalokInvoiceOutstanding, getEsBalokPiutangPeriodSummary } from "@/lib/queries/piutang-invoice-outstanding";
import { getEsBalokCollectionPriority, getEsBalokPembayaranByDate } from "@/lib/queries/piutang-priority-es-balok";
import { getUmurPiutangBersih } from "@/lib/queries/umur-piutang-bersih";
import { ringkasPiutangTerbuka } from "@/lib/piutang-es-balok-status";
import { getPgPool } from "@/lib/pg";
import { periodeBawaanPiutang, rentangQueryPiutang } from "@/lib/piutang-es-balok-periode";
import { PiutangSummaryPanel } from "@/components/dashboard/piutang-summary-panel";
import { PiutangPerAgenTable } from "@/components/dashboard/piutang-per-agen-table";
import { PiutangTabs } from "@/components/dashboard/piutang-tabs";
import { EsBalokCollectionPriorityTable } from "@/components/dashboard/es-balok-collection-priority-table";
import { EsBalokPembayaranPanelContainer } from "@/components/dashboard/es-balok-pembayaran-panel-container";
import { Skeleton } from "@/components/ui/skeleton";

type PropsTabel = ComponentProps<typeof PiutangPerAgenTable>;
type PropsPrioritas = ComponentProps<typeof EsBalokCollectionPriorityTable>;

export interface AksiPiutangEsBalok {
  getPiutangPerAgenAction: PropsTabel["fetchAction"];
  getRingkasanPiutangTerbukaAction: PropsTabel["fetchTerbuka"];
  getKomponenSelisihAction: PropsTabel["fetchKomponenSelisih"];
  getPiutangBayarContextAction: PropsTabel["fetchBayarContext"];
  bayarPiutangAction: PropsTabel["submitBayar"];
  getPiutangTarikContextAction: PropsTabel["fetchTarikContext"];
  tarikPiutangAction: PropsTabel["submitTarik"];
  getEsBalokPeriodSummaryAction: NonNullable<ComponentProps<typeof PiutangSummaryPanel>["fetchPeriodSummary"]>;
  getEsBalokPembayaranByDateAction: ComponentProps<typeof EsBalokPembayaranPanelContainer>["fetchByDate"];
  setEsBalokCollectionTargetAction: PropsPrioritas["onSetTarget"];
  removeEsBalokCollectionTargetAction: PropsPrioritas["onRemoveTarget"];
}

// Satu kali per request walau dipakai tiga bagian tab.
const fifoSekali = cache((kode: string) => getEsBalokInvoiceOutstanding(kode));
// Umur & hutang bersih per Agen — dipakai panel ringkasan DAN status kartu.
const umurSekali = cache((kode: string) => getUmurPiutangBersih(kode));
// Nama PT untuk judul & nama file ekspor .xlsx.
async function namaPerusahaanDari(kode: string): Promise<string> {
  const r = await getPgPool().query<{ nama: string }>(`SELECT nama FROM perusahaan WHERE kode = $1`, [kode]);
  return r.rows[0]?.nama ?? kode;
}

async function BagianRingkasan({ kode, aksi }: { kode: string; aksi: AksiPiutangEsBalok }) {
  const { awalISO, akhirISO } = periodeBawaanPiutang();
  const { start, end } = rentangQueryPiutang(awalISO, akhirISO);
  // invoiceRows kosong: hanya dipakai sudahJatuhTempo/kritisNominal (FIFO),
  // yang tidak lagi ditampilkan panel ringkasan — angka lain tidak terpengaruh.
  const [data, periode, umur] = await Promise.all([
    getPiutangSummary(kode),
    getEsBalokPiutangPeriodSummary(kode, start, end, []),
    umurSekali(kode),
  ]);
  return (
    <PiutangSummaryPanel
      judul="Piutang"
      data={data}
      awalISO={awalISO}
      akhirISO={akhirISO}
      initialPeriode={periode}
      initialUmur={umur}
      fetchPeriodSummary={aksi.getEsBalokPeriodSummaryAction}
    />
  );
}

async function PanelRincian({ kode, aksi }: { kode: string; aksi: AksiPiutangEsBalok }) {
  const { awalISO, akhirISO } = periodeBawaanPiutang();
  const { start, end } = rentangQueryPiutang(awalISO, akhirISO);
  const [perMitra, invoiceRows, umur, namaPerusahaan] = await Promise.all([
    getPiutangPerAgen(kode, start, end),
    fifoSekali(kode),
    umurSekali(kode),
    namaPerusahaanDari(kode),
  ]);
  return (
    <PiutangPerAgenTable
      namaPerusahaan={namaPerusahaan}
      initialRows={perMitra}
      initialTerbuka={ringkasPiutangTerbuka(invoiceRows, umur.perAgen)}
      awalISO={awalISO}
      akhirISO={akhirISO}
      fetchTerbuka={aksi.getRingkasanPiutangTerbukaAction}
      fetchKomponenSelisih={aksi.getKomponenSelisihAction}
      fetchAction={aksi.getPiutangPerAgenAction}
      fetchBayarContext={aksi.getPiutangBayarContextAction}
      submitBayar={aksi.bayarPiutangAction}
      fetchTarikContext={aksi.getPiutangTarikContextAction}
      submitTarik={aksi.tarikPiutangAction}
    />
  );
}

async function PanelPembayaran({ kode, aksi }: { kode: string; aksi: AksiPiutangEsBalok }) {
  // Tetap seperti sebelumnya: hari ini tengah malam waktu lokal server, sama
  // dengan getEsBalokPembayaranByDateAction (belum diselaraskan ke UTC).
  const todayMidnight = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00`);
  const rows = await getEsBalokPembayaranByDate(kode, todayMidnight, await fifoSekali(kode));
  return <EsBalokPembayaranPanelContainer initialRows={rows} fetchByDate={aksi.getEsBalokPembayaranByDateAction} />;
}

async function PanelPrioritas({ kode, aksi }: { kode: string; aksi: AksiPiutangEsBalok }) {
  const [fifo, umur] = await Promise.all([fifoSekali(kode), umurSekali(kode)]);
  const rows = await getEsBalokCollectionPriority(kode, fifo, umur.perAgen);
  return (
    <EsBalokCollectionPriorityTable
      rows={rows}
      onSetTarget={aksi.setEsBalokCollectionTargetAction}
      onRemoveTarget={aksi.removeEsBalokCollectionTargetAction}
    />
  );
}

function KerangkaRingkasan() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">Piutang</h1>
        <Skeleton className="h-[50px] w-[22rem] max-w-full rounded-lg max-sm:hidden" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-[150px] w-full rounded-xl" />
        <Skeleton className="h-[150px] w-full rounded-xl lg:col-span-2" />
      </div>
      <Skeleton className="h-[220px] w-full rounded-xl" />
      <Skeleton className="h-[260px] w-full rounded-xl" />
    </div>
  );
}

function KerangkaPanel() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-[104px] w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[300px] w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export function HalamanPiutangEsBalok({ kode, aksi }: { kode: string; aksi: AksiPiutangEsBalok }) {
  return (
    <div className="flex flex-col gap-4">
      <Suspense fallback={<KerangkaRingkasan />}>
        <BagianRingkasan kode={kode} aksi={aksi} />
      </Suspense>
      <PiutangTabs
        invoiceLabel="Rincian per Mitra"
        invoicePanel={
          <Suspense fallback={<KerangkaPanel />}>
            <PanelRincian kode={kode} aksi={aksi} />
          </Suspense>
        }
        pembayaranLabel="Pembayaran & Tarikan"
        pembayaranPanel={
          <Suspense fallback={<KerangkaPanel />}>
            <PanelPembayaran kode={kode} aksi={aksi} />
          </Suspense>
        }
        prioritasPanel={
          <Suspense fallback={<KerangkaPanel />}>
            <PanelPrioritas kode={kode} aksi={aksi} />
          </Suspense>
        }
      />
    </div>
  );
}
