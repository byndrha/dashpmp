"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateWib } from "@/lib/format";
import {
  BerkasIdentitasField,
  type BerkasIdentitasNilai,
  type JenisBerkasIdentitas,
} from "@/components/dashboard/mitra-form/berkas-identitas-field";

// Dua baris pertama form Mitra (spec §2):
//   Nama Mitra | Nama Penanggung Jawab
//   NIK + berkasnya | Tanggal Pendaftaran (otomatis) + Dokumen SK
// Generik (Es Kristal & Es Balok): semua nilai lewat props, tidak terikat
// MitraRow. Aturan izin:
//   - !bolehLihat → NIK tampil "Tersembunyi", tombol berkas tidak dirender.
//   - !bolehUbah  → input NIK & unggah/hapus nonaktif.
// Grid induk diasumsikan 4 kolom di sm+ (2 kolom di layar kecil).
export function MitraIdentitasSection({
  nama,
  onNamaChange,
  namaPenanggungJawab,
  onNamaPenanggungJawabChange,
  nik,
  onNikChange,
  tanggalPendaftaran,
  bolehLihat,
  bolehUbah,
  memuat = false,
  berkas,
}: {
  nama: string;
  onNamaChange: (v: string) => void;
  namaPenanggungJawab: string;
  onNamaPenanggungJawabChange: (v: string) => void;
  nik: string;
  onNikChange: (v: string) => void;
  // Tanggal mentah (naive WIB / YYYY-MM-DD); null → "—".
  tanggalPendaftaran: string | null;
  bolehLihat: boolean;
  bolehUbah: boolean;
  // true selama data identitas tersimpan belum dimuat — isian dikunci agar
  // nilai kosong tidak tersimpan menimpa data lama.
  memuat?: boolean;
  berkas: {
    kode: string;
    sumber: "utama" | "logistik";
    partnerId: string | null;
    nik: BerkasIdentitasNilai;
    sk: BerkasIdentitasNilai;
    onBerubah: (jenis: JenisBerkasIdentitas, nilai: BerkasIdentitasNilai) => void;
  };
}) {
  return (
    <>
      <div className="col-span-2 flex flex-col gap-1">
        <Label htmlFor="mitra-nama" className="text-xs text-muted-foreground">
          Nama Mitra
        </Label>
        <Input id="mitra-nama" value={nama} onChange={(e) => onNamaChange(e.target.value)} placeholder="Nama Mitra" required />
      </div>
      <div className="col-span-2 flex flex-col gap-1">
        <Label htmlFor="mitra-pj" className="text-xs text-muted-foreground">
          Nama Penanggung Jawab
        </Label>
        <Input
          id="mitra-pj"
          value={namaPenanggungJawab}
          onChange={(e) => onNamaPenanggungJawabChange(e.target.value)}
          placeholder={memuat ? "Memuat..." : "Nama Penanggung Jawab"}
          disabled={memuat}
        />
      </div>

      <div className="col-span-2 flex flex-col gap-1">
        <Label htmlFor="mitra-nik" className="text-xs text-muted-foreground">
          NIK
        </Label>
        {bolehLihat ? (
          <Input
            id="mitra-nik"
            value={nik}
            onChange={(e) => onNikChange(e.target.value)}
            placeholder={memuat ? "Memuat..." : "NIK"}
            inputMode="numeric"
            maxLength={32}
            disabled={memuat || !bolehUbah}
          />
        ) : (
          <Input id="mitra-nik" value="Tersembunyi" disabled readOnly className="italic" />
        )}
        <BerkasIdentitasField
          jenis="nik"
          kode={berkas.kode}
          sumber={berkas.sumber}
          partnerId={berkas.partnerId}
          nilai={berkas.nik}
          bolehLihat={bolehLihat && !memuat}
          bolehUbah={bolehUbah}
          onBerubah={(v) => berkas.onBerubah("nik", v)}
        />
      </div>
      <div className="col-span-2 flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Tanggal Pendaftaran</Label>
        <Input value={tanggalPendaftaran ? formatDateWib(tanggalPendaftaran) : "—"} disabled readOnly />
        <BerkasIdentitasField
          jenis="sk"
          kode={berkas.kode}
          sumber={berkas.sumber}
          partnerId={berkas.partnerId}
          nilai={berkas.sk}
          bolehLihat={bolehLihat && !memuat}
          bolehUbah={bolehUbah}
          onBerubah={(v) => berkas.onBerubah("sk", v)}
        />
      </div>
    </>
  );
}
