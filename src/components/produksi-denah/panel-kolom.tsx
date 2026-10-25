"use client";

// Panel kolom Builder Denah: pita semua kolom bak terpilih (klik / Shift
// rentang / Ctrl satu-satu) + isian untuk SATU ATAU BANYAK kolom sekaligus.
// Nilai yang berbeda antar kolom tampil sebagai "campuran".

import { memo, type Dispatch } from "react";
import { cn } from "@/lib/utils";
import type { BakElemen, DenahKolom, Varian } from "@/lib/produksi-denah";
import type { AksiBuilder } from "@/components/produksi-denah/builder-state";
import { Bidang, Centang, InputAngka, InputTeks, Judul, Segmen, TombolKecil } from "@/components/produksi-denah/bidang";

function sama<T>(daftar: DenahKolom[], ambil: (k: DenahKolom) => T): T | null {
  if (daftar.length === 0) return null;
  const v = ambil(daftar[0]);
  return daftar.every((k) => Object.is(ambil(k), v)) ? v : null;
}

function ringkasNomor(kolom: DenahKolom[]): string {
  const n = kolom.map((k) => k.nomor).sort((a, b) => a - b);
  const bagian: string[] = [];
  for (let i = 0; i < n.length; i++) {
    let j = i;
    while (j + 1 < n.length && n[j + 1] === n[j] + 1) j++;
    bagian.push(i === j ? `${n[i]}` : `${n[i]}–${n[j]}`);
    i = j;
  }
  return bagian.join(", ");
}

export const PanelKolom = memo(function PanelKolom({
  bak,
  kolomTerpilih,
  kolomSorotIds,
  dispatch,
}: {
  bak: BakElemen | null;
  kolomTerpilih: readonly string[];
  kolomSorotIds: ReadonlySet<string>;
  dispatch: Dispatch<AksiBuilder>;
}) {
  if (!bak) {
    return (
      <p className="text-xs text-muted-foreground">
        Pilih satu bak, lalu klik kolom di dalamnya (atau di pita kolom di sini). Shift+klik memilih rentang, Ctrl+klik menambah satu per satu.
      </p>
    );
  }
  const idPilih = new Set(kolomTerpilih);
  const pilih = bak.kolom.filter((k) => idPilih.has(k.id));
  const ids = pilih.map((k) => k.id);
  const ubah = (patch: Partial<Omit<DenahKolom, "id" | "nomor">>, gabung?: string) =>
    dispatch({ type: "ubahKolom", bakId: bak.id, kolomIds: ids, patch, gabung: gabung ? `${gabung}:${ids[0]}:${ids.length}` : undefined });

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-sm font-medium">{bak.nama || "Bak tanpa nama"}</div>
        <div className="text-xs text-muted-foreground">{bak.kolom.length} kolom</div>
      </div>

      <Judul
        aksi={
          <div className="flex gap-1">
            <TombolKecil onClick={() => dispatch({ type: "aturKolomTerpilih", bakId: bak.id, kolomIds: bak.kolom.map((k) => k.id) })}>Semua</TombolKecil>
            <TombolKecil disabled={ids.length === 0} onClick={() => dispatch({ type: "aturKolomTerpilih", bakId: bak.id, kolomIds: [] })}>
              Kosongkan
            </TombolKecil>
          </div>
        }
      >
        Kolom
      </Judul>
      <div className="flex flex-wrap gap-0.5" role="listbox" aria-multiselectable aria-label="Kolom bak">
        {bak.kolom.map((k) => (
          <button
            key={k.id}
            type="button"
            role="option"
            aria-selected={idPilih.has(k.id)}
            title={`Kolom ${k.nomor} · ${k.varian === "kecil" ? "Kecil" : "Besar"} · ${k.jumlahIceCan} ice can${k.nonaktif ? " · nonaktif" : ""}${k.catatan ? ` · ${k.catatan}` : ""}`}
            onClick={(e) =>
              dispatch({ type: "pilihKolom", bakId: bak.id, kolomId: k.id, rentang: e.shiftKey, toggle: e.ctrlKey || e.metaKey })
            }
            className={cn(
              "h-6 min-w-6 rounded px-0.5 text-[10px] font-medium tabular-nums transition-all",
              k.nonaktif
                ? "bg-muted text-muted-foreground line-through"
                : k.varian === "kecil"
                  ? "bg-sky-200 text-sky-900 dark:bg-sky-800 dark:text-sky-100"
                  : "bg-amber-200 text-amber-900 dark:bg-amber-700 dark:text-amber-50",
              kolomSorotIds.has(k.id) && "bg-red-300 text-red-950 ring-1 ring-destructive dark:bg-red-800 dark:text-red-50",
              idPilih.has(k.id) && "scale-110 ring-2 ring-primary"
            )}
          >
            {k.nomor}
          </button>
        ))}
      </div>

      {pilih.length === 0 ? (
        <p className="text-xs text-muted-foreground">Belum ada kolom terpilih.</p>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border p-2">
          <div className="text-xs font-medium">
            {pilih.length === 1 ? `Kolom ${pilih[0].nomor}` : `${pilih.length} kolom: ${ringkasNomor(pilih)}`}
          </div>
          <Bidang label="Varian">
            <Segmen<Varian>
              nilai={sama(pilih, (k) => k.varian)}
              pilihan={[
                { nilai: "kecil", label: "Kecil" },
                { nilai: "besar", label: "Besar" },
              ]}
              onUbah={(varian) => ubah({ varian })}
            />
          </Bidang>
          <Bidang label="Jumlah ice can">
            <InputAngka nilai={sama(pilih, (k) => k.jumlahIceCan)} min={1} max={200} stepper onUbah={(jumlahIceCan) => ubah({ jumlahIceCan })} />
          </Bidang>
          <Bidang label="Ukuran ice can">
            <InputTeks
              nilai={sama(pilih, (k) => k.ukuranIceCan ?? "") ?? ""}
              placeholder={sama(pilih, (k) => k.ukuranIceCan ?? "") === null ? "campuran" : "mis. 25 kg"}
              onUbah={(ukuranIceCan) => ubah({ ukuranIceCan }, "ukuran")}
              onSelesai={() => dispatch({ type: "putusGabung" })}
            />
          </Bidang>
          <Bidang label="Catatan">
            <InputTeks
              nilai={sama(pilih, (k) => k.catatan ?? "") ?? ""}
              placeholder={sama(pilih, (k) => k.catatan ?? "") === null ? "campuran" : undefined}
              onUbah={(catatan) => ubah({ catatan }, "catatan")}
              onSelesai={() => dispatch({ type: "putusGabung" })}
            />
          </Bidang>
          <Centang nilai={sama(pilih, (k) => !!k.nonaktif)} label="Nonaktif (tidak dipakai produksi)" onUbah={(nonaktif) => ubah({ nonaktif })} />
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Kolom yang masih berisi es tidak boleh diubah varian, jumlah/ukuran ice can, atau status nonaktifnya — server menolak saat menyimpan.</p>
    </div>
  );
});
