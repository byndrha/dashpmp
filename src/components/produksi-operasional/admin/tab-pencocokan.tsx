"use client";

// Tab Pencocokan panen ↔ DO layar admin (spec §4, §8) — hanya untuk admin
// produksi (dirender tab-operasional.tsx kalau bolehKelolaProduksi; server
// action-nya memakai gerbang "kelola"). Membandingkan es yang dipanen per
// kendaraan armada dengan DO ERP pada tanggal bisnis yang sama (closing
// 13:59 WIB, ROLLOVER_PANEN_JAM). Muatan "kendaraan pembeli" ditampilkan
// terpisah, tanpa dicocokkan per baris.

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { getPencocokanAction } from "@/app/produksi-operasional-actions";
import type { KodeProduksi } from "@/lib/produksi-denah";
import { ROLLOVER_PANEN_JAM, tanggalBisnisPanen, type BarisCocok, type StatusCocok } from "@/lib/produksi-operasional";
import type { MuatanHarian } from "@/lib/queries/produksi-operasional";

const angka = new Intl.NumberFormat("id-ID");
const FORMAT_TANGGAL = new Intl.DateTimeFormat("id-ID", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });

const STATUS: Record<StatusCocok, { label: string; kelas: string }> = {
  "panen-lebih": {
    label: "Panen > DO",
    kelas: "bg-red-100 border-red-400 text-red-900 dark:bg-red-950/70 dark:border-red-700 dark:text-red-100",
  },
  "hanya-panen": {
    label: "Hanya panen",
    kelas: "bg-orange-100 border-orange-400 text-orange-900 dark:bg-orange-950/70 dark:border-orange-700 dark:text-orange-100",
  },
  "do-lebih": {
    label: "DO > Panen",
    kelas: "bg-amber-100 border-amber-400 text-amber-900 dark:bg-amber-950/70 dark:border-amber-700 dark:text-amber-100",
  },
  "hanya-do": {
    label: "Hanya DO",
    kelas: "bg-sky-100 border-sky-300 text-sky-900 dark:bg-sky-950/60 dark:border-sky-800 dark:text-sky-100",
  },
  cocok: {
    label: "Cocok",
    kelas: "bg-emerald-100 border-emerald-400 text-emerald-900 dark:bg-emerald-950/70 dark:border-emerald-700 dark:text-emerald-100",
  },
};

/** Latar baris tabel untuk status yang perlu perhatian (panen-lebih = merah). */
const LATAR_BARIS: Partial<Record<StatusCocok, string>> = {
  "panen-lebih": "bg-red-50 dark:bg-red-950/30",
  "hanya-panen": "bg-orange-50/60 dark:bg-orange-950/20",
};

function geserTanggal(tanggal: string, hari: number): string {
  const [y, m, d] = tanggal.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + hari)).toISOString().slice(0, 10);
}

function labelTanggal(tanggal: string): string {
  return FORMAT_TANGGAL.format(new Date(`${tanggal}T00:00:00Z`));
}

function Selisih({ n }: { n: number }) {
  if (n === 0) return <span className="text-muted-foreground">0</span>;
  return (
    <span className={cn("font-semibold", n > 0 ? "text-red-600 dark:text-red-400" : "text-amber-700 dark:text-amber-400")}>
      {n > 0 ? "+" : "−"}
      {angka.format(Math.abs(n))}
    </span>
  );
}

interface Hasil {
  baris: BarisCocok[];
  muatan: MuatanHarian;
  sementara: boolean;
}

export function TabPencocokan({ kode }: { kode: KodeProduksi }) {
  // Bawaan: hari bisnis terakhir yang sudah closing (= hari bisnis berjalan − 1).
  const [hariIni] = useState(() => tanggalBisnisPanen(new Date()));
  const [tanggal, setTanggal] = useState(() => geserTanggal(hariIni, -1));
  const [hasil, setHasil] = useState<Hasil | null>(null);
  const [hasilTanggal, setHasilTanggal] = useState<string | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(false);

  // Tanggal yang terakhir selesai dimuat (berhasil atau gagal): selama
  // berbeda dari `tanggal`, permintaan untuk tanggal itu masih berjalan.
  const [selesaiTanggal, setSelesaiTanggal] = useState<string | null>(null);
  const [segar, setSegar] = useState(0);

  useEffect(() => {
    let batal = false;
    getPencocokanAction(kode, tanggal).then(
      (r) => {
        if (batal) return;
        if (r.success) {
          setHasil(r.data);
          setHasilTanggal(tanggal);
          setGalat(null);
        } else {
          setGalat(r.error);
        }
        setSelesaiTanggal(tanggal);
        setMemuat(false);
      },
      () => {
        if (batal) return;
        setGalat("Gagal memuat pencocokan — periksa koneksi.");
        setSelesaiTanggal(tanggal);
        setMemuat(false);
      },
    );
    return () => {
      batal = true;
    };
  }, [kode, tanggal, segar]);

  const sedangMuat = memuat || selesaiTanggal !== tanggal;
  const segarkan = () => {
    setMemuat(true);
    setSegar((n) => n + 1);
  };

  const total = useMemo(() => {
    const t = { panenKecil: 0, panenBesar: 0, doKecil: 0, doBesar: 0 };
    for (const b of hasil?.baris ?? []) {
      t.panenKecil += b.panenKecil;
      t.panenBesar += b.panenBesar;
      t.doKecil += b.doKecil;
      t.doBesar += b.doBesar;
    }
    return t;
  }, [hasil]);
  const totalPembeli = useMemo(() => {
    const t = { kecil: 0, besar: 0 };
    for (const p of hasil?.muatan.pembeli ?? []) {
      t.kecil += p.kecil;
      t.besar += p.besar;
    }
    return t;
  }, [hasil]);

  const gantiTanggal = (t: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) setTanggal(t > hariIni ? hariIni : t);
  };
  const ringkasan = hasil?.muatan.ringkasan;
  const totalDo = total.doKecil + total.doBesar;
  const basi = hasilTanggal !== tanggal;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => gantiTanggal(geserTanggal(tanggal, -1))} disabled={sedangMuat}>
          <ChevronLeft className="size-3.5" /> Lihat H−1
        </Button>
        <Input
          type="date"
          value={tanggal}
          max={hariIni}
          onChange={(e) => gantiTanggal(e.target.value)}
          className="h-8 w-auto"
          aria-label="Tanggal bisnis"
        />
        <Button variant="outline" size="sm" onClick={() => gantiTanggal(geserTanggal(tanggal, 1))} disabled={sedangMuat || tanggal >= hariIni}>
          Lihat H+1 <ChevronRight className="size-3.5" />
        </Button>
        <Button variant="ghost" size="sm" onClick={segarkan} disabled={sedangMuat}>
          <RefreshCw className={cn("size-3.5", sedangMuat && "animate-spin")} /> Segarkan
        </Button>
        <span className="text-sm font-medium">{labelTanggal(tanggal)}</span>
        {hasil?.sementara && !basi && (
          <span className="rounded-md border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-950/70 dark:text-amber-100">
            Sementara
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Tanggal bisnis ditutup pukul {String(ROLLOVER_PANEN_JAM - 1).padStart(2, "0")}:59 WIB; mulai{" "}
        {String(ROLLOVER_PANEN_JAM).padStart(2, "0")}:00 dihitung hari berikutnya — untuk panen maupun DO. DO biasanya diinput malam
        (sekitar 20:00–21:00), jadi kalau ada selisih, cek dulu H−1 / H+1: bisa jadi panen dan DO-nya jatuh di tanggal bisnis berbeda.
        {hasil?.sementara && !basi && " Hari bisnis ini belum closing, jadi selisih masih wajar."}
      </p>

      {galat && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{galat}</p>}

      {ringkasan && (
        <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-5", basi && "opacity-60")}>
          <Kartu label="Dimuat (panen)" nilai={ringkasan.dimuat} />
          <Kartu label="Total DO" nilai={totalDo} />
          <Kartu label="Ke Babonan" nilai={ringkasan.keBabonan} />
          <Kartu label="Pecah" nilai={ringkasan.pecah} />
          <Kartu label="Babonan dibuang" nilai={ringkasan.babonanDibuang} />
        </div>
      )}

      <div className={cn("overflow-x-auto rounded-lg border", basi && "opacity-60")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kendaraan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Panen K/B</TableHead>
              <TableHead className="text-right">DO K/B</TableHead>
              <TableHead className="text-right">Selisih K/B</TableHead>
              <TableHead>No DO</TableHead>
              <TableHead>Operator</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!hasil && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  {sedangMuat ? "Memuat…" : "Belum ada data."}
                </TableCell>
              </TableRow>
            )}
            {hasil && hasil.baris.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  Tidak ada panen armada maupun DO pada tanggal bisnis ini.
                </TableCell>
              </TableRow>
            )}
            {hasil?.baris.map((b) => {
              const s = STATUS[b.status];
              return (
                <TableRow key={b.kendaraanErpId} className={LATAR_BARIS[b.status]}>
                  <TableCell className="font-medium whitespace-nowrap">{b.plat || `ID ${b.kendaraanErpId}`}</TableCell>
                  <TableCell>
                    <span className={cn("inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold whitespace-nowrap", s.kelas)}>{s.label}</span>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {angka.format(b.panenKecil)} / {angka.format(b.panenBesar)}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    {angka.format(b.doKecil)} / {angka.format(b.doBesar)}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">
                    <Selisih n={b.selisihKecil} /> / <Selisih n={b.selisihBesar} />
                  </TableCell>
                  <TableCell className="max-w-64 text-xs">{b.noDo.length ? b.noDo.join(", ") : "—"}</TableCell>
                  <TableCell className="max-w-48 text-xs">{b.operator.length ? b.operator.join(", ") : "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {hasil && hasil.baris.length > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="font-semibold">
                  Total armada
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {angka.format(total.panenKecil)} / {angka.format(total.panenBesar)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  {angka.format(total.doKecil)} / {angka.format(total.doBesar)}
                </TableCell>
                <TableCell className="text-right whitespace-nowrap tabular-nums">
                  <Selisih n={total.panenKecil - total.doKecil} /> / <Selisih n={total.panenBesar - total.doBesar} />
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        K = balok kecil, B = balok besar. Selisih = panen − DO (+ merah: es keluar lebih banyak dari nota). Es pecah dan Babonan
        yang dibuang tidak ikut dicocokkan.
      </p>

      <section className={cn("flex flex-col gap-2", basi && "opacity-60")}>
        <h3 className="text-sm font-semibold">Kendaraan pembeli</h3>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plat</TableHead>
                <TableHead>Agen</TableHead>
                <TableHead className="text-right">K</TableHead>
                <TableHead className="text-right">B</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(hasil?.muatan.pembeli.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                    Tidak ada muatan kendaraan pembeli.
                  </TableCell>
                </TableRow>
              )}
              {hasil?.muatan.pembeli.map((p) => (
                <TableRow key={p.plat}>
                  <TableCell className="font-medium whitespace-nowrap">{p.plat}</TableCell>
                  <TableCell>{p.agenNama ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{angka.format(p.kecil)}</TableCell>
                  <TableCell className="text-right tabular-nums">{angka.format(p.besar)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            {(hasil?.muatan.pembeli.length ?? 0) > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2} className="font-semibold">
                    Total kendaraan pembeli
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{angka.format(totalPembeli.kecil)}</TableCell>
                  <TableCell className="text-right tabular-nums">{angka.format(totalPembeli.besar)}</TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Total kendaraan pembeli bisa jadi sepadan dengan DO berkendaraan &quot;Ambil Sendiri&quot; di tabel atas.
        </p>
      </section>
    </div>
  );
}

function Kartu({ label, nilai }: { label: string; nilai: number }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{angka.format(nilai)}</div>
    </div>
  );
}
