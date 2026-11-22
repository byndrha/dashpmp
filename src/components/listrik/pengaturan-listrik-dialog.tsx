"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { simpanPengaturanListrikAction } from "@/app/listrik-actions";
import type { PengaturanListrik } from "@/lib/listrik";
import { parseAngka } from "./catat-meter-dialog";

const teks = (n: number | null) =>
  n == null ? "" : String(n).replace(".", ",");

function Bidang({
  id,
  label,
  bantuan,
  value,
  onChange,
  akhiran,
}: {
  id: string;
  label: string;
  bantuan: string;
  value: string;
  onChange: (v: string) => void;
  akhiran?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="belum diketahui"
          className={akhiran ? "pr-12" : ""}
        />
        {akhiran && (
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
            {akhiran}
          </span>
        )}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {bantuan}
      </p>
    </div>
  );
}

export function PengaturanListrikDialog({
  kode,
  awal,
  open,
  onOpenChange,
}: {
  kode: string;
  awal: PengaturanListrik;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [golongan, setGolongan] = useState(awal.golongan ?? "");
  const [daya, setDaya] = useState(teks(awal.dayaKva));
  const [kali, setKali] = useState(teks(awal.faktorKali));
  const [harga, setHarga] = useState(teks(awal.hargaLwbp));
  const [k, setK] = useState(teks(awal.faktorK));
  const [jamMulai, setJamMulai] = useState(String(awal.jamWbpMulai));
  const [jamSelesai, setJamSelesai] = useState(String(awal.jamWbpSelesai));
  const [terpisah, setTerpisah] = useState(awal.registerTerpisah);
  const [menyimpan, setMenyimpan] = useState(false);

  async function simpan() {
    const angka = [daya, kali, harga, k].map(parseAngka);
    if (angka.some((n) => Number.isNaN(n)))
      return toast.error("Ada angka yang tidak valid.");
    setMenyimpan(true);
    const r = await simpanPengaturanListrikAction(kode, {
      golongan,
      dayaKva: angka[0],
      faktorKali: angka[1],
      hargaLwbp: angka[2],
      faktorK: angka[3],
      jamWbpMulai: Number(jamMulai),
      jamWbpSelesai: Number(jamSelesai),
      registerTerpisah: terpisah,
    });
    setMenyimpan(false);
    if (!r.success) return toast.error(r.error);
    toast.success("Pengaturan kelistrikan disimpan");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !menyimpan && onOpenChange(v)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pengaturan Kelistrikan</DialogTitle>
          <DialogDescription>
            Lihat rekening PLN terakhir. Kolom yang belum diketahui biarkan
            kosong — angka rupiah dan kWh hanya dihitung bila datanya lengkap.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="golongan">Golongan tarif</Label>
            <Input
              id="golongan"
              value={golongan}
              onChange={(e) => setGolongan(e.target.value)}
              placeholder="mis. I-3/TM"
            />
            <p className="text-[11px] text-muted-foreground">
              Tertera di rekening PLN.
            </p>
          </div>
          <Bidang
            id="daya"
            label="Daya kontrak"
            akhiran="kVA"
            value={daya}
            onChange={setDaya}
            bantuan="Daya tersambung di rekening."
          />
          <Bidang
            id="kali"
            label="Faktor kali meter"
            value={kali}
            onChange={setKali}
            bantuan="Pengali angka register (rasio CT/PT). Wajib untuk menghitung kWh sebenarnya."
          />
          <Bidang
            id="harga"
            label="Harga LWBP"
            akhiran="Rp/kWh"
            value={harga}
            onChange={setHarga}
            bantuan="Harga per kWh di luar beban puncak."
          />
          <Bidang
            id="k"
            label="Faktor K"
            value={k}
            onChange={setK}
            bantuan="Harga WBP = K × harga LWBP (umumnya 1,4–2)."
          />
          <div className="flex flex-col gap-1.5">
            <Label>Jam beban puncak (WBP)</Label>
            <div className="flex items-center gap-2">
              <Input
                aria-label="Jam mulai WBP"
                inputMode="numeric"
                value={jamMulai}
                onChange={(e) => setJamMulai(e.target.value)}
                className="w-16 text-center"
              />
              <span className="text-xs text-muted-foreground">s.d.</span>
              <Input
                aria-label="Jam selesai WBP"
                inputMode="numeric"
                value={jamSelesai}
                onChange={(e) => setJamSelesai(e.target.value)}
                className="w-16 text-center"
              />
              <span className="text-xs text-muted-foreground">WIB</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Jam wajib catat meter mengikuti batas ini.
            </p>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
          <input
            type="checkbox"
            checked={terpisah}
            onChange={(e) => setTerpisah(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span className="text-sm">
            Meter menampilkan stand LWBP dan WBP terpisah
            <span className="block text-xs text-muted-foreground">
              Bila dicentang, operator mengisi dua angka. Bila tidak, cukup satu
              angka stand kWh.
            </span>
          </span>
        </label>

        {awal.diubahAt && (
          <p className="text-[11px] text-muted-foreground">
            Terakhir diubah {awal.diubahOlehNama ?? ""},{" "}
            {new Date(awal.diubahAt).toLocaleString("id-ID", {
              timeZone: "Asia/Jakarta",
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={menyimpan}
            onClick={() => onOpenChange(false)}
          >
            Batal
          </Button>
          <Button disabled={menyimpan} onClick={simpan}>
            {menyimpan && <Loader2 className="size-4 animate-spin" />}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
