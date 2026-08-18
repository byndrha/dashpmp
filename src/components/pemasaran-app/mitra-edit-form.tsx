"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRupiah } from "@/lib/format";
import { getPriceLevelOptionsAction, updateMitraAction } from "@/app/mkesindo/pemasaran-app/actions";
import type { MitraRow, PriceLevelOption } from "@/lib/queries/mitra";

export function MitraEditForm({ mitra }: { mitra: MitraRow }) {
  const router = useRouter();
  const [priceLevels, setPriceLevels] = useState<PriceLevelOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    getPriceLevelOptionsAction().then((result) => {
      if (result.success) setPriceLevels(result.data);
    });
  }, []);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updateMitraAction(mitra.BusinessPartnerID, {
        name: String(formData.get("name") ?? ""),
        mobileNo: String(formData.get("mobileNo") ?? "") || null,
        address: String(formData.get("address") ?? "") || null,
        wilayah: String(formData.get("wilayah") ?? "") || null,
        kecamatan: String(formData.get("kecamatan") ?? "") || null,
        gender: mitra.Gender,
        priceLevel: formData.get("priceLevel") ? Number(formData.get("priceLevel")) : null,
        termOfPaymentId: mitra.TermOfPaymentID,
        capacity: formData.get("capacity") ? Number(formData.get("capacity")) : null,
      });
      if (!result.success) {
        setError(result.error);
        return;
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
          <Label htmlFor="wilayah">Kabupaten</Label>
          <Input id="wilayah" name="wilayah" defaultValue={mitra.Wilayah ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="kecamatan">Wilayah / Kecamatan</Label>
          <Input id="kecamatan" name="kecamatan" defaultValue={mitra.Kecamatan ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="address">Alamat</Label>
          <Textarea id="address" name="address" rows={2} defaultValue={mitra.Alamat ?? ""} />
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

        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={pending}>
          {pending ? "Menyimpan..." : "Simpan Perubahan"}
        </Button>
      </form>
    </div>
  );
}
