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
import { cn } from "@/lib/utils";
import type { MitraRow, TermOfPaymentOption, MitraInput } from "@/lib/queries/mitra";
import { createMitraAction, updateMitraAction, deleteMitraAction } from "@/app/(dashboard)/mitra/actions";

const PAGE_SIZE = 12;

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
  onSubmit,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: MitraInput;
  title: string;
  termOptions: TermOfPaymentOption[];
  onSubmit: (input: MitraInput) => void;
  pending: boolean;
}) {
  function handleSubmit(formData: FormData) {
    onSubmit({
      name: String(formData.get("name") ?? ""),
      mobileNo: String(formData.get("mobileNo") ?? "") || null,
      address: String(formData.get("address") ?? "") || null,
      wilayah: String(formData.get("wilayah") ?? "") || null,
      kecamatan: String(formData.get("kecamatan") ?? "") || null,
      gender: String(formData.get("gender") ?? "Male"),
      priceLevel: formData.get("priceLevel") ? Number(formData.get("priceLevel")) : null,
      termOfPaymentId: (formData.get("termOfPaymentId") as string) || null,
      capacity: formData.get("capacity") ? Number(formData.get("capacity")) : null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            <Label htmlFor="gender">Tipe Mitra</Label>
            <Select name="gender" defaultValue={initial.gender ?? "Male"}>
              <SelectTrigger id="gender" className="w-full">
                <SelectValue />
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
            <Label htmlFor="priceLevel">Harga (Price Level)</Label>
            <Input id="priceLevel" name="priceLevel" type="number" defaultValue={initial.priceLevel ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="termOfPaymentId">Tenggat Bayar</Label>
            <Select name="termOfPaymentId" defaultValue={initial.termOfPaymentId ?? undefined}>
              <SelectTrigger id="termOfPaymentId" className="w-full">
                <SelectValue placeholder="Pilih tenggat" />
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

export function MitraList({ mitra, termOptions }: { mitra: MitraRow[]; termOptions: TermOfPaymentOption[] }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MitraRow | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    if (!search) return mitra;
    const q = search.toLowerCase();
    return mitra.filter((m) => m.Name?.toLowerCase().includes(q));
  }, [mitra, search]);

  const [prevSearch, setPrevSearch] = useState(search);
  if (search !== prevSearch) {
    setPrevSearch(search);
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
        <Input
          placeholder="Cari nama mitra..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
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
                  Harga: <span className="text-foreground">{m.PriceLevel ?? "-"}</span>
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
          onSubmit={handleUpdate}
          pending={pending}
        />
      )}
    </div>
  );
}
