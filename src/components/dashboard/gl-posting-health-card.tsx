import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import type { GLPostingHealthRow } from "@/lib/queries/gl-posting-health";

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

function RasioCell({ dibuat, posted }: { dibuat: number; posted: number }) {
  const tone = rasioTone(dibuat, posted);
  const persen = dibuat === 0 ? null : Math.round((posted / dibuat) * 100);
  return (
    <TableCell className={cn("px-1.5 py-1.5 text-right text-xs tabular-nums", TONE_CLASS[tone])}>
      {posted}/{dibuat}
      {persen != null && <span className="ml-1 text-[10px]">({persen}%)</span>}
    </TableCell>
  );
}

export function GLPostingHealthCard({ rows }: { rows: GLPostingHealthRow[] }) {
  const adaMasalah = rows.some(
    (r) => rasioTone(r.siDibuat, r.siPosted) === "bad" || rasioTone(r.doDibuat, r.doPosted) === "bad"
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Kesehatan Posting GL (SI/DO)
          {adaMasalah && <AlertTriangle className="size-4 text-destructive" />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-xs text-muted-foreground">
          Membandingkan jumlah SalesInvoice/DeliveryOrder yang dibuat per hari terhadap jumlah yang
          benar-benar ter-posting ke GeneralLedger pada hari yang sama. Rasio rendah berarti ada
          dokumen yang belum masuk COA — segera periksa kalau tanda merah muncul beberapa hari
          berturut-turut.
        </p>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-7 px-1.5 text-[10px]">Tanggal</TableHead>
                <TableHead className="h-7 px-1.5 text-right text-[10px]">SI Posted/Dibuat</TableHead>
                <TableHead className="h-7 px-1.5 text-right text-[10px]">DO Posted/Dibuat</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.tanggal}>
                  <TableCell className="px-1.5 py-1.5 text-xs">{formatDate(r.tanggal)}</TableCell>
                  <RasioCell dibuat={r.siDibuat} posted={r.siPosted} />
                  <RasioCell dibuat={r.doDibuat} posted={r.doPosted} />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
