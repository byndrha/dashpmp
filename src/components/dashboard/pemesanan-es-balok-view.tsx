"use client";

// Modul Pemesanan Es Balok (PMPutra/PMPersada/PMPakis) — tampilan BACA-SAJA
// pesanan agen dari ERP untuk satu tanggal kirim. Dua tampilan:
//   - Papan: kolom tahap (Belum Dijadwalkan → Dijadwalkan → Selesai, + Retur)
//   - Per Kendaraan: muatan tiap kendaraan (jadwal ERP) vs kapasitasnya
// Tahap diturunkan dari data ERP (lib/queries/pemesanan-es-balok.ts), sama
// prinsipnya dengan Papan Pemesanan Es Kristal: tidak ada status manual.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  KanbanSquare,
  MapPin,
  Search,
  Truck,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PesananBalok, TahapBalok } from "@/lib/queries/pemesanan-es-balok";

const TAHAP: { key: TahapBalok; label: string; ket: string; icon: LucideIcon; aksen: string }[] = [
  { key: "belum", label: "Belum Dijadwalkan", ket: "Pesanan masuk, belum ada jadwal kendaraan", icon: CircleDashed, aksen: "text-muted-foreground" },
  { key: "dijadwalkan", label: "Dijadwalkan", ket: "Sudah masuk jadwal kendaraan, belum diselesaikan", icon: CalendarClock, aksen: "text-warning" },
  { key: "selesai", label: "Selesai", ket: "Pesanan sudah diselesaikan di ERP", icon: CheckCircle2, aksen: "text-primary" },
  { key: "retur", label: "Retur", ket: "Ada balok yang dikembalikan", icon: Undo2, aksen: "text-destructive" },
];

function fmt(n: number): string {
  return n.toLocaleString("id-ID", { maximumFractionDigits: 1 });
}

// "PMP/SO/001207/2026-11/GE/HO" → "SO 001207"
function noSingkat(no: string): string {
  const p = no.split("/");
  return p.length >= 3 ? `${p[1]} ${p[2]}` : no;
}

function geserTanggal(iso: string, hari: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + hari);
  return d.toISOString().slice(0, 10);
}

function labelTanggal(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Chip qty satu jenis balok: pesanan, dan realisasi bila berbeda.
function ChipQty({ jenis, pesan, real }: { jenis: string; pesan: number; real: number }) {
  if (pesan === 0 && real === 0) return null;
  const beda = real !== pesan;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]",
        beda ? "bg-warning/15 text-warning" : "bg-sky-500/15 text-sky-700 dark:text-sky-400"
      )}
      title={beda ? `Dipesan ${fmt(pesan)}, terealisasi ${fmt(real)}` : undefined}
    >
      {jenis}
      <span className="font-bold">{fmt(beda ? real : pesan)}</span>
      {beda && <span className="opacity-70 line-through">{fmt(pesan)}</span>}
    </span>
  );
}

function KartuPesananBalok({ p }: { p: PesananBalok }) {
  const retur = p.returKecil + p.returBesar;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-card p-2.5 text-sm shadow-xs transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-medium" title={p.agen}>
          {p.agen}
        </p>
        <span className="shrink-0 text-[11px] text-muted-foreground" title={p.noDokumen}>
          {noSingkat(p.noDokumen)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {p.wilayah && (
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            <MapPin className="size-3" />
            {p.wilayah}
          </span>
        )}
        <ChipQty jenis="Kecil" pesan={p.pesanKecil} real={p.realKecil} />
        <ChipQty jenis="Besar" pesan={p.pesanBesar} real={p.realBesar} />
        {retur > 0 && (
          <span className="rounded-md bg-destructive/15 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
            Retur {fmt(retur)}
          </span>
        )}
      </div>
      {(p.kendaraan || p.catatan) && (
        <div className="flex flex-col gap-0.5 border-t pt-1.5 text-[11px] text-muted-foreground">
          {p.kendaraan && (
            <p className="flex items-center gap-1 truncate" title={p.noJadwal ?? undefined}>
              <Truck className="size-3 shrink-0" />
              {p.kendaraan}
            </p>
          )}
          {p.catatan && <p className="truncate italic">“{p.catatan}”</p>}
        </div>
      )}
    </div>
  );
}

function Papan({ rows }: { rows: PesananBalok[] }) {
  const per: Record<TahapBalok, PesananBalok[]> = { belum: [], dijadwalkan: [], selesai: [], retur: [] };
  for (const r of rows) per[r.tahap].push(r);
  return (
    <div className="-mx-3 overflow-x-auto px-3 pb-2">
      <div className="grid auto-cols-[minmax(250px,1fr)] grid-flow-col gap-3">
        {TAHAP.map((t) => {
          const isi = per[t.key];
          const kecil = isi.reduce((s, r) => s + r.realKecil, 0);
          const besar = isi.reduce((s, r) => s + r.realBesar, 0);
          return (
            <section key={t.key} className="flex flex-col rounded-xl border bg-muted/30" aria-label={t.label}>
              <header className="flex flex-col gap-1 rounded-t-xl border-b bg-background/60 px-3 py-2.5" title={t.ket}>
                <div className="flex items-center gap-2">
                  <t.icon className={cn("size-4", t.aksen)} />
                  <h3 className="text-sm font-semibold">{t.label}</h3>
                  <span className="ml-auto rounded-full bg-background px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                    {isi.length}
                  </span>
                </div>
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  Kecil <span className="font-semibold text-foreground">{fmt(kecil)}</span> · Besar{" "}
                  <span className="font-semibold text-foreground">{fmt(besar)}</span>
                </p>
              </header>
              <div className="flex flex-col gap-2 p-2">
                {isi.map((p, i) => (
                  <div
                    key={p.id}
                    className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300 motion-safe:fill-mode-backwards"
                    style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}
                  >
                    <KartuPesananBalok p={p} />
                  </div>
                ))}
                {isi.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">Tidak ada pesanan.</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function PerKendaraan({ rows }: { rows: PesananBalok[] }) {
  const grup = new Map<string, { nama: string; maks: number | null; rows: PesananBalok[] }>();
  for (const r of rows) {
    const k = r.kendaraanId ?? "__belum";
    const g = grup.get(k) ?? { nama: r.kendaraan ?? "Belum dijadwalkan", maks: r.kendaraanMaks, rows: [] };
    g.rows.push(r);
    grup.set(k, g);
  }
  const daftar = [...grup.entries()].sort(([a], [b]) => (a === "__belum" ? 1 : b === "__belum" ? -1 : 0));
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {daftar.map(([id, g]) => {
        const kecil = g.rows.reduce((s, r) => s + r.realKecil, 0);
        const besar = g.rows.reduce((s, r) => s + r.realBesar, 0);
        const total = kecil + besar;
        const adaMaks = g.maks != null && g.maks > 0;
        const pct = adaMaks ? Math.min(100, (total / (g.maks as number)) * 100) : 0;
        const lebih = adaMaks && total > (g.maks as number);
        return (
          <section key={id} className="flex flex-col gap-2 rounded-xl border bg-card p-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg",
                  id === "__belum" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"
                )}
              >
                <Truck className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{g.nama}</p>
                <p className="text-[11px] text-muted-foreground">
                  {g.rows.length} pesanan · Kecil {fmt(kecil)} · Besar {fmt(besar)}
                </p>
              </div>
              <span className="font-display text-lg font-semibold tabular-nums">{fmt(total)}</span>
            </div>
            {adaMaks && (
              <div className="flex flex-col gap-1">
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full transition-[width] duration-500 ease-out", lebih ? "bg-destructive" : "bg-primary")}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className={cn("text-[11px] tabular-nums", lebih ? "font-medium text-destructive" : "text-muted-foreground")}>
                  {fmt(total)} / {fmt(g.maks as number)} balok{lebih ? " — melebihi kapasitas tercatat" : ""}
                </p>
              </div>
            )}
            <ul className="flex flex-col divide-y text-xs">
              {g.rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate" title={r.agen}>
                    {r.agen}
                    {r.wilayah && <span className="text-muted-foreground"> · {r.wilayah}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {r.realKecil > 0 && `K ${fmt(r.realKecil)}`}
                    {r.realKecil > 0 && r.realBesar > 0 && " · "}
                    {r.realBesar > 0 && `B ${fmt(r.realBesar)}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function PemesananEsBalokView({
  kode,
  rows,
  tanggalISO,
  todayISO,
}: {
  kode: string;
  rows: PesananBalok[];
  tanggalISO: string;
  todayISO: string;
}) {
  const router = useRouter();
  const [tampilan, setTampilan] = useState<"papan" | "kendaraan">("papan");
  const [cari, setCari] = useState("");

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.agen.toLowerCase().includes(q) || r.noDokumen.toLowerCase().includes(q) || (r.wilayah ?? "").toLowerCase().includes(q)
    );
  }, [rows, cari]);

  const ringkas = useMemo(() => {
    const kecil = tampil.reduce((s, r) => s + r.realKecil, 0);
    const besar = tampil.reduce((s, r) => s + r.realBesar, 0);
    const agen = new Set(tampil.map((r) => r.agenId ?? r.agen)).size;
    const kendaraan = new Set(tampil.filter((r) => r.kendaraanId).map((r) => r.kendaraanId)).size;
    return { kecil, besar, agen, kendaraan };
  }, [tampil]);

  const besok = geserTanggal(todayISO, 1);
  const href = (iso: string) => `/${kode}/pemesanan?tanggal=${iso}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold">Pemesanan</h1>
          <p className="text-sm text-muted-foreground">Pesanan mitra untuk {labelTanggal(tanggalISO)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex h-9 items-center rounded-lg border bg-card p-0.5">
            <Link href={href(geserTanggal(tanggalISO, -1))} className="flex size-8 items-center justify-center rounded-md hover:bg-muted" aria-label="Hari sebelumnya">
              <ChevronLeft className="size-4" />
            </Link>
            {[
              { iso: todayISO, label: "Hari ini" },
              { iso: besok, label: "Besok" },
            ].map((o) => (
              <Link
                key={o.iso}
                href={href(o.iso)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  tanggalISO === o.iso ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {o.label}
              </Link>
            ))}
            <Link href={href(geserTanggal(tanggalISO, 1))} className="flex size-8 items-center justify-center rounded-md hover:bg-muted" aria-label="Hari berikutnya">
              <ChevronRight className="size-4" />
            </Link>
          </div>
          <input
            type="date"
            value={tanggalISO}
            onChange={(e) => e.target.value && router.push(href(e.target.value))}
            className="h-9 rounded-lg border bg-card px-2 text-sm"
            aria-label="Pilih tanggal kirim"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex h-9 rounded-lg border bg-muted/40 p-0.5" role="group" aria-label="Tampilan">
          {(
            [
              { v: "papan", label: "Papan", icon: KanbanSquare },
              { v: "kendaraan", label: "Per Kendaraan", icon: Truck },
            ] as const
          ).map(({ v, label, icon: Icon }) => (
            <button
              key={v}
              type="button"
              aria-pressed={tampilan === v}
              onClick={() => setTampilan(v)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors",
                tampilan === v ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            placeholder="Cari mitra, wilayah, atau no. SO"
            className="h-9 w-full rounded-lg border bg-background pl-8 pr-8 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label="Cari pesanan"
          />
          {cari && (
            <button
              type="button"
              onClick={() => setCari("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label="Hapus pencarian"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground sm:ml-auto">
          <span className="font-semibold text-foreground">{tampil.length}</span> pesanan ·{" "}
          <span className="font-semibold text-foreground">{ringkas.agen}</span> mitra · Kecil{" "}
          <span className="font-semibold text-foreground">{fmt(ringkas.kecil)}</span> · Besar{" "}
          <span className="font-semibold text-foreground">{fmt(ringkas.besar)}</span> ·{" "}
          <span className="font-semibold text-foreground">{ringkas.kendaraan}</span> kendaraan
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-14 text-center">
          <CalendarClock className="size-8 text-muted-foreground/60" />
          <p className="text-sm font-medium">Belum ada pesanan untuk tanggal ini</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Pesanan dibuat di ERP Es Balok. Pesanan untuk besok biasanya mulai masuk malam hari sebelumnya.
          </p>
        </div>
      ) : tampil.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Tidak ada pesanan yang cocok dengan “{cari.trim()}”.</p>
      ) : tampilan === "papan" ? (
        <Papan rows={tampil} />
      ) : (
        <PerKendaraan rows={tampil} />
      )}

      <p className="text-[11px] text-muted-foreground">
        Data dibaca langsung dari ERP Es Balok. Pembuatan & perubahan pesanan masih dilakukan di ERP.
      </p>
    </div>
  );
}
