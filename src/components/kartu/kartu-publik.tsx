import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { teksIsi } from "@/lib/bychat/isi-pesanan";
import type { KartuPiutangData } from "@/lib/bychat/mitra";
import { esBalokAgingBucket } from "@/lib/queries/piutang-invoice-outstanding";

// Tampilan HTML kartu piutang untuk tautan publik. Gaya = modul piutang
// (Card shadcn, pill umur piutang, nomor faktur font-data), tanpa label status/
// segmentasi dan tanpa tombol bayar.

const BUCKET_TONE: Record<string, string> = {
  "Belum Jatuh Tempo": "bg-muted text-muted-foreground",
  "1-30 Hari": "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  "31-60 Hari": "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  "61-90 Hari": "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  ">90 Hari": "bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-200",
};
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const tgl = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
};
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

export function KartuPublik({ data, token }: { data: KartuPiutangData; token: string }) {
  const urut = [...data.faktur].sort((a, b) => b.hariLewat - a.hariLewat || a.tanggal.localeCompare(b.tanggal));
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-4 p-4 sm:py-8">
      <header>
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Kartu Piutang</p>
        <h1 className="font-display text-2xl font-semibold">{data.ptNama}</h1>
        <p className="text-sm text-muted-foreground">Posisi per {tgl(data.tanggalPosisi)}</p>
      </header>

      <Card className="py-4">
        <CardContent className="flex flex-col gap-2 px-4">
          <div>
            <p className="text-lg font-medium">{data.mitra.nama}</p>
            {data.mitra.wilayah && <p className="text-sm text-muted-foreground">{data.mitra.wilayah}</p>}
          </div>
          <div className="flex items-center justify-between border-t pt-2">
            <span className="text-sm text-muted-foreground">{data.faktur.length} faktur belum lunas</span>
            <span className="font-display text-xl font-semibold tabular-nums">{rp(data.totalPiutang)}</span>
          </div>
          <div className="divide-y divide-border border-t">
            {urut.map((f, i) => {
              const tone = BUCKET_TONE[esBalokAgingBucket(f.hariLewat)];
              return (
                <div key={`${f.noDokumen}-${i}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                  <div className="min-w-0">
                    <p className="font-data truncate text-xs text-muted-foreground">{f.noDokumen}</p>
                    <p className="text-xs text-muted-foreground">
                      Terbit {tgl(f.tanggal)} &middot; Jatuh tempo {tgl(f.jatuhTempo)}
                    </p>
                    {f.isi.length > 0 && <p className="text-xs font-medium">{teksIsi(f.isi)}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", tone)}>
                      {f.hariLewat > 0 ? `Lewat ${f.hariLewat} hari` : "Belum jatuh tempo"}
                    </span>
                    <span className="text-sm font-semibold tabular-nums">{rp(f.sisa)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="py-4">
        <CardContent className="flex flex-col gap-2 px-4">
          <p className="font-medium">Cara pembayaran</p>
          {data.rekening.length > 0 ? (
            data.rekening.map((r, i) => (
              <div key={`${r.bank}-${r.nomorRekening}-${i}`} className="flex flex-col gap-0.5">
                <p>
                  <span className="rounded bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary">Transfer {r.bank}</span>{" "}
                  <span className="font-data text-lg font-medium">{r.nomorRekening}</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {[r.atasNama ? `a.n. ${r.atasNama}` : "", r.catatan ?? ""].filter(Boolean).join(" · ")}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Hubungi admin kami untuk informasi pembayaran.</p>
          )}
          {data.rekening.length > 0 && <p className="text-sm text-muted-foreground">Mohon konfirmasi setelah transfer.</p>}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        <a className="underline underline-offset-4" href={`/kartu/${token}/gambar`} download={`kartu-piutang-${data.tanggalPosisi}.png`}>
          Unduh sebagai gambar
        </a>
      </p>
    </main>
  );
}
