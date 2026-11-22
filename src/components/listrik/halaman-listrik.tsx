import { AlertTriangle } from "lucide-react";
import {
  getBacaanMeter,
  getPengaturanListrik,
  getWaktuBacaanPertama,
} from "@/lib/queries/listrik";
import { sesiListrik } from "@/lib/listrik-akses";
import type { BacaanMeter, PengaturanListrik } from "@/lib/listrik";
import { PanelListrik } from "./panel-listrik";

// Bagian pencatatan meter modul Kelistrikan (server) — dipakai halaman
// Kelistrikan Es Kristal dan ketiga PT Es Balok.

const HARI_DIMUAT = 15;

async function muat(kode: string): Promise<
  | {
      ok: true;
      pengaturan: PengaturanListrik;
      bacaan: BacaanMeter[];
      pertama: string | null;
      sekarangMs: number;
      bolehKelola: boolean;
    }
  | { ok: false; pesan: string }
> {
  const sekarangMs = Date.now();
  try {
    const [pengaturan, bacaan, pertama, bolehKelola] = await Promise.all([
      getPengaturanListrik(kode),
      getBacaanMeter(kode, new Date(sekarangMs - HARI_DIMUAT * 86_400_000)),
      getWaktuBacaanPertama(kode),
      sesiListrik(kode, "kelola").then(
        () => true,
        () => false
      ),
    ]);
    return { ok: true, pengaturan, bacaan, pertama, sekarangMs, bolehKelola };
  } catch (err) {
    console.error("[kelistrikan] gagal memuat", err);
    const belumAda =
      err instanceof Error &&
      /listrik_(pengaturan|bacaan_meter)" does not exist/.test(err.message);
    return {
      ok: false,
      pesan: belumAda
        ? "Tabel kelistrikan belum dibuat di database (jalankan scripts/create-listrik-tables.ts)."
        : "Data pencatatan meter gagal dimuat. Coba muat ulang halaman.",
    };
  }
}

export async function HalamanListrik({
  kode,
  judul = "Kelistrikan",
}: {
  kode: string;
  judul?: string;
}) {
  const d = await muat(kode);
  if (!d.ok) {
    return (
      <div className="contents">
        <h1 className="font-display text-xl font-semibold">{judul}</h1>
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p>{d.pesan}</p>
        </div>
      </div>
    );
  }
  return (
    <PanelListrik
      kode={kode}
      judul={judul}
      pengaturan={d.pengaturan}
      bacaan={d.bacaan}
      pertama={d.pertama}
      sekarangMs={d.sekarangMs}
      bolehKelola={d.bolehKelola}
    />
  );
}
