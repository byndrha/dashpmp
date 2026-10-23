"use client";

import { useState, type ReactNode } from "react";
import { MapPin, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MitraLocationField } from "@/components/dashboard/mitra-location-field";
import type { AlamatFields, LokasiTambahanInput, MitraAlamatForm, PinFields } from "@/lib/mitra-lokasi";

export type AlamatPin = AlamatFields & PinFields;

// Slot Wilayah + Kecamatan: Es Kristal memakai WilayahSelect/KecamatanSelect
// (teks nama), Es Balok bisa memasok select WilayahID sendiri. Harus
// merender DUA sel grid (Wilayah, Kecamatan).
export type RenderWilayahKecamatan = (p: {
  wilayah: string;
  kecamatan: string;
  onChange: (wilayah: string, kecamatan: string) => void;
}) => ReactNode;

// Pengubah bergaya setState(fn): semua perubahan dihitung dari nilai
// terbaru, sehingga dua perubahan beruntun (mis. MitraLocationField memanggil
// onChange pin lalu onGeocode alamat sebelum render ulang) tidak saling timpa.
// Induk cukup meneruskan setter useState-nya.
export type Pengubah<T> = (fn: (prev: T) => T) => void;

export const ALAMAT_KOSONG: AlamatPin = {
  wilayah: null,
  kecamatan: null,
  alamat: null,
  kontak: null,
  latitude: null,
  longitude: null,
  geoAlamat: null,
};

const kosongJadiNull = (s: string): string | null => (s === "" ? null : s);
const punyaPin = (v: PinFields) => v.latitude != null && v.longitude != null;

/**
 * Satu baris "Wilayah | Kecamatan | Alamat | Kontak [pin]". Dipakai untuk
 * baris alamat Identitas (pin hanya bila kotak lokasi berbeda TIDAK
 * dicentang) dan untuk setiap baris lokasi pengiriman. Peta (MitraLocationField)
 * baru dipasang saat tombol pin diklik, supaya membuka/menyimpan form tidak
 * pernah membuat pin tanpa sengaja.
 */
export function AlamatBaris({
  value,
  onChange,
  renderWilayahKecamatan,
  tampilkanPin = true,
  disabled = false,
}: {
  value: AlamatPin;
  onChange: Pengubah<AlamatPin>;
  renderWilayahKecamatan: RenderWilayahKecamatan;
  tampilkanPin?: boolean;
  disabled?: boolean;
}) {
  const [petaTerbuka, setPetaTerbuka] = useState(false);
  const adaPin = punyaPin(value);
  function ubah(patch: Partial<AlamatPin>) {
    onChange((prev) => ({ ...prev, ...patch }));
  }

  return (
    <div className="col-span-full grid grid-cols-2 gap-2 sm:grid-cols-4">
      {renderWilayahKecamatan({
        wilayah: value.wilayah ?? "",
        kecamatan: value.kecamatan ?? "",
        onChange: (wilayah, kecamatan) => ubah({ wilayah: kosongJadiNull(wilayah), kecamatan: kosongJadiNull(kecamatan) }),
      })}
      <Input
        placeholder="Alamat"
        value={value.alamat ?? ""}
        disabled={disabled}
        onChange={(e) => ubah({ alamat: kosongJadiNull(e.target.value) })}
      />
      <div className="flex items-center gap-1">
        <Input
          placeholder="Kontak"
          value={value.kontak ?? ""}
          disabled={disabled}
          onChange={(e) => ubah({ kontak: kosongJadiNull(e.target.value) })}
        />
        {tampilkanPin && (
          <Button
            type="button"
            variant={petaTerbuka ? "secondary" : "outline"}
            size="icon"
            className="shrink-0"
            title={adaPin ? "Ubah pin lokasi" : "Pasang pin lokasi"}
            disabled={disabled}
            onClick={() => setPetaTerbuka((v) => !v)}
          >
            <MapPin className={cn("size-4", adaPin ? "fill-primary/30 text-primary" : "text-muted-foreground")} />
          </Button>
        )}
      </div>
      {tampilkanPin && petaTerbuka && (
        <div className="col-span-full">
          <MitraLocationField
            value={adaPin ? { latitude: value.latitude!, longitude: value.longitude!, alamat: value.geoAlamat } : null}
            onChange={(loc) => ubah({ latitude: loc.latitude, longitude: loc.longitude, geoAlamat: loc.alamat })}
            onGeocode={(s) => {
              // Sama dengan form lama: Kecamatan dari OSM sering kosong, jadi
              // hanya nilai yang ditemukan yang menimpa isian.
              const patch: Partial<AlamatPin> = {};
              if (s.alamat) patch.alamat = s.alamat;
              if (s.wilayah) patch.wilayah = s.wilayah;
              if (s.kecamatan) patch.kecamatan = s.kecamatan;
              ubah(patch);
            }}
            wilayah={value.wilayah}
            kecamatan={value.kecamatan}
          />
        </div>
      )}
    </div>
  );
}

// Kunci React stabil untuk baris lokasi tambahan (baris baru belum punya ID).
let kunciBerikut = 0;
const kunciBaru = () => `lok-${++kunciBerikut}`;

/**
 * Kotak "Lokasi Pengiriman Berbeda dengan Mitra" + daftar lokasi (spec §2, §8).
 * Bekerja atas seluruh MitraAlamatForm agar aturan centang/hapus centang
 * terpusat di sini:
 *   - centang: alamat yang ada menjadi Lokasi 1 (Utama), alamat mitra tetap
 *     berisi salinannya;
 *   - hapus centang dengan lokasi tambahan: konfirmasi, lalu lokasi tambahan
 *     dibuang (soft-delete saat simpan) dan alamat mitra = Lokasi Utama.
 * "Jadikan Utama" langsung ke server, jadi disuntikkan lewat onJadikanUtama
 * (hanya untuk baris yang sudah tersimpan).
 */
export function LokasiPengirimanSection({
  value,
  onChange,
  renderWilayahKecamatan,
  onJadikanUtama,
  sedangJadikanUtama = false,
}: {
  value: MitraAlamatForm;
  onChange: Pengubah<MitraAlamatForm>;
  renderWilayahKecamatan: RenderWilayahKecamatan;
  onJadikanUtama?: (lokasi: LokasiTambahanInput) => void;
  sedangJadikanUtama?: boolean;
}) {
  const [kunci, setKunci] = useState<string[]>(() => value.lokasiTambahan.map(kunciBaru));
  // Sinkronkan bila daftar diganti dari luar (mis. dimuat ulang setelah
  // Jadikan Utama) — penyesuaian state saat render, bukan efek.
  if (kunci.length !== value.lokasiTambahan.length) {
    setKunci(value.lokasiTambahan.map(kunciBaru));
  }

  function ubahCentang(dicentang: boolean) {
    if (dicentang) {
      onChange((v) => ({ ...v, lokasiBerbeda: true, lokasiUtama: { ...v.alamatMitra }, lokasiTambahan: [] }));
      return;
    }
    const n = value.lokasiTambahan.length;
    if (n > 0 && !confirm(`${n} lokasi tambahan akan dihapus, alamat mitra akan disamakan dengan Lokasi Utama.`)) return;
    onChange((v) => ({ ...v, lokasiBerbeda: false, alamatMitra: { ...v.lokasiUtama }, lokasiTambahan: [] }));
  }

  function ubahTambahan(i: number, fn: (prev: LokasiTambahanInput) => LokasiTambahanInput) {
    onChange((v) => ({ ...v, lokasiTambahan: v.lokasiTambahan.map((x, j) => (j === i ? fn(x) : x)) }));
  }

  function tambah() {
    setKunci((k) => [...k, kunciBaru()]);
    onChange((v) => ({
      ...v,
      lokasiTambahan: [...v.lokasiTambahan, { ...ALAMAT_KOSONG, lokasiPengirimanId: null, label: null }],
    }));
  }

  function hapus(i: number) {
    const l = value.lokasiTambahan[i];
    const nama = l.label?.trim() || `Lokasi ${i + 2}`;
    if (!confirm(`Hapus ${nama}? Perubahan berlaku saat form disimpan.`)) return;
    setKunci((k) => k.filter((_, j) => j !== i));
    onChange((v) => ({ ...v, lokasiTambahan: v.lokasiTambahan.filter((_, j) => j !== i) }));
  }

  return (
    <>
      <label className="col-span-full flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-primary"
          checked={value.lokasiBerbeda}
          onChange={(e) => ubahCentang(e.target.checked)}
        />
        Lokasi Pengiriman Berbeda dengan Mitra
      </label>

      {value.lokasiBerbeda && (
        <div className="col-span-full flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Lokasi Pengiriman</h4>
            <Button type="button" variant="outline" size="icon-sm" title="Tambah lokasi pengiriman" onClick={tambah}>
              <Plus className="size-4" />
            </Button>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Lokasi 1 (Utama)</span>
            <AlamatBaris
              value={value.lokasiUtama}
              onChange={(fn) => onChange((v) => ({ ...v, lokasiUtama: fn(v.lokasiUtama) }))}
              renderWilayahKecamatan={renderWilayahKecamatan}
            />
          </div>

          {value.lokasiTambahan.map((l, i) => (
            <div key={kunci[i] ?? i} className="flex flex-col gap-1.5 border-t pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Lokasi {i + 2}</span>
                <Input
                  placeholder="Label (opsional), mis. Gudang Pasar"
                  value={l.label ?? ""}
                  maxLength={64}
                  onChange={(e) => {
                    const label = kosongJadiNull(e.target.value);
                    ubahTambahan(i, (x) => ({ ...x, label }));
                  }}
                  className="h-7 max-w-64 text-xs"
                />
                <div className="ml-auto flex items-center gap-1">
                  {onJadikanUtama && l.lokasiPengirimanId != null && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={sedangJadikanUtama}
                      onClick={() => onJadikanUtama(l)}
                    >
                      <Star className="size-3" />
                      Jadikan Utama
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    title="Hapus lokasi"
                    onClick={() => hapus(i)}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </div>
              </div>
              <AlamatBaris
                value={l}
                onChange={(fn) => ubahTambahan(i, (x) => ({ ...x, ...fn(x) }))}
                renderWilayahKecamatan={renderWilayahKecamatan}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
