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
import { getReportShift, getShiftLabel, getShiftWindow, type ShiftNumber } from "@/lib/report-shift";
import type { LaporanShiftDetail } from "@/lib/queries/laporan-shift-detail";
import type { StatusBayar, KartuPengirimanRow } from "@/lib/queries/laporan-shift-pengiriman";
import type { MesinEventRow } from "@/lib/queries/produksi-mesin-event";

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

interface MesinTimelineSegment {
  state: "On" | "Off";
  startPct: number;
  widthPct: number;
}

// Proportional On/Off segments for one mesin across [start, end] (both
// naive-WIB Dates from getShiftWindow) -- initialState is what the mesin
// carried INTO the window (LaporanShiftDetail.mesinStateAwalShift), since
// mesinEvents only ever covers the shift itself and says nothing about
// state before it.
function computeMesinTimeline(
  events: MesinEventRow[],
  mesinId: number,
  start: Date,
  end: Date,
  initialState: "On" | "Off"
): MesinTimelineSegment[] {
  const totalMs = end.getTime() - start.getTime();
  if (totalMs <= 0) return [];
  const sorted = events
    .filter((e) => e.mesinId === mesinId)
    .slice()
    .sort((a, b) => a.waktuEvent.getTime() - b.waktuEvent.getTime());
  const segments: MesinTimelineSegment[] = [];
  let state: "On" | "Off" = initialState;
  let cursorMs = start.getTime();
  for (const e of sorted) {
    const t = Math.min(Math.max(e.waktuEvent.getTime(), start.getTime()), end.getTime());
    if (t > cursorMs) {
      segments.push({ state, startPct: ((cursorMs - start.getTime()) / totalMs) * 100, widthPct: ((t - cursorMs) / totalMs) * 100 });
      cursorMs = t;
    }
    state = e.jenisEvent;
  }
  if (cursorMs < end.getTime()) {
    segments.push({ state, startPct: ((cursorMs - start.getTime()) / totalMs) * 100, widthPct: ((end.getTime() - cursorMs) / totalMs) * 100 });
  }
  return segments;
}

// Vertical hour-mark guide lines across [start, end] -- both naive-WIB
// Dates, so UTC accessors read the WIB wall-clock hour directly (this
// file's established convention, e.g. formatJudulRute's jamAktualBerangkat).
function getHourGuides(start: Date, end: Date): { pct: number; label: string }[] {
  const totalMs = end.getTime() - start.getTime();
  if (totalMs <= 0) return [];
  const guides: { pct: number; label: string }[] = [];
  const first = new Date(start.getTime());
  first.setUTCMinutes(0, 0, 0);
  if (first.getTime() <= start.getTime()) first.setTime(first.getTime() + 3_600_000);
  for (let t = first.getTime(); t < end.getTime(); t += 3_600_000) {
    guides.push({ pct: ((t - start.getTime()) / totalMs) * 100, label: `${String(new Date(t).getUTCHours()).padStart(2, "0")}:00` });
  }
  return guides;
}

const SECTIONS = [
  { id: "stok-bahan-baku", label: "Stok Bahan Baku" },
  { id: "kartu-pengiriman", label: "Kartu Pengiriman" },
  { id: "kas", label: "Kas" },
  { id: "mesin", label: "Mesin" },
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
          <label className="text-xs text-muted-foreground">Tanggal Kerja</label>
          <Input type="date" value={tanggalUsaha} onChange={(e) => setPilihan((p) => ({ ...p, tanggalUsaha: e.target.value }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Shift</label>
          <Select value={String(shift)} onValueChange={(v) => setPilihan((p) => ({ ...p, shift: Number(v) as ShiftNumber }))}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[2, 3, 1].map((s) => (
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
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[3fr_2fr]">
              <div className="flex min-w-0 flex-col gap-3">
                {detail.kartuPengiriman.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Tidak ada kartu pengiriman pada shift ini.</p>
                ) : (
                  detail.kartuPengiriman.map((k, index) => {
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
                        <div className="divide-y border-t">
                          {k.stops.length === 0 ? (
                            <p className="p-3 text-center text-muted-foreground">Tidak ada stop.</p>
                          ) : (
                            k.stops.map((s) => (
                              <div key={s.jadwalDetailId} className="flex flex-col gap-1 p-2">
                                <div className="flex items-start justify-between gap-2">
                                  <span className="font-medium">{s.customerName}</span>
                                  {s.nominalBayar != null && (
                                    <span className="shrink-0 tabular-nums text-muted-foreground">{formatRupiah(s.nominalBayar)}</span>
                                  )}
                                </div>
                                <p className="text-muted-foreground">Kirim: {s.items.map((i) => `${i.itemName} x${i.qty}`).join(", ")}</p>
                                {s.retur.length > 0 && (
                                  <div className="flex flex-col gap-0.5">
                                    {s.retur.map((r) => (
                                      <span key={r.itemId} className="text-destructive">
                                        Return: {r.itemName} x{r.qtyRetur} ({r.kondisiRetur ?? "-"})
                                        {r.resale.length > 0 &&
                                          ` — dijual ulang: ${r.resale.map((rs) => `${rs.jalur} x${rs.qty}`).join(", ")}`}
                                      </span>
                                    ))}
                                  </div>
                                )}
                                <div className="flex flex-wrap items-center justify-between gap-1.5">
                                  <span
                                    className={cn(
                                      "inline-flex items-center rounded-full px-2 py-0.5 font-medium",
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
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                  })
                )}
              </div>

              <div className="rounded-md border p-2">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Rekap Total per Driver <span className="font-normal">(seluruh shift hari ini)</span></p>
                {detail.rekapPerDriver.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Tidak ada driver bertugas hari ini.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Driver</TableHead>
                        <TableHead className="text-right">Kirim</TableHead>
                        <TableHead className="text-right">Return</TableHead>
                        <TableHead className="text-right">Netto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.rekapPerDriver.map((r) => (
                        <TableRow key={r.salesmanId}>
                          <TableCell>{r.driverName ?? r.salesmanId}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.totalKirim}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.totalReturn}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{r.netto}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
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

          <section id="mesin" className="flex flex-col gap-2 rounded-md border p-3">
            <h3 className="text-sm font-semibold">Mesin</h3>

            {(() => {
              const shiftWindow = getShiftWindow(new Date(`${detail.tanggalUsaha}T00:00:00Z`), detail.shift, "work");
              const hourGuides = getHourGuides(shiftWindow.start, shiftWindow.end);
              return (
                <div className="rounded-md border p-2">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">Status Mesin</p>
                    <span className="text-[10px] text-muted-foreground">On / Off Timeline</span>
                  </div>
                  <div className="grid grid-cols-[3.5rem_1fr_2.5rem] items-center gap-x-2 gap-y-1.5 text-xs">
                    <div />
                    <div className="relative h-3">
                      {hourGuides.map((g) => (
                        <span
                          key={g.pct}
                          className="absolute -translate-x-1/2 text-[9px] whitespace-nowrap text-muted-foreground"
                          style={{ left: `${g.pct}%` }}
                        >
                          {g.label}
                        </span>
                      ))}
                    </div>
                    <div />
                    {detail.mesinList.map((m) => {
                      const initialState = detail.mesinStateAwalShift[m.MesinID] ?? "Off";
                      const segments = computeMesinTimeline(detail.mesinEvents, m.MesinID, shiftWindow.start, shiftWindow.end, initialState);
                      const counter = detail.mesinCounter.find((c) => c.mesinId === m.MesinID);
                      const totalQty10KG = counter?.readings.reduce((sum, r) => sum + r.qty10KG, 0) ?? 0;
                      return (
                        <div key={m.MesinID} className="contents">
                          <span className="truncate font-medium">{m.Nama}</span>
                          <div className="relative h-4 overflow-hidden rounded-full bg-muted">
                            {segments.map((s, i) => (
                              <div
                                key={i}
                                className={cn("absolute inset-y-0", s.state === "On" ? "bg-emerald-500" : "bg-red-500")}
                                style={{ left: `${s.startPct}%`, width: `${s.widthPct}%` }}
                              />
                            ))}
                            {hourGuides.map((g) => (
                              <div key={g.pct} className="absolute inset-y-0 w-px bg-background/50" style={{ left: `${g.pct}%` }} />
                            ))}
                          </div>
                          <span className="text-right tabular-nums text-muted-foreground">{totalQty10KG}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-[11px] text-muted-foreground">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <span className="size-2 rounded-full bg-emerald-500" /> On
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="size-2 rounded-full bg-red-500" /> Off
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span>
                        Stok Es Awal (10 KG): <span className="font-medium text-foreground">{detail.stokEs.stokAwal ?? "-"}</span>
                      </span>
                      <span>
                        Stok Es Akhir Shift (10 KG):{" "}
                        <span className="font-medium text-foreground">
                          {detail.stokEs.stokAkhir}
                          {!detail.stokEs.stokAkhirFinal && " (live, belum final)"}
                        </span>
                      </span>
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                    <span>
                      Qty 5KG Dimuat (shift ini, seluruh mesin): <span className="font-medium text-foreground">{detail.produksiTotal5KG}</span>
                    </span>
                    <span>
                      Kantong Ekivalen (10KG + 5KG/2): <span className="font-medium text-foreground">{detail.produksiKantongEkivalen}</span>
                    </span>
                  </div>
                </div>
              );
            })()}

            <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
              {detail.mesinList.map((m) => {
                const events = detail.mesinEvents.filter((e) => e.mesinId === m.MesinID);
                const counter = detail.mesinCounter.find((c) => c.mesinId === m.MesinID);
                const totalQty10KG = counter?.readings.reduce((sum, r) => sum + r.qty10KG, 0) ?? 0;
                return (
                  <div key={m.MesinID} className="flex flex-col gap-2 rounded border p-2">
                    <p className="font-medium">{m.Nama}</p>
                    <div>
                      <p className="mb-0.5 font-medium text-foreground/70">On/Off</p>
                      {events.length === 0 ? (
                        <p className="text-muted-foreground">Tidak ada event.</p>
                      ) : (
                        events.map((e) => (
                          <p key={e.eventId} className="text-muted-foreground">
                            {e.jenisEvent} — {formatTimeWib(e.waktuEvent)}
                          </p>
                        ))
                      )}
                    </div>
                    <div>
                      <p className="mb-0.5 font-medium text-foreground/70">Produksi (Panen)</p>
                      {!counter || counter.readings.length === 0 ? (
                        <p className="text-muted-foreground">Belum ada panen.</p>
                      ) : (
                        <>
                          {counter.readings.map((r, i) => (
                            <p key={i} className="text-muted-foreground">
                              {r.jamPanen || "-"} — {r.qty10KG} (10KG)
                            </p>
                          ))}
                          <p className="mt-0.5 font-medium">Total: {totalQty10KG} (10KG)</p>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {(detail.kerusakan.pecahKemasanQty > 0 ||
              detail.kerusakan.esJatuhQty > 0 ||
              detail.kerusakan.gantiReturnQty > 0 ||
              detail.kerusakan.sealerJebolQty > 0) && (
              <div className="rounded-md border p-2 text-xs">
                <p className="mb-1.5 font-medium text-muted-foreground">
                  Aktivitas Produksi — Es Rusak <span className="font-normal">(tanggung jawab Staf Operasional/Tim Produksi shift ini)</span>
                </p>
                <div className="flex flex-col gap-0.5 text-muted-foreground">
                  {detail.kerusakan.pecahKemasanQty > 0 && <p>Pecah Kemasan: {detail.kerusakan.pecahKemasanQty}</p>}
                  {detail.kerusakan.esJatuhQty > 0 && <p>Es Jatuh: {detail.kerusakan.esJatuhQty}</p>}
                  {detail.kerusakan.gantiReturnQty > 0 && <p>Ganti Retur: {detail.kerusakan.gantiReturnQty}</p>}
                  {detail.kerusakan.sealerJebolQty > 0 && <p>Sealer Jebol: {detail.kerusakan.sealerJebolQty}</p>}
                  <p className="mt-1 font-medium text-foreground">Total Denda: {formatRupiah(detail.produksiTotalDenda)}</p>
                </div>
              </div>
            )}
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
