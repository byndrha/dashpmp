import { cache } from "react";
import { Wallet, TrendingUp, Landmark, PiggyBank } from "lucide-react";
import { getPnL, getBEP } from "@/lib/queries/pnl";
import { getCOADetail } from "@/lib/queries/keuangan-detail";
import { getBalanceSheetDetail } from "@/lib/queries/balance-sheet";
import { getCashFlowDetail } from "@/lib/queries/cash-flow";
import { getCashFlowHarian, getCashFlowHarianHistory } from "@/lib/queries/cash-flow-harian";
import { getHPPBersih } from "@/lib/queries/hpp-bersih";
import { getGLPostingHealth } from "@/lib/queries/gl-posting-health";
import { getBackfillRingkasanPerTanggal } from "@/lib/queries/gl-posting-backfill";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { SimpleBarChart } from "@/components/charts/simple-bar-chart";
import { COADetailTable } from "@/components/dashboard/coa-detail-table";
import { BalanceSheetTable } from "@/components/dashboard/balance-sheet-table";
import { CashFlowPanel } from "@/components/dashboard/cash-flow-panel";
import { CashFlowHarianPanel } from "@/components/dashboard/cash-flow-harian-panel";
import { CashFlowHarianHistoryPanel } from "@/components/dashboard/cash-flow-harian-history-panel";
import { HPPBersihPanel } from "@/components/dashboard/hpp-bersih-panel";
import { GLPostingHealthCard } from "@/components/dashboard/gl-posting-health-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  saveCOABudgetAction,
  saveCashFlowDailyFiguresAction,
  addCashFlowExpenseAction,
  deleteCashFlowExpenseAction,
  getHPPBersihAction,
  previewGLBacklogAction,
  postGLBacklogAction,
} from "@/app/mkesindo/(dashboard)/pnl/actions";
import { formatRupiah, formatPercent, formatDate } from "@/lib/format";
import type { DateRangeFilter } from "@/types/dashboard";

// Setiap seksi di bawah adalah async Server Component-nya sendiri, dirender
// lewat <Suspense> terpisah di page.tsx -- supaya halaman ini tidak lagi
// menunggu SEMUA 10 query sekaligus (KPI, GL Posting Health, 3 Cash Flow,
// P&L, Komposisi, COA, Balance Sheet, BEP, HPP Bersih) sebelum menampilkan
// apa pun, pola sama seperti /mkesindo/aging (lihat piutang-sections.tsx).
// getPnL dibungkus cache() karena dipakai 2 seksi berbeda (boks KPI +
// Rincian P&L/Komposisi) -- tetap satu query per request, bukan dobel.
const getPnLCached = cache(getPnL);

export async function PnlKpiRow({ filter }: { filter: DateRangeFilter }) {
  const pnl = await getPnLCached(filter);
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard label="Pendapatan" value={formatRupiah(pnl.Pendapatan)} icon={Wallet} />
      <KpiCard label="Laba Kotor" value={formatRupiah(pnl.LabaKotor)} icon={TrendingUp} />
      <KpiCard
        label="Laba Operasional"
        value={formatRupiah(pnl.LabaOperasional)}
        icon={Landmark}
        tone={pnl.LabaOperasional >= 0 ? "positive" : "negative"}
      />
      <KpiCard
        label="Laba Bersih"
        value={formatRupiah(pnl.LabaBersih)}
        icon={PiggyBank}
        tone={pnl.LabaBersih >= 0 ? "positive" : "negative"}
      />
    </div>
  );
}

export async function PnlGLPostingHealthSection({
  bolehProsesGLBacklog,
  backfillStartISO,
  backfillEndISO,
  todayISO,
}: {
  bolehProsesGLBacklog: boolean;
  backfillStartISO: string;
  backfillEndISO: string;
  todayISO: string;
}) {
  const [glPostingHealth, backfillRingkasan] = await Promise.all([
    getGLPostingHealth(todayISO),
    getBackfillRingkasanPerTanggal(backfillStartISO, backfillEndISO),
  ]);
  const backfillAkunIds = Array.from(new Set(Array.from(backfillRingkasan.values()).map((v) => v.dipostingOlehAkunId)));
  const backfillAkunNamaMap = await getAkunNamaMap(backfillAkunIds);
  const riwayatPerTanggal: Record<string, { jumlahDokumen: number; dipostingOlehNama: string; dipostingPada: string }> = {};
  for (const [tanggal, ringkasan] of backfillRingkasan) {
    riwayatPerTanggal[tanggal] = {
      jumlahDokumen: ringkasan.jumlahDokumen,
      dipostingOlehNama: backfillAkunNamaMap.get(ringkasan.dipostingOlehAkunId) ?? "(akun tidak ditemukan)",
      dipostingPada: ringkasan.dipostingPada,
    };
  }
  return (
    <GLPostingHealthCard
      rows={glPostingHealth}
      bolehProses={bolehProsesGLBacklog}
      onPreview={previewGLBacklogAction}
      onPost={postGLBacklogAction}
      riwayatPerTanggal={riwayatPerTanggal}
    />
  );
}

export async function PnlCashFlowSection({ filter, balanceSheetCutoff }: { filter: DateRangeFilter; balanceSheetCutoff: Date }) {
  const cashFlow = await getCashFlowDetail(filter);
  return <CashFlowPanel data={cashFlow} asOfLabel={formatDate(balanceSheetCutoff)} />;
}

export async function PnlCashFlowHarianSection({ cfDate }: { cfDate: string }) {
  const cashFlowHarian = await getCashFlowHarian(cfDate);
  return (
    <CashFlowHarianPanel
      key={cashFlowHarian.businessDate}
      data={cashFlowHarian}
      onSaveFigures={saveCashFlowDailyFiguresAction}
      onAddExpense={addCashFlowExpenseAction}
      onDeleteExpense={deleteCashFlowExpenseAction}
    />
  );
}

export async function PnlCashFlowHarianHistorySection({ cfDate }: { cfDate: string }) {
  const cashFlowHarianHistory = await getCashFlowHarianHistory();
  return <CashFlowHarianHistoryPanel rows={cashFlowHarianHistory} activeDate={cfDate} />;
}

export async function PnlRincianSection({ filter }: { filter: DateRangeFilter }) {
  const pnl = await getPnLCached(filter);
  const compositionData = [
    { name: "HPP", value: pnl.HPP },
    { name: "Biaya Tetap", value: pnl.BiayaTetap },
    { name: "Beban Operasional", value: pnl.BebanOperasional },
    { name: "Laba Bersih", value: Math.max(pnl.LabaBersih, 0) },
  ].filter((d) => d.value > 0);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Rincian P&amp;L</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <PnlRow label="Pendapatan" value={pnl.Pendapatan} />
          <PnlRow label="HPP" value={-pnl.HPP} />
          <PnlRow label="Laba Kotor" value={pnl.LabaKotor} bold />
          <PnlRow label="Biaya Tetap" value={-pnl.BiayaTetap} />
          <PnlRow label="Beban Operasional" value={-pnl.BebanOperasional} />
          <PnlRow label="Laba Operasional" value={pnl.LabaOperasional} bold />
          <PnlRow label="Penghasilan Lainnya" value={pnl.PenghasilanLainnya} />
          <PnlRow label="Adjustment" value={-pnl.Adjustment} />
          <PnlRow label="Beban Lainnya" value={-pnl.BebanLainnya} />
          <PnlRow label="Laba Bersih" value={pnl.LabaBersih} bold />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Komposisi Biaya vs Laba</CardTitle>
        </CardHeader>
        <CardContent>
          <SimpleBarChart data={compositionData} height={200} />
        </CardContent>
      </Card>
    </>
  );
}

export async function PnlCoaDetailSection({ filter, periodStart }: { filter: DateRangeFilter; periodStart: Date }) {
  const coaDetail = await getCOADetail(filter);
  return (
    <COADetailTable
      rows={coaDetail}
      year={periodStart.getUTCFullYear()}
      month={periodStart.getUTCMonth() + 1}
      onSaveBudget={saveCOABudgetAction}
    />
  );
}

export async function PnlBalanceSheetSection({ filter }: { filter: DateRangeFilter }) {
  const balanceSheet = await getBalanceSheetDetail(filter);
  return <BalanceSheetTable rows={balanceSheet} />;
}

export async function PnlBepSection({ filter }: { filter: DateRangeFilter }) {
  const bep = await getBEP(filter);
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Break-Even Point (BEP)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <PnlStat label="Revenue" value={formatRupiah(bep.Revenue)} />
            <PnlStat label="Biaya Variabel" value={formatRupiah(bep.VariableCost)} />
            <PnlStat label="Biaya Tetap" value={formatRupiah(bep.FixedCost)} />
            <PnlStat label="Margin Kontribusi" value={formatPercent(bep.MarginKontribusiPct)} />
            <PnlStat label="BEP / Bulan" value={formatRupiah(bep.BEPPerBulan)} />
          </div>
          <div className="rounded-lg border border-border bg-card/50 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Rumus Perhitungan BEP:</p>
            <p className="mt-1 font-data">Margin Kontribusi = 1 &minus; (Biaya Variabel &divide; Revenue)</p>
            <p className="font-data">BEP per Bulan = Biaya Tetap &divide; Margin Kontribusi</p>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Catatan: Biaya MIXED (Bonus, Mesin, Peralatan Kendaraan, Peralatan Mesin Produksi, Beban
        Usaha Lainnya, Beban Penunjang) sebesar {formatRupiah(bep.MixedCost)} sengaja tidak
        dimasukkan ke perhitungan BEP di atas — perlu direview manual.
      </p>
    </>
  );
}

export async function PnlHppBersihSection() {
  const hppBersih = await getHPPBersih(new Date().getUTCFullYear());
  return <HPPBersihPanel initialData={hppBersih} onNavigateYear={getHPPBersihAction} />;
}

function PnlRow({ label, value, bold = false }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "font-semibold border-t pt-2" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{formatRupiah(value)}</span>
    </div>
  );
}

function PnlStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
