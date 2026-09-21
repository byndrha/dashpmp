"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatDate, formatTime, formatRupiah } from "@/lib/format";
import type { GLPostingHealthRow } from "@/lib/queries/gl-posting-health";
import type { BacklogPreview, BacklogPostResult } from "@/lib/queries/gl-posting-backfill";
import type { ActionResult } from "@/lib/action-result";
import { GLPostingBackfillDialog } from "@/components/dashboard/gl-posting-backfill-dialog";

// Rasio dibuat vs ter-GL-posting hari itu -- >=95% dianggap normal (hijau),
// 50-94% mulai tersendat (kuning), <50% dianggap macet total (merah). Hari
// dengan 0 dokumen dibuat sama sekali dianggap normal (tidak ada yang perlu
// diposting), bukan 0%.
function rasioTone(dibuat: number, posted: number): "ok" | "warn" | "bad" {
  if (dibuat === 0) return "ok";
  const rasio = posted / dibuat;
  if (rasio >= 0.95) return "ok";
  if (rasio >= 0.5) return "warn";
  return "bad";
}

const TONE_CLASS: Record<"ok" | "warn" | "bad", string> = {
  ok: "text-foreground",
  warn: "text-amber-600 font-semibold",
  bad: "text-destructive font-semibold",
};

function RasioCell({ dibuat, posted, sublabel }: { dibuat: number; posted: number; sublabel?: string }) {
  const tone = rasioTone(dibuat, posted);
  const persen = dibuat === 0 ? null : Math.round((posted / dibuat) * 100);
  return (
    <TableCell className={cn("px-1.5 py-1.5 text-right text-xs tabular-nums", TONE_CLASS[tone])}>
      {sublabel ?? `${posted}/${dibuat}`}
      {persen != null && <span className="ml-1 text-[10px]">({persen}%)</span>}
    </TableCell>
  );
}

interface GLPostingHealthCardProps {
  rows: GLPostingHealthRow[];
  bolehProses: boolean;
  onPreview: (tanggal: string) => Promise<ActionResult<BacklogPreview>>;
  onPost: (tanggal: string) => Promise<ActionResult<BacklogPostResult>>;
  // Ringkasan "siapa & kapan" dari DashboardGLPostingBackfill (spec Bagian 3)
  // untuk baris tanggal yang sudah pernah diproses fitur ini -- dari Server
  // Component (getBackfillRingkasanPerTanggal + getAkunNamaMap di pnl/page.tsx),
  // sudah diserialisasi jadi plain object (bukan Map) supaya bisa lewat props.
  riwayatPerTanggal: Record<string, { jumlahDokumen: number; dipostingOlehNama: string; dipostingPada: string }>;
}

export function GLPostingHealthCard({ rows, bolehProses, onPreview, onPost, riwayatPerTanggal }: GLPostingHealthCardProps) {
  const [tanggalDiproses, setTanggalDiproses] = useState<string | null>(null);

  const adaMasalah = rows.some(
    (r) => rasioTone(r.siDibuat, r.siPosted) === "bad" || rasioTone(r.doDibuat, r.doPosted) === "bad"
  );

  const totalSIDibuat = rows.reduce((s, r) => s + r.siDibuat, 0);
  const totalSIPosted = rows.reduce((s, r) => s + r.siPosted, 0);
  const totalRpDibuat = rows.reduce((s, r) => s + r.siRupiahDibuat, 0);
  const totalRpPosted = rows.reduce((s, r) => s + r.siRupiahPosted, 0);
  const persenDok = totalSIDibuat === 0 ? 100 : Math.round((totalSIPosted / totalSIDibuat) * 100);

  return (
    <details className="group overflow-hidden rounded-xl bg-card text-sm text-card-foreground ring-1 ring-foreground/10 shadow-md">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2 font-heading text-base font-medium leading-snug">
          Kesehatan Posting GL (SI/DO)
          {adaMasalah && <AlertTriangle className="size-4 shrink-0 text-destructive" />}
        </span>
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {totalSIPosted}/{totalSIDibuat} SI ({persenDok}%)
          </span>
          <span className="tabular-nums">
            {formatRupiah(totalRpPosted)} / {formatRupiah(totalRpDibuat)}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="px-4 pb-4">
        <p className="mb-2 text-xs text-muted-foreground">
          Membandingkan jumlah SalesInvoice/DeliveryOrder yang dibuat per hari terhadap jumlah yang
          benar-benar ter-posting ke GeneralLedger pada hari yang sama, termasuk nilai Rupiah
          Pendapatan yang seharusnya vs yang benar-benar masuk COA. Rasio rendah berarti ada dokumen
          yang belum masuk COA — segera periksa kalau tanda merah muncul beberapa hari berturut-turut.
        </p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-7 px-1.5 text-[10px]">Tanggal</TableHead>
                <TableHead className="h-7 px-1.5 text-right text-[10px]">SI Posted/Dibuat</TableHead>
                <TableHead className="h-7 px-1.5 text-right text-[10px]">Pendapatan Ter-posting/Seharusnya (Rp)</TableHead>
                <TableHead className="h-7 px-1.5 text-right text-[10px]">DO Posted/Dibuat</TableHead>
                <TableHead className="h-7 px-1.5 text-right text-[10px]">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.tanggal}>
                  <TableCell className="px-1.5 py-1.5 text-xs">{formatDate(r.tanggal)}</TableCell>
                  <RasioCell dibuat={r.siDibuat} posted={r.siPosted} />
                  <RasioCell
                    dibuat={r.siRupiahDibuat}
                    posted={r.siRupiahPosted}
                    sublabel={`${formatRupiah(r.siRupiahPosted)} / ${formatRupiah(r.siRupiahDibuat)}`}
                  />
                  <RasioCell dibuat={r.doDibuat} posted={r.doPosted} />
                  <TableCell className="px-1.5 py-1.5 text-right">
                    {bolehProses &&
                      (rasioTone(r.siDibuat, r.siPosted) !== "ok" || rasioTone(r.doDibuat, r.doPosted) !== "ok") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setTanggalDiproses(r.tanggal)}
                      >
                        Proses
                      </Button>
                    )}
                    {riwayatPerTanggal[r.tanggal] && (
                      <p className="mt-0.5 whitespace-normal text-right text-[10px] text-muted-foreground">
                        {riwayatPerTanggal[r.tanggal].jumlahDokumen} dok. diposting manual oleh{" "}
                        {riwayatPerTanggal[r.tanggal].dipostingOlehNama} (
                        {/* dipostingPada berasal dari DipostingPada, kolom DEFAULT
                            GETDATE() (bukan naive-WIB seperti TransDate-family) --
                            server SQL Server ini genuinely UTC (lihat precedent di
                            marketing-collection-attribution.ts:113-121 soal
                            ReviewedAt), jadi nilainya TRUE UTC instant. Pakai
                            formatDate/formatTime BIASA (bukan *Wib), yang tidak
                            pin timeZone dan karenanya membaca timezone ambien --
                            browser end user (WIB) di komponen client ini -- supaya
                            konversi UTC->WIB terjadi secara otomatis dan benar. */}
                        {formatDate(riwayatPerTanggal[r.tanggal].dipostingPada)}{" "}
                        {formatTime(riwayatPerTanggal[r.tanggal].dipostingPada)})
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {tanggalDiproses && (
        <GLPostingBackfillDialog
          tanggal={tanggalDiproses}
          open={tanggalDiproses !== null}
          onOpenChange={(open) => !open && setTanggalDiproses(null)}
          onPreview={onPreview}
          onPost={onPost}
          onSelesai={() => {
            /* revalidatePath di postGLBacklogAction sudah memicu refresh data
               server -- tidak perlu aksi tambahan di sini. */
          }}
        />
      )}
    </details>
  );
}
