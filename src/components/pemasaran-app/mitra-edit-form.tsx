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
import { getPriceLevelOptionsAction, setMitraLocationAction, updateMitraAction } from "@/app/mkesindo/pemasaran-app/actions";
import type { MitraRow, PriceLevelOption } from "@/lib/queries/mitra";

function rowToLocation(mitra: MitraRow): MitraLocationValue | null {
  if (mitra.Latitude == null || mitra.Longitude == null) return null;
  return { latitude: mitra.Latitude, longitude: mitra.Longitude, alamat: mitra.GeoAlamat };
}

export function MitraEditForm({ mitra }: { mitra: MitraRow }) {
  const router = useRouter();
  const [priceLevels, setPriceLevels] = useState<PriceLevelOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [address, setAddress] = useState(mitra.Alamat ?? "");
  const [wilayah, setWilayah] = useState(mitra.Wilayah ?? "");
  const [kecamatan, setKecamatan] = useState(mitra.Kecamatan ?? "");
  const [regencyCode, setRegencyCode] = useState<string | null>(null);
  const [location, setLocation] = useState<MitraLocationValue | null>(rowToLocation(mitra));

  useEffect(() => {
    getPriceLevelOptionsAction().then((result) => {
      if (result.success) setPriceLevels(result.data);
    });
  }, []);

  // Only clears Kecamatan when Wilayah actually changes to a different
  // region — WilayahSelect also calls this to report the regencyCode it
  // resolved for the mitra's CURRENT Wilayah on mount, which must not wipe
  // out the Kecamatan that came with `mitra`. Matches mitra-list.tsx's
  // MitraFormDialog exactly.
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
    startTransition(async () => {
      const result = await updateMitraAction(mitra.BusinessPartnerID, {
        name: String(formData.get("name") ?? ""),
        mobileNo: String(formData.get("mobileNo") ?? "") || null,
        address: address || null,
        wilayah: wilayah || null,
        kecamatan: kecamatan || null,
        gender: mitra.Gender,
        priceLevel: formData.get("priceLevel") ? Number(formData.get("priceLevel")) : null,
        termOfPaymentId: mitra.TermOfPaymentID,
        capacity: formData.get("capacity") ? Number(formData.get("capacity")) : null,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      if (location) {
        const locationResult = await setMitraLocationAction({ businessPartnerId: mitra.BusinessPartnerID, ...location });
        if (!locationResult.success) {
          setError(locationResult.error);
          return;
        }
      }
      router.push(`/mkesindo/pemasaran-app/mitra/${mitra.BusinessPartnerID}`);
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="font-display text-base font-semibold">Edit Mitra</h1>
      </header>

      <form action={handleSubmit} className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Nama Mitra</Label>
          <Input id="name" name="name" defaultValue={mitra.Name} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mobileNo">Nomor Telepon</Label>
          <Input id="mobileNo" name="mobileNo" defaultValue={mitra.Kontak ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Jenis Usaha</Label>
          <Input value={mitra.PartnerType} disabled className="text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Wilayah</Label>
          <WilayahSelect value={wilayah} onChange={handleWilayahChange} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Kecamatan</Label>
          <KecamatanSelect regencyCode={regencyCode} value={kecamatan} onChange={setKecamatan} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="address">Alamat</Label>
          <Textarea id="address" rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Lokasi GPS</Label>
          <MitraLocationField
            value={location}
            onChange={setLocation}
            onGeocode={handleGeocode}
            wilayah={wilayah}
            kecamatan={kecamatan}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="priceLevel">Harga per Kantong</Label>
          <Select name="priceLevel" defaultValue={mitra.PriceLevel != null ? String(mitra.PriceLevel) : undefined}>
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
          <Label htmlFor="capacity">Kebutuhan Kantong per Hari</Label>
          <Input id="capacity" name="capacity" type="number" defaultValue={mitra.Capacity ?? ""} />
        </div>

        <div className="sticky bottom-0 z-10 -mx-4 -mb-4 mt-2 flex flex-col gap-2 border-t border-border bg-background p-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Menyimpan..." : "Simpan Perubahan"}
          </Button>
        </div>
      </form>
    </div>
  );
}
