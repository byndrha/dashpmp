"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Pencil, Trash2, Phone, MapPin, Package, Filter, Ban, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { Pagination } from "@/components/dashboard/pagination";
import { MitraLocationField, type MitraLocationValue } from "@/components/dashboard/mitra-location-field";
import { WilayahSelect } from "@/components/dashboard/wilayah-select";
import { KecamatanSelect } from "@/components/dashboard/kecamatan-select";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MitraRow, TermOfPaymentOption, MitraInput, PriceLevelOption } from "@/lib/queries/mitra";
import {
  createMitraAction,
  updateMitraAction,
  deleteMitraAction,
  setMitraSuspendedAction,
  setMitraLocationAction,
  setMitraCompetitorAction,
  setMitraPemilikAction,
} from "@/app/mkesindo/(dashboard)/mitra/actions";
import type { MarketingUserOption } from "@/lib/queries/marketing-wilayah";

const PEMILIK_NONE = "__none__";

const PAGE_SIZE = 12;

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

function emptyForm(): MitraInput {
  return {
    name: "",
    mobileNo: "",
    address: "",
    wilayah: "",
    kecamatan: "",
    gender: "Male",
    priceLevel: null,
    termOfPaymentId: null,
    capacity: null,
  };
}

export function rowToForm(row: MitraRow): MitraInput {
  return {
    name: row.Name ?? "",
    mobileNo: row.Kontak ?? "",
    address: row.Alamat ?? "",
    wilayah: row.Wilayah ?? "",
    kecamatan: row.Kecamatan ?? "",
    gender: row.Gender ?? "Male",
    priceLevel: row.PriceLevel,
    termOfPaymentId: row.TermOfPaymentID,
    capacity: row.Capacity,
  };
}

export function rowToLocation(row: MitraRow): MitraLocationValue | null {
  if (row.Latitude == null || row.Longitude == null) return null;
  return { latitude: row.Latitude, longitude: row.Longitude, alamat: row.GeoAlamat };
}

// Exported so MitraEditDialog (mitra-edit-dialog.tsx) can reuse this same
// form — reused anywhere "Edit Mitra" needs to open outside the Mitra
// module itself (Transaksi's Mitra DO panel), same pattern as
// MitraDetailDialog's cross-module reuse.
export function MitraFormDialog({
  open,
  onOpenChange,
  initial,
  initialLocation,
  initialKompetitor,
  title,
  termOptions,
  priceLevels,
  onSubmit,
  pending,
  error,
  canEditPemilik = false,
  pemilikOptions = { marketing: [], driver: [] },
  initialPemilik = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: MitraInput;
  initialLocation: MitraLocationValue | null;
  initialKompetitor: string | null;
  title: string;
  termOptions: TermOfPaymentOption[];
  priceLevels: PriceLevelOption[];
  onSubmit: (
    input: MitraInput,
    location: MitraLocationValue | null,
    kompetitor: string | null,
    pemilikAkunId: string | null
  ) => void;
  pending: boolean;
  error?: string | null;
  // Only ever true for an edit dialog on a session allowed to change it
  // (see MitraPage's canEditPemilik) — omitted entirely (falls back to
  // false/empty) for the create dialog and for every other reuse of this
  // component (mitra-edit-dialog.tsx, Transaksi's Mitra DO panel), none of
  // which were asked to expose this field.
  canEditPemilik?: boolean;
  pemilikOptions?: { marketing: MarketingUserOption[]; driver: MarketingUserOption[] };
  initialPemilik?: string | null;
}) {
  const [gender, setGender] = useState(initial.gender ?? "Male");
  const [pemilik, setPemilik] = useState(initialPemilik ?? PEMILIK_NONE);
  const [termOfPaymentId, setTermOfPaymentId] = useState(initial.termOfPaymentId ?? "");
  const [priceLevel, setPriceLevel] = useState(initial.priceLevel != null ? String(initial.priceLevel) : "");
  const [location, setLocation] = useState<MitraLocationValue | null>(initialLocation);
  const [address, setAddress] = useState(initial.address ?? "");
  const [wilayah, setWilayah] = useState(initial.wilayah ?? "");
  const [kecamatan, setKecamatan] = useState(initial.kecamatan ?? "");
  const [regencyCode, setRegencyCode] = useState<string | null>(null);
  // Tooltip's own uncontrolled hover/focus detection doesn't fire when its
  // trigger is a Textarea passed via `render` — controlling `open` directly
  // off the field's focus state sidesteps that and is proven reliable
  // elsewhere (filter-bar.tsx's same-date warning uses the same approach).
  const [kompetitorFocused, setKompetitorFocused] = useState(false);

  // Auto-fills Wilayah/Kecamatan/Alamat from the geser-pin location whenever
  // it resolves — Kecamatan is frequently missing from OSM's Indonesia data
  // (verified: rural areas often have no suburb/city_district tag at all),
  // so that one's left untouched rather than overwritten with a blank guess.
  // WilayahSelect resolves the matching regencyCode itself once its list has
  // loaded (via handleWilayahChange below), so Kecamatan's dropdown unlocks
  // right after.
  function handleGeocode(suggestion: { alamat: string | null; wilayah: string | null; kecamatan: string | null }) {
    if (suggestion.alamat) setAddress(suggestion.alamat);
    if (suggestion.wilayah) setWilayah(suggestion.wilayah);
    if (suggestion.kecamatan) setKecamatan(suggestion.kecamatan);
  }

  // Only clears Kecamatan when Wilayah actually changes to a different
  // region — WilayahSelect also calls this to report the regencyCode it
  // resolved for the CURRENT value (e.g. right after opening the edit
  // dialog), which must not wipe out the Kecamatan that came with `initial`.
  function handleWilayahChange(name: string, code: string | null) {
    if (name !== wilayah) setKecamatan("");
    setWilayah(name);
    setRegencyCode(code);
  }

  function handleSubmit(formData: FormData) {
    onSubmit(
      {
        name: String(formData.get("name") ?? ""),
        mobileNo: String(formData.get("mobileNo") ?? "") || null,
        address: address || null,
        wilayah: wilayah || null,
        kecamatan: kecamatan || null,
        gender,
        priceLevel: priceLevel ? Number(priceLevel) : null,
        termOfPaymentId: termOfPaymentId || null,
        capacity: formData.get("capacity") ? Number(formData.get("capacity")) : null,
      },
      location,
      String(formData.get("kompetitor") ?? "").trim() || null,
      pemilik === PEMILIK_NONE ? null : pemilik
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) {
          setGender(initial.gender ?? "Male");
          setPemilik(initialPemilik ?? PEMILIK_NONE);
          setTermOfPaymentId(initial.termOfPaymentId ?? "");
          setPriceLevel(initial.priceLevel != null ? String(initial.priceLevel) : "");
          setLocation(initialLocation);
          setAddress(initial.address ?? "");
          setWilayah(initial.wilayah ?? "");
          setKecamatan(initial.kecamatan ?? "");
          setRegencyCode(null);
        }
      }}
    >
      <DialogContent className="max-w-lg sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Data mitra tersimpan langsung ke database MKEsindo.</DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="name" className="sr-only">Nama Mitra</Label>
            <Input id="name" name="name" placeholder="Nama Mitra" defaultValue={initial.name} required />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="address" className="sr-only">Alamat</Label>
            <Input
              id="address"
              name="address"
              placeholder="Alamat"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="sr-only">Wilayah</Label>
            <WilayahSelect value={wilayah} onChange={handleWilayahChange} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="sr-only">Kecamatan</Label>
            <KecamatanSelect regencyCode={regencyCode} value={kecamatan} onChange={setKecamatan} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mobileNo" className="sr-only">Kontak</Label>
            <Input id="mobileNo" name="mobileNo" placeholder="Kontak" defaultValue={initial.mobileNo ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="capacity" className="sr-only">Kapasitas Harian</Label>
            <Input
              id="capacity"
              name="capacity"
              type="number"
              placeholder="Kapasitas Harian"
              defaultValue={initial.capacity ?? ""}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="sr-only">Tipe Mitra</Label>
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
          {canEditPemilik && (
            <div className="flex flex-col gap-1.5">
              <Label className="sr-only">Pemilik</Label>
              <Select value={pemilik} onValueChange={(v) => setPemilik(v ?? PEMILIK_NONE)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pemilik (Marketing/Driver)" />
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
            </div>
          )}
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kompetitor" className="sr-only">Daftar Kompetitor</Label>
            <Tooltip open={kompetitorFocused}>
              <TooltipTrigger
                render={
                  <Textarea
                    id="kompetitor"
                    name="kompetitor"
                    defaultValue={initialKompetitor ?? ""}
                    placeholder="Daftar Kompetitor"
                    rows={1}
                    onFocus={() => setKompetitorFocused(true)}
                    onBlur={() => setKompetitorFocused(false)}
                  />
                }
              />
              <TooltipContent>Pisahkan satu kompetitor dengan koma</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex flex-col gap-1.5 col-span-2 sm:col-span-4">
            <Label className="sr-only">Lokasi GPS</Label>
            <MitraLocationField
              value={location}
              onChange={setLocation}
              onGeocode={handleGeocode}
              wilayah={wilayah}
              kecamatan={kecamatan}
            />
          </div>
          {error && (
            <p className="col-span-2 text-xs text-destructive sm:col-span-4">{error}</p>
          )}
          <DialogFooter className="col-span-2 sm:col-span-4">
            <Button type="submit" disabled={pending} className="ml-auto">
              {pending ? "Menyimpan..." : "Simpan"}
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
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MitraRow | null>(null);
  const [pending, startTransition] = useTransition();
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  // Two independent error states, not one shared `error` — the create/edit
  // dialog and the plain list (delete/suspend) are separate surfaces, and a
  // failure in one must never bleed into the other (e.g. showing a stale
  // "gagal menyimpan lokasi" banner over the list after a failed create
  // dialog is dismissed, or a previous row's edit error appearing in a
  // freshly-opened dialog for a different row). Matches driver-manager.tsx's
  // split between its list-level `error` and its DriverFormDialog-local one.
  const [formError, setFormError] = useState<string | null>(null);
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
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleCreate(input: MitraInput, location: MitraLocationValue | null, kompetitor: string | null) {
    setFormError(null);
    startTransition(async () => {
      const createResult = await createMitraAction(input);
      if (!createResult.success) {
        setFormError(createResult.error);
        return;
      }
      if (location) {
        const locationResult = await setMitraLocationAction({ businessPartnerId: createResult.data, ...location });
        if (!locationResult.success) {
          setFormError(locationResult.error);
          return;
        }
      }
      if (kompetitor) {
        const competitorResult = await setMitraCompetitorAction({ businessPartnerId: createResult.data, kompetitor });
        if (!competitorResult.success) {
          setFormError(competitorResult.error);
          return;
        }
      }
      setCreating(false);
    });
  }

  function handleUpdate(
    input: MitraInput,
    location: MitraLocationValue | null,
    kompetitor: string | null,
    pemilikAkunId: string | null
  ) {
    if (!editing) return;
    setFormError(null);
    startTransition(async () => {
      const updateResult = await updateMitraAction(editing.BusinessPartnerID, input);
      if (!updateResult.success) {
        setFormError(updateResult.error);
        return;
      }
      if (location) {
        const locationResult = await setMitraLocationAction({ businessPartnerId: editing.BusinessPartnerID, ...location });
        if (!locationResult.success) {
          setFormError(locationResult.error);
          return;
        }
      }
      const competitorResult = await setMitraCompetitorAction({ businessPartnerId: editing.BusinessPartnerID, kompetitor });
      if (!competitorResult.success) {
        setFormError(competitorResult.error);
        return;
      }
      // Only sent when this session can actually edit it (canEditPemilik) —
      // for anyone else the field never rendered, pemilikAkunId always
      // arrives as null, and re-sending null here would silently WIPE an
      // existing override for a session that never touched the field.
      if (canEditPemilik && pemilikAkunId !== (currentPemilikMap[editing.BusinessPartnerID] ?? null)) {
        const pemilikResult = await setMitraPemilikAction(editing.BusinessPartnerID, pemilikAkunId);
        if (!pemilikResult.success) {
          setFormError(pemilikResult.error);
          return;
        }
      }
      setEditing(null);
    });
  }

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
        <Button
          onClick={() => {
            setFormError(null);
            setCreating(true);
          }}
        >
          <Plus className="size-4" />
          Tambah Mitra
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Menampilkan {pageRows.length} dari {filtered.length} mitra.
      </p>

      {listError && <p className="text-xs text-destructive">{listError}</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {pageRows.map((m) => (
          <Card key={m.BusinessPartnerID} className={cn("py-3.5", m.IsSuspended && "opacity-60")}>
            <CardContent className="flex flex-col gap-2 px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{m.Name}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                      {m.PartnerType}
                    </Badge>
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
                    onClick={() => {
                      setFormError(null);
                      setEditing(m);
                    }}
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
        {pageRows.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Tidak ada mitra ditemukan.</p>
        )}
      </div>

      <Pagination page={page} pageCount={pageCount} onChange={setPage} />

      <MitraFormDialog
        open={creating}
        onOpenChange={(open) => {
          setCreating(open);
          if (!open) setFormError(null);
        }}
        initial={emptyForm()}
        initialLocation={null}
        initialKompetitor={null}
        title="Tambah Mitra"
        termOptions={termOptions}
        priceLevels={priceLevels}
        onSubmit={handleCreate}
        pending={pending}
        error={formError}
      />
      {editing && (
        <MitraFormDialog
          open={!!editing}
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null);
              setFormError(null);
            }
          }}
          initial={rowToForm(editing)}
          initialLocation={rowToLocation(editing)}
          initialKompetitor={editing.Kompetitor}
          title={`Edit Mitra — ${editing.Name}`}
          termOptions={termOptions}
          priceLevels={priceLevels}
          onSubmit={handleUpdate}
          canEditPemilik={canEditPemilik}
          pemilikOptions={pemilikOptions}
          initialPemilik={currentPemilikMap[editing.BusinessPartnerID] ?? null}
          pending={pending}
          error={formError}
        />
      )}
    </div>
  );
}
