import type { Metadata } from "next";
import { requireProduksiPabrik } from "@/lib/require-access";
import { bolehKelolaProduksi } from "@/lib/permissions";
import { getKeadaanAction, getPilihanKendaraanAction, getRiwayatSayaAction } from "@/app/produksi-operasional-actions";
import { ProduksiApp } from "@/components/produksi-operasional/app/produksi-app";

// Aplikasi HP operator produksi Es Balok (spec operasional §7). Berada di luar
// route group (dashboard), jadi tanpa sidebar dan tanpa redirect is_produksi
// layout dashboard.
export const metadata: Metadata = { title: "Produksi" };

export default async function PmpersadaProduksiAppPage() {
  const session = await requireProduksiPabrik("pmpersada");
  const [keadaan, kendaraan, riwayat] = await Promise.all([
    getKeadaanAction("pmpersada"),
    getPilihanKendaraanAction("pmpersada"),
    getRiwayatSayaAction("pmpersada"),
  ]);
  return (
    <ProduksiApp
      kode="pmpersada"
      namaPerusahaan="PMPersada"
      namaOperator={session.user.name ?? session.user.username}
      admin={bolehKelolaProduksi(session.user)}
      awalKeadaan={
        keadaan.success
          ? { data: { data: keadaan.data.data, keadaan: keadaan.data.keadaan }, galat: null }
          : { data: null, galat: keadaan.error }
      }
      awalArmada={kendaraan.success ? kendaraan.data.armada : []}
      armadaGalat={kendaraan.success ? kendaraan.data.armadaGalat : kendaraan.error}
      awalKendaraanAktif={kendaraan.success ? kendaraan.data.aktif : null}
      awalRiwayat={riwayat.success ? { data: riwayat.data, galat: null } : { data: null, galat: riwayat.error }}
    />
  );
}
