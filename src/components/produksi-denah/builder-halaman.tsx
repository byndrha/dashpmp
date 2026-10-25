// Halaman Builder Denah (server component) — dipakai /pmpersada/produksi/denah
// dan /pmpakis/produksi/denah. Pemanggil (page) WAJIB sudah menjalankan
// requirePmpersada()/requirePmpakis(); kode perusahaan = konstanta rute.
// Tanpa izin edit -> kembali ke halaman Produksi (simpan juga dijaga di
// server action).

import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { DenahBuilder } from "@/components/produksi-denah/denah-builder";
import { getDenah } from "@/lib/queries/produksi-denah";
import { bolehEditDenah } from "@/lib/permissions";
import type { KodeProduksi } from "@/lib/produksi-denah";

export async function BuilderHalaman({ kode, namaPerusahaan, user }: { kode: KodeProduksi; namaPerusahaan: string; user: Session["user"] }) {
  if (!bolehEditDenah(user)) redirect(`/${kode}/produksi`);
  const denah = await getDenah(kode);
  return <DenahBuilder kode={kode} namaPerusahaan={namaPerusahaan} dokumenAwal={denah?.data ?? null} versiAwal={denah?.versi ?? null} />;
}
