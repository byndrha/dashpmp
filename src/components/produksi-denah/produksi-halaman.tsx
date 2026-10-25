// Halaman Produksi Es Balok (server component) — dipakai /pmpersada/produksi
// dan /pmpakis/produksi. Pemanggil (page) WAJIB sudah menjalankan gerbang
// requirePmpersada()/requirePmpakis(); kode perusahaan berasal dari konstanta
// rute, bukan input client.

import Link from "next/link";
import { LayoutGrid, PencilRuler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DenahPenampil } from "@/components/produksi-denah/denah-penampil";
import { getDenah } from "@/lib/queries/produksi-denah";
import type { KodeProduksi } from "@/lib/produksi-denah";
import { getUserById } from "@/lib/queries/akun";
import { bolehEditDenah } from "@/lib/permissions";
import { ringkasDenah } from "@/lib/produksi-denah";
import type { Session } from "next-auth";

const angka = new Intl.NumberFormat("id-ID");
const formatWib = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" });

// updated_by = session.user.id (ID akun Postgres). Tampilkan nama bila bisa,
// selain itu ID apa adanya.
async function namaPengubah(id: string | null): Promise<string> {
  if (!id) return "—";
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return id;
  try {
    return (await getUserById(n))?.nama || id;
  } catch {
    return id;
  }
}

export async function ProduksiHalaman({ kode, namaPerusahaan, user }: { kode: KodeProduksi; namaPerusahaan: string; user: Session["user"] }) {
  const denah = await getDenah(kode);
  const bolehEdit = bolehEditDenah(user);
  const hrefEdit = `/${kode}/produksi/denah`;
  const ada = !!denah && denah.data.elemen.length > 0;
  const oleh = ada ? await namaPengubah(denah.updatedBy) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold">Produksi</h1>
          <p className="text-sm text-muted-foreground">{namaPerusahaan} — Es Balok</p>
        </div>
        {ada && bolehEdit && (
          <Button variant="outline" render={<Link href={hrefEdit} />}>
            <PencilRuler /> Edit Denah
          </Button>
        )}
      </div>

      {!ada ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <LayoutGrid className="size-4 text-muted-foreground" />
              <CardTitle>Denah produksi belum diatur</CardTitle>
            </div>
            <CardDescription>
              Denah berisi bak (brine tank), kolom dan ice can, mesin, serta jalur derek pabrik ini.
              {bolehEdit ? " Mulai susun denah lewat tombol di bawah." : " Hubungi pengguna yang berwenang untuk menyusun denah."}
            </CardDescription>
          </CardHeader>
          {bolehEdit && (
            <CardContent>
              <Button render={<Link href={hrefEdit} />}>
                <PencilRuler /> Edit Denah
              </Button>
            </CardContent>
          )}
        </Card>
      ) : (
        <>
          <Ringkasan r={ringkasDenah(denah.data)} />
          <DenahPenampil dokumen={denah.data} />
          <p className="text-xs text-muted-foreground">
            Diperbarui {formatWib.format(new Date(denah.updatedAt))} WIB oleh {oleh} · versi {denah.versi}. Klik bak untuk melihat detail kolom.
          </p>
        </>
      )}
    </div>
  );
}

function Ringkasan({ r }: { r: ReturnType<typeof ringkasDenah> }) {
  const isi: [string, number][] = [
    ["Bak", r.jumlahBak],
    ["Kolom", r.jumlahKolom],
    ["Ice can Kecil", r.iceCanKecil],
    ["Ice can Besar", r.iceCanBesar],
    ["Mesin", r.jumlahMesin],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {isi.map(([label, nilai]) => (
        <div key={label} className="rounded-lg border bg-card px-3 py-2">
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-lg font-semibold tabular-nums">{angka.format(nilai)}</div>
        </div>
      ))}
    </div>
  );
}
