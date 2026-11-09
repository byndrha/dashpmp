"use client";

// Tab Ringkasan layar admin (spec §8): kartu stok can gaya IceControl (semua
// dihitung dari `sisa` isian, bukan jumlah rek), progres per bak, dan
// estimasi can jadi dalam 6/12 jam ke depan.

import { cn } from "@/lib/utils";
import { estimasiCanJadi, type KeadaanRek, type RingkasanStok } from "@/lib/produksi-operasional";
import { jamWib, WARNA_KEADAAN, WARNA_TAHAP } from "../warna-tahap";

const angka = new Intl.NumberFormat("id-ID");
const JAM_MS = 3_600_000;

export function RingkasanStokPanel({ ringkasan, keadaan, sekarang }: { ringkasan: RingkasanStok; keadaan: KeadaanRek[]; sekarang: string }) {
  const now = new Date(sekarang);
  const kartu: { label: string; nilai: number; ket: string; kelas: string }[] = [
    { label: "Can sehat", nilai: ringkasan.sehat, ket: "kapasitas aktif di luar maintenance", kelas: "bg-card" },
    { label: WARNA_TAHAP.air.label, nilai: ringkasan.air, ket: "baru diisi air (0%)", kelas: cn(WARNA_TAHAP.air.latar, WARNA_TAHAP.air.teks) },
    { label: "Proses", nilai: ringkasan.proses, ket: "1–99% (mulai, kristal, siap)", kelas: cn(WARNA_TAHAP.kristal.latar, WARNA_TAHAP.kristal.teks) },
    { label: "Matang", nilai: ringkasan.matang, ket: "100%, siap dipanen", kelas: cn(WARNA_TAHAP.jadi.latar, WARNA_TAHAP.jadi.teks) },
    { label: "Babonan", nilai: ringkasan.babonan, ket: "penjaga suhu, termasuk pecah", kelas: cn(WARNA_KEADAAN.babonan.latar, WARNA_KEADAAN.babonan.teks) },
    {
      label: "Maintenance",
      nilai: ringkasan.maintenance,
      ket: "kapasitas rek maintenance",
      kelas: cn(WARNA_KEADAAN.maintenance.latar, WARNA_KEADAAN.maintenance.teks),
    },
  ];
  const estimasi = [6, 12].map((jam) => ({ jam, ...estimasiCanJadi(keadaan, now, jam) }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {kartu.map((k) => (
          <div key={k.label} className={cn("rounded-lg border px-3 py-2", k.kelas)}>
            <div className="text-xs font-medium opacity-80">{k.label}</div>
            <div className="text-2xl font-semibold tabular-nums">{angka.format(k.nilai)}</div>
            <div className="text-[11px] opacity-70">{k.ket}</div>
          </div>
        ))}
      </div>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold">Estimasi can jadi</h2>
        <p className="text-xs text-muted-foreground">
          Σ sisa isian produksi yang matang (waktu isi + durasi beku) sebelum batas waktu — dasar perencanaan muatan.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {estimasi.map((e) => (
            <div key={e.jam} className="rounded-md border px-3 py-2">
              <div className="text-xs text-muted-foreground">
                ≤ {e.jam} jam lagi (sampai {jamWib(new Date(now.getTime() + e.jam * JAM_MS).toISOString())} WIB)
              </div>
              <div className="text-2xl font-semibold tabular-nums">{angka.format(e.total)} can</div>
              <div className="text-xs text-muted-foreground">
                termasuk {angka.format(e.sudahJadi)} can yang sudah jadi · {angka.format(e.total - e.sudahJadi)} can baru jadi
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold">Terisi per bak</h2>
        <p className="text-xs text-muted-foreground">Can berisi (produksi + Babonan) dibanding kapasitas kolom aktif.</p>
        {ringkasan.perBak.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Belum ada bak di denah.</p>}
        <div className="mt-3 flex flex-col gap-3">
          {ringkasan.perBak.map((b) => {
            const pct = b.kapasitas > 0 ? Math.min(100, Math.round((b.terisi / b.kapasitas) * 100)) : 0;
            return (
              <div key={b.bakId}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{b.nama}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {angka.format(b.terisi)}/{angka.format(b.kapasitas)} can · {pct}%
                  </span>
                </div>
                <div
                  className="mt-1 h-2 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                  aria-label={`${b.nama} terisi`}
                >
                  <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
