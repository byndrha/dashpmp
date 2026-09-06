"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRupiah, formatTime, formatTimeWib, formatDate } from "@/lib/format";
import { getLaporanShiftDetailAction } from "@/app/mkesindo/(dashboard)/laporan/actions";
import { getReportShift, getShiftLabel, type ShiftNumber } from "@/lib/report-shift";
import type { LaporanShiftDetail } from "@/lib/queries/laporan-shift-detail";
import type { StatusBayar } from "@/lib/queries/laporan-shift-pengiriman";

const STATUS_BAYAR_LABEL: Record<StatusBayar, string> = {
  TUNAI: "Tunai",
  QRIS: "QRIS",
  TRANSFER: "Transfer",
  TIDAK_BAYAR: "Tidak Bayar",
  BELUM_BAYAR: "Belum Bayar",
};

const SECTIONS = [
  { id: "stok-bahan-baku", label: "Stok Bahan Baku" },
  { id: "kartu-pengiriman", label: "Kartu Pengiriman" },
  { id: "kas", label: "Kas" },
  { id: "produksi", label: "Produksi" },
  { id: "mesin", label: "Mesin" },
  { id: "stok-es", label: "Stok Es" },
] as const;

function todayDefault(): { tanggalUsaha: string; shift: ShiftNumber } {
  const { shift, businessDate } = getReportShift("work");
  return { tanggalUsaha: businessDate.toISOString().slice(0, 10), shift };
}

export function LaporanShiftDetailView() {
  const [{ tanggalUsaha, shift }, setPilihan] = useState(todayDefault);
  const [detail, setDetail] = useState<LaporanShiftDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleTampilkan() {
    setError(null);
    startTransition(async () => {
      const result = await getLaporanShiftDetailAction(tanggalUsaha, shift);
      if (!result.success) {
        setError(result.error);
        setDetail(null);
        return;
      }
      setDetail(result.data);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Tanggal Usaha</label>
          <Input type="date" value={tanggalUsaha} onChange={(e) => setPilihan((p) => ({ ...p, tanggalUsaha: e.target.value }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Shift</label>
          <Select value={String(shift)} onValueChange={(v) => setPilihan((p) => ({ ...p, shift: Number(v) as ShiftNumber }))}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3].map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {getShiftLabel(s as ShiftNumber, "work")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleTampilkan} disabled={pending}>
          {pending ? "Memuat..." : "Tampilkan"}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {detail && (
        <div className="flex flex-col gap-4 rounded-lg border p-4">
          <div className="sticky top-0 z-10 -mx-4 -mt-4 flex flex-wrap gap-1 border-b bg-background px-4 py-2">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                {s.label}
              </a>
            ))}
          </div>

          <div>
            <h2 className="font-display text-lg font-semibold">
              {formatDate(detail.tanggalUsaha)} — {detail.shiftLabel}
            </h2>
            <p className="text-xs text-muted-foreground">
              Tim Produksi: {detail.timNama ?? "-"} · Staf Operasional: {detail.stafOperasionalNama ?? "-"}
            </p>
          </div>

          <section id="stok-bahan-baku" className="flex flex-col gap-2 rounded-md border p-3">
            <h3 className="text-sm font-semibold">Stok Bahan Baku</h3>
            {detail.stokBahanBaku.length === 0 ? (
              <p className="text-xs text-muted-foreground">Belum ada data stok bahan baku pada shift ini.</p>
            ) : (
              <div className="flex flex-col gap-1.5 text-xs">
                {detail.stokBahanBaku.map((r) => (
                  <div key={r.jenisBarang} className="flex flex-col gap-0.5 rounded border p-2">
                    <span className="font-medium">{r.jenisBarang}</span>
                    <span>
                      Masuk Gudang: {r.stokMasukGudang} {r.operasionalDiisiPada && `(${formatTime(r.operasionalDiisiPada)})`}
                    </span>
                    <span>
                      Masuk Inventori: {r.stokMasukInventoriOperasional} {r.operasionalDiisiPada && `(${formatTime(r.operasionalDiisiPada)})`}
                    </span>
                    <span>
                      Dipakai/Rusak Produksi: {r.stokDipakaiProduksi}/{r.stokRusakProduksi}{" "}
                      {r.produksiDiisiPada && `(${formatTime(r.produksiDiisiPada)})`}
                    </span>
                    <span className="font-medium">
                      Sisa Akhir — Gudang: {r.sisaGudangAkhir}, Inventori: {r.sisaInventoriAkhir}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section id="kartu-pengiriman" className="flex flex-col gap-2 rounded-md border p-3">
            <h3 className="text-sm font-semibold">Kartu Pengiriman</h3>
            {detail.kartuPengiriman.length === 0 ? (
              <p className="text-xs text-muted-foreground">Tidak ada kartu pengiriman pada shift ini.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {detail.kartuPengiriman.map((k) => (
                  <div key={k.jadwalId} className="rounded-md border p-2 text-xs">
                    <p className="mb-1.5 font-medium">
                      Jadwal #{k.jadwalId} — {k.driverName ?? "-"} ({k.armadaNama ?? "-"})
                    </p>
                    <div className="flex flex-col divide-y">
                      {k.stops.map((s) => (
                        <div key={s.jadwalDetailId} className="flex flex-col gap-1 py-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{s.customerName}</span>
                            <span className="text-muted-foreground">
                              {s.statusBayar === "BELUM_BAYAR" && s.nominalBayar != null
                                ? `Dibayar (metode belum tercatat) — ${formatRupiah(s.nominalBayar)}`
                                : `${STATUS_BAYAR_LABEL[s.statusBayar]}${s.nominalBayar != null ? ` — ${formatRupiah(s.nominalBayar)}` : ""}`}
                            </span>
                          </div>
                          <p className="text-muted-foreground">{s.items.map((i) => `${i.itemName} x${i.qty}`).join(", ")}</p>
                          {s.retur.map((r) => (
                            <p key={r.itemId} className="text-destructive">
                              Retur {r.itemName}: {r.qtyRetur} ({r.kondisiRetur ?? "-"})
                              {r.resale.length > 0 &&
                                ` — dijual ulang: ${r.resale.map((rs) => `${rs.jalur} x${rs.qty}`).join(", ")}`}
                            </p>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section id="kas" className="flex flex-col gap-2 rounded-md border p-3">
            <h3 className="text-sm font-semibold">Pengeluaran Uang Kas</h3>
            {detail.bbm.length === 0 && (!detail.kasKecil || detail.kasKecil.pengeluaran.length === 0) ? (
              <p className="text-xs text-muted-foreground">Tidak ada pengeluaran kas pada shift ini.</p>
            ) : (
              <div className="flex flex-col gap-1 text-xs">
                {detail.bbm.map((b, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span>
                      BBM — {b.driverName ?? b.salesmanId} ({formatTime(b.waktuIsi)})
                    </span>
                    <span>{formatRupiah((b.nominalAsli ?? 0) + (b.nominalEkstra ?? 0))}</span>
                  </div>
                ))}
                {detail.kasKecil?.pengeluaran.map((p) => (
                  <div key={p.pengeluaranId} className="flex items-center justify-between">
                    <span>{p.keterangan}</span>
                    <span>{formatRupiah(p.nominal)}</span>
                  </div>
                ))}
                {detail.kasKecil && (
                  <div className="mt-1 flex items-center justify-between border-t pt-1 font-medium">
                    <span>Total Pengeluaran / Saldo Akhir</span>
                    <span>
                      {formatRupiah(detail.kasKecil.totalPengeluaran)} / {formatRupiah(detail.kasKecil.saldoAkhir)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </section>

          <section id="produksi" className="flex flex-col gap-2 rounded-md border p-3">
            <h3 className="text-sm font-semibold">Data Produksi</h3>
            <p className="text-xs">Kantong Ekivalen: {detail.produksiKantongEkivalen}</p>
            <p className="text-xs">Total Denda: {formatRupiah(detail.produksiTotalDenda)}</p>
          </section>

          <section id="mesin" className="flex flex-col gap-2 rounded-md border p-3">
            <h3 className="text-sm font-semibold">Mesin</h3>
            <div className="flex flex-col gap-2 text-xs">
              {detail.mesinList.map((m) => {
                const events = detail.mesinEvents.filter((e) => e.mesinId === m.MesinID);
                const counter = detail.mesinCounter.find((c) => c.mesinId === m.MesinID);
                return (
                  <div key={m.MesinID} className="rounded border p-2">
                    <p className="mb-1 font-medium">{m.Nama}</p>
                    <p className="text-muted-foreground">
                      {events.length === 0 ? "Tidak ada event ON/OFF" : events.map((e) => `${e.jenisEvent} ${formatTimeWib(e.waktuEvent)}`).join(", ")}
                    </p>
                    {counter && counter.readings.length > 0 && (
                      <p className="text-muted-foreground">
                        Counter: {counter.readings.map((r) => `${r.jamPanen || "-"}|${r.qty10KG}`).join(", ")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section id="stok-es" className="flex flex-col gap-2 rounded-md border p-3">
            <h3 className="text-sm font-semibold">Stok Es</h3>
            <p className="text-xs">Stok Awal: {detail.stokEs.stokAwal ?? "Belum ada data"}</p>
            <p className="text-xs">
              Stok Akhir: {detail.stokEs.stokAkhir} {!detail.stokEs.stokAkhirFinal && "(live, belum final)"}
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
