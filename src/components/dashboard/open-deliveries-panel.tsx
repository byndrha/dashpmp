"use client";

// Tab "Pengiriman Terbuka" (desain ulang 2026-11-22). Hanya DO yang MASIH
// punya sisa kirim (filter di getOpenDeliveries), dikelompokkan per DO
// (bukan satu baris per item), dengan umur DO, pencarian, dan filter
// wilayah di dalam tab — filter wilayah dulu ada di header halaman padahal
// hanya berlaku untuk tab ini.
import { useMemo, useState } from "react";
import { PackageOpen, Search, Truck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { OpenDelivery } from "@/lib/queries/delivery";

interface GrupDo {
  id: string;
  voucher: string;
  tanggal: string;
  jatuhTempo: string;
  wilayah: string;
  mitra: string;
  kendaraan: string;
  ditagih: boolean;
  umurHari: number;
  sisa: number;
  item: { nama: string; qty: number; terkirim: number; sisa: number }[];
}

function kelompokkan(rows: OpenDelivery[], sekarang: number): GrupDo[] {
  const peta = new Map<string, GrupDo>();
  for (const r of rows) {
    let g = peta.get(r.DeliveryOrderID);
    if (!g) {
      g = {
        id: r.DeliveryOrderID,
        voucher: r.VoucherNo,
        tanggal: r.TransDate,
        jatuhTempo: r.DueDate,
        wilayah: r.Wilayah,
        mitra: r.CustomerName,
        kendaraan: r.VehicleNo,
        ditagih: r.IsInvoiced,
        umurHari: Math.max(0, Math.floor((sekarang - new Date(r.TransDate).getTime()) / 86400000)),
        sisa: 0,
        item: [],
      };
      peta.set(r.DeliveryOrderID, g);
    }
    g.sisa += r.SisaBelumDikirim;
    g.item.push({ nama: r.ItemName, qty: r.Qty, terkirim: r.Delivered, sisa: r.SisaBelumDikirim });
  }
  return [...peta.values()];
}

function labelUmur(hari: number): string {
  if (hari < 1) return "hari ini";
  if (hari < 31) return `${hari} hari`;
  if (hari < 365) return `${Math.floor(hari / 30)} bulan`;
  return `${(hari / 365).toLocaleString("id-ID", { maximumFractionDigits: 1 })} tahun`;
}

function warnaUmur(hari: number): string {
  if (hari <= 7) return "bg-primary/10 text-primary";
  if (hari <= 30) return "bg-warning/15 text-warning";
  return "bg-destructive/10 text-destructive";
}

export function OpenDeliveriesPanel({ rows, sekarangMs }: { rows: OpenDelivery[]; sekarangMs: number }) {
  const [cari, setCari] = useState("");
  const [wilayah, setWilayah] = useState("all");
  const grup = useMemo(() => kelompokkan(rows, sekarangMs), [rows, sekarangMs]);
  const daftarWilayah = useMemo(() => [...new Set(grup.map((g) => g.wilayah))].sort(), [grup]);

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return grup.filter(
      (g) =>
        (wilayah === "all" || g.wilayah === wilayah) &&
        (!q || g.voucher.toLowerCase().includes(q) || (g.mitra ?? "").toLowerCase().includes(q))
    );
  }, [grup, cari, wilayah]);

  const totalSisa = tampil.reduce((t, g) => t + g.sisa, 0);
  const tertua = tampil.reduce((m, g) => Math.max(m, g.umurHari), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="DO Masih Bersisa" value={tampil.length.toLocaleString("id-ID")} icon={Truck} />
        <KpiCard label="Total Sisa Belum Dikirim" value={totalSisa.toLocaleString("id-ID")} icon={PackageOpen} tone="warning" />
        <KpiCard
          label="DO Tertua"
          value={tampil.length ? labelUmur(tertua) : "—"}
          hint={tertua > 90 ? "Kemungkinan data lama yang belum ditutup di ERP" : undefined}
          icon={PackageOpen}
          tone={tertua > 30 ? "negative" : "default"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 shadow-xs">
        <div className="relative min-w-0 flex-1 sm:max-w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Cari no. DO atau mitra..."
            aria-label="Cari no. DO atau mitra"
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={wilayah} onValueChange={(v) => setWilayah(v ?? "all")}>
          <SelectTrigger aria-label="Wilayah">
            <SelectValue>{() => (wilayah === "all" ? "Semua Wilayah" : wilayah)}</SelectValue>
          </SelectTrigger>
          <SelectContent className="w-auto min-w-(--anchor-width)">
            <SelectItem value="all">Semua Wilayah</SelectItem>
            {daftarWilayah.map((w) => (
              <SelectItem key={w} value={w}>
                {w}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="ml-auto text-xs text-muted-foreground">
          {tampil.length} DO · sisa = Qty − Terkirim per item
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="hidden grid-cols-[13.5rem_minmax(0,1.5fr)_minmax(0,0.9fr)_minmax(0,2fr)_5rem_7rem] gap-x-4 border-b bg-muted/40 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:grid">
          <span>DO</span>
          <span>Mitra</span>
          <span>Wilayah</span>
          <span>Item (sisa / qty)</span>
          <span className="text-right">Sisa</span>
          <span>Status</span>
        </div>
        <ul className="divide-y">
          {tampil.map((g) => (
            <li
              key={g.id}
              className="grid grid-cols-1 gap-x-4 gap-y-1.5 px-4 py-3 text-sm transition-colors hover:bg-muted/30 lg:grid-cols-[13.5rem_minmax(0,1.5fr)_minmax(0,0.9fr)_minmax(0,2fr)_5rem_7rem] lg:items-center"
            >
              <div className="min-w-0">
                <p className="font-data text-xs font-medium break-all">{g.voucher}</p>
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {formatDate(g.tanggal)}
                  <span className={cn("rounded px-1.5 py-px text-[10px] font-semibold", warnaUmur(g.umurHari))}>{labelUmur(g.umurHari)}</span>
                </p>
              </div>
              <div className="min-w-0">
                <p className="truncate font-medium">{g.mitra}</p>
                <p className="truncate text-[11px] text-muted-foreground">Kendaraan {g.kendaraan || "—"}</p>
              </div>
              <p className="truncate text-xs">{g.wilayah}</p>
              <div className="flex min-w-0 flex-wrap gap-1">
                {g.item.map((it, i) => (
                  <span key={i} className="truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    {it.nama} <span className="font-semibold text-foreground">{it.sisa}</span>/{it.qty}
                  </span>
                ))}
              </div>
              <p className="font-data text-sm font-semibold tabular-nums lg:text-right">
                <span className="text-xs font-normal text-muted-foreground lg:hidden">Sisa </span>
                {g.sisa.toLocaleString("id-ID")}
              </p>
              <div>
                <Badge variant={g.ditagih ? "default" : "secondary"}>{g.ditagih ? "Sudah Ditagih" : "Belum Ditagih"}</Badge>
              </div>
            </li>
          ))}
        </ul>
        {tampil.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {grup.length === 0 ? "Semua DO sudah terkirim penuh — tidak ada sisa kirim." : "Tidak ada DO yang cocok dengan pencarian."}
          </p>
        )}
      </div>
    </div>
  );
}
