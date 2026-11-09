"use client";

import { useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { panenAction } from "@/app/produksi-operasional-actions";
import type { KodeProduksi } from "@/lib/produksi-denah";
import {
  hitungKematangan,
  slotDimuatDari,
  validasiPanenSlot,
  type IsianAktif,
  type KeadaanRek,
  type KendaraanPilihan,
  type MuatanInput,
  type PanenSlotInput,
} from "@/lib/produksi-operasional";
import type { PanenInputSlot } from "@/lib/queries/produksi-operasional";
import type { KendaraanArmada } from "@/lib/queries/produksi-do-erp";
import { GridCan, type TandaPanen } from "../grid-can";
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

function aman(n: number): number {
  return Number.isNaN(n) ? 0 : n;
}

// Formulir "Panen & Isi Air" (spec slot can §4) untuk satu isian. Isian
// produksi: grid can mode panen (ketuk biasa → Babonan ◆ → Pecah ✕ → biasa),
// sisanya dimuat. Isian Babonan ("Lepas Babonan — dimuat"): grid pilih can
// yang dimuat (can pecah tidak bisa dimuat), tanpa isi ulang. Baris muatan
// pertama otomatis = jumlah can dimuat dikurangi baris lain.
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
  const bolehMuatBabonan = useMemo(() => {
    const pecah = new Set(isian.slotPecah);
    return new Set(isian.slot.filter((s) => !pecah.has(s)));
  }, [isian.slot, isian.slotPecah]);
  const milik = useMemo(() => new Set(isian.slot), [isian.slot]);

  const [tanda, setTanda] = useState<Map<number, TandaPanen>>(() => new Map());
  const [pilihMuat, setPilihMuat] = useState<Set<number>>(() => new Set(bolehMuatBabonan));
  const [baris, setBaris] = useState<BarisMuatan[]>(() => [
    { kunci: 0, kendaraan: kendaraanAktif, jumlah: String(babonanMode ? bolehMuatBabonan.size : isian.slot.length) },
  ]);
  const [kunciBerikut, setKunciBerikut] = useState(1);
  const [konfirmasi, setKonfirmasi] = useState<{ pct: number; isiUlang: boolean } | null>(null);

  // Tanda/pilihan yang masih berlaku untuk isian ini (data bisa berubah sesudah muat ulang).
  const slotBabonan = babonanMode ? [] : [...tanda].filter(([s, t]) => t === "babonan" && milik.has(s)).map(([s]) => s);
  const slotPecah = babonanMode ? [] : [...tanda].filter(([s, t]) => t === "pecah" && milik.has(s)).map(([s]) => s);
  const slotDimuatPilih = babonanMode ? [...pilihMuat].filter((s) => bolehMuatBabonan.has(s)) : undefined;

  const muatan: MuatanInput[] = baris
    .filter((b): b is BarisMuatan & { kendaraan: KendaraanPilihan } => b.kendaraan !== null)
    .map((b) => ({ ...b.kendaraan, jumlah: angka(b.jumlah) }));
  const inputSlot: PanenSlotInput = { muatan, slotBabonan, slotPecah, slotDimuat: slotDimuatPilih };
  const harusDimuat = slotDimuatDari(isian, inputSlot).length;
  const dimuat = baris.reduce((s, b) => s + aman(angka(b.jumlah)), 0);
  const adaTanpaKendaraan = baris.some((b) => b.kendaraan === null);
  const galat = adaTanpaKendaraan
    ? "Pilih kendaraan untuk setiap baris muatan."
    : baris.length === 0
      ? "Tambahkan minimal satu kendaraan."
      : validasiPanenSlot(isian, inputSlot);
  const sah = galat === null;

  const pctIsian = babonanMode ? null : hitungKematangan(new Date(isian.mulaiAt), isian.durasiBekuJam ?? 0, new Date(sekarang));

  // Baris pertama mengikuti jumlah can dimuat (dikurangi baris lain).
  function sesuaikanBarisPertama(target: number) {
    setBaris((l) => {
      if (l.length === 0) return l;
      const lain = l.slice(1).reduce((s, b) => s + aman(angka(b.jumlah)), 0);
      const [pertama, ...sisa] = l;
      return [{ ...pertama, jumlah: String(Math.max(0, target - lain)) }, ...sisa];
    });
  }

  function ubahTanda(baru: Map<number, TandaPanen>) {
    setTanda(baru);
    const keluar = [...baru].filter(([s]) => milik.has(s)).length;
    sesuaikanBarisPertama(isian.slot.length - keluar);
  }

  function ubahPilihMuat(baru: Set<number>) {
    setPilihMuat(baru);
    sesuaikanBarisPertama([...baru].filter((s) => bolehMuatBabonan.has(s)).length);
  }

  function ubahBaris(kunci: number, ubah: Partial<BarisMuatan>) {
    setBaris((l) => l.map((b) => (b.kunci === kunci ? { ...b, ...ubah } : b)));
  }

  function tambahBaris() {
    const kurang = harusDimuat - dimuat;
    setBaris((l) => [...l, { kunci: kunciBerikut, kendaraan: null, jumlah: kurang > 0 ? String(kurang) : "" }]);
    setKunciBerikut((k) => k + 1);
  }

  async function kirim(isiUlang: boolean, konfirmasiBelumSiap: boolean) {
    if (!sah) return;
    const input: PanenInputSlot = {
      isianId: isian.id,
      muatan,
      slotBabonan,
      slotPecah,
      ...(babonanMode ? { slotDimuat: slotDimuatPilih } : {}),
      isiUlang: babonanMode ? false : isiUlang,
      konfirmasiBelumSiap,
    };
    const pesan = babonanMode
      ? `Babonan ${dimuat} can dimuat.`
      : isiUlang
        ? `Panen ${dimuat} can, diisi air lagi ${dimuat} can.`
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
    } else {
      setKonfirmasi(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {namaBak} · Rek {rek.nomor} · {singkatVarian(isian.varian)} · isian {jamWib(isian.mulaiAt)}
        {pctIsian !== null && ` (${pctIsian}%)`} · <span className="font-semibold text-foreground">{isian.slot.length} can</span>
        {babonanMode && " Babonan"}
      </p>

      <div className="flex flex-col gap-1.5">
        {babonanMode ? (
          <GridCan
            mode="pilih"
            can={rek.can}
            varian={rek.varian}
            boleh={bolehMuatBabonan}
            pilihan={pilihMuat}
            onUbah={ubahPilihMuat}
            disabled={sibuk}
          />
        ) : (
          <GridCan mode="panen" can={rek.can} varian={rek.varian} boleh={milik} pilihan={tanda} onUbah={ubahTanda} disabled={sibuk} />
        )}
        <p className="text-[11px] text-muted-foreground">
          {babonanMode
            ? "Ketuk can Babonan yang dimuat (✓). Can pecah ✕ tidak bisa dimuat."
            : "Ketuk can: biasa (dimuat) → ◆ Babonan → ✕ Pecah → biasa."}
        </p>
      </div>

      <div
        className={cn(
          "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm",
          sah ? "border-green-500/50 bg-green-500/10" : "border-destructive/40 bg-destructive/5",
        )}
      >
        <span className="tabular-nums">
          Dimuat <b>{harusDimuat}</b>
          {!babonanMode && (
            <>
              {" "}
              · <span className="text-orange-700 dark:text-orange-300">◆</span> <b>{slotBabonan.length}</b> · ✕ <b>{slotPecah.length}</b>
            </>
          )}
          {" "}· kendaraan <b>{dimuat}</b>/{harusDimuat}
        </span>
        {sah ? <Check className="size-5 shrink-0 text-green-600" /> : <X className="size-5 shrink-0 text-destructive" />}
      </div>

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

      {galat && <p className="text-xs text-destructive">{galat}</p>}

      {babonanMode ? (
        <Button type="button" className="h-12 text-base" disabled={!sah || sibuk} onClick={() => kirim(false, false)}>
          Muat {dimuat} can Babonan
        </Button>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <Button type="button" className="h-12 w-full text-base" disabled={!sah || sibuk} onClick={() => kirim(true, false)}>
            Panen & Isi Air {harusDimuat} can
          </Button>
          <button
            type="button"
            disabled={!sah || sibuk}
            onClick={() => kirim(false, false)}
            className="py-1 text-xs text-muted-foreground underline underline-offset-4 disabled:opacity-50"
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
