"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";
import { FotoThumbnail } from "@/components/produksi/foto-thumbnail";
import type { RiwayatShiftGroup } from "@/lib/queries/produksi-riwayat-detail";
import { formatQty } from "@/lib/korelasi-format";

// Badge kejernihan/ukuran & bentuk (nama tidak dibuat generik karena
// makna OK/Gagal-nya spesifik per pemeriksaan).
function CekBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
        ok ? "bg-emerald-500/15 text-emerald-600" : "bg-destructive/15 text-destructive"
      )}
    >
      {label} {ok ? "OK" : "Gagal"}
    </span>
  );
}

// Satu kartu grup (Tanggal, Shift) -- header-nya bisa diklik untuk
// collapse/expand daftar entri di bawahnya (default terbuka), dan
// menampilkan 6 statistik ringkas (Stok Awal/Produksi/Masuk Pallet/
// Terkirim/Sisa Stok Akhir/Retur) di sebelah kanan label Shift, sesuai
// permintaan user 2026-09-19. Komponen client terpisah dari
// riwayat-produksi.tsx (Server Component) karena butuh useState untuk
// toggle collapse.
export function RiwayatShiftGroupCard({ group }: { group: RiwayatShiftGroup }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-border bg-muted/30 px-3 py-2 text-left hover:bg-muted/50"
      >
        <div className="flex shrink-0 items-center gap-2">
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", collapsed && "-rotate-90")} />
          <span className="text-sm font-semibold">{formatDate(group.tanggalUsaha)}</span>
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">Shift {group.shift}</span>
          <span className="text-xs text-muted-foreground">Tim: {group.timNama ?? "Belum ditentukan"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            Stok Awal <b className="text-foreground tabular-nums">{formatQty(group.stats.stokAwal)}</b>
          </span>
          <span>
            Produksi <b className="text-foreground tabular-nums">{formatQty(group.stats.totalProduksi)}</b>
          </span>
          <span>
            Produksi 5KG <b className="text-foreground tabular-nums">{formatQty(group.stats.totalProduksi5KG)}</b>
          </span>
          <span>
            Gabungan <b className="text-foreground tabular-nums">{formatQty(group.stats.totalProduksiGabungan)}</b>
          </span>
          <span>
            Masuk Pallet <b className="text-foreground tabular-nums">{formatQty(group.stats.masukPallet)}</b>
          </span>
          <span>
            Terkirim <b className="text-foreground tabular-nums">{formatQty(group.stats.terkirim)}</b>
          </span>
          <span>
            Sisa Stok Akhir{" "}
            <b className="text-foreground tabular-nums">
              {formatQty(group.stats.sisaStokAkhir)}
              {!group.stats.sisaStokAkhirFinal && " (live)"}
            </b>
          </span>
          <span>
            Retur <b className="text-foreground tabular-nums">{formatQty(group.stats.retur)}</b>
          </span>
        </div>
      </button>
      {!collapsed && group.entries.length === 0 && (
        <p className="bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
          Tidak ada entri Cek Kualitas — SOP tidak dijalankan pada shift ini.
        </p>
      )}
      {!collapsed && group.entries.length > 0 && (
        <div className="divide-y divide-border">
          {group.entries.map((e) => (
            <div key={e.kualitasId} className="flex items-center gap-3 p-2 text-sm">
              <div className="flex shrink-0 gap-1.5">
                <FotoThumbnail path={e.fotoPath} alt="Foto es" size={44} />
                <FotoThumbnail path={e.fotoBeratKemasanPath} alt="Foto berat kemasan" size={44} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold tabular-nums">{e.waktu}</span>
                  <span className="text-xs text-muted-foreground">{e.mesinNama}</span>
                  <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-600">
                    {e.variant === "10kg" ? "10 KG" : "5 KG"}
                  </span>
                  <CekBadge label="Kejernihan" ok={e.cekKejernihan} />
                  <CekBadge label="Ukuran &amp; Bentuk" ok={e.cekUkuranBentuk} />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span>
                    Panen <b className="tabular-nums">{e.qty10KG != null ? `${e.qty10KG} kantong` : "-"}</b>
                  </span>
                  <span>
                    Diameter <b className="tabular-nums">{e.diameterDalamMm != null ? `${e.diameterDalamMm} mm` : "-"}</b>
                  </span>
                  <span>
                    Sisa belum dipallet{" "}
                    <b className={cn("tabular-nums", (e.sisaBelumDialokasikan ?? 0) > 0 && "text-amber-600")}>
                      {e.sisaBelumDialokasikan != null ? `${e.sisaBelumDialokasikan} kantong` : "-"}
                    </b>
                  </span>
                  <span>
                    Oleh <b>{e.dicatatOlehNama}</b>
                  </span>
                  {e.alokasiPallet.map((a) => (
                    <span key={a.batchId} className="shrink-0 rounded border border-border px-1.5 py-0.5 tabular-nums">
                      {a.posisiKode} {a.qty10KG}
                      {a.sisaQty10KG !== a.qty10KG && ` (sisa ${a.sisaQty10KG})`}
                    </span>
                  ))}
                </div>
                {e.catatan && <p className="truncate text-xs italic text-muted-foreground">&ldquo;{e.catatan}&rdquo;</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
