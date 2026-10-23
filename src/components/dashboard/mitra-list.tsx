"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Phone, MapPin, Package, Filter, Ban, RotateCcw, LayoutGrid, List } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { MitraIdentitasSection } from "@/components/dashboard/mitra-form/mitra-identitas-section";
import {
  AlamatBaris,
  LokasiPengirimanSection,
  type RenderWilayahKecamatan,
} from "@/components/dashboard/mitra-form/lokasi-pengiriman-section";
import { KompetitorPicker } from "@/components/dashboard/mitra-form/kompetitor-picker";
import { WilayahKecamatanField } from "@/components/dashboard/mitra-form/wilayah-kecamatan-field";
import type { BerkasIdentitasNilai } from "@/components/dashboard/mitra-form/berkas-identitas-field";
import type { MitraLocationPoint } from "@/components/dashboard/mitra-locations-map";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PESAN_SIMPAN_SEBAGIAN, type LokasiTambahanInput, type MitraAlamatForm } from "@/lib/mitra-lokasi";
import { mitraKeAlamatForm } from "@/lib/mitra-form";
import type { MitraRow, TermOfPaymentOption, PriceLevelOption } from "@/lib/queries/mitra";
import type { Kompetitor } from "@/lib/queries/kompetitor";
import {
  deleteMitraAction,
  setMitraSuspendedAction,
  setMitraPemilikAction,
  simpanMitraLengkapAction,
  jadikanLokasiUtamaAction,
  tambahKompetitorAction,
  getMitraFormKonteksAction,
  getMitraDetailAction,
  type MitraLengkapInput,
} from "@/app/mkesindo/(dashboard)/mitra/actions";
import type { MarketingUserOption } from "@/lib/queries/marketing-wilayah";

// Leaflet menyentuh global browser saat impor — sama dengan mitra-locations-panel.tsx.
const MitraLocationsMap = dynamic(
  () => import("@/components/dashboard/mitra-locations-map").then((m) => m.MitraLocationsMap),
  { ssr: false, loading: () => <Skeleton className="h-[220px] w-full rounded-lg" /> }
);

const PEMILIK_NONE = "__none__";

// Shared by both the initial page load and every subsequent auto-load
// triggered by the scroll sentinel — see the IntersectionObserver effect
// in MitraList below.
const BATCH_SIZE = 12;

// Per-browser only (not synced anywhere) — remembers grid vs baris across
// visits/reloads for this viewer. Confirmed with user 2026-09-24.
const VIEW_MODE_STORAGE_KEY = "mitra-view-mode";
type ViewMode = "grid" | "baris";

const CAPACITY_BUCKETS = [
  { value: "all", label: "Kapasitas" },
  { value: "unset", label: "Belum Diisi" },
  { value: "0-50", label: "1 - 50 /hari" },
  { value: "50-100", label: "51 - 100 /hari" },
  { value: "100-250", label: "101 - 250 /hari" },
  { value: "250-500", label: "251 - 500 /hari" },
  { value: "500-999999", label: "> 500 /hari" },
] as const;

function matchesCapacityBucket(capacity: number | null, bucket: string): boolean {
  if (bucket === "all") return true;
  if (bucket === "unset") return capacity == null;
  if (capacity == null) return false;
  const [min, max] = bucket.split("-").map(Number);
  return capacity > min && capacity <= max;
}

// Titik peta satu mitra: utama + lokasi tambahan yang punya koordinat.
export function titikLokasiMitra(nama: string, bpId: string, alamat: MitraAlamatForm): MitraLocationPoint[] {
  const utama = alamat.lokasiBerbeda ? alamat.lokasiUtama : alamat.alamatMitra;
  const hasil: MitraLocationPoint[] = [];
  if (utama.latitude != null && utama.longitude != null) {
    hasil.push({
      Key: `${bpId}:utama`,
      BusinessPartnerID: bpId,
      Name: nama,
      Label: "Utama",
      Wilayah: utama.wilayah,
      Latitude: utama.latitude,
      Longitude: utama.longitude,
    });
  }
  if (alamat.lokasiBerbeda) {
    alamat.lokasiTambahan.forEach((l, i) => {
      if (l.latitude == null || l.longitude == null) return;
      hasil.push({
        Key: `${bpId}:${l.lokasiPengirimanId ?? `baru-${i}`}`,
        BusinessPartnerID: bpId,
        Name: nama,
        Label: l.label?.trim() || `Lokasi ${i + 2}`,
        Wilayah: l.wilayah,
        Latitude: l.latitude,
        Longitude: l.longitude,
      });
    });
  }
  return hasil;
}

const renderWilayahKecamatan: RenderWilayahKecamatan = (p) => <WilayahKecamatanField {...p} />;

const BERKAS_KOSONG: BerkasIdentitasNilai = { ada: false, namaFile: null, mime: null };

// Form Tambah/Edit Mitra Es Kristal (spec §2). Diekspor agar MitraEditDialog
// (mitra-edit-dialog.tsx, Transaksi "Mitra DO") memakai form yang sama.
// Dialog ini memuat sendiri konteks yang tidak ada di MitraRow (identitas,
// kompetitor, hak akses) lewat getMitraFormKonteksAction saat dipasang —
// NIK tidak pernah lewat props halaman — lalu menyimpan lewat
// simpanMitraLengkapAction (+ setMitraPemilikAction bila berubah). Induk
// memasang komponen ini hanya selagi dialog terbuka (state selalu segar).
export function MitraFormDialog({
  open,
  onOpenChange,
  mitra,
  title,
  termOptions,
  priceLevels,
  onSelesai,
  canEditPemilik = false,
  pemilikOptions = { marketing: [], driver: [] },
  initialPemilik = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // null = Tambah Mitra.
  mitra: MitraRow | null;
  title: string;
  termOptions: TermOfPaymentOption[];
  priceLevels: PriceLevelOption[];
  // Dipanggil setelah simpan selesai (induk menutup dialog / refresh).
  onSelesai: () => void;
  // Only ever true for an edit dialog on a session allowed to change it
  // (see MitraPage's canEditPemilik) — omitted for the create dialog and
  // for every other reuse of this component.
  canEditPemilik?: boolean;
  pemilikOptions?: { marketing: MarketingUserOption[]; driver: MarketingUserOption[] };
  initialPemilik?: string | null;
}) {
  const bpId = mitra?.BusinessPartnerID ?? null;
  const [nama, setNama] = useState(mitra?.Name ?? "");
  const [penanggungJawab, setPenanggungJawab] = useState("");
  const [nik, setNik] = useState("");
  const [berkasNik, setBerkasNik] = useState<BerkasIdentitasNilai>(BERKAS_KOSONG);
  const [berkasSk, setBerkasSk] = useState<BerkasIdentitasNilai>(BERKAS_KOSONG);
  const [alamat, setAlamat] = useState<MitraAlamatForm>(() => mitraKeAlamatForm(mitra));
  // Naik setiap isian alamat diganti data server → baris alamat/lokasi
  // dipasang ulang (peta yang terbuka tertutup).
  const [versiAlamat, setVersiAlamat] = useState(0);
  const [gender, setGender] = useState(mitra?.Gender ?? "Male");
  const [pemilik, setPemilik] = useState(initialPemilik ?? PEMILIK_NONE);
  const [priceLevel, setPriceLevel] = useState(mitra?.PriceLevel != null ? String(mitra.PriceLevel) : "");
  const [termOfPaymentId, setTermOfPaymentId] = useState(mitra?.TermOfPaymentID ?? "");
  const [capacity, setCapacity] = useState(mitra?.Capacity != null ? String(mitra.Capacity) : "");
  const [marketingNama, setMarketingNama] = useState(mitra?.MarketingNama ?? null);
  const [kompetitorOpsi, setKompetitorOpsi] = useState<Kompetitor[]>([]);
  const [kompetitorIds, setKompetitorIds] = useState<number[]>([]);
  const [konteks, setKonteks] = useState<{ akses: { lihat: boolean; ubah: boolean }; perusahaanKode: string } | null>(null);
  const [galatKonteks, setGalatKonteks] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [sedangJadikan, startJadikan] = useTransition();

  // Muat identitas + kompetitor + hak akses + alamat/lokasi SEGAR saat
  // dialog dipasang. Isian identitas & alamat dikunci (dan Simpan nonaktif)
  // sampai selesai, supaya nilai kosong/basi tidak tersimpan menimpa data
  // lama (props `mitra` bisa sudah berjam-jam).
  useEffect(() => {
    let batal = false;
    getMitraFormKonteksAction(bpId, true).then((r) => {
      if (batal) return;
      if (!r.success) {
        setGalatKonteks(r.error);
        return;
      }
      const d = r.data;
      if (d.alamat) {
        setAlamat(d.alamat);
        setVersiAlamat((v) => v + 1);
      }
      setKonteks({ akses: d.akses, perusahaanKode: d.perusahaanKode });
      setKompetitorOpsi(d.kompetitorOpsi);
      setKompetitorIds(d.kompetitorDipilih);
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
  }, [bpId]);

  const memuat = konteks === null;
  const akses = konteks?.akses ?? { lihat: false, ubah: false };

  function handleSubmit() {
    if (memuat) return;
    setError(null);
    const input: MitraLengkapInput = {
      ...alamat,
      mitra: {
        name: nama,
        gender,
        priceLevel: priceLevel ? Number(priceLevel) : null,
        termOfPaymentId: termOfPaymentId || null,
        capacity: capacity !== "" ? Number(capacity) : null,
      },
      namaPenanggungJawab: penanggungJawab.trim() || null,
      kompetitorIds,
      // NIK hanya dikirim bila boleh mengubah (server juga membuangnya).
      ...(akses.ubah ? { nik: nik.trim() || null } : {}),
    };
    startTransition(async () => {
      const r = await simpanMitraLengkapAction(bpId, input);
      if (!r.success) {
        if (!bpId && r.error === PESAN_SIMPAN_SEBAGIAN) {
          // Mitra baru SUDAH dibuat — tutup form agar "simpan ulang" tidak
          // membuat mitra ganda; lanjutkan lewat Edit.
          toast.warning("Mitra baru tersimpan, tetapi identitas/kompetitor gagal disimpan. Buka Edit mitra ini lalu simpan ulang.");
          onSelesai();
          return;
        }
        setError(r.error);
        return;
      }
      // Only sent when this session can actually edit it (canEditPemilik) —
      // for anyone else the field never rendered, and re-sending null here
      // would silently WIPE an existing override.
      if (bpId && canEditPemilik) {
        const pemilikAkunId = pemilik === PEMILIK_NONE ? null : pemilik;
        if (pemilikAkunId !== (initialPemilik ?? null)) {
          const p = await setMitraPemilikAction(bpId, pemilikAkunId);
          if (!p.success) {
            setError(p.error);
            return;
          }
        }
      }
      onSelesai();
    });
  }

  function handleJadikanUtama(l: LokasiTambahanInput) {
    if (!bpId || l.lokasiPengirimanId == null) return;
    const lokasiId = l.lokasiPengirimanId;
    const wilayahLama = alamat.lokasiUtama.wilayah?.trim() || null;
    const wilayahBaru = l.wilayah?.trim() || null;
    const beda = (wilayahLama ?? "").toLowerCase() !== (wilayahBaru ?? "").toLowerCase();
    const namaLokasi = l.label?.trim() || "lokasi ini";
    const pesan =
      `Jadikan ${namaLokasi} sebagai Lokasi Utama? Lokasi Utama saat ini akan menjadi lokasi tambahan.\n` +
      `Daftar lokasi di form ini akan dimuat ulang dari data tersimpan (perubahan lokasi yang belum disimpan hilang).` +
      (beda
        ? `\n\nPERINGATAN: Wilayah utama berubah dari "${wilayahLama ?? "-"}" ke "${wilayahBaru ?? "-"}". ` +
          `Marketing penanggung jawab dan laporan per wilayah untuk mitra ini ikut pindah.`
        : "");
    if (!confirm(pesan)) return;
    setError(null);
    startJadikan(async () => {
      const r = await jadikanLokasiUtamaAction(bpId, lokasiId);
      if (!r.success) {
        setError(r.error);
        return;
      }
      const d = await getMitraDetailAction(bpId);
      if (d.success && d.data) {
        const segar = mitraKeAlamatForm(d.data);
        // Alamat mitra (Identitas) tidak disentuh Jadikan Utama — pertahankan isian.
        setAlamat((prev) => ({ ...segar, alamatMitra: prev.alamatMitra }));
        setVersiAlamat((v) => v + 1);
        setMarketingNama(d.data.MarketingNama);
      }
      if ((r.data.wilayahLama ?? "") !== (r.data.wilayahBaru ?? "")) {
        toast.warning(
          `Lokasi utama diganti. Wilayah pindah dari ${r.data.wilayahLama ?? "-"} ke ${r.data.wilayahBaru ?? "-"} — marketing penanggung jawab & laporan wilayah ikut pindah.`
        );
      } else {
        toast.success("Lokasi utama diganti.");
      }
    });
  }

  const titikPeta = useMemo(() => titikLokasiMitra(nama || "Mitra", bpId ?? "baru", alamat), [nama, bpId, alamat]);
  // Peta dipasang ulang saat titik berubah agar tampilan menyesuaikan semua pin.
  const kunciPeta = titikPeta.map((t) => `${t.Key}@${t.Latitude},${t.Longitude}`).join("|");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Data mitra tersimpan langsung ke database perusahaan.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          <h4 className="col-span-full text-sm font-medium">Identitas</h4>
          <MitraIdentitasSection
            nama={nama}
            onNamaChange={setNama}
            namaPenanggungJawab={penanggungJawab}
            onNamaPenanggungJawabChange={setPenanggungJawab}
            nik={nik}
            onNikChange={setNik}
            tanggalPendaftaran={mitra?.JoinDate ?? null}
            bolehLihat={akses.lihat}
            bolehUbah={akses.ubah}
            memuat={memuat}
            berkas={{
              kode: konteks?.perusahaanKode ?? "",
              sumber: "utama",
              partnerId: bpId,
              nik: berkasNik,
              sk: berkasSk,
              onBerubah: (jenis, v) => (jenis === "nik" ? setBerkasNik(v) : setBerkasSk(v)),
            }}
          />
          <AlamatBaris
            key={`alamat-${versiAlamat}`}
            value={alamat.alamatMitra}
            onChange={(fn) => setAlamat((a) => ({ ...a, alamatMitra: fn(a.alamatMitra) }))}
            renderWilayahKecamatan={renderWilayahKecamatan}
            tampilkanPin={!alamat.lokasiBerbeda}
            disabled={memuat}
          />

          <div className="flex flex-col gap-1.5">
            <Label className="sr-only">Segmentasi</Label>
            <Select value={gender} onValueChange={(v) => setGender(v ?? "Male")}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => (v === "Female" ? "Outlet" : v === "Other" ? "RPA" : "Agen")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Male">Agen</SelectItem>
                <SelectItem value="Female">Outlet</SelectItem>
                <SelectItem value="Other">RPA</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="sr-only">Marketing</Label>
            {canEditPemilik ? (
              <Select value={pemilik} onValueChange={(v) => setPemilik(v ?? PEMILIK_NONE)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Marketing">
                    {(v: string) =>
                      v === PEMILIK_NONE
                        ? "Ikuti Wilayah"
                        : ([...pemilikOptions.marketing, ...pemilikOptions.driver].find((o) => o.UserID === v)?.Nama ?? "Marketing")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PEMILIK_NONE}>Ikuti Wilayah (tidak ditentukan)</SelectItem>
                  {pemilikOptions.marketing.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Marketing</SelectLabel>
                      {pemilikOptions.marketing.map((m) => (
                        <SelectItem key={m.UserID} value={m.UserID}>
                          {m.Nama}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {pemilikOptions.driver.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Driver</SelectLabel>
                      {pemilikOptions.driver.map((d) => (
                        <SelectItem key={d.UserID} value={d.UserID}>
                          {d.Nama}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={mitra ? (marketingNama ?? "Marketing belum ditentukan") : "Marketing mengikuti Wilayah"}
                disabled
                readOnly
                title="Marketing penanggung jawab mengikuti Wilayah/Kecamatan lokasi utama"
              />
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="sr-only">Harga</Label>
            <Select value={priceLevel} onValueChange={(v) => setPriceLevel(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Harga">
                  {(v: string) => {
                    const p = priceLevels.find((pl) => String(pl.Level) === v);
                    return p ? `Harga ${formatRupiah(p.Price)}` : "Harga";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {priceLevels.map((p) => (
                  <SelectItem key={p.Level} value={String(p.Level)}>
                    Harga {formatRupiah(p.Price)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="sr-only">Tenggat Bayar</Label>
            <Select value={termOfPaymentId} onValueChange={(v) => setTermOfPaymentId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Tenggat Bayar">
                  {(v: string) => termOptions.find((t) => t.TermOfPaymentID === v)?.TermOfPaymentName ?? "Tenggat Bayar"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {termOptions.map((t) => (
                  <SelectItem key={t.TermOfPaymentID} value={t.TermOfPaymentID}>
                    {t.TermOfPaymentName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <LokasiPengirimanSection
            key={`lokasi-${versiAlamat}`}
            value={alamat}
            onChange={setAlamat}
            renderWilayahKecamatan={renderWilayahKecamatan}
            onJadikanUtama={bpId ? handleJadikanUtama : undefined}
            sedangJadikanUtama={sedangJadikan}
            disabled={memuat}
          />

          <div className="col-span-2 flex flex-col gap-1 sm:col-span-3">
            <Label className="text-xs text-muted-foreground">Daftar Kompetitor</Label>
            <KompetitorPicker
              bisnis="es_kristal"
              opsi={kompetitorOpsi}
              onOpsiChange={setKompetitorOpsi}
              value={kompetitorIds}
              onChange={setKompetitorIds}
              onTambah={tambahKompetitorAction}
              disabled={memuat}
            />
            {mitra?.Kompetitor && kompetitorIds.length === 0 && (
              <p className="text-[11px] text-muted-foreground">Catatan lama: {mitra.Kompetitor}</p>
            )}
          </div>
          <div className="col-span-2 flex flex-col gap-1 sm:col-span-1">
            <Label htmlFor="mitra-capacity" className="text-xs text-muted-foreground">
              Kapasitas Harian
            </Label>
            <Input
              id="mitra-capacity"
              type="number"
              placeholder="Kapasitas Harian"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </div>

          {titikPeta.length > 0 && (
            <div className="col-span-full overflow-hidden rounded-lg ring-1 ring-foreground/10">
              <MitraLocationsMap key={kunciPeta} points={titikPeta} growthRows={[]} ringkas />
            </div>
          )}

          {(error || galatKonteks) && <p className="col-span-full text-xs text-destructive">{error ?? galatKonteks}</p>}
          <DialogFooter className="col-span-full">
            <Button type="submit" disabled={pending || memuat || sedangJadikan} className="ml-auto">
              {pending ? "Menyimpan..." : memuat ? "Memuat..." : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const PARTNER_TYPES = ["Agen", "Outlet", "RPA", "TakeAway", "Lainnya"] as const;
const WILAYAH_UNKNOWN = "__unknown__";
const PIN_OPTIONS = [
  { value: "all", label: "Pin" },
  { value: "yes", label: "Sudah Pin" },
  { value: "no", label: "Belum Pin" },
] as const;
const STATUS_OPTIONS = [
  { value: "all", label: "Status" },
  { value: "active", label: "Aktif" },
  { value: "suspended", label: "Nonaktif" },
] as const;

export function MitraList({
  mitra,
  termOptions,
  priceLevels,
  canEditPemilik = false,
  pemilikOptions = { marketing: [], driver: [] },
  currentPemilikMap = {},
}: {
  mitra: MitraRow[];
  termOptions: TermOfPaymentOption[];
  priceLevels: PriceLevelOption[];
  canEditPemilik?: boolean;
  pemilikOptions?: { marketing: MarketingUserOption[]; driver: MarketingUserOption[] };
  currentPemilikMap?: Record<string, string>;
}) {
  const [search, setSearch] = useState("");
  const [tipe, setTipe] = useState("all");
  const [wilayah, setWilayah] = useState("all");
  const [kecamatan, setKecamatan] = useState("all");
  const [harga, setHarga] = useState("all");
  const [kapasitas, setKapasitas] = useState("all");
  const [pin, setPin] = useState("all");
  const [status, setStatus] = useState("all");
  const [visibleCount, setVisibleCount] = useState(BATCH_SIZE);
  // Starts at "grid" for both SSR and the first client render (avoids a
  // hydration mismatch), then reads the stored preference once on mount —
  // deliberately NOT mirrored by a reactive write-effect (that races with
  // this same read-on-mount effect: the write-effect would fire during the
  // same mount commit with the stale "grid" closure and clobber whatever
  // was just read from storage). setViewModePersisted below is the only
  // place that writes, and only in response to an actual user click.
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  useEffect(() => {
    const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (stored === "grid" || stored === "baris") setViewMode(stored);
  }, []);
  function setViewModePersisted(mode: ViewMode) {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  }
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MitraRow | null>(null);
  const [, startTransition] = useTransition();
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  // Galat daftar (hapus/nonaktifkan) terpisah dari galat form — form
  // menyimpan galatnya sendiri di MitraFormDialog, jadi tidak pernah bocor
  // ke daftar atau ke dialog mitra lain.
  const [listError, setListError] = useState<string | null>(null);

  const priceByLevel = useMemo(() => new Map(priceLevels.map((p) => [p.Level, p.Price])), [priceLevels]);

  const wilayahOptions = useMemo(
    () => [...new Set(mitra.map((m) => m.Wilayah).filter((w): w is string => !!w))].sort(),
    [mitra]
  );
  const kecamatanOptions = useMemo(() => {
    const pool = wilayah === "all" ? mitra : mitra.filter((m) => m.Wilayah === wilayah);
    return [...new Set(pool.map((m) => m.Kecamatan).filter((k): k is string => !!k))].sort();
  }, [mitra, wilayah]);

  const filtered = useMemo(() => {
    return mitra.filter((m) => {
      if (search && !m.Name?.toLowerCase().includes(search.toLowerCase())) return false;
      if (tipe !== "all" && m.PartnerType !== tipe) return false;
      if (wilayah === WILAYAH_UNKNOWN) {
        if (m.Wilayah) return false;
      } else if (wilayah !== "all" && m.Wilayah !== wilayah) return false;
      if (kecamatan !== "all" && m.Kecamatan !== kecamatan) return false;
      if (harga !== "all" && String(m.PriceLevel ?? "") !== harga) return false;
      if (!matchesCapacityBucket(m.Capacity, kapasitas)) return false;
      const hasPin = m.Latitude != null && m.Longitude != null;
      if (pin === "yes" && !hasPin) return false;
      if (pin === "no" && hasPin) return false;
      if (status === "active" && m.IsSuspended) return false;
      if (status === "suspended" && !m.IsSuspended) return false;
      return true;
    });
  }, [mitra, search, tipe, wilayah, kecamatan, harga, kapasitas, pin, status]);

  const filterKey = `${search}|${tipe}|${wilayah}|${kecamatan}|${harga}|${kapasitas}|${pin}|${status}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setVisibleCount(BATCH_SIZE);
  }

  const visibleRows = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  // Lazy-load sentinel: an empty div at the bottom of the list. Once it
  // scrolls into view, grow visibleCount by one more batch — repeats until
  // every filtered mitra is shown. rootMargin gives it a head start so the
  // next batch is already loading before the user hits the literal bottom.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(c + BATCH_SIZE, filtered.length));
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [filtered.length]);

  // Background auto-load: independent of the scroll sentinel above — keeps
  // growing visibleCount on a timer even while the user isn't scrolling, so
  // more of the (already client-side) filtered list is ready to render the
  // moment they do scroll. Confirmed with user 2026-09-24. Stops scheduling
  // once everything filtered is already visible (hasMore false); restarts
  // automatically whenever a filter change makes hasMore true again, since
  // the effect re-runs on every hasMore/filtered.length change.
  useEffect(() => {
    if (!hasMore) return;
    const timer = setInterval(() => {
      setVisibleCount((c) => Math.min(c + BATCH_SIZE, filtered.length));
    }, 4000);
    return () => clearInterval(timer);
  }, [hasMore, filtered.length]);

  function handleDelete(row: MitraRow) {
    if (!confirm(`Hapus mitra "${row.Name}"? Data akan disembunyikan (bisa dipulihkan lewat database).`)) return;
    setListError(null);
    startTransition(async () => {
      const result = await deleteMitraAction(row.BusinessPartnerID);
      if (!result.success) setListError(result.error);
    });
  }

  function handleToggleSuspend(row: MitraRow) {
    const next = !row.IsSuspended;
    if (
      next &&
      !confirm(`Nonaktifkan mitra "${row.Name}"? Mitra ini tidak akan bisa dipilih untuk Pemesanan baru sampai diaktifkan kembali.`)
    )
      return;
    setListError(null);
    startTransition(async () => {
      const result = await setMitraSuspendedAction(row.BusinessPartnerID, next);
      if (!result.success) setListError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="sm:hidden"
            onClick={() => setMobileFilterOpen((v) => !v)}
          >
            <Filter className="size-4" />
            Filter
          </Button>
          <div className={cn("flex-wrap items-center gap-2 sm:flex", mobileFilterOpen ? "flex" : "hidden")}>
          <Input
            placeholder="Cari nama mitra..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
          <Select value={tipe} onValueChange={(v) => setTipe(v ?? "all")}>
            <SelectTrigger className="w-28">
              <SelectValue placeholder="Tipe Mitra">
                {(v: string) => (v === "all" ? "Tipe" : v)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tipe</SelectItem>
              {PARTNER_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={wilayah} onValueChange={(v) => { setWilayah(v ?? "all"); setKecamatan("all"); }}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Wilayah">
                {(v: string) => (v === "all" ? "Wilayah" : v === WILAYAH_UNKNOWN ? "Tidak Diketahui" : v)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Wilayah</SelectItem>
              <SelectItem value={WILAYAH_UNKNOWN}>Tidak Diketahui</SelectItem>
              {wilayahOptions.map((w) => (
                <SelectItem key={w} value={w}>
                  {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={kecamatan} onValueChange={(v) => setKecamatan(v ?? "all")}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Kecamatan">
                {(v: string) => (v === "all" ? "Kecamatan" : v)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Kecamatan</SelectItem>
              {kecamatanOptions.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={harga} onValueChange={(v) => setHarga(v ?? "all")}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Harga">
                {(v: string) => {
                  if (v === "all") return "Harga";
                  const p = priceLevels.find((pl) => String(pl.Level) === v);
                  return p ? formatRupiah(p.Price) : "Harga";
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Harga</SelectItem>
              {priceLevels.map((p) => (
                <SelectItem key={p.Level} value={String(p.Level)}>
                  {formatRupiah(p.Price)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={kapasitas} onValueChange={(v) => setKapasitas(v ?? "all")}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Kapasitas">
                {(v: string) => CAPACITY_BUCKETS.find((b) => b.value === v)?.label ?? "Kapasitas"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CAPACITY_BUCKETS.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={pin} onValueChange={(v) => setPin(v ?? "all")}>
            <SelectTrigger className="w-28">
              <SelectValue placeholder="Pin">
                {(v: string) => PIN_OPTIONS.find((p) => p.value === v)?.label ?? "Pin"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PIN_OPTIONS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v ?? "all")}>
            <SelectTrigger className="w-28">
              <SelectValue placeholder="Status">
                {(v: string) => STATUS_OPTIONS.find((s) => s.value === v)?.label ?? "Status"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-md border p-0.5">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              className="size-7"
              title="Tampilan grid"
              onClick={() => setViewModePersisted("grid")}
            >
              <LayoutGrid className="size-3.5" />
            </Button>
            <Button
              variant={viewMode === "baris" ? "secondary" : "ghost"}
              size="icon"
              className="size-7"
              title="Tampilan baris"
              onClick={() => setViewModePersisted("baris")}
            >
              <List className="size-3.5" />
            </Button>
          </div>
          <Button
            onClick={() => setCreating(true)}
          >
            <Plus className="size-4" />
            Tambah Mitra
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Menampilkan {visibleRows.length} dari {filtered.length} mitra.
      </p>

      {listError && <p className="text-xs text-destructive">{listError}</p>}

      {viewMode === "grid" ? (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visibleRows.map((m) => (
          <Card key={m.BusinessPartnerID} className={cn("py-3.5", m.IsSuspended && "opacity-60")}>
            <CardContent className="flex flex-col gap-2 px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{m.Name}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                      {m.PartnerType}
                    </Badge>
                    {m.LokasiTambahan.length > 0 && (
                      <Badge variant="outline" className="h-5 px-1.5 text-[10px]" title="Jumlah lokasi pengiriman">
                        {m.LokasiTambahan.length + 1} lokasi
                      </Badge>
                    )}
                    <Badge variant={m.MarketingNama ? "secondary" : "outline"} className="h-5 px-1.5 text-[10px]">
                      {m.MarketingNama ?? "Belum Ditentukan"}
                    </Badge>
                    {m.IsSuspended && (
                      <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                        Nonaktif
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title={m.IsSuspended ? "Aktifkan" : "Nonaktifkan"}
                    onClick={() => handleToggleSuspend(m)}
                  >
                    {m.IsSuspended ? (
                      <RotateCcw className="size-3.5" />
                    ) : (
                      <Ban className="size-3.5 text-muted-foreground" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => setEditing(m)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => handleDelete(m)}>
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3" /> {m.Kontak || "-"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-3" />
                  {m.Wilayah || "-"}
                  {m.Kecamatan ? ` | ${m.Kecamatan}` : ""}
                </span>
                {m.Alamat && <span className="truncate pl-[18px]">{m.Alamat}</span>}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2 text-xs">
                <span className="text-muted-foreground">
                  Harga:{" "}
                  <span className="text-foreground">
                    {m.PriceLevel != null && priceByLevel.has(m.PriceLevel)
                      ? formatRupiah(priceByLevel.get(m.PriceLevel)!)
                      : "-"}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  Tenggat: <span className="text-foreground">{m.TermOfPaymentName ?? "-"}</span>
                </span>
                <span className={cn("inline-flex items-center gap-1", m.Capacity == null && "text-muted-foreground")}>
                  <Package className="size-3" />
                  {m.Capacity != null ? `${m.Capacity.toLocaleString("id-ID")} kantong/hari` : "Kapasitas belum diisi"}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
        {visibleRows.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Tidak ada mitra ditemukan.</p>
        )}
      </div>
      ) : (
      <div className="flex flex-col divide-y rounded-lg border">
        {visibleRows.map((m) => (
          <div
            key={m.BusinessPartnerID}
            className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-sm", m.IsSuspended && "opacity-60")}
          >
            <div className="min-w-40 flex-1">
              <p className="truncate font-medium">{m.Name}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  {m.PartnerType}
                </Badge>
                {m.LokasiTambahan.length > 0 && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]" title="Jumlah lokasi pengiriman">
                    {m.LokasiTambahan.length + 1} lokasi
                  </Badge>
                )}
                <Badge variant={m.MarketingNama ? "secondary" : "outline"} className="h-5 px-1.5 text-[10px]">
                  {m.MarketingNama ?? "Belum Ditentukan"}
                </Badge>
                {m.IsSuspended && (
                  <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                    Nonaktif
                  </Badge>
                )}
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Phone className="size-3" /> {m.Kontak || "-"}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="size-3" />
              {m.Wilayah || "-"}
              {m.Kecamatan ? ` | ${m.Kecamatan}` : ""}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              Harga:{" "}
              <span className="text-foreground">
                {m.PriceLevel != null && priceByLevel.has(m.PriceLevel)
                  ? formatRupiah(priceByLevel.get(m.PriceLevel)!)
                  : "-"}
              </span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              Tenggat: <span className="text-foreground">{m.TermOfPaymentName ?? "-"}</span>
            </span>
            <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs", m.Capacity == null && "text-muted-foreground")}>
              <Package className="size-3" />
              {m.Capacity != null ? `${m.Capacity.toLocaleString("id-ID")} kantong/hari` : "Kapasitas belum diisi"}
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                title={m.IsSuspended ? "Aktifkan" : "Nonaktifkan"}
                onClick={() => handleToggleSuspend(m)}
              >
                {m.IsSuspended ? (
                  <RotateCcw className="size-3.5" />
                ) : (
                  <Ban className="size-3.5 text-muted-foreground" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setEditing(m)}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => handleDelete(m)}>
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            </div>
          </div>
        ))}
        {visibleRows.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada mitra ditemukan.</p>
        )}
      </div>
      )}

      <div ref={sentinelRef} className="h-1" />
      {hasMore && <p className="py-2 text-center text-xs text-muted-foreground">Memuat lagi...</p>}

      {creating && (
        <MitraFormDialog
          open
          onOpenChange={(open) => !open && setCreating(false)}
          mitra={null}
          title="Tambah Mitra"
          termOptions={termOptions}
          priceLevels={priceLevels}
          onSelesai={() => setCreating(false)}
        />
      )}
      {editing && (
        <MitraFormDialog
          key={editing.BusinessPartnerID}
          open
          onOpenChange={(open) => !open && setEditing(null)}
          mitra={editing}
          title={`Edit Mitra — ${editing.Name}`}
          termOptions={termOptions}
          priceLevels={priceLevels}
          onSelesai={() => setEditing(null)}
          canEditPemilik={canEditPemilik}
          pemilikOptions={pemilikOptions}
          initialPemilik={currentPemilikMap[editing.BusinessPartnerID] ?? null}
        />
      )}
    </div>
  );
}
