"use client";

import { useEffect, useRef, useState } from "react";
import type { BulanPenjualan } from "@/lib/kinerja/marketing-collection-penjualan";
import { KinerjaPenjualanDetailDialog } from "@/components/dashboard/kinerja-penjualan-detail-dialog";

export interface KaryawanPenjualan {
  akunId: string;
  nama: string;
  histori: { akunId: string; bulanList: BulanPenjualan[] };
}

function formatBulan(bulanMulai: string): string {
  const d = new Date(bulanMulai + "T00:00:00Z");
  return d.toLocaleDateString("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });
}

function formatSigned(n: number): string {
  if (n > 0) return `+${n.toLocaleString("id-ID")}`;
  if (n < 0) return n.toLocaleString("id-ID");
  return "0";
}

function formatRupiah(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}Rp${Math.abs(n).toLocaleString("id-ID")}`;
}

function formatRaw(n: number): string {
  return n.toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

export function KinerjaPenjualanTable({
  jabatanNama,
  aspekNama,
  satuan,
  karyawanList,
}: {
  jabatanNama: string;
  aspekNama: string;
  satuan: string;
  karyawanList: KaryawanPenjualan[];
}) {
  const [selectedAkunId, setSelectedAkunId] = useState<string | null>(karyawanList[0]?.akunId ?? null);
  const [detailBulan, setDetailBulan] = useState<BulanPenjualan | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const selected = karyawanList.find((k) => k.akunId === selectedAkunId) ?? null;

  // History can span back to 2018 (100+ months) for a long-tenured
  // employee, and overflow-x-auto alone lands the viewer on the oldest
  // (leftmost) month. Scroll to the rightmost edge — the most recent
  // month — by default so current data is visible immediately. Re-runs
  // when the selected employee changes since switching employees can
  // change how many months are rendered.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [selectedAkunId]);

  return (
    <div className="flex flex-col gap-4">
      {karyawanList.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {karyawanList.map((k) => (
            <button
              key={k.akunId}
              onClick={() => {
                setSelectedAkunId(k.akunId);
                setDetailBulan(null);
              }}
              className={`rounded-md border px-3 py-1.5 text-sm ${
                k.akunId === selectedAkunId ? "border-primary bg-primary/10 font-medium" : "border-border"
              }`}
            >
              {k.nama}
            </button>
          ))}
        </div>
      )}

      {!selected || selected.histori.bulanList.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">Belum ada data {aspekNama.toLowerCase()}.</p>
      ) : (
        <>
          <div ref={scrollContainerRef} className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="p-2 text-left font-medium">
                    {jabatanNama} — {aspekNama} ({satuan})
                  </th>
                  {selected.histori.bulanList.map((b) => (
                    <th key={b.bulanMulai} className="p-2 text-right font-medium">
                      {formatBulan(b.bulanMulai)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b">
                  <td className="p-2 font-medium">
                    NOO
                    <div className="text-xs font-normal text-muted-foreground">Selisih dari bulan lalu</div>
                  </td>
                  {selected.histori.bulanList.map((b) => (
                    <td
                      key={b.bulanMulai}
                      className="cursor-pointer p-2 text-right hover:bg-muted/40"
                      onClick={() => setDetailBulan(b)}
                    >
                      <div>{formatSigned(b.deltaNoo)}</div>
                      <div className="text-xs text-muted-foreground">
                        Total: {formatRaw(b.qtyNooBerjalan)} {satuan}
                      </div>
                    </td>
                  ))}
                </tr>
                <tr className="border-b">
                  <td className="p-2 font-medium">
                    Existing
                    <div className="text-xs font-normal text-muted-foreground">Selisih dari bulan lalu</div>
                  </td>
                  {selected.histori.bulanList.map((b) => (
                    <td
                      key={b.bulanMulai}
                      className="cursor-pointer p-2 text-right hover:bg-muted/40"
                      onClick={() => setDetailBulan(b)}
                    >
                      <div>{formatSigned(b.deltaExisting)}</div>
                      <div className="text-xs text-muted-foreground">
                        Rata-rata: {formatRaw(b.qtyExistingBerjalan)} {satuan}/hari
                      </div>
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="p-2 font-medium">Total</td>
                  {selected.histori.bulanList.map((b) => (
                    <td
                      key={b.bulanMulai}
                      className="cursor-pointer p-2 text-right hover:bg-muted/40"
                      onClick={() => setDetailBulan(b)}
                    >
                      <div>
                        {formatSigned(b.totalQty)} {satuan}
                      </div>
                      <div className="text-xs text-muted-foreground">{formatRupiah(b.nilaiRupiah)}</div>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <KinerjaPenjualanDetailDialog
            bulan={detailBulan}
            satuan={satuan}
            onOpenChange={(open) => {
              if (!open) setDetailBulan(null);
            }}
          />
        </>
      )}
    </div>
  );
}
