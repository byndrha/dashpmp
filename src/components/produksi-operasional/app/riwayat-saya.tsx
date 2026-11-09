"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BarisLog, MuatanHarian } from "@/lib/queries/produksi-operasional";
import { jamWib } from "../warna-tahap";

export interface DataRiwayat {
  log: BarisLog[];
  muatanHariIni: MuatanHarian;
}

const LABEL_AKSI: Record<string, string> = {
  isi_air: "Isi Air",
  panen: "Panen",
  tandai_babonan: "Tandai Babonan",
  buang_babonan: "Buang Babonan",
  mulai_maintenance: "Mulai Maintenance",
  selesai_maintenance: "Selesai Maintenance",
  koreksi_isian: "Koreksi isian",
  batal_panen: "Batal panen",
};

function objek(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function bil(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Ringkasan satu baris log dari kolom `sesudah` (bentuknya per aksi, lihat queries/produksi-operasional.ts). */
function ringkas(l: BarisLog): string {
  const s = objek(l.sesudah);
  switch (l.aksi) {
    case "isi_air":
      return `${bil(s.jumlah) ?? "?"} can`;
    case "panen": {
      const muatan = Array.isArray(s.muatan) ? s.muatan.map(objek) : [];
      const bagian = muatan.map((m) => `${typeof m.plat === "string" && m.plat ? m.plat : "?"} ${bil(m.jumlah) ?? "?"}`);
      const bab = bil(s.babonan) ?? 0;
      const pecah = bil(s.pecah) ?? 0;
      if (bab > 0) bagian.push(`Babonan ${bab}`);
      if (pecah > 0) bagian.push(`pecah ${pecah}`);
      if (s.isiUlang === true) bagian.push("isi ulang");
      if (s.belumSiap === true && bil(s.persen) !== null) bagian.push(`belum siap ${bil(s.persen)}%`);
      return bagian.join(" · ");
    }
    case "tandai_babonan":
    case "buang_babonan":
      return `${bil(s.jumlah) ?? "?"} can`;
    case "mulai_maintenance":
      return typeof s.catatan === "string" ? s.catatan : "";
    default:
      return l.alasan ?? "";
  }
}

// Tab "Riwayat saya" (spec §7): aksi operator di shift ini + total muatan per
// kendaraan hari bisnis ini.
export function RiwayatSaya({
  data,
  galat,
  memuat,
  shift,
  onSegarkan,
}: {
  data: DataRiwayat | null;
  galat: string | null;
  memuat: boolean;
  shift: number;
  onSegarkan: () => void;
}) {
  const muatan = data?.muatanHariIni;
  const adaMuatan = muatan && (muatan.armada.length > 0 || muatan.pembeli.length > 0);

  return (
    <div className="flex flex-col gap-4 p-3 pb-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-semibold">Aksi saya · Shift {shift}</h2>
        <Button variant="ghost" size="sm" onClick={onSegarkan} disabled={memuat}>
          <RefreshCw className={memuat ? "size-4 animate-spin" : "size-4"} /> Segarkan
        </Button>
      </div>
      {galat && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{galat}</p>}

      {data && data.log.length === 0 && <p className="text-sm text-muted-foreground">Belum ada aksi di shift ini.</p>}
      {data && data.log.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border">
          {data.log.map((l) => (
            <li key={l.id} className="flex gap-3 px-3 py-2 text-sm">
              <span className="w-11 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{jamWib(l.at)}</span>
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{LABEL_AKSI[l.aksi] ?? l.aksi}</span>
                {l.kolomNomor !== null && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {l.bakNama ?? "Bak"} Rek {l.kolomNomor}
                  </span>
                )}
                {ringkas(l) && <span className="block text-xs text-muted-foreground">{ringkas(l)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="font-display text-base font-semibold">Muatan hari ini (semua operator)</h2>
        {muatan && (
          <p className="text-xs text-muted-foreground">
            Dimuat {muatan.ringkasan.dimuat} · ke Babonan {muatan.ringkasan.keBabonan} · pecah {muatan.ringkasan.pecah} · Babonan
            dibuang {muatan.ringkasan.babonanDibuang}
          </p>
        )}
        {data && !adaMuatan && <p className="text-sm text-muted-foreground">Belum ada muatan hari ini.</p>}
        {muatan && adaMuatan && (
          <table className="w-full overflow-hidden rounded-lg border text-sm">
            <thead className="bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">Kendaraan</th>
                <th className="px-2 py-1.5 text-right font-medium">BK</th>
                <th className="px-3 py-1.5 text-right font-medium">BB</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {muatan.armada.map((m) => (
                <tr key={`a-${m.kendaraanErpId}`}>
                  <td className="px-3 py-1.5 font-semibold">{m.plat || m.kendaraanErpId}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{m.kecil}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{m.besar}</td>
                </tr>
              ))}
              {muatan.pembeli.map((m, i) => (
                <tr key={`p-${m.plat}-${i}`}>
                  <td className="px-3 py-1.5">
                    <span className="font-semibold">{m.plat}</span>
                    <span className="text-xs text-muted-foreground"> pembeli{m.agenNama ? ` · ${m.agenNama}` : ""}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{m.kecil}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{m.besar}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
