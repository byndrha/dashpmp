// src/app/pmpersada/keuangan/page.tsx
import { Wallet, TrendingUp, Landmark, PiggyBank } from "lucide-react";
import { getPnLPmpersada, getBEPPmpersada } from "@/lib/queries/pnl-pmpersada";
import {
  getCOADetailPmpersada,
  listChartOfAccountForCostBehaviorPmpersada,
} from "@/lib/queries/keuangan-detail-pmpersada";
import { getBalanceSheetPmpersada } from "@/lib/queries/balance-sheet-pmpersada";
import { getCashFlowPmpersada } from "@/lib/queries/cash-flow-pmpersada";
import { getCashFlowHarianPmpersada, getCashFlowHarianHistoryPmpersada } from "@/lib/queries/cash-flow-harian-pmpersada";
import { getHPPBersihPmpersada } from "@/lib/queries/hpp-bersih-pmpersada";
import { getBusinessDateISO } from "@/lib/business-date";
import { requirePmpersada } from "@/lib/require-access";
import { resolveFilter, type DashboardSearchParams } from "@/lib/date-range";
import { FilterBar } from "@/components/dashboard/filter-bar";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { SimpleBarChart } from "@/components/charts/simple-bar-chart";
import { COADetailTable } from "@/components/dashboard/coa-detail-table";
import { BalanceSheetTable } from "@/components/dashboard/balance-sheet-table";
import { CashFlowPanel } from "@/components/dashboard/cash-flow-panel";
import { CashFlowHarianPanel } from "@/components/dashboard/cash-flow-harian-panel";
import { CashFlowHarianHistoryPanel } from "@/components/dashboard/cash-flow-harian-history-panel";
import { HPPBersihPanel } from "@/components/dashboard/hpp-bersih-panel";
import { CostBehaviorEditor } from "@/components/dashboard/cost-behavior-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRupiah, formatPercent, formatDate } from "@/lib/format";
import {
  saveCOABudgetPmpersadaAction,
  saveCashFlowDailyFiguresPmpersadaAction,
  addCashFlowExpensePmpersadaAction,
  deleteCashFlowExpensePmpersadaAction,
  getHPPBersihPmpersadaAction,
  setCostBehaviorPmpersadaAction,
} from "@/app/pmpersada/keuangan/actions";

export default async function PmpersadaKeuanganPage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  await requirePmpersada();
  const params = await searchParams;
  const filter = resolveFilter(params);
  const cfDate = params.cfDate ?? getBusinessDateISO();

  const [pnl, bep, coaDetail, costBehaviorRows, balanceSheet, cashFlow, cashFlowHarian, cashFlowHarianHistory, hppBersih] =
    await Promise.all([
      getPnLPmpersada(filter),
      getBEPPmpersada(filter),
      getCOADetailPmpersada(filter),
      listChartOfAccountForCostBehaviorPmpersada(),
      getBalanceSheetPmpersada(filter),
      getCashFlowPmpersada(filter),
      getCashFlowHarianPmpersada(cfDate),
      getCashFlowHarianHistoryPmpersada(),
      getHPPBersihPmpersada(new Date().getUTCFullYear()),
    ]);

  const periodStart = new Date(filter.startDate);
  const endDateUTC = new Date(filter.endDate);
  const balanceSheetCutoff = new Date(
    Date.UTC(endDateUTC.getUTCFullYear(), endDateUTC.getUTCMonth(), endDateUTC.getUTCDate() - 1)
  );

  const compositionData = [
    { name: "HPP", value: pnl.HPP },
    { name: "Biaya Tetap", value: pnl.BiayaTetap },
    { name: "Beban Operasional", value: pnl.BebanOperasional },
    { name: "Laba Bersih", value: Math.max(pnl.LabaBersih, 0) },
  ].filter((d) => d.value > 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Keuangan</h1>
        <p className="text-sm text-muted-foreground">PT Putra Maesa Persada — Es Balok</p>
      </div>
      <FilterBar />

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

      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-5">
        <div className="flex flex-col gap-4 @4xl:col-span-3">
          <CashFlowPanel data={cashFlow} asOfLabel={formatDate(balanceSheetCutoff)} />
          <CashFlowHarianPanel
            key={cashFlowHarian.businessDate}
            data={cashFlowHarian}
            onSaveFigures={saveCashFlowDailyFiguresPmpersadaAction}
            onAddExpense={addCashFlowExpensePmpersadaAction}
            onDeleteExpense={deleteCashFlowExpensePmpersadaAction}
          />
          <CashFlowHarianHistoryPanel rows={cashFlowHarianHistory} activeDate={cfDate} />
        </div>

        <div className="flex flex-col gap-4 @4xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Rincian P&amp;L</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Pendapatan" value={pnl.Pendapatan} />
              <Row label="HPP" value={-pnl.HPP} />
              <Row label="Laba Kotor" value={pnl.LabaKotor} bold />
              <Row label="Biaya Tetap" value={-pnl.BiayaTetap} />
              <Row label="Beban Operasional" value={-pnl.BebanOperasional} />
              <Row label="Laba Operasional" value={pnl.LabaOperasional} bold />
              <Row label="Penghasilan Lainnya" value={pnl.PenghasilanLainnya} />
              <Row label="Adjustment" value={-pnl.Adjustment} />
              <Row label="Beban Lainnya" value={-pnl.BebanLainnya} />
              <Row label="Laba Bersih" value={pnl.LabaBersih} bold />
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
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-5">
        <div className="@4xl:col-span-3 @4xl:border-r @4xl:border-border @4xl:pr-4">
          <h2 className="mb-2 font-display text-sm font-semibold text-muted-foreground">
            Detail per Akun (COA) &mdash; APBP vs Realisasi
          </h2>
          <COADetailTable
            rows={coaDetail}
            year={periodStart.getUTCFullYear()}
            month={periodStart.getUTCMonth() + 1}
            onSaveBudget={saveCOABudgetPmpersadaAction}
          />
        </div>
        <div className="@4xl:col-span-2">
          <h2 className="mb-2 font-display text-sm font-semibold text-muted-foreground">
            Detail Balance Sheet &mdash; per {formatDate(balanceSheetCutoff)}
          </h2>
          <BalanceSheetTable rows={balanceSheet} />
        </div>
      </div>

      <hr className="border-border" />

      <CostBehaviorEditor rows={costBehaviorRows} onSetCostBehavior={setCostBehaviorPmpersadaAction} />

      <Card>
        <CardHeader>
          <CardTitle>Break-Even Point (BEP)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Revenue" value={formatRupiah(bep.Revenue)} />
            <Stat label="Biaya Variabel" value={formatRupiah(bep.VariableCost)} />
            <Stat label="Biaya Tetap" value={formatRupiah(bep.FixedCost)} />
            <Stat label="Margin Kontribusi" value={formatPercent(bep.MarginKontribusiPct)} />
            <Stat label="BEP / Bulan" value={formatRupiah(bep.BEPPerBulan)} />
          </div>
          <div className="rounded-lg border border-border bg-card/50 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">Rumus Perhitungan BEP:</p>
            <p className="mt-1 font-data">Margin Kontribusi = 1 &minus; (Biaya Variabel &divide; Revenue)</p>
            <p className="font-data">BEP per Bulan = Biaya Tetap &divide; Margin Kontribusi</p>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Akun bertanda &quot;Campuran (Mixed)&quot; sebesar {formatRupiah(bep.MixedCost)} sengaja tidak dimasukkan ke
        perhitungan BEP di atas.
      </p>

      <HPPBersihPanel
        initialData={hppBersih}
        onNavigateYear={getHPPBersihPmpersadaAction}
        unitLabel="Balok"
        formulaAccountsLabel="Listrik, Garam, Air, Sewa, Oli (FINAC_ES_TB) + BBM Es, Sparepart, Oli, Vulkanisir, Pembelian Ban, Sewa (FINAC_PMP_LOGISTIC)"
      />
    </div>
  );
}

function Row({ label, value, bold = false }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "font-semibold border-t pt-2" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{formatRupiah(value)}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
