"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Search, Truck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { cariAgenAction } from "@/app/produksi-operasional-actions";
import type { KodeProduksi } from "@/lib/produksi-denah";
import type { KendaraanPilihan } from "@/lib/produksi-operasional";
import type { KendaraanArmada } from "@/lib/queries/produksi-do-erp";

export function labelKendaraan(k: KendaraanPilihan | null): string {
  if (!k) return "Pilih kendaraan";
  if (k.jenis === "pembeli") return `${k.plat || "?"} (pembeli${k.agenNama ? ` · ${k.agenNama}` : ""})`;
  return k.plat || k.kendaraanErpId || "?";
}

/** Kunci keunikan kendaraan dalam satu panen (selaras validasiPanen). */
export function kunciKendaraan(k: KendaraanPilihan): string {
  return k.jenis === "armada" ? `armada:${k.kendaraanErpId}` : `pembeli:${k.plat.trim().toUpperCase().replace(/\s+/g, " ")}`;
}

function dariArmada(a: KendaraanArmada): KendaraanPilihan {
  return { jenis: "armada", kendaraanErpId: a.kendaraanErpId, plat: a.plat, agenId: null, agenNama: null };
}

const BATAS_TAMPIL = 80;

// Tombol + dialog pemilih kendaraan. Dipakai di bagian atas aplikasi (kendaraan
// aktif) dan di setiap baris muatan formulir panen.
export function PemilihKendaraan({
  kode,
  armada,
  armadaGalat = null,
  nilai,
  onPilih,
  disabled,
  tampilan = "atas",
  judul = "Kendaraan aktif",
}: {
  kode: KodeProduksi;
  armada: KendaraanArmada[];
  armadaGalat?: string | null;
  nilai: KendaraanPilihan | null;
  onPilih: (k: KendaraanPilihan) => void;
  disabled?: boolean;
  tampilan?: "atas" | "baris";
  judul?: string;
}) {
  const [buka, setBuka] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => setBuka(true)}
        className={cn(
          "min-w-0 justify-between gap-1.5",
          tampilan === "atas" ? "h-9 max-w-[60vw] px-2.5 font-semibold" : "h-10 w-full px-2.5 text-left",
          !nilai && "text-muted-foreground",
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {nilai?.jenis === "pembeli" ? <UserRound className="size-4 shrink-0" /> : <Truck className="size-4 shrink-0" />}
          <span className="truncate">{labelKendaraan(nilai)}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 opacity-60" />
      </Button>
      <Dialog open={buka} onOpenChange={(o) => setBuka(o)}>
        <DialogContent className="top-4 translate-y-0 sm:max-w-md">
          {buka && (
            <IsiPemilih
              kode={kode}
              armada={armada}
              armadaGalat={armadaGalat}
              nilai={nilai}
              judul={judul}
              onPilih={(k) => {
                onPilih(k);
                setBuka(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function IsiPemilih({
  kode,
  armada,
  armadaGalat,
  nilai,
  judul,
  onPilih,
}: {
  kode: KodeProduksi;
  armada: KendaraanArmada[];
  armadaGalat: string | null;
  nilai: KendaraanPilihan | null;
  judul: string;
  onPilih: (k: KendaraanPilihan) => void;
}) {
  const [mode, setMode] = useState<"armada" | "pembeli">(nilai?.jenis === "pembeli" ? "pembeli" : "armada");
  const [cari, setCari] = useState("");

  const daftar = useMemo(() => {
    const q = cari.trim().toUpperCase().replace(/\s+/g, "");
    const cocok = q
      ? armada.filter((a) => a.plat.toUpperCase().replace(/\s+/g, "").includes(q) || (a.sopir ?? "").toUpperCase().includes(q))
      : armada;
    return cocok.slice(0, BATAS_TAMPIL);
  }, [armada, cari]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{judul}</DialogTitle>
        <DialogDescription>Pilih armada pabrik atau kendaraan pembeli.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {(["armada", "pembeli"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "rounded-md py-1.5 text-sm font-medium",
              mode === m ? "bg-background shadow-sm" : "text-muted-foreground",
            )}
          >
            {m === "armada" ? "Armada" : "Kendaraan pembeli"}
          </button>
        ))}
      </div>

      {mode === "armada" ? (
        <div className="flex min-h-0 flex-col gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              placeholder="Cari plat atau sopir"
              className="h-10 pl-8"
              inputMode="search"
            />
          </div>
          <div className="max-h-[50dvh] overflow-y-auto rounded-lg border">
            {daftar.length === 0 ? (
              <p className="p-3 text-center text-sm text-muted-foreground">
                {armada.length === 0 ? (armadaGalat ?? "Daftar armada tidak tersedia.") : "Tidak ada yang cocok."}
              </p>
            ) : (
              daftar.map((a) => {
                const terpilih = nilai?.jenis === "armada" && nilai.kendaraanErpId === a.kendaraanErpId;
                return (
                  <button
                    key={a.kendaraanErpId}
                    type="button"
                    onClick={() => onPilih(dariArmada(a))}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 border-b px-3 py-2.5 text-left last:border-b-0 active:bg-muted",
                      terpilih && "bg-primary/10",
                    )}
                  >
                    <span className="font-semibold">{a.plat || a.kendaraanErpId}</span>
                    {a.sopir && <span className="truncate text-xs text-muted-foreground">{a.sopir}</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <FormPembeli kode={kode} awal={nilai?.jenis === "pembeli" ? nilai : null} onPilih={onPilih} />
      )}
    </>
  );
}

function FormPembeli({
  kode,
  awal,
  onPilih,
}: {
  kode: KodeProduksi;
  awal: KendaraanPilihan | null;
  onPilih: (k: KendaraanPilihan) => void;
}) {
  const [plat, setPlat] = useState(awal?.plat ?? "");
  const [agenNama, setAgenNama] = useState(awal?.agenNama ?? "");
  const [agenId, setAgenId] = useState<string | null>(awal?.agenId ?? null);
  const [saran, setSaran] = useState<{ agenId: string; nama: string }[]>([]);

  // Cari agen di ERP saat nama diketik (debounce), kecuali sudah dipilih dari saran.
  useEffect(() => {
    const q = agenNama.trim();
    if (agenId || q.length < 2) return;
    let batal = false;
    const t = setTimeout(async () => {
      const r = await cariAgenAction(kode, q);
      if (!batal) setSaran(r.success ? r.data : []);
    }, 300);
    return () => {
      batal = true;
      clearTimeout(t);
    };
  }, [kode, agenNama, agenId]);

  const platBersih = plat.trim().toUpperCase().replace(/\s+/g, " ");

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium">Plat kendaraan (wajib)</span>
        <Input value={plat} onChange={(e) => setPlat(e.target.value)} placeholder="mis. S 1234 AB" className="h-10 uppercase" autoCapitalize="characters" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium">Nama agen (opsional)</span>
        <Input
          value={agenNama}
          onChange={(e) => {
            setAgenNama(e.target.value);
            setAgenId(null);
            if (e.target.value.trim().length < 2) setSaran([]);
          }}
          placeholder="Ketik untuk mencari agen"
          className="h-10"
        />
      </label>
      {!agenId && saran.length > 0 && agenNama.trim().length >= 2 && (
        <div className="max-h-40 overflow-y-auto rounded-lg border">
          {saran.map((s) => (
            <button
              key={s.agenId}
              type="button"
              onClick={() => {
                setAgenId(s.agenId);
                setAgenNama(s.nama);
                setSaran([]);
              }}
              className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 active:bg-muted"
            >
              {s.nama}
            </button>
          ))}
        </div>
      )}
      {agenId && <p className="text-xs text-muted-foreground">Agen terpilih dari daftar ERP.</p>}
      <Button
        type="button"
        size="lg"
        className="h-11"
        disabled={!platBersih}
        onClick={() =>
          onPilih({ jenis: "pembeli", kendaraanErpId: null, plat: platBersih, agenId, agenNama: agenNama.trim() || null })
        }
      >
        Pakai kendaraan ini
      </Button>
    </div>
  );
}
