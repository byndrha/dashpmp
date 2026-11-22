// Beranda bersama PT Es Balok (PMPutra, PMPersada, PMPakis) — menggantikan
// kartu lama "Integrasi database belum dihubungkan" yang sudah tidak benar
// sejak modul Penjualan/Piutang/Keuangan Es Balok tersambung ke data nyata.
// Angka diambil dari query yang SAMA dengan modul Penjualan
// (getPenjualanBalokHari) dan Piutang (getPiutangSummary), jadi selalu
// cocok dengan halaman detailnya.
import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, Boxes, ClipboardList, Factory, LineChart, Receipt, ShoppingCart, Users, Wallet } from "lucide-react";
import { getPenjualanBalokHari, getTodayWib } from "@/lib/queries/penjualan-es-balok";
import { getPiutangSummary } from "@/lib/queries/penjualan-piutang";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { GreetingHeader } from "@/components/dashboard/greeting-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRupiah } from "@/lib/format";

function fmtAngka(n: number): string {
  return n.toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

function persen(p: number | null): string | undefined {
  if (p == null || !Number.isFinite(p)) return undefined;
  const tanda = p > 0 ? "+" : "";
  return `${tanda}${p.toLocaleString("id-ID", { maximumFractionDigits: 1 })}% vs hari yang sama bulan lalu`;
}

async function KpiEsBalok({ kode }: { kode: string }) {
  const todayISO = getTodayWib().toISOString().slice(0, 10);
  const [hari, piutang] = await Promise.all([getPenjualanBalokHari(kode, todayISO), getPiutangSummary(kode)]);
  const balok = hari.qtyKecil + hari.qtyBesar;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label="Penjualan Hari Ini"
        value={formatRupiah(hari.nominal)}
        hint={persen(hari.growthPercent)}
        icon={Wallet}
        tone="positive"
      />
      <KpiCard
        label="Balok Terjual"
        value={fmtAngka(balok)}
        hint={`Kecil ${fmtAngka(hari.qtyKecil)} · Besar ${fmtAngka(hari.qtyBesar)} · kemarin ${fmtAngka(hari.kemarinQty)}`}
        icon={Boxes}
      />
      <KpiCard
        label="Pesanan Hari Ini"
        value={fmtAngka(hari.dokumen)}
        hint={`${fmtAngka(hari.agen)} mitra memesan`}
        icon={ClipboardList}
      />
      <KpiCard
        label="Piutang Saat Ini"
        value={formatRupiah(piutang.totalPiutangSaatIni)}
        hint={`Tabungan mitra ${formatRupiah(piutang.totalTabunganSaatIni)}`}
        icon={Receipt}
        tone="warning"
      />
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-[112px] rounded-xl" />
      ))}
    </div>
  );
}

const PINTASAN = [
  { slug: "penjualan", label: "Penjualan", desc: "Omzet & balok terjual per hari/bulan", icon: ShoppingCart, keuangan: true },
  { slug: "piutang", label: "Piutang", desc: "Hutang/tabungan mitra & penagihan", icon: Receipt, keuangan: true },
  { slug: "keuangan", label: "Keuangan", desc: "Laporan keuangan perusahaan", icon: LineChart, keuangan: true },
  { slug: "pemesanan", label: "Pemesanan", desc: "Pesanan mitra & proses pengirimannya", icon: ClipboardList, keuangan: false },
  { slug: "produksi", label: "Produksi", desc: "Denah, stok, dan panen es balok", icon: Factory, keuangan: false },
  { slug: "mitra", label: "Mitra", desc: "Data & lokasi mitra", icon: Users, keuangan: false },
];

export function BerandaEsBalok({
  kode,
  nama,
  bolehKeuangan,
}: {
  kode: "pmputra" | "pmpersada" | "pmpakis";
  nama: string;
  // Akun operator produksi tidak melihat angka keuangan (sama dengan
  // require*Keuangan di require-access.ts).
  bolehKeuangan: boolean;
}) {
  const pintasan = PINTASAN.filter((p) => bolehKeuangan || !p.keuangan);
  return (
    <div className="flex flex-col gap-5">
      <GreetingHeader name={nama} />

      {bolehKeuangan && (
        <Suspense fallback={<KpiSkeleton />}>
          <KpiEsBalok kode={kode} />
        </Suspense>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Modul</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {pintasan.map((m, i) => (
            <Link
              key={m.slug}
              href={`/${kode}/${m.slug}`}
              className="group/pintasan rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300 motion-safe:fill-mode-backwards"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <Card className="py-3.5 transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out hover:border-primary/40 hover:bg-primary/5 hover:shadow-md motion-safe:hover:-translate-y-0.5">
                <CardContent className="flex items-center gap-3 px-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
                    <m.icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{m.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{m.desc}</p>
                  </div>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover/pintasan:text-primary motion-safe:group-hover/pintasan:translate-x-0.5" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
