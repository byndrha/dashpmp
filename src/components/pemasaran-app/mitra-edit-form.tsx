"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlamatBaris,
  LokasiPengirimanSection,
  type RenderWilayahKecamatan,
} from "@/components/dashboard/mitra-form/lokasi-pengiriman-section";
import { WilayahKecamatanField } from "@/components/dashboard/mitra-form/wilayah-kecamatan-field";
import { KompetitorPicker } from "@/components/dashboard/mitra-form/kompetitor-picker";
import { formatRupiah } from "@/lib/format";
import { mitraKeAlamatForm } from "@/lib/mitra-form";
import type { MitraAlamatForm } from "@/lib/mitra-lokasi";
import type { MitraRow, PriceLevelOption } from "@/lib/queries/mitra";
import type { Kompetitor } from "@/lib/queries/kompetitor";
import {
  getMitraDetailAction,
  getPriceLevelOptionsAction,
  simpanMitraPemasaranAction,
  tambahKompetitorAction,
} from "@/app/mkesindo/pemasaran-app/actions";

const renderWilayahKecamatan: RenderWilayahKecamatan = (p) => <WilayahKecamatanField {...p} />;

// Edit mitra versi ponsel — memakai komponen form Mitra dashboard
// (AlamatBaris, LokasiPengirimanSection, KompetitorPicker) dan inti simpan
// yang sama (simpanMitraPemasaranAction → simpanMitraLengkap). NIK tidak
// pernah diubah dari sini. Jadikan Utama hanya tersedia di dashboard.
export function MitraEditForm({
  mitra,
  namaPenanggungJawab,
  kompetitorOpsi: opsiAwal,
  kompetitorDipilih,
}: {
  mitra: MitraRow;
  namaPenanggungJawab: string | null;
  kompetitorOpsi: Kompetitor[];
  kompetitorDipilih: number[];
}) {
  const router = useRouter();
  const [priceLevels, setPriceLevels] = useState<PriceLevelOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [nama, setNama] = useState(mitra.Name);
  const [penanggungJawab, setPenanggungJawab] = useState(namaPenanggungJawab ?? "");
  const [alamat, setAlamat] = useState<MitraAlamatForm>(() => mitraKeAlamatForm(mitra));
  // Alamat/lokasi dimuat ulang dari server saat form dipasang (halaman bisa
  // dibuka lama / dari cache router); isian alamat & Simpan dikunci sampai
  // selesai supaya lokasi yang ditambah dari tempat lain tidak tertimpa.
  const [alamatSiap, setAlamatSiap] = useState(false);
  const [versiAlamat, setVersiAlamat] = useState(0);
  const [priceLevel, setPriceLevel] = useState(mitra.PriceLevel != null ? String(mitra.PriceLevel) : "");
  const [capacity, setCapacity] = useState(mitra.Capacity != null ? String(mitra.Capacity) : "");
  const [kompetitorOpsi, setKompetitorOpsi] = useState<Kompetitor[]>(opsiAwal);
  const [kompetitorIds, setKompetitorIds] = useState<number[]>(kompetitorDipilih);

  useEffect(() => {
    getPriceLevelOptionsAction().then((result) => {
      if (result.success) setPriceLevels(result.data);
    });
  }, []);

  const bpId = mitra.BusinessPartnerID;
  useEffect(() => {
    let batal = false;
    getMitraDetailAction(bpId).then((r) => {
      if (batal) return;
      if (!r.success || !r.data) {
        setError(r.success ? "Mitra tidak ditemukan atau sudah dihapus." : r.error);
        return;
      }
      setAlamat(mitraKeAlamatForm(r.data));
      setVersiAlamat((v) => v + 1);
      setAlamatSiap(true);
    });
    return () => {
      batal = true;
    };
  }, [bpId]);

  function handleSubmit() {
    if (!alamatSiap) return;
    setError(null);
    startTransition(async () => {
      const result = await simpanMitraPemasaranAction(mitra.BusinessPartnerID, {
        ...alamat,
        mitra: {
          name: nama,
          // Segmentasi & Tenggat tidak diubah dari aplikasi pemasaran.
          gender: mitra.Gender,
          priceLevel: priceLevel ? Number(priceLevel) : null,
          termOfPaymentId: mitra.TermOfPaymentID,
          capacity: capacity !== "" ? Number(capacity) : null,
        },
        namaPenanggungJawab: penanggungJawab.trim() || null,
        kompetitorIds,
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="flex flex-col gap-4 p-4"
      >
        <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <p className="text-xs font-semibold text-muted-foreground">Identitas</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nama">Nama Mitra</Label>
            <Input id="nama" value={nama} onChange={(e) => setNama(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="penanggungJawab">Nama Penanggung Jawab</Label>
            <Input id="penanggungJawab" value={penanggungJawab} onChange={(e) => setPenanggungJawab(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Jenis Usaha</Label>
            <Input value={mitra.PartnerType} disabled className="text-muted-foreground" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{alamat.lokasiBerbeda ? "Alamat Mitra" : "Alamat Mitra & Lokasi Pengiriman"}</Label>
            <div className="grid grid-cols-2 gap-2">
              <AlamatBaris
                key={`alamat-${versiAlamat}`}
                value={alamat.alamatMitra}
                onChange={(fn) => setAlamat((a) => ({ ...a, alamatMitra: fn(a.alamatMitra) }))}
                renderWilayahKecamatan={renderWilayahKecamatan}
                tampilkanPin={!alamat.lokasiBerbeda}
                disabled={!alamatSiap}
              />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-2 rounded-lg border border-border p-3">
          <LokasiPengirimanSection
            key={`lokasi-${versiAlamat}`}
            value={alamat}
            onChange={setAlamat}
            renderWilayahKecamatan={renderWilayahKecamatan}
            disabled={!alamatSiap}
          />
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <p className="text-xs font-semibold text-muted-foreground">Harga, Kapasitas &amp; Kompetitor</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="priceLevel">Harga per Kantong</Label>
            <Select value={priceLevel} onValueChange={(v) => setPriceLevel(v ?? "")}>
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
            <Label htmlFor="capacity">Kapasitas Harian (kantong)</Label>
            <Input id="capacity" type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Daftar Kompetitor</Label>
            <KompetitorPicker
              bisnis="es_kristal"
              opsi={kompetitorOpsi}
              onOpsiChange={setKompetitorOpsi}
              value={kompetitorIds}
              onChange={setKompetitorIds}
              onTambah={tambahKompetitorAction}
            />
            {mitra.Kompetitor && kompetitorIds.length === 0 && (
              <p className="text-[11px] text-muted-foreground">Catatan lama: {mitra.Kompetitor}</p>
            )}
          </div>
        </section>

        <div className="sticky bottom-0 z-10 -mx-4 -mb-4 mt-2 flex flex-col gap-2 border-t border-border bg-background p-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending || !alamatSiap} className="w-full">
            {pending ? "Menyimpan..." : !alamatSiap ? "Memuat..." : "Simpan Perubahan"}
          </Button>
        </div>
      </form>
    </div>
  );
}
