"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Pencil, Trash2, Phone, MapPin, Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MitraRow, TermOfPaymentOption, MitraInput, PriceLevelOption } from "@/lib/queries/mitra";
import { createMitraAction, updateMitraAction, deleteMitraAction } from "@/app/(dashboard)/mitra/actions";

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

function MitraFormDialog({
  open,
  onOpenChange,
  initial,
  title,
  termOptions,
  priceLevels,
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: MitraInput;
  title: string;
  termOptions: TermOfPaymentOption[];
  priceLevels: PriceLevelOption[];
  onSubmit: (input: MitraInput) => void;
  pending: boolean;
}) {
  const [gender, setGender] = useState(initial.gender ?? "Male");
  const [termOfPaymentId, setTermOfPaymentId] = useState(initial.termOfPaymentId ?? "");
  const [priceLevel, setPriceLevel] = useState(initial.priceLevel != null ? String(initial.priceLevel) : "");

  function handleSubmit(formData: FormData) {
    onSubmit({
      name: String(formData.get("name") ?? ""),
      mobileNo: String(formData.get("mobileNo") ?? "") || null,
      address: String(formData.get("address") ?? "") || null,
      wilayah: String(formData.get("wilayah") ?? "") || null,
      kecamatan: String(formData.get("kecamatan") ?? "") || null,
      gender,
      priceLevel: priceLevel ? Number(priceLevel) : null,
      termOfPaymentId: termOfPaymentId || null,
      capacity: formData.get("capacity") ? Number(formData.get("capacity")) : null,
    });
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
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Data mitra tersimpan langsung ke database MKEsindo.</DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="name">Nama Mitra</Label>
            <Input id="name" name="name" defaultValue={initial.name} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mobileNo">Kontak</Label>
            <Input id="mobileNo" name="mobileNo" defaultValue={initial.mobileNo ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Tipe Mitra</Label>
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
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="address">Alamat</Label>
            <Input id="address" name="address" defaultValue={initial.address ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wilayah">Wilayah</Label>
            <Input id="wilayah" name="wilayah" defaultValue={initial.wilayah ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kecamatan">Kecamatan</Label>
            <Input id="kecamatan" name="kecamatan" defaultValue={initial.kecamatan ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Harga</Label>
            <Select value={priceLevel} onValueChange={(v) => setPriceLevel(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pilih harga">
                  {(v: string) => {
                    const p = priceLevels.find((pl) => String(pl.Level) === v);
                    return p ? `Harga ${formatRupiah(p.Price)}` : "Pilih harga";
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
            <Label>Tenggat Bayar</Label>
            <Select value={termOfPaymentId} onValueChange={(v) => setTermOfPaymentId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pilih tenggat">
                  {(v: string) => termOptions.find((t) => t.TermOfPaymentID === v)?.TermOfPaymentName ?? "Pilih tenggat"}
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
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="capacity">Kapasitas (kantong/hari)</Label>
            <Input id="capacity" name="capacity" type="number" defaultValue={initial.capacity ?? ""} />
          </div>
          <DialogFooter className="sm:col-span-2">
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

  function handleCreate(input: MitraInput) {
    startTransition(async () => {
      await createMitraAction(input);
      setCreating(false);
    });
  }

  function handleUpdate(input: MitraInput) {
    if (!editing) return;
    startTransition(async () => {
      await updateMitraAction(editing.BusinessPartnerID, input);
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
