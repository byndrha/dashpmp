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

// maximumFractionDigits matches formatRaw's precision below — the
// "Existing" row's delta is a difference of daily averages, so it can be
// fractional; capping both lines in a cell to the same 1 decimal keeps
// them visually consistent instead of the delta line showing up to 3
// digits (toLocaleString's default) while the raw line shows 1.
function formatSigned(n: number): string {
  const formatted = Math.abs(n).toLocaleString("id-ID", { maximumFractionDigits: 1 });
  if (n > 0) return `+${formatted}`;
  if (n < 0) return `-${formatted}`;
  return "0";
}

function formatRupiah(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}Rp${Math.abs(n).toLocaleString("id-ID")}`;
}

function formatRaw(n: number): string {
  return n.toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

// One employee's own table — pulled out so each employee gets its own
// scroll-to-recent ref and can be rendered stacked with every other
// employee's table at once, instead of behind a tab switcher.
function KinerjaPenjualanEmployeeSection({
  karyawan,
  aspekNama,
  satuan,
  onCellClick,
}: {
  karyawan: KaryawanPenjualan;
  aspekNama: string;
  satuan: string;
  onCellClick: (bulan: BulanPenjualan) => void;
}) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // History can span many months, and overflow-x-auto alone lands the
  // viewer on the oldest (leftmost) month. Scroll to the rightmost edge —
  // the most recent month — by default so current data is visible
  // immediately.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [karyawan.akunId]);

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{karyawan.nama}</h2>
      {karyawan.histori.bulanList.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">Belum ada data {aspekNama.toLowerCase()}.</p>
      ) : (
        <div ref={scrollContainerRef} className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="p-2 text-left font-medium"></th>
                {karyawan.histori.bulanList.map((b) => (
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
                {karyawan.histori.bulanList.map((b) => (
                  <td
                    key={b.bulanMulai}
                    className="cursor-pointer p-2 text-right hover:bg-muted/40"
                    onClick={() => onCellClick(b)}
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
                {karyawan.histori.bulanList.map((b) => (
                  <td
                    key={b.bulanMulai}
                    className="cursor-pointer p-2 text-right hover:bg-muted/40"
                    onClick={() => onCellClick(b)}
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
                {karyawan.histori.bulanList.map((b) => (
                  <td
                    key={b.bulanMulai}
                    className="cursor-pointer p-2 text-right hover:bg-muted/40"
                    onClick={() => onCellClick(b)}
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
      )}
    </div>
  );
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
  const [detailBulan, setDetailBulan] = useState<BulanPenjualan | null>(null);

  if (karyawanList.length === 0) {
    return <p className="p-8 text-center text-sm text-muted-foreground">Belum ada karyawan {jabatanNama}.</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      {karyawanList.map((k) => (
        <KinerjaPenjualanEmployeeSection
          key={k.akunId}
          karyawan={k}
          aspekNama={aspekNama}
          satuan={satuan}
          onCellClick={setDetailBulan}
        />
      ))}

      <KinerjaPenjualanDetailDialog
        bulan={detailBulan}
        satuan={satuan}
        onOpenChange={(open) => {
          if (!open) setDetailBulan(null);
        }}
      />
    </div>
  );
}
