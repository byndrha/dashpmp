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
import { createPengajuanAction, getPriceLevelOptionsAction } from "@/app/mkesindo/pemasaran-app/actions";
import type { PriceLevelOption } from "@/lib/queries/mitra";

export function PengajuanForm() {
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
    const priceLevel = formData.get("priceLevel") ? Number(formData.get("priceLevel")) : null;
    const qtyKantong = formData.get("qtyKantong") ? Number(formData.get("qtyKantong")) : null;
    startTransition(async () => {
      const result = await createPengajuanAction({
        namaCalon: String(formData.get("namaCalon") ?? ""),
        noHP: String(formData.get("noHP") ?? "") || null,
        waktuPermintaanSampai: String(formData.get("waktuPermintaanSampai") ?? ""),
        qtyKantong,
        priceLevel,
        wilayah: String(formData.get("wilayah") ?? "") || null,
        kecamatan: String(formData.get("kecamatan") ?? "") || null,
        alamat: String(formData.get("alamat") ?? "") || null,
        latitude: null,
        longitude: null,
        kapasitas: qtyKantong,
        kompetitor: String(formData.get("kompetitor") ?? "") || null,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.push("/mkesindo/pemasaran-app/pemasaran");
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
            <Textarea id="alamat" name="alamat" rows={2} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wilayah">Wilayah *</Label>
            <Input id="wilayah" name="wilayah" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kecamatan">Kecamatan</Label>
            <Input id="kecamatan" name="kecamatan" />
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <p className="text-xs font-semibold text-muted-foreground">Kebutuhan &amp; Harga</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="priceLevel">Tingkat Harga</Label>
            <Select name="priceLevel">
              <SelectTrigger id="priceLevel">
                <SelectValue placeholder="Pilih tingkat harga" />
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

        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={pending}>
          {pending ? "Mengirim..." : "Kirim Pengajuan"}
        </Button>
      </form>
    </div>
  );
}
