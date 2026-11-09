"use client";

// Tab Peringatan layar admin (spec §5/§8): dihitung server saat keadaan
// dimuat (tanpa job terjadwal). SELISIH_MUATAN hanya dikirim server untuk
// admin produksi. Klik peringatan rek membuka DetailRek rek itu.

import { AlertTriangle, CheckCircle2, Clock, PackageX, Snowflake, Truck, Wrench, type LucideIcon } from "lucide-react";
import { AMBANG, type KodePeringatan, type Peringatan } from "@/lib/produksi-operasional";
import { tanggalJamWib } from "../warna-tahap";

const INFO: Record<KodePeringatan, { judul: string; ikon: LucideIcon; kelas: string }> = {
  TERLAMBAT_PANEN: {
    judul: `Terlambat panen (> durasi beku + ${AMBANG.terlambatTambahJam} jam)`,
    ikon: Clock,
    kelas: "text-red-600 dark:text-red-400",
  },
  BABONAN_LAMA: { judul: `Babonan terlalu lama (> ${AMBANG.babonanJam} jam)`, ikon: Snowflake, kelas: "text-amber-600 dark:text-amber-400" },
  MAINTENANCE_LAMA: {
    judul: `Maintenance lama (> ${AMBANG.maintenanceJam} jam)`,
    ikon: Wrench,
    kelas: "text-orange-600 dark:text-orange-400",
  },
  KOSONG_LAMA: { judul: `Rek kosong lama (> ${AMBANG.kosongJam} jam)`, ikon: PackageX, kelas: "text-sky-600 dark:text-sky-400" },
  PANEN_BELUM_SIAP: {
    judul: `Dipanen < ${AMBANG.panenBelumSiapPersen}% (${AMBANG.panenBelumSiapJendelaJam} jam terakhir)`,
    ikon: AlertTriangle,
    kelas: "text-yellow-600 dark:text-yellow-400",
  },
  SLOT_BELUM_SIAP: {
    judul: "Data slot can belum siap (jalankan backfill slot)",
    ikon: AlertTriangle,
    kelas: "text-red-600 dark:text-red-400",
  },
  SELISIH_MUATAN: { judul: "Selisih muatan ↔ DO (hari bisnis terakhir yang sudah closing)", ikon: Truck, kelas: "text-red-600 dark:text-red-400" },
};
const URUTAN: KodePeringatan[] = ["SLOT_BELUM_SIAP", "TERLAMBAT_PANEN", "SELISIH_MUATAN", "BABONAN_LAMA", "MAINTENANCE_LAMA", "PANEN_BELUM_SIAP", "KOSONG_LAMA"];

export function DaftarPeringatan({
  peringatan,
  selisihGagal = false,
  onPilihRek,
}: {
  peringatan: Peringatan[];
  /** Server gagal/terlambat membaca DO ERP: selisih muatan tidak dihitung (bukan berarti cocok). */
  selisihGagal?: boolean;
  onPilihRek: (kolomId: string) => void;
}) {
  const galatDo = selisihGagal && (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-100"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>
        <b>Pemeriksaan DO gagal — selisih tidak dapat dihitung.</b> ERP tidak terjangkau atau terlalu lambat; peringatan selisih muatan
        hari bisnis terakhir belum diperiksa. Dicoba lagi otomatis dalam ±1 menit.
      </span>
    </p>
  );

  if (peringatan.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {galatDo}
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <CheckCircle2 className="size-6 text-green-600 dark:text-green-400" />
          {selisihGagal ? "Tidak ada peringatan lain saat ini." : "Tidak ada peringatan saat ini."}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {galatDo}
      {URUTAN.map((kode) => {
        const daftar = peringatan.filter((p) => p.kode === kode).sort((a, b) => Date.parse(a.sejak) - Date.parse(b.sejak));
        if (daftar.length === 0) return null;
        const info = INFO[kode];
        return (
          <section key={kode} className="rounded-lg border bg-card">
            <h2 className="flex items-center gap-2 border-b px-4 py-2 text-sm font-semibold">
              <info.ikon className={`size-4 ${info.kelas}`} />
              {info.judul}
              <span className="ml-auto rounded-full bg-muted px-2 text-xs tabular-nums">{daftar.length}</span>
            </h2>
            <ul className="divide-y">
              {daftar.map((p, idx) => {
                const isi = (
                  <>
                    <span className="min-w-0 flex-1">{p.pesan}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">sejak {tanggalJamWib(p.sejak)} WIB</span>
                  </>
                );
                const kolomId = p.kolomId;
                return (
                  <li key={`${p.kolomId ?? "x"}-${idx}`}>
                    {kolomId ? (
                      <button
                        type="button"
                        onClick={() => onPilihRek(kolomId)}
                        className="flex w-full items-start gap-3 px-4 py-2 text-left text-sm hover:bg-muted/50"
                      >
                        {isi}
                      </button>
                    ) : (
                      <div className="flex items-start gap-3 px-4 py-2 text-sm">{isi}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
