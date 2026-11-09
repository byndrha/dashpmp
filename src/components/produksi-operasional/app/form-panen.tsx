"use client";

import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { panenAction } from "@/app/produksi-operasional-actions";
import type { KodeProduksi } from "@/lib/produksi-denah";
import {
  hitungKematangan,
  validasiPanen,
  type IsianAktif,
  type KeadaanRek,
  type KendaraanPilihan,
  type MuatanInput,
  type PanenInput,
} from "@/lib/produksi-operasional";
import type { KendaraanArmada } from "@/lib/queries/produksi-do-erp";
import { jamWib, singkatVarian } from "../warna-tahap";
import { PemilihKendaraan } from "./pemilih-kendaraan";
import type { Jalankan } from "./produksi-app";

interface BarisMuatan {
  kunci: number;
  kendaraan: KendaraanPilihan | null;
  jumlah: string;
}

function angka(s: string): number {
  const t = s.trim();
  if (t === "") return 0;
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}

// Formulir "Panen & Isi Air" (spec §3) untuk satu isian. Untuk isian Babonan
// formulir ini menjadi "Lepas Babonan — dimuat": hanya baris muatan, boleh
// sebagian, tanpa isi ulang.
export function FormPanen({
  kode,
  rek,
  isian,
  namaBak,
  armada,
  armadaGalat,
  kendaraanAktif,
  sibuk,
  jalankan,
  onKendaraanTerakhir,
  onSelesai,
  sekarang,
}: {
  kode: KodeProduksi;
  rek: KeadaanRek;
  isian: IsianAktif;
  namaBak: string;
  armada: KendaraanArmada[];
  armadaGalat: string | null;
  kendaraanAktif: KendaraanPilihan | null;
  sibuk: boolean;
  jalankan: Jalankan;
  onKendaraanTerakhir: (k: KendaraanPilihan) => void;
  onSelesai: () => void;
  sekarang: string;
}) {
  const babonanMode = isian.jenis === "babonan";
  const sisa = isian.sisa;
  const [baris, setBaris] = useState<BarisMuatan[]>(() => [{ kunci: 0, kendaraan: kendaraanAktif, jumlah: String(sisa) }]);
  const [kunciBerikut, setKunciBerikut] = useState(1);
  const [babonan, setBabonan] = useState("0");
  const [pecah, setPecah] = useState("0");
  const [konfirmasi, setKonfirmasi] = useState<{ pct: number; isiUlang: boolean } | null>(null);

  const nBabonan = babonanMode ? 0 : angka(babonan);
  const nPecah = babonanMode ? 0 : angka(pecah);
  const muatan: MuatanInput[] = baris
    .filter((b): b is BarisMuatan & { kendaraan: KendaraanPilihan } => b.kendaraan !== null)
    .map((b) => ({ ...b.kendaraan, jumlah: angka(b.jumlah) }));
  const adaTanpaKendaraan = baris.some((b) => b.kendaraan === null);
  const dimuat = baris.reduce((s, b) => s + (Number.isNaN(angka(b.jumlah)) ? 0 : angka(b.jumlah)), 0);
  const total = dimuat + (Number.isNaN(nBabonan) ? 0 : nBabonan) + (Number.isNaN(nPecah) ? 0 : nPecah);
  const galat = adaTanpaKendaraan
    ? "Pilih kendaraan untuk setiap baris muatan."
    : baris.length === 0
      ? "Tambahkan minimal satu kendaraan."
      : validasiPanen(isian.jenis, sisa, { muatan, babonan: nBabonan, pecah: nPecah });
  const sah = galat === null;
  const totalCocok = babonanMode ? dimuat > 0 && dimuat <= sisa : total === sisa;

  const pctIsian = babonanMode ? null : hitungKematangan(new Date(isian.mulaiAt), isian.durasiBekuJam ?? 0, new Date(sekarang));

  function ubahBaris(kunci: number, ubah: Partial<BarisMuatan>) {
    setBaris((l) => l.map((b) => (b.kunci === kunci ? { ...b, ...ubah } : b)));
  }

  function tambahBaris() {
    const kurang = sisa - total;
    setBaris((l) => [...l, { kunci: kunciBerikut, kendaraan: null, jumlah: kurang > 0 && !babonanMode ? String(kurang) : "" }]);
    setKunciBerikut((k) => k + 1);
  }

  async function kirim(isiUlang: boolean, konfirmasiBelumSiap: boolean) {
    if (!sah) return;
    const input: PanenInput = {
      isianId: isian.id,
      muatan,
      babonan: nBabonan,
      pecah: nPecah,
      isiUlang,
      konfirmasiBelumSiap,
    };
    const pesan = babonanMode
      ? `Babonan ${dimuat} can dimuat.`
      : isiUlang
        ? `Panen ${dimuat} can, rek diisi air lagi.`
        : `Panen ${dimuat} can tanpa isi ulang.`;
    const r = await jalankan(() => panenAction(kode, input), pesan);
    if (r.success) {
      const terakhir = muatan[muatan.length - 1];
      if (terakhir) onKendaraanTerakhir({ ...terakhir });
      setKonfirmasi(null);
      onSelesai();
      return;
    }
    if ("kodeGalat" in r && r.kodeGalat === "BELUM_SIAP") {
      const m = /(\d+)\s*%/.exec(r.error);
      setKonfirmasi({ pct: m ? Number(m[1]) : (pctIsian ?? 0), isiUlang });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {namaBak} · Rek {rek.nomor} · {singkatVarian(isian.varian)} · isian {jamWib(isian.mulaiAt)}
        {pctIsian !== null && ` (${pctIsian}%)`} · <span className="font-semibold text-foreground">{sisa} can</span>
        {babonanMode && " Babonan"}
      </p>

      <div className="flex flex-col gap-2">
        {baris.map((b, i) => (
          <div key={b.kunci} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <PemilihKendaraan
                kode={kode}
                armada={armada}
                armadaGalat={armadaGalat}
                nilai={b.kendaraan}
                onPilih={(k) => ubahBaris(b.kunci, { kendaraan: k })}
                disabled={sibuk}
                tampilan="baris"
                judul={`Kendaraan muatan ${i + 1}`}
              />
            </div>
            <Input
              value={b.jumlah}
              onChange={(e) => ubahBaris(b.kunci, { jumlah: e.target.value })}
              inputMode="numeric"
              aria-label={`Jumlah can muatan ${i + 1}`}
              className="h-10 w-16 text-center text-base font-semibold"
              disabled={sibuk}
            />
            {baris.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Hapus baris muatan"
                disabled={sibuk}
                onClick={() => setBaris((l) => l.filter((x) => x.kunci !== b.kunci))}
              >
                <X className="size-4" />
              </Button>
            ) : (
              <span className="w-8" />
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={tambahBaris}
          disabled={sibuk}
          className="flex items-center gap-1 self-start text-sm font-medium text-primary disabled:opacity-50"
        >
          <Plus className="size-4" /> Bagi ke kendaraan lain
        </button>
      </div>

      {!babonanMode && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <BarisAngka label="Tinggal sebagai Babonan" nilai={babonan} onUbah={setBabonan} disabled={sibuk} />
          <BarisAngka label="Pecah (tetap di can)" nilai={pecah} onUbah={setPecah} disabled={sibuk} />
        </div>
      )}

      <div
        className={cn(
          "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm",
          totalCocok && sah ? "border-green-500/50 bg-green-500/10" : "border-destructive/40 bg-destructive/5",
        )}
      >
        <span>
          Dimuat <b>{dimuat}</b>
          {!babonanMode && (
            <>
              {" "}
              · Babonan <b>{Number.isNaN(nBabonan) ? "?" : nBabonan}</b>
              {nPecah !== 0 && (
                <>
                  {" "}
                  · Pecah <b>{Number.isNaN(nPecah) ? "?" : nPecah}</b>
                </>
              )}{" "}
              · total <b>{total}</b>/{sisa}
            </>
          )}
          {babonanMode && <> dari {sisa}</>}
        </span>
        {sah ? <Check className="size-5 text-green-600" /> : <X className="size-5 text-destructive" />}
      </div>
      {galat && <p className="text-xs text-destructive">{galat}</p>}

      {babonanMode ? (
        <Button type="button" className="h-12 text-base" disabled={!sah || sibuk} onClick={() => kirim(false, false)}>
          Muat {dimuat} can Babonan
        </Button>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <Button type="button" className="h-12 w-full text-base" disabled={!sah || sibuk} onClick={() => kirim(true, false)}>
            Panen & Isi Air {dimuat} can
          </Button>
          <button
            type="button"
            disabled={!sah || sibuk}
            onClick={() => kirim(false, false)}
            className="text-xs text-muted-foreground underline underline-offset-4 disabled:opacity-50"
          >
            Panen tanpa isi ulang
          </button>
        </div>
      )}

      <Dialog open={konfirmasi !== null} onOpenChange={(o) => !o && setKonfirmasi(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Es baru {konfirmasi?.pct ?? 0}%, tetap panen?</DialogTitle>
            <DialogDescription>Panen sebelum siap tetap dicatat dan ditandai di log.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKonfirmasi(null)} disabled={sibuk}>
              Batal
            </Button>
            <Button onClick={() => konfirmasi && kirim(konfirmasi.isiUlang, true)} disabled={sibuk}>
              Tetap panen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BarisAngka({
  label,
  nilai,
  onUbah,
  disabled,
}: {
  label: string;
  nilai: string;
  onUbah: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-2">
      <span className="text-sm">{label}</span>
      <span className="flex items-center gap-2">
        <Input
          value={nilai}
          onChange={(e) => onUbah(e.target.value)}
          inputMode="numeric"
          className="h-10 w-16 text-center text-base font-semibold"
          disabled={disabled}
        />
        <span className="w-8" />
      </span>
    </label>
  );
}
