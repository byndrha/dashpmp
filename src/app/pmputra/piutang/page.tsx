// src/app/pmputra/piutang/page.tsx
import { getPiutangSummary, getPiutangPerAgen } from "@/lib/queries/penjualan-piutang";
import { requirePmputra } from "@/lib/require-access";
import { PiutangSummaryPanel } from "@/components/dashboard/piutang-summary-panel";
import { PiutangPerAgenTable } from "@/components/dashboard/piutang-per-agen-table";
import {
  getPiutangPerAgenAction,
  getPiutangBayarContextAction,
  bayarPiutangAction,
  getPiutangTarikContextAction,
  tarikPiutangAction,
} from "./actions";

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
  const [data, perAgen] = await Promise.all([
    getPiutangSummary("pmputra"),
    getPiutangPerAgen("pmputra", monthStart(), tomorrow()),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-semibold">Piutang</h1>
        <p className="text-sm text-muted-foreground">PT Prima Maesa Putra — Es Balok</p>
      </div>
      <PiutangSummaryPanel data={data} />
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
