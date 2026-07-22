"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Pencil, Trash2, Phone, MapPin, Package, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
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
  setMitraLocationAction,
  setMitraCompetitorAction,
} from "@/app/(dashboard)/mitra/actions";

const PAGE_SIZE = 12;

const CAPACITY_BUCKETS = [
  { value: "all", label: "Semua Kapasitas" },
  { value: "unset", label: "Belum Diisi" },
  { value: "0-50", label: "1 - 50 kantong/hari" },
  { value: "50-100", label: "51 - 100 kantong/hari" },
  { value: "100-250", label: "101 - 250 kantong/hari" },
  { value: "250-500", label: "251 - 500 kantong/hari" },
  { value: "500-999999", label: "> 500 kantong/hari" },
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

function rowToForm(row: MitraRow): MitraInput {
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

function rowToLocation(row: MitraRow): MitraLocationValue | null {
  if (row.Latitude == null || row.Longitude == null) return null;
  return { latitude: row.Latitude, longitude: row.Longitude, alamat: row.GeoAlamat };
}

function MitraFormDialog({
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: MitraInput;
  initialLocation: MitraLocationValue | null;
  initialKompetitor: string | null;
  title: string;
  termOptions: TermOfPaymentOption[];
  priceLevels: PriceLevelOption[];
  onSubmit: (input: MitraInput, location: MitraLocationValue | null, kompetitor: string | null) => void;
  pending: boolean;
}) {
  const [gender, setGender] = useState(initial.gender ?? "Male");
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
      String(formData.get("kompetitor") ?? "").trim() || null
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) {
          setGender(initial.gender ?? "Male");
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
                <SelectValue>{(v: string) => (v === "Female" ? "Retail" : "Agen")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Male">Agen</SelectItem>
                <SelectItem value="Female">Retail</SelectItem>
              </SelectContent>
            </Select>
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
            <MitraLocationField value={location} onChange={setLocation} onGeocode={handleGeocode} />
          </div>
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

const PARTNER_TYPES = ["Agen", "Retail", "TakeAway", "Lainnya"] as const;

export function MitraList({
  mitra,
  termOptions,
  priceLevels,
}: {
  mitra: MitraRow[];
  termOptions: TermOfPaymentOption[];
  priceLevels: PriceLevelOption[];
}) {
  const [search, setSearch] = useState("");
  const [tipe, setTipe] = useState("all");
  const [wilayah, setWilayah] = useState("all");
  const [kecamatan, setKecamatan] = useState("all");
  const [harga, setHarga] = useState("all");
  const [kapasitas, setKapasitas] = useState("all");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MitraRow | null>(null);
  const [pending, startTransition] = useTransition();
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

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
      if (wilayah !== "all" && m.Wilayah !== wilayah) return false;
      if (kecamatan !== "all" && m.Kecamatan !== kecamatan) return false;
      if (harga !== "all" && String(m.PriceLevel ?? "") !== harga) return false;
      if (!matchesCapacityBucket(m.Capacity, kapasitas)) return false;
      return true;
    });
  }, [mitra, search, tipe, wilayah, kecamatan, harga, kapasitas]);

  const filterKey = `${search}|${tipe}|${wilayah}|${kecamatan}|${harga}|${kapasitas}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleCreate(input: MitraInput, location: MitraLocationValue | null, kompetitor: string | null) {
    startTransition(async () => {
      const id = await createMitraAction(input);
      if (location) {
        await setMitraLocationAction({ businessPartnerId: id, ...location });
      }
      if (kompetitor) {
        await setMitraCompetitorAction({ businessPartnerId: id, kompetitor });
      }
      setCreating(false);
    });
  }

  function handleUpdate(input: MitraInput, location: MitraLocationValue | null, kompetitor: string | null) {
    if (!editing) return;
    startTransition(async () => {
      await updateMitraAction(editing.BusinessPartnerID, input);
      if (location) {
        await setMitraLocationAction({ businessPartnerId: editing.BusinessPartnerID, ...location });
      }
      await setMitraCompetitorAction({ businessPartnerId: editing.BusinessPartnerID, kompetitor });
      setEditing(null);
    });
  }

  function handleDelete(row: MitraRow) {
    if (!confirm(`Hapus mitra "${row.Name}"? Data akan disembunyikan (bisa dipulihkan lewat database).`)) return;
    startTransition(async () => {
      await deleteMitraAction(row.BusinessPartnerID);
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
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Tipe Mitra">
                {(v: string) => (v === "all" ? "Semua Tipe" : v)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Tipe</SelectItem>
              {PARTNER_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={wilayah} onValueChange={(v) => { setWilayah(v ?? "all"); setKecamatan("all"); }}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Wilayah">
                {(v: string) => (v === "all" ? "Semua Wilayah" : v)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Wilayah</SelectItem>
              {wilayahOptions.map((w) => (
                <SelectItem key={w} value={w}>
                  {w}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={kecamatan} onValueChange={(v) => setKecamatan(v ?? "all")}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Kecamatan">
                {(v: string) => (v === "all" ? "Semua Kecamatan" : v)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Kecamatan</SelectItem>
              {kecamatanOptions.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={harga} onValueChange={(v) => setHarga(v ?? "all")}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Harga">
                {(v: string) => {
                  if (v === "all") return "Semua Harga";
                  const p = priceLevels.find((pl) => String(pl.Level) === v);
                  return p ? formatRupiah(p.Price) : "Semua Harga";
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Harga</SelectItem>
              {priceLevels.map((p) => (
                <SelectItem key={p.Level} value={String(p.Level)}>
                  {formatRupiah(p.Price)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={kapasitas} onValueChange={(v) => setKapasitas(v ?? "all")}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Kapasitas">
                {(v: string) => CAPACITY_BUCKETS.find((b) => b.value === v)?.label ?? "Semua Kapasitas"}
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
          </div>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          Tambah Mitra
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Menampilkan {pageRows.length} dari {filtered.length} mitra.
      </p>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {pageRows.map((m) => (
          <Card key={m.BusinessPartnerID} className="py-3.5">
            <CardContent className="flex flex-col gap-2 px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{m.Name}</p>
                  <Badge variant="outline" className="mt-0.5 h-5 px-1.5 text-[10px]">
                    {m.PartnerType}
                  </Badge>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditing(m)}>
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
        onOpenChange={setCreating}
        initial={emptyForm()}
        initialLocation={null}
        initialKompetitor={null}
        title="Tambah Mitra"
        termOptions={termOptions}
        priceLevels={priceLevels}
        onSubmit={handleCreate}
        pending={pending}
      />
      {editing && (
        <MitraFormDialog
          open={!!editing}
          onOpenChange={(open) => !open && setEditing(null)}
          initial={rowToForm(editing)}
          initialLocation={rowToLocation(editing)}
          initialKompetitor={editing.Kompetitor}
          title={`Edit Mitra — ${editing.Name}`}
          termOptions={termOptions}
          priceLevels={priceLevels}
          onSubmit={handleUpdate}
          pending={pending}
        />
      )}
    </div>
  );
}
