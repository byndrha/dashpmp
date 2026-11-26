"use client";

// Editor daftar SIM seorang driver (golongan, nomor, masa berlaku) —
// terkendali penuh lewat `sims` + `onUbah`, tanpa ambil data sendiri, agar
// bisa dipakai di Kelola Driver maupun di dialog Health Check yang sempit.
// Nilai disimpan apa adanya saat diketik (spasi di "B2 Umum" tetap bisa
// diketik); rapikan dengan `rapikanSims` tepat sebelum dikirim ke server.
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { HARI_PERINGATAN_SIM, hariIniWibISO, statusSim, type SimDriver } from "@/lib/health-check-driver";

/** Selisih hari kalender (b − a) dari dua tanggal "YYYY-MM-DD". */
function selisihHari(aISO: string, bISO: string): number {
  const keUtc = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((keUtc(bISO) - keUtc(aISO)) / 86_400_000);
}

/**
 * Bentuk yang diterima server: golongan di-trim + huruf besar, nomor/tanggal
 * kosong jadi null. Baris yang sepenuhnya kosong dibuang; baris dengan
 * nomor/tanggal tetapi tanpa golongan dibiarkan agar server menolaknya
 * dengan pesan yang jelas (bukan hilang diam-diam).
 */
export function rapikanSims(sims: SimDriver[]): SimDriver[] {
  return sims
    .map((s) => ({
      jenisSim: s.jenisSim.trim().toUpperCase(),
      nomorSim: s.nomorSim?.trim() ? s.nomorSim.trim() : null,
      berlakuHingga: s.berlakuHingga ? s.berlakuHingga : null,
    }))
    .filter((s) => s.jenisSim !== "" || s.nomorSim !== null || s.berlakuHingga !== null);
}

function LencanaStatusSim({ sim, hariIni }: { sim: SimDriver; hariIni: string }) {
  const status = statusSim(sim, hariIni);
  if (status === "berlaku") return null;
  if (status === "kedaluwarsa") {
    return (
      <Badge variant="destructive" className="text-[10px]">
        Kedaluwarsa
      </Badge>
    );
  }
  if (status === "tanpa_tanggal") {
    return (
      <Badge variant="outline" className="text-[10px] text-muted-foreground">
        Tanpa tanggal
      </Badge>
    );
  }
  const sisa = selisihHari(hariIni, sim.berlakuHingga!);
  return (
    <Badge
      variant="outline"
      className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400"
      title={`Habis dalam ≤${HARI_PERINGATAN_SIM} hari`}
    >
      {sisa === 0 ? "Habis hari ini" : `Habis dlm ${sisa} hari`}
    </Badge>
  );
}

export function EditorSimDriver({ sims, onUbah }: { sims: SimDriver[]; onUbah: (s: SimDriver[]) => void }) {
  // Tanggal WIB dibekukan saat editor dipasang — cukup untuk umur sebuah dialog.
  const [hariIni] = useState(() => hariIniWibISO());

  function ubahBaris(index: number, perubahan: Partial<SimDriver>) {
    onUbah(sims.map((s, i) => (i === index ? { ...s, ...perubahan } : s)));
  }

  function hapusBaris(index: number) {
    onUbah(sims.filter((_, i) => i !== index));
  }

  function tambahBaris() {
    onUbah([...sims, { jenisSim: "", nomorSim: null, berlakuHingga: null }]);
  }

  const golonganTerpakai = sims.map((s) => s.jenisSim.trim().toUpperCase());

  return (
    <div className="flex flex-col gap-2">
      {sims.length === 0 && <p className="text-xs text-muted-foreground">Belum ada data SIM.</p>}
      {sims.map((s, i) => {
        const golongan = golonganTerpakai[i];
        const ganda = golongan !== "" && golonganTerpakai.indexOf(golongan) !== i;
        // Kunci indeks aman: semua isian terkendali dari `sims`.
        return (
          <div key={i} className="flex flex-col gap-1.5 rounded-lg border p-2">
            <div className="flex items-end gap-1.5">
              <label className="flex w-20 shrink-0 flex-col gap-1">
                <span className="text-[10px] text-muted-foreground">Golongan</span>
                <Input
                  value={s.jenisSim}
                  onChange={(e) => ubahBaris(i, { jenisSim: e.target.value })}
                  placeholder="mis. B1"
                  maxLength={10}
                  aria-invalid={ganda || undefined}
                  className="h-8 text-xs uppercase"
                />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[10px] text-muted-foreground">Nomor SIM</span>
                <Input
                  value={s.nomorSim ?? ""}
                  onChange={(e) => ubahBaris(i, { nomorSim: e.target.value })}
                  maxLength={30}
                  className="h-8 text-xs"
                />
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-destructive hover:text-destructive"
                aria-label={`Hapus SIM ${golongan || "ini"}`}
                onClick={() => hapusBaris(i)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-1.5">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-muted-foreground">Berlaku hingga</span>
                <Input
                  type="date"
                  value={s.berlakuHingga ?? ""}
                  onChange={(e) => ubahBaris(i, { berlakuHingga: e.target.value || null })}
                  className="h-8 w-40 text-xs"
                />
              </label>
              <div className="flex h-8 items-center gap-1.5">
                <LencanaStatusSim sim={s} hariIni={hariIni} />
                {ganda && <span className="text-[10px] text-destructive">Golongan ganda</span>}
              </div>
            </div>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" className="w-fit gap-1.5 text-xs" onClick={tambahBaris}>
        <Plus className="size-3.5" />
        Tambah SIM
      </Button>
    </div>
  );
}
