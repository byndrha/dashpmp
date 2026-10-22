"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { QrisBayar, RekeningBayar } from "@/lib/bychat/mitra";

// Cara pembayaran di tautan publik kartu piutang: tab TRANSFER / QRIS seperti
// panel di invoice publik, hanya menampilkan (tanpa tombol konfirmasi).
export function MetodeBayarKartu({ rekening, qris }: { rekening: RekeningBayar[]; qris: QrisBayar[] }) {
  const tab = [...(rekening.length > 0 ? ["TRANSFER"] : []), ...(qris.length > 0 ? ["QRIS"] : [])];
  if (tab.length === 0) return <p className="text-sm text-muted-foreground">Hubungi admin kami untuk informasi pembayaran.</p>;

  return (
    <Tabs defaultValue={tab[0]}>
      <TabsList>
        {tab.map((t) => (
          <TabsTrigger key={t} value={t}>
            {t}
          </TabsTrigger>
        ))}
      </TabsList>
      {rekening.length > 0 && (
        <TabsContent value="TRANSFER" className="flex flex-col gap-3 pt-3">
          {rekening.map((r, i) => (
            <div key={`${r.bank}-${r.nomorRekening}-${i}`} className="flex flex-col gap-0.5">
              <p>
                <span className="rounded bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary">{/^bank\b/i.test(r.bank) ? r.bank : `Bank ${r.bank}`}</span>{" "}
                <span className="font-data text-lg font-medium">{r.nomorRekening}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                {[r.atasNama ? `a.n. ${r.atasNama}` : "", r.catatan ?? ""].filter(Boolean).join(" · ")}
              </p>
            </div>
          ))}
          <p className="text-sm text-muted-foreground">Mohon konfirmasi setelah transfer.</p>
        </TabsContent>
      )}
      {qris.length > 0 && (
        <TabsContent value="QRIS" className="flex flex-col gap-3 pt-3">
          {qris.map((q, i) => (
            <div key={`${q.gambar}-${i}`} className="flex flex-col items-center gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element -- proxy Google Drive, bukan aset build */}
              <img src={q.gambar} alt="QRIS" className="mx-auto h-56 w-56 object-contain" />
              {q.catatan && <p className="text-sm text-muted-foreground">{q.catatan}</p>}
            </div>
          ))}
          <p className="text-center text-sm text-muted-foreground">Mohon konfirmasi setelah membayar.</p>
        </TabsContent>
      )}
    </Tabs>
  );
}
