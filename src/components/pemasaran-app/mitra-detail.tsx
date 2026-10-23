"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, MapPin, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MitraRow } from "@/lib/queries/mitra";
import type { MitraKonteksPemasaran } from "@/app/mkesindo/pemasaran-app/actions";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

const gabung = (...bagian: (string | null | undefined)[]) => bagian.filter((b) => b && b.trim()).join(" · ") || "-";

function KartuLokasi({
  judul,
  wilayah,
  kecamatan,
  alamat,
  kontak,
  adaPin,
}: {
  judul: string;
  wilayah: string | null;
  kecamatan: string | null;
  alamat: string | null;
  kontak: string | null;
  adaPin: boolean | null; // null = tidak relevan (alamat mitra tanpa pin)
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border py-2 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{judul}</p>
        {adaPin !== null && (
          <span className={cn("flex items-center gap-1 text-[11px]", adaPin ? "text-primary" : "text-muted-foreground")}>
            <MapPin className="size-3" />
            {adaPin ? "Ada pin" : "Belum pin"}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{gabung(wilayah, kecamatan)}</p>
      {alamat && <p className="text-xs">{alamat}</p>}
      {kontak && <p className="text-xs tabular-nums text-muted-foreground">{kontak}</p>}
    </div>
  );
}

export function MitraDetail({ mitra, konteks }: { mitra: MitraRow; konteks: MitraKonteksPemasaran | null }) {
  const router = useRouter();
  const identitas = konteks?.identitas ?? null;
  const nik = !konteks ? "-" : konteks.akses.lihat ? (identitas?.nik ?? "-") : "Tersembunyi";
  const kompetitor = konteks?.kompetitorDipilih.map((k) => k.nama) ?? [];
  const tanggalDaftar = mitra.JoinDate ? new Date(mitra.JoinDate).toLocaleDateString("id-ID", { dateStyle: "medium" }) : "-";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="font-display text-base font-semibold">{mitra.Name}</h1>
        </div>
        <Badge variant="outline">{mitra.IsSuspended ? "Nonaktif" : "Aktif"}</Badge>
      </header>

      <div className="flex flex-col gap-4 p-4">
        <section className="flex flex-col">
          <Row label="Penanggung Jawab" value={identitas?.namaPenanggungJawab ?? "-"} />
          <Row label="NIK" value={nik} />
          <Row label="Tanggal Pendaftaran" value={tanggalDaftar} />
          <Row label="Jenis Usaha" value={mitra.PartnerType} />
          <Row label="Kantong/Hari" value={mitra.Capacity != null ? String(mitra.Capacity) : "Belum diisi"} />
          <Row
            label="Kompetitor"
            value={kompetitor.length > 0 ? kompetitor.join(", ") : mitra.Kompetitor ? `Catatan lama: ${mitra.Kompetitor}` : "-"}
          />
        </section>

        {mitra.LokasiBerbeda && mitra.AlamatMitra && (
          <section className="flex flex-col">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Alamat Mitra</p>
            <KartuLokasi judul="Alamat Mitra" adaPin={null} {...mitra.AlamatMitra} />
          </section>
        )}

        <section className="flex flex-col">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Lokasi Pengiriman ({1 + mitra.LokasiTambahan.length})
          </p>
          <KartuLokasi
            judul={mitra.LokasiTambahan.length > 0 ? "Lokasi 1 (Utama)" : "Utama"}
            wilayah={mitra.Wilayah}
            kecamatan={mitra.Kecamatan}
            alamat={mitra.Alamat}
            kontak={mitra.Kontak}
            adaPin={mitra.Latitude != null && mitra.Longitude != null}
          />
          {mitra.LokasiTambahan.map((l, i) => (
            <KartuLokasi
              key={l.LokasiPengirimanID}
              judul={`Lokasi ${i + 2}${l.Label?.trim() ? ` — ${l.Label.trim()}` : ""}`}
              wilayah={l.wilayah}
              kecamatan={l.kecamatan}
              alamat={l.alamat}
              kontak={l.kontak}
              adaPin={l.latitude != null && l.longitude != null}
            />
          ))}
        </section>
      </div>

      <div className="mt-auto p-4">
        <Button render={<Link href={`/mkesindo/pemasaran-app/mitra/${mitra.BusinessPartnerID}/edit`} />} className="w-full gap-1.5">
          <Pencil className="size-4" /> Edit Data Mitra
        </Button>
      </div>
    </div>
  );
}
