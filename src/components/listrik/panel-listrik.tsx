"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  CircleDashed,
  Clock,
  Gauge,
  ImageIcon,
  Settings2,
  Sun,
  Moon,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Petunjuk } from "@/components/ui/petunjuk";
import { konfirmasi } from "@/components/konfirmasi";
import { cn } from "@/lib/utils";
import { formatRupiah } from "@/lib/format";
import { batalkanBacaanMeterAction } from "@/app/listrik-actions";
import {
  bacaanTidakWajar,
  jamLabel,
  rekapHarian,
  standTotal,
  LABEL_SLOT,
  type BacaanMeter,
  type HariListrik,
  type PengaturanListrik,
  type StatusSlot,
} from "@/lib/listrik";
import { CatatMeterDialog } from "./catat-meter-dialog";
import { PengaturanListrikDialog } from "./pengaturan-listrik-dialog";

const fmt = (n: number, d = 1) =>
  n.toLocaleString("id-ID", { maximumFractionDigits: d });
const jamWib = (iso: string) =>
  new Date(iso).toLocaleTimeString("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
  });
const tanggalWib = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
const hariLabel = (tgl: string) =>
  new Date(`${tgl}T00:00:00Z`).toLocaleDateString("id-ID", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });

const HARI_REKAP = 14;
const HARI_KPI = 7;

function ChipSlot({ s, jam }: { s: StatusSlot; jam: number }) {
  if (s.status === "belum_dimulai")
    return <span className="text-xs text-muted-foreground/60">—</span>;
  if (s.status === "belum_waktunya")
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
        <Clock className="size-3" /> nanti
      </span>
    );
  if (s.status === "kosong")
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
        <X className="size-3" /> terlewat
      </span>
    );
  const menit = Math.abs(s.selisihMenit);
  return (
    <Petunjuk
      render={
        <span
          className={cn(
            "inline-flex cursor-help items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
            s.tepat
              ? "bg-primary/10 text-primary"
              : "bg-warning/15 text-warning"
          )}
        />
      }
      judul={`${s.bacaan.olehNama} · ${jamWib(s.bacaan.waktu)}`}
      isi={
        s.tepat
          ? `Tepat waktu (jadwal ${jamLabel(jam)}).`
          : `${menit} menit ${
              s.selisihMenit < 0 ? "lebih awal" : "terlambat"
            } dari jadwal ${jamLabel(
              jam
            )} — pembagian WBP/LWBP sedikit bergeser.`
      }
    >
      {s.tepat ? (
        <CheckCircle2 className="size-3" />
      ) : (
        <AlertTriangle className="size-3" />
      )}
      {jamWib(s.bacaan.waktu)}
    </Petunjuk>
  );
}

function Angka({
  register,
  kwh,
  satuanKwh,
}: {
  register: number | null;
  kwh: number | null;
  satuanKwh: boolean;
}) {
  if (register == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="font-data tabular-nums">
      {fmt(satuanKwh ? kwh ?? 0 : register)}
    </span>
  );
}

export function PanelListrik({
  kode,
  judul,
  pengaturan,
  bacaan,
  pertama,
  sekarangMs,
  bolehKelola,
}: {
  kode: string;
  judul: string;
  pengaturan: PengaturanListrik;
  bacaan: BacaanMeter[];
  pertama: string | null;
  sekarangMs: number;
  bolehKelola: boolean;
}) {
  const router = useRouter();
  const [catatBuka, setCatatBuka] = useState(false);
  const [aturBuka, setAturBuka] = useState(false);

  const hari = useMemo(
    () => rekapHarian(bacaan, pengaturan, sekarangMs, HARI_REKAP, pertama),
    [bacaan, pengaturan, sekarangMs, pertama]
  );
  const aneh = useMemo(() => bacaanTidakWajar(bacaan), [bacaan]);
  const satuanKwh = pengaturan.faktorKali != null;
  const satuan = satuanKwh ? "kWh" : "satuan register";

  const ringkas = useMemo(() => {
    const tujuh = hari.slice(0, HARI_KPI);
    let lwbp = 0;
    let wbp = 0;
    let hariLengkap = 0;
    let biaya = 0;
    let adaBiaya = false;
    let slotWajib = 0;
    let slotTercatat = 0;
    let slotTepat = 0;
    for (const h of tujuh) {
      if (h.lwbpRegister != null && h.wbpRegister != null) {
        lwbp += satuanKwh ? h.lwbpKwh ?? 0 : h.lwbpRegister;
        wbp += satuanKwh ? h.wbpKwh ?? 0 : h.wbpRegister;
        hariLengkap++;
      }
      if (h.biaya != null) {
        biaya += h.biaya;
        adaBiaya = true;
      }
      for (const s of [h.mulai, h.akhir]) {
        if (s.status === "belum_waktunya" || s.status === "belum_dimulai")
          continue;
        slotWajib++;
        if (s.status === "tercatat") {
          slotTercatat++;
          if (s.tepat) slotTepat++;
        }
      }
    }
    return {
      lwbp,
      wbp,
      hariLengkap,
      biaya: adaBiaya ? biaya : null,
      slotWajib,
      slotTercatat,
      slotTepat,
    };
  }, [hari, satuanKwh]);

  const terakhir = bacaan[0] ?? null;
  const standTerakhir = terakhir ? standTotal(terakhir) : null;
  const hariIni = hari[0];
  const kurang: string[] = [];
  if (pengaturan.faktorKali == null) kurang.push("faktor kali meter");
  if (pengaturan.hargaLwbp == null || pengaturan.faktorK == null)
    kurang.push("tarif (harga LWBP & faktor K)");

  async function batalkan(b: BacaanMeter) {
    const ok = await konfirmasi(
      `Batalkan pembacaan ${jamWib(b.waktu)} oleh ${
        b.olehNama
      }? Pembacaan tidak dihapus, hanya tidak lagi dihitung.`,
      { tombol: "Batalkan pembacaan", bahaya: true }
    );
    if (!ok) return;
    const r = await batalkanBacaanMeterAction(
      kode,
      b.id,
      "Dibatalkan dari dashboard"
    );
    if (!r.success) return toast.error(r.error);
    toast.success("Pembacaan dibatalkan");
    router.refresh();
  }

  // Selisih tiap pembacaan terhadap pembacaan sebelumnya (daftar terbaru dulu).
  const delta = new Map<string, number>();
  for (let i = 0; i < bacaan.length - 1; i++) {
    const a = standTotal(bacaan[i]);
    const b = standTotal(bacaan[i + 1]);
    if (a != null && b != null) delta.set(bacaan[i].id, a - b);
  }

  return (
    <div className="contents">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-xl font-semibold">{judul}</h1>
        <div className="flex items-center gap-2">
          {bolehKelola && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAturBuka(true)}
            >
              <Settings2 className="size-4" /> Pengaturan
            </Button>
          )}
          <Button size="sm" onClick={() => setCatatBuka(true)}>
            <Camera className="size-4" /> Catat Meter
          </Button>
        </div>
      </div>

      {kurang.length > 0 && (
        <div className="flex flex-wrap items-start gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="min-w-0 flex-1 text-muted-foreground">
            <span className="font-medium text-foreground">
              Belum diisi: {kurang.join(" dan ")}.
            </span>{" "}
            {pengaturan.faktorKali == null
              ? "Pemakaian ditampilkan dalam satuan register meter (belum dikali faktor kali), dan biaya belum dihitung."
              : "Biaya belum dihitung."}{" "}
            Isi dari rekening PLN terakhir.
          </p>
          {bolehKelola && (
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => setAturBuka(true)}
            >
              Isi sekarang
            </Button>
          )}
        </div>
      )}

      {/* Jadwal hari ini */}
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          {
            label: "Awal beban puncak",
            jam: pengaturan.jamWbpMulai,
            s: hariIni.mulai,
            ikon: Sun,
          },
          {
            label: "Akhir beban puncak",
            jam: pengaturan.jamWbpSelesai,
            s: hariIni.akhir,
            ikon: Moon,
          },
        ].map(({ label, jam, s, ikon: Ikon }) => (
          <div
            key={jam}
            className={cn(
              "flex items-center gap-3 rounded-xl border bg-card px-4 py-3",
              s.status === "kosong" && "border-destructive/40 bg-destructive/5"
            )}
          >
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-lg",
                s.status === "tercatat"
                  ? "bg-primary/10 text-primary"
                  : s.status === "kosong"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted text-muted-foreground"
              )}
            >
              <Ikon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">
                Hari ini · {label} ·{" "}
                <span className="font-data">{jamLabel(jam)}</span>
              </p>
              <p className="truncate text-sm font-medium">
                {s.status === "tercatat"
                  ? `Tercatat ${jamWib(s.bacaan.waktu)} oleh ${
                      s.bacaan.olehNama
                    }`
                  : s.status === "kosong"
                  ? "Terlewat — tidak ada pembacaan"
                  : s.status === "belum_dimulai"
                  ? "Pencatatan belum dimulai"
                  : `Menunggu (${jamLabel(jam)} ± 1 jam)`}
              </p>
            </div>
            {s.status === "tercatat" ? (
              <CheckCircle2 className="size-5 shrink-0 text-primary" />
            ) : (
              <CircleDashed className="size-5 shrink-0 text-muted-foreground" />
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label={`Pemakaian ${HARI_KPI} hari`}
          value={ringkas.hariLengkap ? fmt(ringkas.lwbp + ringkas.wbp, 0) : "—"}
          hint={
            ringkas.hariLengkap
              ? `${satuan} · ${ringkas.hariLengkap} hari lengkap`
              : "Butuh pembacaan 17.00 & 22.00 berurutan"
          }
          icon={Zap}
          tone="warning"
        />
        <KpiCard
          label="Porsi beban puncak"
          value={
            ringkas.lwbp + ringkas.wbp > 0
              ? `${fmt((ringkas.wbp / (ringkas.lwbp + ringkas.wbp)) * 100)}%`
              : "—"
          }
          hint={`WBP ${jamLabel(pengaturan.jamWbpMulai)}–${jamLabel(
            pengaturan.jamWbpSelesai
          )}, lebih mahal`}
          icon={Sun}
          tone={
            ringkas.lwbp + ringkas.wbp > 0 &&
            ringkas.wbp / (ringkas.lwbp + ringkas.wbp) > 0.25
              ? "negative"
              : "default"
          }
        />
        <KpiCard
          label="Kepatuhan catat"
          value={
            ringkas.slotWajib
              ? `${ringkas.slotTercatat}/${ringkas.slotWajib}`
              : "—"
          }
          hint={
            ringkas.slotWajib
              ? `${ringkas.slotTepat} tepat waktu · ${HARI_KPI} hari`
              : undefined
          }
          icon={CheckCircle2}
          tone={
            ringkas.slotWajib && ringkas.slotTercatat < ringkas.slotWajib
              ? "negative"
              : "positive"
          }
        />
        <KpiCard
          label={
            ringkas.biaya != null
              ? `Estimasi biaya ${HARI_KPI} hari`
              : "Stand terakhir"
          }
          value={
            ringkas.biaya != null
              ? formatRupiah(ringkas.biaya)
              : standTerakhir != null
              ? fmt(standTerakhir, 2)
              : "—"
          }
          hint={
            ringkas.biaya != null
              ? "Tanpa biaya beban, kVArh & PPJ"
              : terakhir
              ? `${tanggalWib(terakhir.waktu)} ${jamWib(terakhir.waktu)} · ${
                  terakhir.olehNama
                }`
              : "Belum ada pembacaan"
          }
          icon={Gauge}
        />
      </div>

      {/* Rekap harian */}
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Rekap {HARI_REKAP} hari</h2>
          <p className="text-xs text-muted-foreground">
            LWBP = {jamLabel(pengaturan.jamWbpSelesai)} kemarin →{" "}
            {jamLabel(pengaturan.jamWbpMulai)}; WBP ={" "}
            {jamLabel(pengaturan.jamWbpMulai)} →{" "}
            {jamLabel(pengaturan.jamWbpSelesai)} · {satuan}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-sm">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Tanggal</th>
                <th className="px-2 py-2 text-left font-medium">
                  {jamLabel(pengaturan.jamWbpMulai)}
                </th>
                <th className="px-2 py-2 text-left font-medium">
                  {jamLabel(pengaturan.jamWbpSelesai)}
                </th>
                <th className="px-2 py-2 text-right font-medium">LWBP</th>
                <th className="px-2 py-2 text-right font-medium">WBP</th>
                <th className="px-2 py-2 text-right font-medium">Total</th>
                <th className="px-2 py-2 text-right font-medium">% WBP</th>
                <th className="px-4 py-2 text-right font-medium">Biaya</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {hari.map((h: HariListrik) => {
                const total =
                  h.lwbpRegister != null && h.wbpRegister != null
                    ? h.lwbpRegister + h.wbpRegister
                    : null;
                const porsi =
                  total && h.wbpRegister != null ? h.wbpRegister / total : null;
                return (
                  <tr key={h.tanggal} className="hover:bg-muted/30">
                    <td className="px-4 py-2 whitespace-nowrap">
                      {hariLabel(h.tanggal)}
                    </td>
                    <td className="px-2 py-2">
                      <ChipSlot s={h.mulai} jam={pengaturan.jamWbpMulai} />
                    </td>
                    <td className="px-2 py-2">
                      <ChipSlot s={h.akhir} jam={pengaturan.jamWbpSelesai} />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Angka
                        register={h.lwbpRegister}
                        kwh={h.lwbpKwh}
                        satuanKwh={satuanKwh}
                      />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Angka
                        register={h.wbpRegister}
                        kwh={h.wbpKwh}
                        satuanKwh={satuanKwh}
                      />
                    </td>
                    <td className="px-2 py-2 text-right font-medium">
                      <Angka
                        register={total}
                        kwh={h.totalKwh}
                        satuanKwh={satuanKwh}
                      />
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                      {porsi != null ? `${fmt(porsi * 100)}%` : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {h.biaya != null ? (
                        formatRupiah(h.biaya)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Riwayat pembacaan */}
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Riwayat pembacaan</h2>
          <p className="text-xs text-muted-foreground">
            {bacaan.length} pembacaan · 15 hari terakhir
          </p>
        </div>
        {bacaan.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-warning/10 text-warning">
              <Zap className="size-6" />
            </span>
            <p className="text-sm font-medium">Belum ada pembacaan meter</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Operator mencatat stand meter PLN beserta fotonya setiap pukul{" "}
              {jamLabel(pengaturan.jamWbpMulai)} dan{" "}
              {jamLabel(pengaturan.jamWbpSelesai)} dari aplikasi produksi, atau
              lewat tombol Catat Meter di atas.
            </p>
          </div>
        ) : (
          <ul className="divide-y">
            {bacaan.map((b) => {
              const s = standTotal(b);
              const d = delta.get(b.id);
              return (
                <li
                  key={b.id}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm"
                >
                  {b.fotoPath ? (
                    <a
                      href={b.fotoPath}
                      target="_blank"
                      rel="noreferrer"
                      className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted"
                      aria-label="Lihat foto meter"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- foto unggahan (Drive/lokal) */}
                      <img
                        src={b.fotoPath}
                        alt=""
                        className="size-full object-cover"
                        loading="lazy"
                      />
                    </a>
                  ) : (
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                      <ImageIcon className="size-4" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-data font-semibold tabular-nums">
                        {s != null ? fmt(s, 2) : "—"}
                      </span>
                      {d != null && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          +{fmt(d, 2)}
                        </span>
                      )}
                      {b.kwhLwbp != null && b.kwhWbp != null && (
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          (LWBP {fmt(b.kwhLwbp, 2)} · WBP {fmt(b.kwhWbp, 2)})
                        </span>
                      )}
                      <span
                        className={cn(
                          "rounded px-1.5 py-px text-[10px] font-medium",
                          b.slot === "lain"
                            ? "bg-muted text-muted-foreground"
                            : "bg-primary/10 text-primary"
                        )}
                      >
                        {LABEL_SLOT[b.slot]}
                      </span>
                      {b.sumber === "otomatis" && (
                        <span className="rounded bg-secondary px-1.5 py-px text-[10px]">
                          otomatis
                        </span>
                      )}
                      {aneh.has(b.id) && (
                        <Petunjuk
                          render={
                            <span className="inline-flex cursor-help items-center gap-1 rounded bg-destructive/10 px-1.5 py-px text-[10px] font-medium text-destructive" />
                          }
                          judul="Lonjakan tidak wajar"
                          isi="Kenaikan per jam sejak pembacaan sebelumnya lebih dari 3× biasanya. Cocokkan dengan fotonya — mungkin salah ketik."
                        >
                          <AlertTriangle className="size-3" /> cek
                        </Petunjuk>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {tanggalWib(b.waktu)} {jamWib(b.waktu)} · {b.olehNama}
                      {b.kvarh != null && ` · kVArh ${fmt(b.kvarh, 2)}`}
                      {b.catatan && ` · ${b.catatan}`}
                    </p>
                  </div>
                  {bolehKelola && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label="Batalkan pembacaan"
                      onClick={() => batalkan(b)}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <CatatMeterDialog
        kode={kode}
        pengaturan={pengaturan}
        open={catatBuka}
        onOpenChange={setCatatBuka}
        onTersimpan={() => router.refresh()}
      />
      {bolehKelola && aturBuka && (
        <PengaturanListrikDialog
          kode={kode}
          awal={pengaturan}
          open={aturBuka}
          onOpenChange={(v) => {
            setAturBuka(v);
            if (!v) router.refresh();
          }}
        />
      )}
    </div>
  );
}
