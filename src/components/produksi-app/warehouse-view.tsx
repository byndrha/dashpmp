"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { WAREHOUSE_ZONES } from "@/components/produksi/warehouse-layout";
import { WarehouseCell } from "@/components/produksi/warehouse-cell";
import { TambahProduksiDialog, RiwayatPosisiList } from "@/components/produksi-app/tambah-produksi-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { KAPASITAS_PALLET_10KG } from "@/lib/produksi-warehouse-constants";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";
import type { DraftJadwalForProduksi } from "@/lib/queries/produksi-muatan";

// Ambang "mendekati keberangkatan": kartu pengiriman ditampilkan di sini
// jika waktu jadwalnya tinggal segini jam lagi (atau malah sudah lewat /
// terlambat — itu dianggap lebih mendesak lagi, jadi tidak ada batas atas
// untuk keterlambatan). Ubah angka ini saja untuk mengatur seberapa "dekat"
// yang dimaksud.
const JAM_AMBANG_MENDEKATI_KEBERANGKATAN = 2;

export function WarehouseView({
  posisi,
  jadwal = [],
  onAfterTambah,
}: {
  posisi: PalletPosisiRow[];
  // Daftar draft jadwal yang sama seperti yang dipakai tab Pengiriman
  // (KartuPengirimanList) — di sini akan disaring hanya yang mendekati
  // waktu keberangkatan. Dibuat opsional (default []) supaya pemanggil yang
  // belum diupdate tidak langsung error — tapi tetap harus dikirim isinya
  // supaya panel ini gunanya kepakai.
  jadwal?: DraftJadwalForProduksi[];
  onAfterTambah: () => void;
}) {
  const [detailPosisi, setDetailPosisi] = useState<PalletPosisiRow | null>(null);
  const [dialogPosisi, setDialogPosisi] = useState<PalletPosisiRow | null>(null);
  // Default view is Utara, not the first zone in WAREHOUSE_ZONES (Selatan)
  // — Utara is where the sliding door / most active traffic is, per user
  // request.
  const [activeZone, setActiveZone] = useState<string>("U");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const byKode = new Map(posisi.map((p) => [p.Kode, p]));

  // Diperbarui tiap menit supaya hitung mundur/telat di panel kartu
  // pengiriman tetap akurat, dan kartu otomatis hilang dari panel begini
  // jadwalnya sudah lewat ambang jam ke depan.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const jadwalMendekat = jadwal
    .filter((j) => {
      const selisihJam = (new Date(j.JamJadwal).getTime() - now.getTime()) / (1000 * 60 * 60);
      return selisihJam <= JAM_AMBANG_MENDEKATI_KEBERANGKATAN;
    })
    .sort((a, b) => new Date(a.JamJadwal).getTime() - new Date(b.JamJadwal).getTime());

  // Jump (no smooth animation) to the Utara panel on first mount, since the
  // scroller otherwise always starts at scrollLeft=0 (Selatan) regardless
  // of `activeZone`'s initial value.
  useEffect(() => {
    panelRefs.current["U"]?.scrollIntoView({ inline: "start", block: "nearest" });
  }, []);

  function scrollToZone(zoneId: string) {
    setActiveZone(zoneId);
    panelRefs.current[zoneId]?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }

  function handleCellClick(row: PalletPosisiRow | undefined) {
    if (!row) return;
    setDetailPosisi(row);
  }

  // Keeps the Selatan/Tengah/Utara tab highlight in sync when the user
  // swipes manually (not just when they tap a tab) — finds whichever
  // panel's horizontal center is closest to the scroller's own center.
  function handleScroll() {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const centerX = scrollerRect.left + scrollerRect.width / 2;
    let closest = WAREHOUSE_ZONES[0].id;
    let closestDist = Infinity;
    for (const zone of WAREHOUSE_ZONES) {
      const el = panelRefs.current[zone.id];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const dist = Math.abs(rect.left + rect.width / 2 - centerX);
      if (dist < closestDist) {
        closestDist = dist;
        closest = zone.id;
      }
    }
    setActiveZone(closest);
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex gap-1 border-b border-border">
            {WAREHOUSE_ZONES.map((zone) => (
              <button
                key={zone.id}
                type="button"
                onClick={() => scrollToZone(zone.id)}
                className={cn(
                  "flex-1 border-b-2 py-2 text-sm font-medium",
                  activeZone === zone.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
                )}
              >
                {zone.label}
              </button>
            ))}
          </div>

          <div ref={scrollerRef} onScroll={handleScroll} className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2">
            {WAREHOUSE_ZONES.map((zone) => {
              const isSelatan = zone.id === "S";
              const hasJendela = zone.grup.some((g) => g.dividerAfter?.includes("Jendela"));
              return (
                <div
                  key={zone.id}
                  ref={(el) => {
                    panelRefs.current[zone.id] = el;
                  }}
                  className="flex w-fit shrink-0 snap-start flex-col gap-1 rounded-lg border border-border p-3"
                >
                  <div className="relative flex flex-col gap-1 mr-2">
                    {zone.grup.map((g) => (
                      <div key={g.id} className="flex flex-col gap-1">
                        {g.rows.map((row, i) => (
                          <div key={i} className="flex gap-2">
                            {isSelatan && (
                              <span className="flex w-[60px] shrink-0 items-center justify-center">
                                <span className="size-3 rounded-full border border-border bg-muted-foreground/30" />
                              </span>
                            )}
                            {row.map((kode) => (
                              <WarehouseCell key={kode} kode={kode} row={byKode.get(kode)} onClick={handleCellClick} />
                            ))}
                          </div>
                        ))}
                        {g.dividerAfter && (
                          <div
                            className={cn(
                              "flex items-center gap-2 text-center text-[11px] text-muted-foreground",
                              g.dividerAfter === "Jalan" && "py-2"
                            )}
                          >
                            {isSelatan && <span className="w-[60px] shrink-0" />}
                            <span className="flex-1 border-t border-dashed border-border" />
                            <span>{g.dividerAfter}</span>
                            <span className="flex-1 border-t border-dashed border-border" />
                            <span className="flex-1 border-t border-dashed border-border" />
                            <span className="flex-1 border-t border-dashed border-border" />
                            {g.dividerAfter.includes("Jendela") && (
                              <span
                                title="Jendela"
                                className="relative z-10 h-6 w-1.5 shrink-0 rounded-sm border border-border bg-muted"
                              />
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                    {hasJendela && <div className="pointer-events-none absolute inset-y-0 right-0 w-1 bg-foreground/70" />}
                  </div>
                  {zone.showPintuGeser && (
                    <p className="mt-2 rounded-md bg-muted py-1 text-center text-xs font-medium">Pintu Geser</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-3 text-[11px]">
            <span className="flex items-center gap-1">
              <span className="size-3 rounded-sm bg-red-600" /> Paling lama
            </span>
            <span className="flex items-center gap-1">
              <span className="size-3 rounded-sm bg-amber-500" /> Menengah
            </span>
            <span className="flex items-center gap-1">
              <span className="size-3 rounded-sm bg-emerald-600" /> Baru
            </span>
            <span className="flex items-center gap-1">
              <span className="size-3 rounded-sm bg-muted" /> Kosong — ketuk untuk detail &amp; tambah produksi
            </span>
          </div>
        </div>

        <KartuPengirimanMendekatPanel jadwal={jadwalMendekat} now={now} />
      </div>

      <Dialog open={detailPosisi != null} onOpenChange={(open) => !open && setDetailPosisi(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pallete {detailPosisi?.Kode}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {detailPosisi && <RiwayatPosisiList posisiId={detailPosisi.PosisiID} open={detailPosisi != null} />}
            <div className="rounded-md border border-border p-3 text-sm">
              <p className="text-muted-foreground">
                Terisi {detailPosisi?.TotalSisaQty10KG ?? 0}/{KAPASITAS_PALLET_10KG} kantong 10kg
                {(detailPosisi?.JumlahBatchAktif ?? 0) > 1 && ` — ${detailPosisi?.JumlahBatchAktif} batch aktif`}
              </p>
            </div>
            {detailPosisi && detailPosisi.TotalSisaQty10KG < KAPASITAS_PALLET_10KG && (
              <Button
                onClick={() => {
                  setDialogPosisi(detailPosisi);
                  setDetailPosisi(null);
                }}
              >
                + Tambah Produksi
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <TambahProduksiDialog
        open={dialogPosisi != null}
        onOpenChange={(open) => !open && setDialogPosisi(null)}
        posisi={dialogPosisi}
        onSaved={() => {
          setDialogPosisi(null);
          onAfterTambah();
        }}
      />
    </div>
  );
}

// Panel ringkas berisi jadwal pengiriman yang waktu keberangkatannya sudah
// mendekat, ditampilkan di sisi kanan denah Coldstorage. Hanya menampilkan
// jadwal yang sudah difilter oleh pemanggilnya (lihat
// JAM_AMBANG_MENDEKATI_KEBERANGKATAN) — bukan seluruh kartu pengiriman
// seperti di tab Pengiriman.
function KartuPengirimanMendekatPanel({ jadwal, now }: { jadwal: DraftJadwalForProduksi[]; now: Date }) {
  return (
    <div className="flex w-full shrink-0 flex-col gap-2 rounded-lg border border-border p-3 lg:w-72">
      <p className="text-sm font-medium">Keberangkatan Mendekat</p>
      {jadwal.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Tidak ada jadwal keberangkatan dalam {JAM_AMBANG_MENDEKATI_KEBERANGKATAN} jam ke depan.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {jadwal.map((j) => {
            const diffMs = new Date(j.JamJadwal).getTime() - now.getTime();
            const terlambat = diffMs < 0;
            return (
              <div key={j.JadwalID} className="rounded-md border border-border p-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{j.ArmadaNama}</p>
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
                      terlambat ? "bg-red-600/15 text-red-600" : "bg-amber-500/15 text-amber-600"
                    )}
                  >
                    {formatSelisihWaktu(diffMs)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(j.JamJadwal).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                </p>
                <p className="mt-1 text-xs">
                  {j.Qty10KGDibutuhkan} kantong 10kg, {j.Qty5KGDibutuhkan} kantong 5kg
                </p>
                {j.JamMulaiMuat != null && (
                  <span className="mt-1 inline-block rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">
                    Sedang dimuat
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Format selisih waktu ke label singkat, mis. "45m lagi", "1j 20m lagi",
// atau "Telat 10m" jika waktu jadwal sudah lewat.
function formatSelisihWaktu(diffMs: number) {
  const totalMenit = Math.round(Math.abs(diffMs) / 60_000);
  const jam = Math.floor(totalMenit / 60);
  const menit = totalMenit % 60;
  const label = jam > 0 ? `${jam}j ${menit}m` : `${menit}m`;
  return diffMs < 0 ? `Telat ${label}` : `${label} lagi`;
}