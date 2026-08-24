"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MitraLocationField, type MitraLocationValue } from "@/components/dashboard/mitra-location-field";
import { WilayahSelect } from "@/components/dashboard/wilayah-select";
import { KecamatanSelect } from "@/components/dashboard/kecamatan-select";
import { formatRupiah } from "@/lib/format";
import { createPengajuanAction, getPriceLevelOptionsForDriverAction } from "@/app/mkesindo/driver-app/actions";
import type { PriceLevelOption } from "@/lib/queries/mitra";

// Same fields/flow as pemasaran-app's PengajuanForm — this Mitra becomes
// this Driver's own ("NOO khusus Driver") once approved, see
// createPengajuanAction's own comment in driver-app/actions.ts.
export function PengajuanForm() {
  const router = useRouter();
  const [priceLevels, setPriceLevels] = useState<PriceLevelOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [address, setAddress] = useState("");
  const [wilayah, setWilayah] = useState("");
  const [kecamatan, setKecamatan] = useState("");
  const [regencyCode, setRegencyCode] = useState<string | null>(null);
  const [location, setLocation] = useState<MitraLocationValue | null>(null);

  useEffect(() => {
    getPriceLevelOptionsForDriverAction().then((result) => {
      if (result.success) setPriceLevels(result.data);
    });
  }, []);

  // Same cascade pattern as the desktop Pengajuan/Edit Mitra dialogs — only
  // clears Kecamatan when Wilayah actually changes to a different region.
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

  function handleSubmit(formData: FormData) {
    setError(null);
    if (!location) {
      setError("Lokasi GPS wajib diisi — geser pin atau klik peta.");
      return;
    }
    const priceLevel = formData.get("priceLevel") ? Number(formData.get("priceLevel")) : null;
    const qtyKantong = formData.get("qtyKantong") ? Number(formData.get("qtyKantong")) : null;
    startTransition(async () => {
      const result = await createPengajuanAction({
        namaCalon: String(formData.get("namaCalon") ?? ""),
        noHP: String(formData.get("noHP") ?? "") || null,
        waktuPermintaanSampai: String(formData.get("waktuPermintaanSampai") ?? ""),
        qtyKantong,
        priceLevel,
        wilayah: wilayah || null,
        kecamatan: kecamatan || null,
        alamat: address || null,
        latitude: location.latitude,
        longitude: location.longitude,
        kapasitas: qtyKantong,
        kompetitor: String(formData.get("kompetitor") ?? "") || null,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.push("/mkesindo/driver-app/pengajuan");
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="font-display text-base font-semibold">Pengajuan Mitra Baru</h1>
      </header>

      <form action={handleSubmit} className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <p className="text-xs font-semibold text-muted-foreground">Data Calon Mitra</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="namaCalon">Nama Mitra *</Label>
            <Input id="namaCalon" name="namaCalon" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="noHP">Nomor Telepon</Label>
            <Input id="noHP" name="noHP" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="alamat">Alamat *</Label>
            <Textarea id="alamat" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Wilayah *</Label>
            <WilayahSelect value={wilayah} onChange={handleWilayahChange} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Kecamatan</Label>
            <KecamatanSelect regencyCode={regencyCode} value={kecamatan} onChange={setKecamatan} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Lokasi GPS *</Label>
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
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <p className="text-xs font-semibold text-muted-foreground">Kebutuhan &amp; Harga</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="priceLevel">Tingkat Harga</Label>
            <Select name="priceLevel">
              <SelectTrigger id="priceLevel">
                <SelectValue placeholder="Pilih tingkat harga">
                  {(value: string | null) => {
                    if (!value) return "Pilih tingkat harga";
                    const level = priceLevels?.find((p) => String(p.Level) === value);
                    return level ? `Level ${level.Level} — ${formatRupiah(level.Price)}` : value;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {priceLevels?.map((p) => (
                  <SelectItem key={p.Level} value={String(p.Level)}>
                    Level {p.Level} — {formatRupiah(p.Price)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="qtyKantong">Kantong/Hari</Label>
            <Input id="qtyKantong" name="qtyKantong" type="number" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="waktuPermintaanSampai">Permintaan Sampai</Label>
            <Input id="waktuPermintaanSampai" name="waktuPermintaanSampai" type="datetime-local" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kompetitor">Daftar Kompetitor</Label>
            <Textarea id="kompetitor" name="kompetitor" rows={2} placeholder="Es kristal lain, es balok, dll." />
          </div>
        </div>

        <div className="sticky bottom-0 z-10 -mx-4 -mb-4 mt-2 flex flex-col gap-2 border-t border-border bg-background p-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Mengirim..." : "Kirim Pengajuan"}
          </Button>
        </div>
      </form>
    </div>
  );
}
