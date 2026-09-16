"use client";

import { useEffect, useRef, useState } from "react";
import type { BulanPenjualan } from "@/lib/kinerja/marketing-collection-penjualan";

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
                      {formatSigned(b.deltaNoo)}
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
                      {formatSigned(b.deltaExisting)}
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

          {detailBulan && (
            <div className="rounded-xl border p-4 text-sm">
              <p className="mb-2 font-medium">Rincian Perhitungan — {formatBulan(detailBulan.bulanMulai)}</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <p className="font-medium">NOO</p>
                  <p>QTY sebelumnya: {detailBulan.qtyNooSebelumnya.toLocaleString("id-ID")} {satuan}</p>
                  <p>QTY berjalan: {detailBulan.qtyNooBerjalan.toLocaleString("id-ID")} {satuan}</p>
                  <p>Selisih: {formatSigned(detailBulan.deltaNoo)} {satuan}</p>
                </div>
                <div>
                  <p className="font-medium">Existing</p>
                  <p>QTY sebelumnya: {detailBulan.qtyExistingSebelumnya.toLocaleString("id-ID")} {satuan}</p>
                  <p>QTY berjalan: {detailBulan.qtyExistingBerjalan.toLocaleString("id-ID")} {satuan}</p>
                  <p>Selisih: {formatSigned(detailBulan.deltaExisting)} {satuan}</p>
                </div>
              </div>
              <div className="mt-3 border-t pt-2">
                <p className="font-medium">
                  Total: {formatSigned(detailBulan.totalQty)} {satuan}
                </p>
                <p className="font-medium">
                  Nilai: {detailBulan.totalQty.toLocaleString("id-ID")} × Rp200 = {formatRupiah(detailBulan.nilaiRupiah)}
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
