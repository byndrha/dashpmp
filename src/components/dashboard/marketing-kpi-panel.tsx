import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { MarketingKPIRow } from "@/lib/queries/mitra-pengajuan";

const TARGET_KUNJUNGAN_BULANAN = 300;
const TARGET_KONVERSI_PERSEN = 75;

function ProgressBar({
  label,
  valueLabel,
  pct,
  achieved,
}: {
  label: string;
  valueLabel: string;
  pct: number;
  achieved: boolean;
}) {
  const width = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{valueLabel}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", achieved ? "bg-primary" : "bg-warning")}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

export function MarketingKPIPanel({ rows }: { rows: MarketingKPIRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Pencapaian Marketing &mdash; Bulan Berjalan</CardTitle>
        <CardDescription>
          Target {TARGET_KUNJUNGAN_BULANAN} kunjungan outlet baru/bulan (10/hari/orang),{" "}
          {TARGET_KONVERSI_PERSEN}% konversi jadi pemesanan.
        </CardDescription>
      </CardHeader>
      <CardContent className="@container flex flex-col gap-4">
        {rows.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">Belum ada data marketing.</p>
        )}
        {rows.map((r) => {
          const kunjunganPct = (r.Kunjungan / TARGET_KUNJUNGAN_BULANAN) * 100;
          const konversiPct = r.Kunjungan > 0 ? (r.Konversi / r.Kunjungan) * 100 : 0;
          return (
            <div key={r.UserID} className="flex flex-col gap-2 border-b pb-4 last:border-b-0 last:pb-0">
              <p className="text-sm font-medium">{r.Nama}</p>
              <div className="grid grid-cols-1 gap-3 @lg:grid-cols-2">
                <ProgressBar
                  label="Jumlah Kunjungan"
                  valueLabel={`${r.Kunjungan.toLocaleString("id-ID")} / ${TARGET_KUNJUNGAN_BULANAN}`}
                  pct={kunjunganPct}
                  achieved={kunjunganPct >= 100}
                />
                <ProgressBar
                  label="Konversi Transaksi"
                  valueLabel={`${konversiPct.toFixed(0)}% / ${TARGET_KONVERSI_PERSEN}%`}
                  pct={konversiPct}
                  achieved={konversiPct >= TARGET_KONVERSI_PERSEN}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
