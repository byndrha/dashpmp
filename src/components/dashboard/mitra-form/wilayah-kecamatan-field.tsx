"use client";

import { useState } from "react";
import { WilayahSelect } from "@/components/dashboard/wilayah-select";
import { KecamatanSelect } from "@/components/dashboard/kecamatan-select";

// Slot Wilayah + Kecamatan versi Es Kristal (nama teks, sama dengan kolom
// ERP NPWPName/NPWPAddress) untuk AlamatBaris / LokasiPengirimanSection.
// Merender dua sel grid.
export function WilayahKecamatanField({
  wilayah,
  kecamatan,
  onChange,
}: {
  wilayah: string;
  kecamatan: string;
  onChange: (wilayah: string, kecamatan: string) => void;
}) {
  const [regencyCode, setRegencyCode] = useState<string | null>(null);
  return (
    <>
      <WilayahSelect
        value={wilayah}
        onChange={(nama, kode) => {
          setRegencyCode(kode);
          // Kecamatan hanya dikosongkan bila Wilayah benar-benar berganti —
          // WilayahSelect juga memanggil ini untuk melaporkan kode wilayah
          // dari nilai yang sudah ada (mis. saat form edit dibuka).
          if (nama !== wilayah) onChange(nama, "");
        }}
      />
      <KecamatanSelect regencyCode={regencyCode} value={kecamatan} onChange={(k) => onChange(wilayah, k)} />
    </>
  );
}
