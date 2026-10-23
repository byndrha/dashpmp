// src/components/dashboard/mitra-es-balok-form-dialog.tsx
"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MitraIdentitasSection } from "@/components/dashboard/mitra-form/mitra-identitas-section";
import {
  AlamatBaris,
  LokasiPengirimanSection,
  type AdaptorWilayah,
  type RenderWilayahKecamatan,
} from "@/components/dashboard/mitra-form/lokasi-pengiriman-section";
import { KompetitorPicker } from "@/components/dashboard/mitra-form/kompetitor-picker";
import type { BerkasIdentitasNilai } from "@/components/dashboard/mitra-form/berkas-identitas-field";
import type { MitraLocationPoint } from "@/components/dashboard/mitra-locations-map";
import type { ActionResult } from "@/lib/action-result";
import { PESAN_SIMPAN_SEBAGIAN, type LokasiTambahanInput, type MitraAlamatForm } from "@/lib/mitra-lokasi";
import { kartuKeAlamatForm, nilaiBalokBesarUntukSimpan } from "@/lib/mitra-es-balok-form";
import type { MitraCard, SumberAgen, WilayahOption } from "@/lib/queries/mitra-es-balok";
import type { MitraFormKonteksEsBalok, MitraLengkapEsBalokInput } from "@/lib/queries/mitra-es-balok-lokasi";
import type { BisnisKompetitor, Kompetitor } from "@/lib/queries/kompetitor";
import { SEGMENTASI_OPTIONS, type Segmentasi } from "@/lib/segmentasi-mitra";

// Leaflet menyentuh global browser saat impor — dimuat hanya di client.
const MitraLocationsMap = dynamic(
  () => import("@/components/dashboard/mitra-locations-map").then((m) => m.MitraLocationsMap),
  { ssr: false, loading: () => <Skeleton className="h-[220px] w-full rounded-lg" /> }
);

// Server action milik halaman perusahaan (pmputra/pmpersada/pmpakis) —
// disuntikkan supaya satu form melayani ketiganya dengan gerbang masing-masing.
export interface AksiMitraEsBalok {
  simpan: (
    sumber: SumberAgen,
    agenId: string | null,
    input: MitraLengkapEsBalokInput,
    agenDetailId: string | null
  ) => Promise<ActionResult<string>>;
  jadikanUtama: (
    sumber: SumberAgen,
    agenId: string,
    agenDetailId: string | null,
    lokasiPengirimanId: number
  ) => Promise<ActionResult<{ wilayahLama: string | null; wilayahBaru: string | null }>>;
  tambahKompetitor: (bisnis: BisnisKompetitor, nama: string) => Promise<ActionResult<Kompetitor>>;
  konteks: (sumber: SumberAgen, agenId: string | null) => Promise<ActionResult<MitraFormKonteksEsBalok>>;
  muatKartu: (sumber: SumberAgen, agenId: string, agenDetailId: string | null) => Promise<ActionResult<MitraCard | null>>;
}

const BERKAS_KOSONG: BerkasIdentitasNilai = { ada: false, namaFile: null, mime: null };
const TANPA_WILAYAH = "__none__";

// Nama wilayah OSM ("Kabupaten Madiun", "Kota Madiun") → bentuk pembanding.
function normalNamaWilayah(nama: string): string {
  return nama
    .toLowerCase()
    .replace(/^(kabupaten|kab\.?|kota)\s+/, "")
    .trim();
}

function SelectWilayahId({
  value,
  onChange,
  opsi,
}: {
  value: string;
  onChange: (v: string) => void;
  opsi: WilayahOption[];
}) {
  // WilayahID tersimpan yang tidak ada di daftar (mis. wilayah sudah dihapus
  // di ERP) tetap ditampilkan agar tidak hilang diam-diam.
  const adaDiOpsi = !value || opsi.some((w) => w.wilayahId === value);
  return (
    <Select value={value || TANPA_WILAYAH} onValueChange={(v) => onChange(!v || v === TANPA_WILAYAH ? "" : v)}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Wilayah">
          {() => (!value ? "Wilayah" : (opsi.find((w) => w.wilayahId === value)?.nama ?? `Wilayah ${value}`))}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TANPA_WILAYAH}>Pilih Wilayah</SelectItem>
        {!adaDiOpsi && <SelectItem value={value}>Wilayah {value}</SelectItem>}
        {opsi.map((w) => (
          <SelectItem key={w.wilayahId} value={w.wilayahId}>
            {w.nama}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function angkaAtauNol(s: string): number {
  const n = Number(s);
  return s.trim() === "" || !Number.isFinite(n) ? 0 : n;
}
function angkaAtauNull(s: string): number | null {
  const n = Number(s);
  return s.trim() === "" || !Number.isFinite(n) ? null : n;
}
const keTeks = (n: number | null | undefined) => (n == null ? "" : String(n));

/**
 * Form Tambah/Edit Mitra Es Balok — layout sama dengan Es Kristal (spec §2,
 * §6.2): Wilayah = WilayahID (RegionID), Kecamatan = DashboardAgenProfil
 * (opsional), Marketing = "—", Harga = Balok Kecil + Besar, Tenggat = Batas
 * Hutang, Kapasitas Harian = Kecil + Besar. Konteks (identitas, kompetitor,
 * hak akses, daftar Wilayah sumber ini) dimuat sendiri lewat aksi.konteks —
 * NIK tidak pernah lewat props halaman. Induk memasang komponen ini hanya
 * selagi dialog terbuka (state selalu segar).
 */
export function MitraEsBalokFormDialog({
  open,
  onOpenChange,
  kode,
  card,
  jumlahKartuAgen = 1,
  aksi,
  onSelesai,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kode: string;
  // null = Tambah Mitra.
  card: MitraCard | null;
  // Jumlah kartu dengan (sumber, AgenID) yang sama — >1 bila Agen punya
  // beberapa baris PMP_AgenDetail aktif.
  jumlahKartuAgen?: number;
  aksi: AksiMitraEsBalok;
  onSelesai: () => void;
}) {
  const agenId = card?.agenId ?? null;
  const agenDetailId = card?.agenDetailId ?? null;
  const needsSumberChoice = kode !== "pmputra" && !card;
  // PMPakis only sells Balok Kecil -- Balok Besar harga/kapasitas is never
  // asked for or shown here. User decision 2026-09-24.
  const isPmpakis = kode === "pmpakis";

  const [sumber, setSumber] = useState<SumberAgen>(card?.sumber ?? "utama");
  const [nama, setNama] = useState(card?.nama ?? "");
  const [penanggungJawab, setPenanggungJawab] = useState("");
  const [nik, setNik] = useState("");
  const [berkasNik, setBerkasNik] = useState<BerkasIdentitasNilai>(BERKAS_KOSONG);
  const [berkasSk, setBerkasSk] = useState<BerkasIdentitasNilai>(BERKAS_KOSONG);
  const [alamat, setAlamat] = useState<MitraAlamatForm>(() => kartuKeAlamatForm(card));
  const [segmentasi, setSegmentasi] = useState<Segmentasi | null>(card?.segmentasi ?? null);
  const [hargaKecil, setHargaKecil] = useState(keTeks(card?.hargaBalokKecil ?? 0));
  const [hargaBesar, setHargaBesar] = useState(keTeks(card?.hargaBalokBesar ?? 0));
  const [maksHutang, setMaksHutang] = useState(keTeks(card?.maksimumHutang ?? 0));
  const [kapasitasKecil, setKapasitasKecil] = useState(keTeks(card?.kapasitasBalokKecil));
  const [kapasitasBesar, setKapasitasBesar] = useState(keTeks(card?.kapasitasBalokBesar));
  const [kompetitorOpsi, setKompetitorOpsi] = useState<Kompetitor[]>([]);
  const [kompetitorIds, setKompetitorIds] = useState<number[]>([]);
  const [konteks, setKonteks] = useState<MitraFormKonteksEsBalok | null>(null);
  const [galatKonteks, setGalatKonteks] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [sedangJadikan, startJadikan] = useTransition();

  // Muat identitas + kompetitor + hak akses + daftar Wilayah sumber ini.
  // Isian identitas dikunci (dan Simpan nonaktif) sampai selesai, supaya
  // nilai kosong tidak tersimpan menimpa data lama.
  useEffect(() => {
    let batal = false;
    aksi.konteks(sumber, agenId).then((r) => {
      if (batal) return;
      if (!r.success) {
        setGalatKonteks(r.error);
        return;
      }
      const d = r.data;
      setGalatKonteks(null);
      setKonteks(d);
      setKompetitorOpsi(d.kompetitorOpsi);
      if (agenId) setKompetitorIds(d.kompetitorDipilih);
      if (d.identitas) {
        setPenanggungJawab(d.identitas.namaPenanggungJawab ?? "");
        setNik(d.identitas.nik ?? "");
        setBerkasNik({ ada: d.identitas.punyaBerkasNik, namaFile: d.identitas.nikNamaFile, mime: d.identitas.nikMime });
        setBerkasSk({ ada: d.identitas.punyaBerkasSk, namaFile: d.identitas.skNamaFile, mime: d.identitas.skMime });
      }
    });
    return () => {
      batal = true;
    };
  }, [aksi, sumber, agenId]);

  const memuat = konteks === null;
  const akses = konteks?.akses ?? { lihat: false, ubah: false };
  const wilayahOpsi = useMemo(() => konteks?.wilayahOptions ?? [], [konteks]);
  const namaWilayah = useMemo(() => new Map(wilayahOpsi.map((w) => [w.wilayahId, w.nama])), [wilayahOpsi]);

  const adaptorWilayah: AdaptorWilayah = useMemo(
    () => ({
      keNama: (id) => (id ? (namaWilayah.get(id) ?? null) : null),
      dariNama: (n) => {
        const cari = normalNamaWilayah(n);
        return wilayahOpsi.find((w) => normalNamaWilayah(w.nama) === cari)?.wilayahId ?? null;
      },
    }),
    [wilayahOpsi, namaWilayah]
  );

  const renderWilayahKecamatan: RenderWilayahKecamatan = (p) => (
    <>
      <SelectWilayahId value={p.wilayah} onChange={(w) => p.onChange(w, p.kecamatan)} opsi={wilayahOpsi} />
      <Input placeholder="Kecamatan (opsional)" value={p.kecamatan} maxLength={128} onChange={(e) => p.onChange(p.wilayah, e.target.value)} />
    </>
  );

  function gantiSumber(next: SumberAgen) {
    if (next === sumber) return;
    // WilayahID berbeda per DB fisik — kosongkan pilihan Wilayah lama.
    const tanpaWilayah = <T extends { wilayah: string | null }>(a: T): T => ({ ...a, wilayah: null });
    setAlamat((a) => ({
      ...a,
      alamatMitra: tanpaWilayah(a.alamatMitra),
      lokasiUtama: tanpaWilayah(a.lokasiUtama),
      lokasiTambahan: a.lokasiTambahan.map(tanpaWilayah),
    }));
    setKonteks(null);
    setSumber(next);
  }

  function handleSubmit() {
    if (memuat) return;
    setError(null);
    const input: MitraLengkapEsBalokInput = {
      ...alamat,
      mitra: {
        nama,
        hargaBalokKecil: angkaAtauNol(hargaKecil),
        maksimumHutang: angkaAtauNol(maksHutang),
        kapasitasBalokKecil: angkaAtauNull(kapasitasKecil),
        // pmpakis: nilai Besar tersimpan dipertahankan (baris logistik dipakai bersama pmpersada).
        ...nilaiBalokBesarUntukSimpan(kode, card, {
          hargaBalokBesar: angkaAtauNol(hargaBesar),
          kapasitasBalokBesar: angkaAtauNull(kapasitasBesar),
        }),
        segmentasi,
      },
      namaPenanggungJawab: penanggungJawab.trim() || null,
      kompetitorIds,
      // NIK hanya dikirim bila boleh mengubah (server juga membuangnya).
      ...(akses.ubah ? { nik: nik.trim() || null } : {}),
    };
    startTransition(async () => {
      const r = await aksi.simpan(sumber, agenId, input, agenDetailId);
      if (!r.success) {
        if (!agenId && r.error === PESAN_SIMPAN_SEBAGIAN) {
          // Mitra baru SUDAH dibuat — tutup form agar "simpan ulang" tidak
          // membuat mitra ganda; lanjutkan lewat Edit.
          toast.warning("Mitra baru tersimpan, tetapi identitas/kompetitor gagal disimpan. Buka Edit mitra ini lalu simpan ulang.");
          onSelesai();
          return;
        }
        setError(r.error);
        return;
      }
      toast.success(agenId ? "Mitra disimpan." : "Mitra baru ditambahkan.");
      onSelesai();
    });
  }

  function handleJadikanUtama(l: LokasiTambahanInput) {
    if (!agenId || l.lokasiPengirimanId == null) return;
    const lokasiId = l.lokasiPengirimanId;
    const wLama = alamat.lokasiUtama.wilayah;
    const wBaru = l.wilayah;
    const beda = (wLama ?? "") !== (wBaru ?? "");
    const namaLokasi = l.label?.trim() || "lokasi ini";
    const pesan =
      `Jadikan ${namaLokasi} sebagai Lokasi Utama? Lokasi Utama saat ini akan menjadi lokasi tambahan.\n` +
      `Daftar lokasi di form ini akan dimuat ulang dari data tersimpan (perubahan lokasi yang belum disimpan hilang).` +
      (beda
        ? `\n\nPERINGATAN: Wilayah utama berubah dari "${adaptorWilayah.keNama(wLama) ?? "-"}" ke "${adaptorWilayah.keNama(wBaru) ?? "-"}". ` +
          `Laporan per wilayah untuk mitra ini ikut pindah.`
        : "");
    if (!confirm(pesan)) return;
    setError(null);
    startJadikan(async () => {
      const r = await aksi.jadikanUtama(sumber, agenId, agenDetailId, lokasiId);
      if (!r.success) {
        setError(r.error);
        return;
      }
      const d = await aksi.muatKartu(sumber, agenId, agenDetailId);
      if (d.success && d.data) {
        const segar = kartuKeAlamatForm(d.data);
        // Alamat mitra (Identitas) tidak disentuh Jadikan Utama — pertahankan isian.
        setAlamat((prev) => ({ ...segar, alamatMitra: prev.alamatMitra }));
      }
      if ((r.data.wilayahLama ?? "") !== (r.data.wilayahBaru ?? "")) {
        toast.warning(`Lokasi utama diganti. Wilayah pindah dari ${r.data.wilayahLama ?? "-"} ke ${r.data.wilayahBaru ?? "-"} — laporan wilayah ikut pindah.`);
      } else {
        toast.success("Lokasi utama diganti.");
      }
    });
  }

  const titikPeta = useMemo((): MitraLocationPoint[] => {
    const id = agenId ?? "baru";
    const utama = alamat.lokasiBerbeda ? alamat.lokasiUtama : alamat.alamatMitra;
    const hasil: MitraLocationPoint[] = [];
    const nm = nama || "Mitra";
    if (utama.latitude != null && utama.longitude != null) {
      hasil.push({ Key: `${id}:utama`, BusinessPartnerID: id, Name: nm, Label: "Utama", Wilayah: adaptorWilayah.keNama(utama.wilayah), Latitude: utama.latitude, Longitude: utama.longitude });
    }
    if (alamat.lokasiBerbeda) {
      alamat.lokasiTambahan.forEach((l, i) => {
        if (l.latitude == null || l.longitude == null) return;
        hasil.push({
          Key: `${id}:${l.lokasiPengirimanId ?? `baru-${i}`}`,
          BusinessPartnerID: id,
          Name: nm,
          Label: l.label?.trim() || `Lokasi ${i + 2}`,
          Wilayah: adaptorWilayah.keNama(l.wilayah),
          Latitude: l.latitude,
          Longitude: l.longitude,
        });
      });
    }
    return hasil;
  }, [agenId, nama, alamat, adaptorWilayah]);
  // Peta dipasang ulang saat titik berubah agar tampilan menyesuaikan semua pin.
  const kunciPeta = titikPeta.map((t) => `${t.Key}@${t.Latitude},${t.Longitude}`).join("|");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{card ? "Edit Mitra" : "Tambah Mitra"}</DialogTitle>
          <DialogDescription>Data mitra tersimpan langsung ke database perusahaan.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          {needsSumberChoice && (
            <div className="col-span-full flex flex-col gap-1">
              <Label className="text-xs text-muted-foreground">Sumber</Label>
              <Select value={sumber} onValueChange={(v) => gantiSumber((v ?? "utama") as SumberAgen)}>
                <SelectTrigger className="w-full sm:w-64">
                  <SelectValue>{() => (sumber === "utama" ? "Utama" : "Logistik (Bersama)")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="utama">Utama</SelectItem>
                  <SelectItem value="logistik">Logistik (Bersama)</SelectItem>
                </SelectContent>
              </Select>
              {sumber === "logistik" && (
                <p className="text-xs text-warning">
                  Mitra baru ini akan otomatis muncul juga di modul Mitra perusahaan pasangan ({kode === "pmpersada" ? "pmpakis" : "pmpersada"}),
                  karena keduanya menulis ke database fisik yang sama.
                </p>
              )}
            </div>
          )}

          {jumlahKartuAgen > 1 && (
            <p className="col-span-full rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Agen ini punya {jumlahKartuAgen} alamat ERP (tampil sebagai {jumlahKartuAgen} kartu). Alamat & Wilayah lokasi utama di
              form ini hanya mengubah kartu ini. Kontak, pin, identitas, lokasi tambahan, dan kompetitor dipakai bersama semua kartu Agen ini.
            </p>
          )}

          <h4 className="col-span-full text-sm font-medium">Identitas</h4>
          <MitraIdentitasSection
            nama={nama}
            onNamaChange={setNama}
            namaPenanggungJawab={penanggungJawab}
            onNamaPenanggungJawabChange={setPenanggungJawab}
            nik={nik}
            onNikChange={setNik}
            tanggalPendaftaran={konteks?.identitas?.tanggalPendaftaran ?? null}
            bolehLihat={akses.lihat}
            bolehUbah={akses.ubah}
            memuat={memuat}
            berkas={{
              kode: konteks?.berkasKode ?? "",
              sumber: konteks?.berkasSumber ?? "utama",
              partnerId: agenId,
              nik: berkasNik,
              sk: berkasSk,
              onBerubah: (jenis, v) => (jenis === "nik" ? setBerkasNik(v) : setBerkasSk(v)),
            }}
          />
          <AlamatBaris
            value={alamat.alamatMitra}
            onChange={(fn) => setAlamat((a) => ({ ...a, alamatMitra: fn(a.alamatMitra) }))}
            renderWilayahKecamatan={renderWilayahKecamatan}
            tampilkanPin={!alamat.lokasiBerbeda}
            adaptorWilayah={adaptorWilayah}
          />

          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Segmentasi</Label>
            <Select
              value={segmentasi ?? "__none__"}
              onValueChange={(v) => setSegmentasi(!v || v === "__none__" ? null : (v as Segmentasi))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Segmentasi">
                  {() => SEGMENTASI_OPTIONS.find((s) => s.value === segmentasi)?.label ?? "Belum ditentukan"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Belum ditentukan</SelectItem>
                {SEGMENTASI_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Marketing</Label>
            <Input value="—" disabled readOnly title="Es Balok belum punya penugasan marketing" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">{isPmpakis ? "Harga Balok Kecil" : "Harga Balok Kecil / Besar"}</Label>
            <div className="flex gap-1">
              <Input type="number" min={0} placeholder="Kecil" title="Harga Balok Kecil" value={hargaKecil} onChange={(e) => setHargaKecil(e.target.value)} />
              {!isPmpakis && (
                <Input type="number" min={0} placeholder="Besar" title="Harga Balok Besar" value={hargaBesar} onChange={(e) => setHargaBesar(e.target.value)} />
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Batas Hutang</Label>
            <Input type="number" min={0} placeholder="Batas Hutang" value={maksHutang} onChange={(e) => setMaksHutang(e.target.value)} />
          </div>

          <LokasiPengirimanSection
            value={alamat}
            onChange={setAlamat}
            renderWilayahKecamatan={renderWilayahKecamatan}
            onJadikanUtama={agenId ? handleJadikanUtama : undefined}
            sedangJadikanUtama={sedangJadikan}
            adaptorWilayah={adaptorWilayah}
          />

          <div className="col-span-2 flex flex-col gap-1 sm:col-span-3">
            <Label className="text-xs text-muted-foreground">Daftar Kompetitor</Label>
            <KompetitorPicker
              bisnis="es_balok"
              opsi={kompetitorOpsi}
              onOpsiChange={setKompetitorOpsi}
              value={kompetitorIds}
              onChange={setKompetitorIds}
              onTambah={aksi.tambahKompetitor}
              disabled={memuat}
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
            <Label className="text-xs text-muted-foreground">{isPmpakis ? "Kapasitas Harian (Kecil)" : "Kapasitas Harian (Kecil / Besar)"}</Label>
            <div className="flex gap-1">
              <Input type="number" min={0} placeholder="Kecil" title="Kapasitas Balok Kecil /hari" value={kapasitasKecil} onChange={(e) => setKapasitasKecil(e.target.value)} />
              {!isPmpakis && (
                <Input type="number" min={0} placeholder="Besar" title="Kapasitas Balok Besar /hari" value={kapasitasBesar} onChange={(e) => setKapasitasBesar(e.target.value)} />
              )}
            </div>
          </div>

          {titikPeta.length > 0 && (
            <div className="col-span-full overflow-hidden rounded-lg ring-1 ring-foreground/10">
              <MitraLocationsMap key={kunciPeta} points={titikPeta} growthRows={[]} ringkas />
            </div>
          )}

          {(error || galatKonteks) && <p className="col-span-full text-xs text-destructive">{error ?? galatKonteks}</p>}
          <DialogFooter className="col-span-full">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Batal
            </Button>
            <Button type="submit" disabled={pending || memuat || sedangJadikan || !nama.trim()}>
              {pending ? "Menyimpan..." : memuat ? "Memuat..." : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
