// src/app/pmputra/piutang/page.tsx
import { getPiutangSummary, getPiutangPerAgen } from "@/lib/queries/penjualan-piutang";
import { requirePmputra } from "@/lib/require-access";
import { PiutangSummaryPanel } from "@/components/dashboard/piutang-summary-panel";
import { PiutangPerAgenTable } from "@/components/dashboard/piutang-per-agen-table";
import { PiutangTabs } from "@/components/dashboard/piutang-tabs";
import { EsBalokInvoiceOutstandingTable } from "@/components/dashboard/es-balok-invoice-outstanding-table";
import { EsBalokCollectionPriorityTable } from "@/components/dashboard/es-balok-collection-priority-table";
import { getEsBalokInvoiceOutstanding } from "@/lib/queries/piutang-invoice-outstanding";
import { getEsBalokCollectionPriority, getEsBalokPembayaranByDate } from "@/lib/queries/piutang-priority-es-balok";
import { EsBalokPembayaranPanelContainer } from "./pembayaran-panel-container";
import {
  getPiutangPerAgenAction,
  getPiutangBayarContextAction,
  bayarPiutangAction,
  getPiutangTarikContextAction,
  tarikPiutangAction,
  getEsBalokPeriodSummaryAction,
  getEsBalokStatusOverviewAction,
  getEsBalokPembayaranByDateAction,
  setEsBalokCollectionTargetAction,
  removeEsBalokCollectionTargetAction,
} from "./actions";

const KODE = "pmputra";

function monthStart(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function tomorrow(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
}

export default async function PmputraPiutangPage() {
  await requirePmputra();
  const [data, perAgen, invoiceRows] = await Promise.all([
    getPiutangSummary("pmputra"),
    getPiutangPerAgen("pmputra", monthStart(), tomorrow()),
    getEsBalokInvoiceOutstanding(KODE),
  ]);

  // Direct-call pattern for the INITIAL render (same as
  // getPiutangSummary/getPiutangPerAgen above) -- the Task 5 Server Actions
  // are for Client Component re-fetches after an interaction (date-range
  // change, Pembayaran date picker, target mutations), not for this page's
  // own first paint.
  //
  // NOTE: getEsBalokPiutangPeriodSummary/getEsBalokStatusOverview are NOT
  // called directly here even though the brief lists them alongside the
  // other 3 -- PiutangSummaryPanel (src/components/dashboard/
  // piutang-summary-panel.tsx) has no prop to accept pre-fetched period
  // summary/status data; it always fetches both itself client-side on mount
  // via the fetchPeriodSummary/fetchStatusOverview Server Actions passed
  // below. Calling those 2 queries again here would just be a discarded,
  // duplicate DB round trip.
  // Must be midnight-truncated "today", NOT the current instant --
  // getEsBalokPembayaranByDate filters a literal [@date, @date+1day) window,
  // so passing `new Date()` (e.g. 14:32) would exclude every payment made
  // earlier today and instead leak into tomorrow. Constructed the same way
  // getEsBalokPembayaranByDateAction truncates its own `dateISO` input, so
  // the initial render matches exactly what reselecting "today" in the
  // Pembayaran date-picker would fetch.
  const todayMidnight = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00`);
  const [priorityRows, pembayaranRows] = await Promise.all([
    getEsBalokCollectionPriority(KODE, invoiceRows),
    getEsBalokPembayaranByDate(KODE, todayMidnight, invoiceRows),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Piutang</h1>
        <p className="text-sm text-muted-foreground">PT Prima Maesa Putra — Es Balok</p>
      </div>
      <PiutangSummaryPanel
        data={data}
        fetchPeriodSummary={getEsBalokPeriodSummaryAction}
        fetchStatusOverview={getEsBalokStatusOverviewAction}
      />
      <PiutangTabs
        invoicePanel={<EsBalokInvoiceOutstandingTable rows={invoiceRows} />}
        pembayaranPanel={
          <EsBalokPembayaranPanelContainer initialRows={pembayaranRows} fetchByDate={getEsBalokPembayaranByDateAction} />
        }
        prioritasPanel={
          <EsBalokCollectionPriorityTable
            rows={priorityRows}
            onSetTarget={setEsBalokCollectionTargetAction}
            onRemoveTarget={removeEsBalokCollectionTargetAction}
          />
        }
      />
      <div>
        <h2 className="font-display text-lg font-semibold">Rincian per Agen</h2>
        <p className="text-sm text-muted-foreground">Tabungan/Hutang Awal, Pesanan, Retur, Pembayaran, Tarikan, dan Saldo Akhir.</p>
      </div>
      <PiutangPerAgenTable
        initialRows={perAgen}
        fetchAction={getPiutangPerAgenAction}
        fetchBayarContext={getPiutangBayarContextAction}
        submitBayar={bayarPiutangAction}
        fetchTarikContext={getPiutangTarikContextAction}
        submitTarik={tarikPiutangAction}
      />
    </div>
  );
}
