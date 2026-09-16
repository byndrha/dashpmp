// src/app/grup/inventaris/vendor/[id]/page.tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireInventarisAccess } from "@/lib/require-access";
import { getVendor, listVendorLokasi, listVendorPic, listVendorPicInternal } from "@/lib/queries/inventaris-vendor";
import { listVendorProduk, listVendorKategori } from "@/lib/queries/inventaris-produk";
import { listVendorPengiriman, getVendorRanking } from "@/lib/queries/inventaris-pengiriman";
import { listPerusahaan } from "@/lib/queries/perusahaan";
import { listAkun } from "@/lib/queries/akun";
import { getPgPool } from "@/lib/pg";
import { InventarisVendorDetail } from "@/components/dashboard/inventaris-vendor-detail";

export const metadata: Metadata = { title: "Detail Vendor" };

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireInventarisAccess();
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) notFound();

  const vendor = await getVendor(id);
  if (!vendor) notFound();

  const [lokasiList, picList, picInternalList, produkList, kategoriList, pengirimanList, ranking, perusahaanList, akunList, links] =
    await Promise.all([
      listVendorLokasi(id),
      listVendorPic(id),
      listVendorPicInternal(id),
      listVendorProduk(id),
      listVendorKategori(),
      listVendorPengiriman(id),
      getVendorRanking(id),
      listPerusahaan(),
      listAkun(),
      getPgPool().query(
        `SELECT vpl.id, vpl.perusahaan_id, p.nama AS perusahaan_nama, vpl.business_partner_id, vpl.term_of_payment_id, vpl.is_suspended
         FROM vendor_perusahaan_link vpl JOIN perusahaan p ON p.id = vpl.perusahaan_id WHERE vpl.vendor_id = $1`,
        [id]
      ),
    ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-semibold">{vendor.nama}</h1>
      <InventarisVendorDetail
        vendor={vendor}
        lokasiList={lokasiList}
        picList={picList}
        picInternalList={picInternalList}
        produkList={produkList}
        kategoriList={kategoriList}
        pengirimanList={pengirimanList}
        ranking={ranking}
        perusahaanList={perusahaanList}
        perusahaanLinks={links.rows.map((r) => ({
          id: r.id,
          perusahaanId: r.perusahaan_id,
          perusahaanNama: r.perusahaan_nama,
          businessPartnerId: r.business_partner_id,
          termOfPaymentId: r.term_of_payment_id,
          isSuspended: r.is_suspended,
        }))}
        currentAkunId={Number(session.user.id)}
        akunList={akunList}
      />
    </div>
  );
}
