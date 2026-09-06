"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PelunasanDialog } from "@/components/dashboard/pelunasan-dialog";
import { formatRupiah, formatTime, formatTimeWib, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  getLaporanShiftDetailAction,
  updateBbmManualAction,
  hapusBbmEntryAction,
  tambahPengeluaranAction,
  hapusPengeluaranAction,
} from "@/app/mkesindo/(dashboard)/laporan/actions";
import { getReportShift, getShiftLabel, type ShiftNumber } from "@/lib/report-shift";
import type { LaporanShiftDetail } from "@/lib/queries/laporan-shift-detail";
import type { StatusBayar, KartuPengirimanRow } from "@/lib/queries/laporan-shift-pengiriman";

const STATUS_BAYAR_LABEL: Record<StatusBayar, string> = {
  TUNAI: "Tunai",
  QRIS: "QRIS",
  TRANSFER: "Transfer",
  TIDAK_BAYAR: "Tidak Bayar",
  BELUM_BAYAR: "Belum Bayar",
};

// Paid methods get a green badge, TIDAK_BAYAR (deliberately no-payment stop)
// gets red, BELUM_BAYAR (still outstanding, including the "Dibayar (metode
// belum tercatat)" special case) gets an amber/neutral warning tone.
const STATUS_BADGE_CLASS: Record<StatusBayar, string> = {
  TUNAI: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  QRIS: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  TRANSFER: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  TIDAK_BAYAR: "bg-destructive/15 text-destructive",
  BELUM_BAYAR: "bg-warning/15 text-warning",
};

// Route title format: "[JamAktualBerangkat] - Wilayah, Kecamatan", degrading
// to just the time (or "-") when the Jadwal hasn't departed yet or has no
// resolvable farthest-destination location.
function formatJudulRute(k: KartuPengirimanRow): string {
  const jam = k.jamAktualBerangkat ? formatTime(k.jamAktualBerangkat) : "-";
  if (!k.lokasiTerjauh) return jam;
  const lokasi = k.lokasiTerjauh.kecamatan ? `${k.lokasiTerjauh.wilayah}, ${k.lokasiTerjauh.kecamatan}` : k.lokasiTerjauh.wilayah;
  return `${jam} - ${lokasi}`;
}

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
  const [pelunasanTarget, setPelunasanTarget] = useState<{ businessPartnerId: string; customerName: string } | null>(null);
  // Per-jadwalId override of the default "only the first card is expanded"
  // rule -- keyed by jadwalId (not index) so a re-fetch after recording a
  // payment doesn't reset what the user already toggled open/closed.
  const [expandedOverrides, setExpandedOverrides] = useState<Record<number, boolean>>({});
  // Kas section: BBM inline edit + manual kas-keluar add form state.
  const [editingBbmId, setEditingBbmId] = useState<number | null>(null);
  const [bbmForm, setBbmForm] = useState({ liter: "", nominalAsli: "", nominalEkstra: "" });
  const [manualKeterangan, setManualKeterangan] = useState("");
  const [manualNominal, setManualNominal] = useState("");

  function isJadwalExpanded(jadwalId: number, index: number): boolean {
    return expandedOverrides[jadwalId] ?? index === 0;
  }

  function handleSimpanBbm(bbmId: number) {
    startTransition(async () => {
      const parseField = (s: string): number | null => {
        const t = s.trim();
        return t === "" ? null : Number(t);
      };
      const result = await updateBbmManualAction(
        bbmId,
        parseField(bbmForm.liter),
        parseField(bbmForm.nominalAsli),
        parseField(bbmForm.nominalEkstra)
      );
      if (!result.success) {
        setError(result.error);
        return;
      }
      setEditingBbmId(null);
      handleTampilkan();
    });
  }

  function handleHapusBbm(bbmId: number) {
    if (!confirm("Hapus catatan BBM ini?")) return;
    startTransition(async () => {
      const result = await hapusBbmEntryAction(bbmId);
      if (result.success) handleTampilkan();
    });
  }

  function handleTambahPengeluaran() {
    if (!detail) return;
    if (!manualKeterangan.trim()) {
      setError("Keterangan tidak boleh kosong.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await tambahPengeluaranAction(detail.tanggalUsaha, detail.shift, manualKeterangan.trim(), Number(manualNominal) || 0);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setManualKeterangan("");
      setManualNominal("");
      handleTampilkan();
    });
  }

  function handleHapusPengeluaran(pengeluaranId: number) {
    if (!confirm("Hapus rincian pengeluaran ini?")) return;
    startTransition(async () => {
      const result = await hapusPengeluaranAction(pengeluaranId);
      if (result.success) handleTampilkan();
    });
  }

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
                {detail.kartuPengiriman.map((k, index) => {
                  const expanded = isJadwalExpanded(k.jadwalId, index);
                  return (
                    <div key={k.jadwalId} className="rounded-md border text-xs">
                      <button
                        type="button"
                        onClick={() => setExpandedOverrides((prev) => ({ ...prev, [k.jadwalId]: !expanded }))}
                        className="flex w-full items-center gap-2 p-2 text-left hover:bg-muted/50"
                        aria-expanded={expanded}
                      >
                        {expanded ? (
                          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <div className="flex flex-col">
                          <span className="font-medium">{formatJudulRute(k)}</span>
                          <span className="text-muted-foreground">
                            {k.vehicleNo ?? "-"} · {k.driverName ?? "-"}
                          </span>
                        </div>
                      </button>
                      {expanded && (
                        <div className="border-t">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Tujuan</TableHead>
                                <TableHead>Kirim</TableHead>
                                <TableHead>Return</TableHead>
                                <TableHead className="text-right">Nominal</TableHead>
                                <TableHead>Metode</TableHead>
                                <TableHead>Status</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {k.stops.map((s) => (
                                <TableRow key={s.jadwalDetailId}>
                                  <TableCell className="font-medium whitespace-normal">{s.customerName}</TableCell>
                                  <TableCell className="whitespace-normal text-muted-foreground">
                                    {s.items.map((i) => `${i.itemName} x${i.qty}`).join(", ")}
                                  </TableCell>
                                  <TableCell className="whitespace-normal">
                                    {s.retur.length === 0 ? (
                                      <span className="text-muted-foreground">-</span>
                                    ) : (
                                      <div className="flex flex-col gap-0.5">
                                        {s.retur.map((r) => (
                                          <span key={r.itemId} className="text-destructive">
                                            {r.itemName}: {r.qtyRetur} ({r.kondisiRetur ?? "-"})
                                            {r.resale.length > 0 &&
                                              ` — dijual ulang: ${r.resale.map((rs) => `${rs.jalur} x${rs.qty}`).join(", ")}`}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {s.nominalBayar != null ? formatRupiah(s.nominalBayar) : "-"}
                                  </TableCell>
                                  <TableCell>
                                    {s.statusBayar === "TUNAI" || s.statusBayar === "QRIS" || s.statusBayar === "TRANSFER"
                                      ? STATUS_BAYAR_LABEL[s.statusBayar]
                                      : "-"}
                                  </TableCell>
                                  <TableCell className="whitespace-normal">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span
                                        className={cn(
                                          "inline-flex items-center rounded-full px-2 py-0.5 font-medium whitespace-nowrap",
                                          STATUS_BADGE_CLASS[s.statusBayar]
                                        )}
                                      >
                                        {s.statusBayar === "BELUM_BAYAR" && s.nominalBayar != null
                                          ? `Dibayar (metode belum tercatat) — ${formatRupiah(s.nominalBayar)}`
                                          : `${STATUS_BAYAR_LABEL[s.statusBayar]}${s.nominalBayar != null ? ` — ${formatRupiah(s.nominalBayar)}` : ""}`}
                                      </span>
                                      {s.statusBayar === "BELUM_BAYAR" && (
                                        <Button
                                          size="xs"
                                          variant="outline"
                                          onClick={() =>
                                            setPelunasanTarget({ businessPartnerId: s.businessPartnerId, customerName: s.customerName })
                                          }
                                        >
                                          Catat Pembayaran
                                        </Button>
                                      )}
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                              {k.stops.length === 0 && (
                                <TableRow>
                                  <TableCell colSpan={6} className="py-4 text-center text-muted-foreground">
                                    Tidak ada stop.
                                  </TableCell>
                                </TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section id="kas" className="flex flex-col gap-2 rounded-md border p-3">
            <h3 className="text-sm font-semibold">Pengeluaran Uang Kas</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-2 rounded-md border p-2 text-xs">
                <h4 className="font-medium text-muted-foreground">Kas Masuk</h4>
                <div className="flex items-center justify-between">
                  <span>Top-up Shift Ini</span>
                  <span className="font-medium tabular-nums">{formatRupiah(detail.kasKecil?.kasMasuk ?? 0)}</span>
                </div>
              </div>

              <div className="flex flex-col gap-2 rounded-md border p-2 text-xs">
                <h4 className="font-medium text-muted-foreground">Kas Keluar</h4>
                {detail.bbm.length === 0 && (!detail.kasKecil || detail.kasKecil.pengeluaran.length === 0) ? (
                  <p className="text-muted-foreground">Belum ada pengeluaran.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {detail.bbm.map((b) =>
                      editingBbmId === b.bbmId ? (
                        <div key={b.bbmId} className="flex flex-col gap-1.5 rounded border border-dashed p-1.5">
                          <span className="font-medium">BBM — {b.driverName ?? b.salesmanId}</span>
                          <div className="flex gap-1">
                            <Input
                              type="number"
                              min={0}
                              placeholder="Liter"
                              value={bbmForm.liter}
                              onChange={(e) => setBbmForm((f) => ({ ...f, liter: e.target.value }))}
                              className="h-7 text-xs"
                            />
                            <Input
                              type="number"
                              min={0}
                              placeholder="Nominal Asli"
                              value={bbmForm.nominalAsli}
                              onChange={(e) => setBbmForm((f) => ({ ...f, nominalAsli: e.target.value }))}
                              className="h-7 text-xs"
                            />
                            <Input
                              type="number"
                              min={0}
                              placeholder="Nominal Ekstra"
                              value={bbmForm.nominalEkstra}
                              onChange={(e) => setBbmForm((f) => ({ ...f, nominalEkstra: e.target.value }))}
                              className="h-7 text-xs"
                            />
                          </div>
                          <div className="flex gap-1">
                            <Button size="xs" disabled={pending} onClick={() => handleSimpanBbm(b.bbmId)}>
                              Simpan
                            </Button>
                            <Button size="xs" variant="ghost" disabled={pending} onClick={() => setEditingBbmId(null)}>
                              Batal
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div key={b.bbmId} className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingBbmId(b.bbmId);
                              setBbmForm({
                                liter: String(b.liter ?? ""),
                                nominalAsli: String(b.nominalAsli ?? ""),
                                nominalEkstra: String(b.nominalEkstra ?? ""),
                              });
                            }}
                            className="flex-1 truncate text-left hover:underline"
                          >
                            BBM — {b.driverName ?? b.salesmanId} ({formatTime(b.waktuIsi)})
                          </button>
                          <span className="shrink-0 tabular-nums">{formatRupiah((b.nominalAsli ?? 0) + (b.nominalEkstra ?? 0))}</span>
                          <button
                            type="button"
                            onClick={() => handleHapusBbm(b.bbmId)}
                            disabled={pending}
                            className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      )
                    )}
                    {detail.kasKecil?.pengeluaran.map((p) => (
                      <div key={p.pengeluaranId} className="flex items-center justify-between gap-2">
                        <span className="flex-1 truncate">{p.keterangan}</span>
                        <span className="shrink-0 tabular-nums">{formatRupiah(p.nominal)}</span>
                        <button
                          type="button"
                          onClick={() => handleHapusPengeluaran(p.pengeluaranId)}
                          disabled={pending}
                          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-col gap-1.5 rounded border border-dashed p-1.5">
                  <Input
                    placeholder="Keterangan"
                    value={manualKeterangan}
                    onChange={(e) => setManualKeterangan(e.target.value)}
                    disabled={pending}
                    className="h-7 text-xs"
                  />
                  <div className="flex gap-1">
                    <Input
                      type="number"
                      min={0}
                      placeholder="Nominal"
                      value={manualNominal}
                      onChange={(e) => setManualNominal(e.target.value)}
                      disabled={pending}
                      className="h-7 text-xs"
                    />
                    <Button size="xs" disabled={pending} onClick={handleTambahPengeluaran}>
                      <Plus className="size-3.5" /> Tambah
                    </Button>
                  </div>
                </div>

                {detail.kasKecil && (
                  <div className="mt-1 flex items-center justify-between border-t pt-1 font-medium">
                    <span>Total Pengeluaran / Saldo Akhir</span>
                    <span>
                      {formatRupiah(detail.kasKecil.totalPengeluaran)} / {formatRupiah(detail.kasKecil.saldoAkhir)}
                    </span>
                  </div>
                )}
              </div>
            </div>
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

      {detail && (
        <PelunasanDialog
          businessPartnerId={pelunasanTarget?.businessPartnerId ?? ""}
          customerName={pelunasanTarget?.customerName ?? ""}
          perusahaanId={detail.perusahaanId}
          open={pelunasanTarget != null}
          onOpenChange={(open) => {
            if (!open) {
              setPelunasanTarget(null);
              handleTampilkan(); // re-fetch this shift's data so the paid stop's status updates immediately
            }
          }}
        />
      )}
    </div>
  );
}
