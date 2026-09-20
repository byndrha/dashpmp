"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WAREHOUSE_ZONES } from "@/components/produksi/warehouse-layout";
import { WarehouseCell } from "@/components/produksi/warehouse-cell";
import { RiwayatPosisiListDesktop } from "@/components/produksi/riwayat-posisi-list-desktop";
import { KAPASITAS_PALLET_10KG } from "@/lib/produksi-warehouse-constants";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";
import type { MesinRow } from "@/lib/queries/produksi-mesin";
import { createBatchBaselineAction } from "@/app/mkesindo/produksi/actions";

// Dipindah ke BAWAH LUAR kotak peta (sejajar Pintu Geser) dan dibuat grid
// 2 kolom x 2 baris sesuai permintaan user 2026-09-19 -- dirender di
// page.tsx, bukan lagi di dalam/atas peta.
export function WarehouseLegend() {
  return (
    // grid-cols-[auto_auto] (bukan grid-cols-2 / minmax(0,1fr)) + whitespace-nowrap
    // -- kolom "1fr" defaultnya boleh menyusut sampai 0 begitu ruang
    // tersedia menipis, melipat teks jadi 2 baris; "auto" mempertahankan
    // lebar alami tiap kolom apa pun ruang yang tersedia.
    <div className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-[11px]">
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="size-3 shrink-0 rounded-sm bg-red-600" /> &gt;24 Jam
      </span>
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="size-3 shrink-0 rounded-sm bg-amber-500" /> &gt;12 Jam
      </span>
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="size-3 shrink-0 rounded-sm bg-emerald-600" /> &lt;12 Jam
      </span>
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="size-3 shrink-0 rounded-sm bg-muted" /> Kosong
      </span>
    </div>
  );
}

export function PetaWarehouseDesktop({ posisi, mesinList }: { posisi: PalletPosisiRow[]; mesinList: MesinRow[] }) {
  // Stores just the id, not the row itself -- so the summary below (Terisi
  // X/120, batch count) always reflects the LATEST posisi prop after an
  // Ubah/Hapus in RiwayatPosisiListDesktop triggers a server refresh,
  // instead of freezing on the stale row object captured at click time.
  const [selectedPosisiId, setSelectedPosisiId] = useState<number | null>(null);
  const byKode = new Map(posisi.map((p) => [p.Kode, p]));
  const selected = selectedPosisiId != null ? (posisi.find((p) => p.PosisiID === selectedPosisiId) ?? null) : null;

  const [showBaselineForm, setShowBaselineForm] = useState(false);
  const [baselineMesinId, setBaselineMesinId] = useState<number | "">("");
  const [baselineQty, setBaselineQty] = useState("");
  const [baselineAlasan, setBaselineAlasan] = useState("");
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const [baselinePending, startBaselineTransition] = useTransition();

  function handleTambahBaseline() {
    if (!selected) return;
    setBaselineError(null);
    startBaselineTransition(async () => {
      const result = await createBatchBaselineAction(
        selected.PosisiID,
        Number(baselineMesinId),
        Number(baselineQty) || 0,
        baselineAlasan.trim()
      );
      if (!result.success) {
        setBaselineError(result.error);
        return;
      }
      setShowBaselineForm(false);
      setBaselineMesinId("");
      setBaselineQty("");
      setBaselineAlasan("");
    });
  }

  // Legenda harus selalu presis di tengah "Pintu Geser" berapa pun lebar
  // layar -- offset dari TEPI KANAN kotak tidak bisa dipakai karena kotak
  // ini melebar penuh mengikuti kolom grid (bukan shrink-to-content),
  // sedangkan zona pallete di dalamnya rata kiri dengan lebar tetap
  // (piksel), jadi jarak Pintu Geser ke tepi KANAN kotak berubah-ubah
  // mengikuti lebar layar. Diukur langsung dari DOM (posisi Pintu Geser
  // relatif ke tepi KIRI kotak, yang tetap) dan dihitung ulang saat resize,
  // sesuai permintaan user 2026-09-19.
  const boxRef = useRef<HTMLDivElement>(null);
  const pintuGeserRef = useRef<HTMLParagraphElement>(null);
  const [legendLeft, setLegendLeft] = useState<number | null>(null);

  useEffect(() => {
    function updateLegendPosition() {
      if (!boxRef.current || !pintuGeserRef.current) return;
      const boxRect = boxRef.current.getBoundingClientRect();
      const pgRect = pintuGeserRef.current.getBoundingClientRect();
      setLegendLeft(pgRect.left + pgRect.width / 2 - boxRect.left);
    }
    updateLegendPosition();
    window.addEventListener("resize", updateLegendPosition);
    return () => window.removeEventListener("resize", updateLegendPosition);
  }, []);

  return (
    // relative supaya panel Info Pallet bisa melayang (absolute) DI ATAS
    // peta -- bukan lagi flex sibling yang menyempitkan/menggeser peta ke
    // samping -- sehingga background transparan+blur panel itu benar-benar
    // menampakkan sel pallete peta yang tertutup di baliknya, sesuai
    // permintaan user 2026-09-19.
    <div ref={boxRef} className="relative rounded-lg border border-border p-4">
      <div className="flex flex-col gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-4 overflow-x-auto pb-2">
            {WAREHOUSE_ZONES.map((zone, zoneIdx) => (
              <div key={zone.id} className="flex items-start gap-4">
                {zoneIdx > 0 && <div className="mt-6 h-full w-px self-stretch bg-border" />}
                <div className="flex min-w-fit flex-col gap-1">
                  <p className="text-center text-[11px] uppercase tracking-wide text-muted-foreground">
                    {zone.label} (kode {zone.id})
                  </p>
                  {zone.grup.map((g) => (
                    <div key={g.id} className="flex flex-col gap-1">
                      {g.id === "S1" || g.id === "S2" ? (
                        // Persegi panjang dekoratif di kiri kolom pertama
                        // grup ini (S1F-S1E-S1D, lalu S2D-S2E-S2F) -- lebar
                        // 0.5, tinggi 2.5 ukuran pallete, sesuai permintaan
                        // user 2026-09-19 -- items-center supaya titik
                        // tengahnya tetap sejajar baris tengah grup (S1E /
                        // S2E) walau tingginya tidak menyamai penuh 3 baris.
                        <div className="flex items-center gap-3">
                          <div className="h-[137.5px] w-[27.5px] shrink-0 rounded-md border border-border bg-muted/30" />
                          <div className="flex flex-1 flex-col gap-1">
                            {g.rows.map((row, i) => (
                              <div key={i} className="flex gap-2">
                                {row.map((kode) => (
                                  <WarehouseCell
                                    key={kode}
                                    kode={kode}
                                    row={byKode.get(kode)}
                                    onClick={(r) => r && setSelectedPosisiId(r.PosisiID)}
                                  />
                                ))}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        g.rows.map((row, i) => (
                          <div key={i} className="flex gap-2">
                            {row.map((kode) => (
                              <WarehouseCell
                                key={kode}
                                kode={kode}
                                row={byKode.get(kode)}
                                onClick={(r) => r && setSelectedPosisiId(r.PosisiID)}
                              />
                            ))}
                          </div>
                        ))
                      )}
                      {g.dividerAfter && (
                        <div
                          className={cn(
                            "flex items-center gap-2 text-center text-[11px] text-muted-foreground",
                            // Jalan Selatan/Tengah ("Jalan" polos, beda dari
                            // "Jalan & Jendela N" milik Utara) dikasih tinggi
                            // sedikit lebih lega sesuai permintaan user
                            // 2026-09-19.
                            g.dividerAfter === "Jalan" && "py-1.5"
                          )}
                        >
                          <span className="flex-1 border-t border-dashed border-border" />
                          <span>{g.dividerAfter}</span>
                          <span className="flex-1 border-t border-dashed border-border" />
                        </div>
                      )}
                    </div>
                  ))}
                  {zone.showPintuGeser && (
                    <p ref={pintuGeserRef} className="mt-2 rounded-md bg-muted py-1 text-center text-xs font-medium">
                      Pintu Geser
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {selected && (
          // Melayang (absolute) di kanan ATAS peta, bukan flex sibling --
          // background transparan+blur di sini beneran menampakkan sel
          // pallete peta yang tertutup di baliknya, sesuai permintaan user
          // 2026-09-19.
          <div className="absolute inset-y-4 right-4 z-10 flex w-72 flex-col gap-3 overflow-y-auto rounded-lg border border-border/60 bg-background/60 p-3 backdrop-blur-md">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-muted-foreground">Info Pallet {selected.Kode}</p>
              <Button variant="ghost" size="icon" className="size-6" onClick={() => setSelectedPosisiId(null)}>
                <X className="size-3.5" />
              </Button>
            </div>
            <RiwayatPosisiListDesktop key={selected.PosisiID} posisiId={selected.PosisiID} />
            <div className="rounded-md border border-border p-3 text-sm">
              <p className="font-semibold">Pallet {selected.Kode}</p>
              <p className="text-muted-foreground">
                Terisi {selected.TotalSisaQty10KG}/{KAPASITAS_PALLET_10KG} kantong 10kg
                {selected.JumlahBatchAktif > 1 && ` — ${selected.JumlahBatchAktif} batch aktif`}
              </p>
            </div>
            {!showBaselineForm ? (
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowBaselineForm(true)}>
                + Tambah Stok Awal
              </Button>
            ) : (
              <div className="flex flex-col gap-1.5 rounded-md border border-border p-2.5">
                <p className="text-xs font-semibold">Tambah Stok Awal</p>
                <select
                  className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                  value={baselineMesinId}
                  onChange={(e) => setBaselineMesinId(e.target.value === "" ? "" : Number(e.target.value))}
                >
                  <option value="">Pilih Mesin</option>
                  {mesinList.map((m) => (
                    <option key={m.MesinID} value={m.MesinID}>
                      {m.Nama}
                    </option>
                  ))}
                </select>
                <Input
                  type="number"
                  placeholder="Qty 10kg"
                  value={baselineQty}
                  onChange={(e) => setBaselineQty(e.target.value)}
                  className="h-7 text-xs"
                />
                <Input
                  type="text"
                  placeholder="Alasan (wajib)"
                  value={baselineAlasan}
                  onChange={(e) => setBaselineAlasan(e.target.value)}
                  className="h-7 text-xs"
                />
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    className="h-7 flex-1 text-xs"
                    disabled={baselinePending || !baselineMesinId || !baselineQty || !baselineAlasan.trim()}
                    onClick={handleTambahBaseline}
                  >
                    Simpan
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowBaselineForm(false)}>
                    Batal
                  </Button>
                </div>
                {baselineError && <p className="text-[11px] text-destructive">{baselineError}</p>}
              </div>
            )}
          </div>
        )}
      </div>
      {/* w-max WAJIB -- tanpa ini, div absolute dengan width:auto memakai
          algoritma shrink-to-fit yang dibatasi RUANG TERSISA dari titik
          `left` sampai tepi kanan kotak (containing block). Begitu kotak
          menyempit (mengikuti kolom grid saat layar dipersempit) sampai
          lebih sempit dari offset Pintu Geser, ruang tersisa itu jadi
          kecil/negatif, sehingga grid 2-kolom legenda dipaksa menyusut dan
          teksnya melipat 2 baris -- w-max memaksa lebar penuh sesuai
          konten (max-content), lepas dari ruang tersisa itu. Sesuai
          laporan user 2026-09-19. */}
      <div
        className="absolute top-full z-10 mt-1 w-max"
        style={legendLeft != null ? { left: legendLeft, transform: "translateX(-50%)" } : { visibility: "hidden" }}
      >
        <WarehouseLegend />
      </div>
    </div>
  );
}
