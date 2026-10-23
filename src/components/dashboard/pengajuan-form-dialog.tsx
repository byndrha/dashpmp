"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { MitraLocationField, type MitraLocationValue } from "@/components/dashboard/mitra-location-field";
import { WilayahSelect } from "@/components/dashboard/wilayah-select";
import { KecamatanSelect } from "@/components/dashboard/kecamatan-select";
import { formatRupiah } from "@/lib/format";
import type { PriceLevelOption } from "@/lib/queries/mitra";
import type { PengajuanInput } from "@/lib/queries/mitra-pengajuan";
import type { Kompetitor } from "@/lib/queries/kompetitor";
import { KompetitorPicker } from "@/components/dashboard/mitra-form/kompetitor-picker";
import { getMitraFormKonteksAction, tambahKompetitorAction } from "@/app/mkesindo/(dashboard)/mitra/actions";

export function PengajuanFormDialog({
  open,
  onOpenChange,
  priceLevels,
  onSubmit,
  pending,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  priceLevels: PriceLevelOption[];
  onSubmit: (input: PengajuanInput) => void;
  pending: boolean;
  error?: string | null;
}) {
  const [wilayah, setWilayah] = useState("");
  const [kecamatan, setKecamatan] = useState("");
  const [regencyCode, setRegencyCode] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [location, setLocation] = useState<MitraLocationValue | null>(null);
  const [priceLevel, setPriceLevel] = useState("");
  const [kompetitorOpsi, setKompetitorOpsi] = useState<Kompetitor[]>([]);
  const [kompetitorIds, setKompetitorIds] = useState<number[]>([]);

  // Same pattern as MitraFormDialog (mitra-list.tsx): only clears Kecamatan
  // when Wilayah actually changes to a different region.
  function handleWilayahChange(name: string, code: string | null) {
    if (name !== wilayah) setKecamatan("");
    setWilayah(name);
    setRegencyCode(code);
  }

  function handleGeocode(suggestion: { alamat: string | null; wilayah: string | null; kecamatan: string | null }) {
    if (suggestion.alamat) setAddress(suggestion.alamat);
    if (suggestion.wilayah) setWilayah(suggestion.wilayah);
    if (suggestion.kecamatan) setKecamatan(suggestion.kecamatan);
  }

  function resetForm() {
    setWilayah("");
    setKecamatan("");
    setRegencyCode(null);
    setAddress("");
    setLocation(null);
    setPriceLevel("");
    setKompetitorIds([]);
  }

  // Opsi master kompetitor (es_kristal, holding sesi) dimuat setiap dialog
  // dibuka (dialog dibuka dari induk, jadi bukan lewat onOpenChange di
  // bawah). Konteks mitra baru (null) tidak memuat identitas apa pun.
  useEffect(() => {
    if (!open) return;
    let batal = false;
    getMitraFormKonteksAction(null).then((r) => {
      if (!batal && r.success) setKompetitorOpsi(r.data.kompetitorOpsi);
    });
    return () => {
      batal = true;
    };
  }, [open]);

  function handleSubmit(formData: FormData) {
    if (!location) return;
    onSubmit({
      namaCalon: String(formData.get("namaCalon") ?? ""),
      noHP: String(formData.get("noHP") ?? "") || null,
      waktuPermintaanSampai: String(formData.get("waktuPermintaanSampai") ?? ""),
      qtyKantong: formData.get("qtyKantong") ? Number(formData.get("qtyKantong")) : null,
      priceLevel: priceLevel ? Number(priceLevel) : null,
      wilayah: wilayah || null,
      kecamatan: kecamatan || null,
      alamat: address || null,
      latitude: location.latitude,
      longitude: location.longitude,
      kapasitas: formData.get("kapasitas") ? Number(formData.get("kapasitas")) : null,
      kompetitorIds,
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) resetForm();
      }}
    >
      <DialogContent className="max-w-lg sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Pengajuan Mitra Baru</DialogTitle>
          <DialogDescription>Isi data kunjungan ke calon mitra.</DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="namaCalon" className="sr-only">Nama Calon Mitra</Label>
            <Input id="namaCalon" name="namaCalon" placeholder="Nama Calon Mitra" required />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="alamat" className="sr-only">Alamat</Label>
            <Input
              id="alamat"
              name="alamat"
              placeholder="Alamat"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="sr-only">Wilayah</Label>
            <WilayahSelect value={wilayah} onChange={handleWilayahChange} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="sr-only">Kecamatan</Label>
            <KecamatanSelect regencyCode={regencyCode} value={kecamatan} onChange={setKecamatan} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="noHP" className="sr-only">No HP</Label>
            <Input id="noHP" name="noHP" placeholder="No HP" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kapasitas" className="sr-only">Kapasitas Harian</Label>
            <Input id="kapasitas" name="kapasitas" type="number" min={0} placeholder="Kapasitas Harian" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qtyKantong" className="sr-only">Qty Permintaan</Label>
            <Input id="qtyKantong" name="qtyKantong" type="number" min={0} placeholder="Qty Permintaan" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="waktuPermintaanSampai" className="sr-only">Permintaan Tiba</Label>
            <Input id="waktuPermintaanSampai" name="waktuPermintaanSampai" type="datetime-local" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="sr-only">Permintaan Harga</Label>
            <Select value={priceLevel} onValueChange={(v) => setPriceLevel(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Permintaan Harga">
                  {(v: string) => {
                    const p = priceLevels.find((pl) => String(pl.Level) === v);
                    return p ? `Harga ${formatRupiah(p.Price)}` : "Permintaan Harga";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {priceLevels.map((p) => (
                  <SelectItem key={p.Level} value={String(p.Level)}>
                    Harga {formatRupiah(p.Price)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-4">
            <Label className="sr-only">Daftar Kompetitor</Label>
            <KompetitorPicker
              bisnis="es_kristal"
              opsi={kompetitorOpsi}
              onOpsiChange={setKompetitorOpsi}
              value={kompetitorIds}
              onChange={setKompetitorIds}
              onTambah={tambahKompetitorAction}
            />
          </div>
          <div className="flex flex-col gap-1.5 col-span-2 sm:col-span-4">
            <Label className="sr-only">Lokasi GPS</Label>
            <MitraLocationField
              value={location}
              onChange={setLocation}
              onGeocode={handleGeocode}
              wilayah={wilayah}
              kecamatan={kecamatan}
            />
            {!location && (
              <p className="text-xs text-destructive">Lokasi GPS wajib diisi — geser pin atau klik peta.</p>
            )}
          </div>
          {error && (
            <p className="col-span-2 text-xs text-destructive sm:col-span-4">{error}</p>
          )}
          <DialogFooter className="col-span-2 sm:col-span-4">
            <Button type="submit" disabled={pending || !location} className="ml-auto">
              {pending ? "Mengirim..." : "Kirim Pengajuan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
