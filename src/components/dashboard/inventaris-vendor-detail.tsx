// src/components/dashboard/inventaris-vendor-detail.tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, Star, Pencil } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import type { VendorRow, VendorLokasiRow, VendorPicRow, VendorPicInternalRow } from "@/lib/queries/inventaris-vendor";
import type { VendorProdukRow, VendorKategoriRow } from "@/lib/queries/inventaris-produk";
import type { VendorPengirimanRow, VendorRanking } from "@/lib/queries/inventaris-pengiriman";
import type { PerusahaanRow } from "@/lib/queries/perusahaan";
import type { AkunRow } from "@/lib/queries/akun";
import {
  addVendorLokasiAction, deleteVendorLokasiAction,
  addVendorPicAction, deleteVendorPicAction,
  addVendorPicInternalAction, removeVendorPicInternalAction,
  addVendorProdukAction, deleteVendorProdukAction,
  addVendorPengirimanAction, deleteVendorPengirimanAction,
  linkVendorToPerusahaanAction,
  listVendorKategoriAction, createVendorKategoriAction, renameVendorKategoriAction, deleteVendorKategoriAction,
} from "@/app/grup/inventaris/actions";
import { InventarisVendorFormDialog } from "@/components/dashboard/inventaris-vendor-form-dialog";

interface PerusahaanLink {
  id: number;
  perusahaanId: number;
  perusahaanNama: string;
  businessPartnerId: string;
  termOfPaymentId: string;
  isSuspended: boolean;
}

type Tab = "lokasi" | "pic" | "produk" | "pengiriman" | "perusahaan";

export function InventarisVendorDetail({
  vendor,
  lokasiList,
  picList,
  picInternalList,
  produkList,
  kategoriList,
  pengirimanList,
  ranking,
  perusahaanList,
  perusahaanLinks,
  currentAkunId,
  akunList,
}: {
  vendor: VendorRow;
  lokasiList: VendorLokasiRow[];
  picList: VendorPicRow[];
  picInternalList: VendorPicInternalRow[];
  produkList: VendorProdukRow[];
  kategoriList: VendorKategoriRow[];
  pengirimanList: VendorPengirimanRow[];
  ranking: VendorRanking;
  perusahaanList: PerusahaanRow[];
  perusahaanLinks: PerusahaanLink[];
  currentAkunId: number;
  akunList: AkunRow[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("lokasi");
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showKategoriDialog, setShowKategoriDialog] = useState(false);
  const [, startTransition] = useTransition();

  function refresh() {
    router.refresh();
  }

  // Only companies with a Postgres kode can actually be linked — Kode
  // resolves the MSSQL connection in createBusinessPartnerForVendor via
  // getCompanyPool(kode, "utama"); a Draft PT with Kode still null (not yet
  // wired to a Postgres perusahaan row) has nothing to resolve against.
  const linkablePerusahaan = perusahaanList.filter(
    (p): p is PerusahaanRow & { Kode: string } =>
      p.Kode !== null && !perusahaanLinks.some((l) => l.perusahaanId === p.PerusahaanID)
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm">
        {ranking.jumlahLog > 0 ? (
          <span className="flex items-center gap-1">
            <Star className="size-4 text-warning" />
            {ranking.rataRataRatingKualitas?.toFixed(1)}/5 · rata-rata {ranking.rataRataLamaKirimHari?.toFixed(1)} hari kirim
            ({ranking.jumlahLog} log)
          </span>
        ) : (
          <span className="text-muted-foreground">Belum ada data pengiriman untuk menghitung peringkat.</span>
        )}
        <Button variant="outline" size="sm" onClick={() => setShowEditDialog(true)}>
          <Pencil className="size-4" /> Edit Vendor
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => typeof v === "string" && setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="lokasi">Lokasi</TabsTrigger>
          <TabsTrigger value="pic">PIC</TabsTrigger>
          <TabsTrigger value="produk">Produk</TabsTrigger>
          <TabsTrigger value="pengiriman">Log Pengiriman</TabsTrigger>
          <TabsTrigger value="perusahaan">Perusahaan Terhubung</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "lokasi" && (
        <div className="flex flex-col gap-2">
          {lokasiList.map((l) => (
            <div key={l.id} className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="font-medium">{l.namaLokasi}</p>
                <p className="text-xs text-muted-foreground">{l.alamat} {l.kota}</p>
              </div>
              <Button
                variant="ghost" size="icon"
                onClick={() => startTransition(async () => {
                  const r = await deleteVendorLokasiAction(l.id, vendor.id);
                  if (!r.success) { toast.error(r.error); return; }
                  refresh();
                })}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <QuickAddLokasi vendorId={vendor.id} onAdded={refresh} />
        </div>
      )}

      {tab === "pic" && (
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="mb-2 text-sm font-semibold">PIC Vendor</h3>
            {picList.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="font-medium">{p.nama} {p.urutan === 0 && <span className="text-xs text-primary">(Utama)</span>}</p>
                  <p className="text-xs text-muted-foreground">{p.jabatan} · {p.telepon}</p>
                </div>
                <Button
                  variant="ghost" size="icon"
                  onClick={() => startTransition(async () => {
                    const r = await deleteVendorPicAction(p.id, vendor.id);
                    if (!r.success) { toast.error(r.error); return; }
                    refresh();
                  })}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <QuickAddPic vendorId={vendor.id} onAdded={refresh} />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">PIC Internal PMP Group</h3>
            {picInternalList.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-lg border p-3">
                <p className="text-sm">{p.akunNama} — {p.perusahaanNama}</p>
                <Button
                  variant="ghost" size="icon"
                  onClick={() => startTransition(async () => {
                    const r = await removeVendorPicInternalAction(p.id, vendor.id);
                    if (!r.success) { toast.error(r.error); return; }
                    refresh();
                  })}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <QuickAddPicInternal vendorId={vendor.id} akunList={akunList} onAdded={refresh} />
          </div>
        </div>
      )}

      {tab === "produk" && (
        <div className="flex flex-col gap-2">
          {produkList.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="font-medium">{p.brand} {p.model}</p>
                <p className="text-xs text-muted-foreground">{p.kategoriNama}</p>
              </div>
              <Button
                variant="ghost" size="icon"
                onClick={() => startTransition(async () => {
                  const r = await deleteVendorProdukAction(p.id, vendor.id);
                  if (!r.success) { toast.error(r.error); return; }
                  refresh();
                })}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <QuickAddProduk
            vendorId={vendor.id}
            kategoriList={kategoriList}
            onAdded={refresh}
            onManageKategori={() => setShowKategoriDialog(true)}
          />
        </div>
      )}

      {tab === "pengiriman" && (
        <div className="flex flex-col gap-2">
          {pengirimanList.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
              <div>
                <p>{p.perusahaanNama} — {p.tanggalPesan} → {p.tanggalTiba} ({p.lamaKirimHari} hari)</p>
                <p className="text-xs text-muted-foreground">Rating {p.ratingKualitas}/5 {p.produkLabel && `· ${p.produkLabel}`}</p>
              </div>
              <Button
                variant="ghost" size="icon"
                onClick={() => startTransition(async () => {
                  const r = await deleteVendorPengirimanAction(p.id, vendor.id);
                  if (!r.success) { toast.error(r.error); return; }
                  refresh();
                })}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <QuickAddPengiriman
            perusahaanLinks={perusahaanLinks}
            produkList={produkList}
            currentAkunId={currentAkunId}
            onAdded={refresh}
          />
        </div>
      )}

      {tab === "perusahaan" && (
        <div className="flex flex-col gap-2">
          {perusahaanLinks.map((l) => (
            <div key={l.id} className="rounded-lg border p-3 text-sm">
              <p className="font-medium">{l.perusahaanNama}</p>
              <p className="text-xs text-muted-foreground">BusinessPartnerID {l.businessPartnerId} · Termin {l.termOfPaymentId}</p>
            </div>
          ))}
          <QuickLinkPerusahaan
            vendorId={vendor.id}
            perusahaanList={linkablePerusahaan}
            onLinked={refresh}
          />
        </div>
      )}

      <InventarisVendorFormDialog open={showEditDialog} onOpenChange={setShowEditDialog} vendorToEdit={vendor} />
      <KelolaKategoriDialog open={showKategoriDialog} onOpenChange={setShowKategoriDialog} onChanged={refresh} />
    </div>
  );
}

// Each Quick* component is a minimal inline add-form (name input(s) + a
// Tambah button) — deliberately not a modal Dialog like the top-level
// "Tambah Vendor" form, since these are secondary additions inside an
// already-open detail page. Follows the same startTransition + toast +
// router.refresh() pattern as the delete buttons above.

function QuickAddLokasi({ vendorId, onAdded }: { vendorId: number; onAdded: () => void }) {
  const [namaLokasi, setNamaLokasi] = useState("");
  const [alamat, setAlamat] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-end gap-2 rounded-lg border border-dashed p-3">
      <div className="flex flex-1 flex-col gap-1">
        <Label className="text-xs">Nama Lokasi</Label>
        <Input value={namaLokasi} onChange={(e) => setNamaLokasi(e.target.value)} placeholder="Gudang Utama" />
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <Label className="text-xs">Alamat</Label>
        <Input value={alamat} onChange={(e) => setAlamat(e.target.value)} />
      </div>
      <Button
        size="sm" disabled={!namaLokasi.trim() || pending}
        onClick={() => startTransition(async () => {
          const r = await addVendorLokasiAction(vendorId, { namaLokasi: namaLokasi.trim(), alamat: alamat.trim() || null, kota: null, kontak: null });
          if (!r.success) { toast.error(r.error); return; }
          setNamaLokasi(""); setAlamat(""); onAdded();
        })}
      >
        <Plus className="size-4" /> Tambah
      </Button>
    </div>
  );
}

function QuickAddPic({ vendorId, onAdded }: { vendorId: number; onAdded: () => void }) {
  const [nama, setNama] = useState("");
  const [jabatan, setJabatan] = useState("");
  const [telepon, setTelepon] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-end gap-2 rounded-lg border border-dashed p-3">
      <div className="flex flex-1 flex-col gap-1">
        <Label className="text-xs">Nama</Label>
        <Input value={nama} onChange={(e) => setNama(e.target.value)} />
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <Label className="text-xs">Jabatan</Label>
        <Input value={jabatan} onChange={(e) => setJabatan(e.target.value)} />
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <Label className="text-xs">Telepon/WA</Label>
        <Input value={telepon} onChange={(e) => setTelepon(e.target.value)} />
      </div>
      <Button
        size="sm" disabled={!nama.trim() || pending}
        onClick={() => startTransition(async () => {
          const r = await addVendorPicAction(vendorId, { nama: nama.trim(), jabatan: jabatan.trim() || null, telepon: telepon.trim() || null, email: null });
          if (!r.success) { toast.error(r.error); return; }
          setNama(""); setJabatan(""); setTelepon(""); onAdded();
        })}
      >
        <Plus className="size-4" /> Tambah
      </Button>
    </div>
  );
}

// Akun with no perusahaanId (Direktur/PMP Group-scoped accounts) can't be
// recorded as PIC internal — vendor_pic_internal requires a perusahaan_id,
// and there's no PT to attribute them to.
function QuickAddPicInternal({
  vendorId, akunList, onAdded,
}: { vendorId: number; akunList: AkunRow[]; onAdded: () => void }) {
  const eligible = akunList.filter((a): a is AkunRow & { perusahaanId: number; perusahaanNama: string } => a.perusahaanId !== null);
  const [akunKey, setAkunKey] = useState<string>("");
  const [pending, startTransition] = useTransition();

  if (eligible.length === 0) {
    return <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Tidak ada akun yang tersedia untuk dijadikan PIC internal.</p>;
  }

  return (
    <div className="flex items-end gap-2 rounded-lg border border-dashed p-3">
      <div className="flex flex-1 flex-col gap-1">
        <Label className="text-xs">Akun</Label>
        <Select value={akunKey} onValueChange={(v) => typeof v === "string" && setAkunKey(v)}>
          <SelectTrigger><SelectValue placeholder="Pilih akun" /></SelectTrigger>
          <SelectContent>
            {eligible.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>{a.nama} ({a.perusahaanNama})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        size="sm" disabled={!akunKey || pending}
        onClick={() => {
          const a = eligible.find((x) => String(x.id) === akunKey);
          if (!a) return;
          startTransition(async () => {
            const r = await addVendorPicInternalAction(vendorId, a.perusahaanId, a.id);
            if (!r.success) { toast.error(r.error); return; }
            setAkunKey(""); onAdded();
          });
        }}
      >
        <Plus className="size-4" /> Tambah
      </Button>
    </div>
  );
}

function QuickAddProduk({
  vendorId, kategoriList, onAdded, onManageKategori,
}: { vendorId: number; kategoriList: VendorKategoriRow[]; onAdded: () => void; onManageKategori: () => void }) {
  const [kategoriId, setKategoriId] = useState<string>(kategoriList[0] ? String(kategoriList[0].id) : "");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-end gap-2 rounded-lg border border-dashed p-3">
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Kategori</Label>
          <button type="button" onClick={onManageKategori} className="text-xs text-primary hover:underline">
            Kelola Kategori
          </button>
        </div>
        <Select value={kategoriId} onValueChange={(v) => typeof v === "string" && setKategoriId(v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {kategoriList.map((k) => <SelectItem key={k.id} value={String(k.id)}>{k.nama}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <Label className="text-xs">Brand</Label>
        <Input value={brand} onChange={(e) => setBrand(e.target.value)} />
      </div>
      <div className="flex flex-1 flex-col gap-1">
        <Label className="text-xs">Model</Label>
        <Input value={model} onChange={(e) => setModel(e.target.value)} />
      </div>
      <Button
        size="sm" disabled={!kategoriId || pending}
        onClick={() => startTransition(async () => {
          const r = await addVendorProdukAction(vendorId, { kategoriId: Number(kategoriId), brand: brand.trim() || null, model: model.trim() || null, spesifikasi: null });
          if (!r.success) { toast.error(r.error); return; }
          setBrand(""); setModel(""); onAdded();
        })}
      >
        <Plus className="size-4" /> Tambah
      </Button>
    </div>
  );
}

function QuickAddPengiriman({
  perusahaanLinks, produkList, currentAkunId, onAdded,
}: { perusahaanLinks: PerusahaanLink[]; produkList: VendorProdukRow[]; currentAkunId: number; onAdded: () => void }) {
  const [linkId, setLinkId] = useState<string>(perusahaanLinks[0] ? String(perusahaanLinks[0].id) : "");
  const [produkId, setProdukId] = useState<string>("");
  const [tanggalPesan, setTanggalPesan] = useState("");
  const [tanggalTiba, setTanggalTiba] = useState("");
  const [rating, setRating] = useState("5");
  const [pending, startTransition] = useTransition();

  if (perusahaanLinks.length === 0) {
    return <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Hubungkan vendor ini ke suatu perusahaan dulu (tab Perusahaan Terhubung) sebelum mencatat pengiriman.</p>;
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed p-3">
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Perusahaan</Label>
        <Select value={linkId} onValueChange={(v) => typeof v === "string" && setLinkId(v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {perusahaanLinks.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.perusahaanNama}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Produk (opsional)</Label>
        <Select value={produkId} onValueChange={(v) => typeof v === "string" && setProdukId(v)}>
          <SelectTrigger><SelectValue placeholder="-" /></SelectTrigger>
          <SelectContent>
            {produkList.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.brand} {p.model}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Tgl Pesan</Label>
        <Input type="date" value={tanggalPesan} onChange={(e) => setTanggalPesan(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Tgl Tiba</Label>
        <Input type="date" value={tanggalTiba} onChange={(e) => setTanggalTiba(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Rating (1-5)</Label>
        <Input type="number" min={1} max={5} value={rating} onChange={(e) => setRating(e.target.value)} className="w-16" />
      </div>
      <Button
        size="sm" disabled={!linkId || !tanggalPesan || !tanggalTiba || pending}
        onClick={() => startTransition(async () => {
          const r = await addVendorPengirimanAction({
            vendorPerusahaanLinkId: Number(linkId),
            vendorProdukId: produkId ? Number(produkId) : null,
            tanggalPesan, tanggalTiba,
            ratingKualitas: Number(rating),
            catatan: null,
            dicatatOlehAkunId: currentAkunId,
          });
          if (!r.success) { toast.error(r.error); return; }
          setTanggalPesan(""); setTanggalTiba(""); onAdded();
        })}
      >
        <Plus className="size-4" /> Catat
      </Button>
    </div>
  );
}

function QuickLinkPerusahaan({
  vendorId, perusahaanList, onLinked,
}: { vendorId: number; perusahaanList: (PerusahaanRow & { Kode: string })[]; onLinked: () => void }) {
  const [perusahaanId, setPerusahaanId] = useState<string>("");
  const [pending, startTransition] = useTransition();

  if (perusahaanList.length === 0) {
    return <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Vendor ini sudah terhubung ke semua perusahaan yang tersedia.</p>;
  }

  return (
    <div className="flex items-end gap-2 rounded-lg border border-dashed p-3">
      <div className="flex flex-1 flex-col gap-1">
        <Label className="text-xs">Perusahaan</Label>
        <Select value={perusahaanId} onValueChange={(v) => typeof v === "string" && setPerusahaanId(v)}>
          <SelectTrigger><SelectValue placeholder="Pilih perusahaan" /></SelectTrigger>
          <SelectContent>
            {perusahaanList.map((p) => <SelectItem key={p.PerusahaanID} value={String(p.PerusahaanID)}>{p.Nama}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <Button
        size="sm" disabled={!perusahaanId || pending}
        onClick={() => {
          const p = perusahaanList.find((x) => String(x.PerusahaanID) === perusahaanId);
          if (!p) return;
          startTransition(async () => {
            const r = await linkVendorToPerusahaanAction(vendorId, p.PerusahaanID, p.Kode, "014", false);
            if (!r.success) { toast.error(r.error); return; }
            toast.success(`Terhubung ke ${p.Nama}, BusinessPartner baru dibuat.`);
            setPerusahaanId(""); onLinked();
          });
        }}
      >
        Hubungkan
      </Button>
    </div>
  );
}

// Reachable from the Produk tab's "Kelola Kategori" link (see QuickAddProduk
// above). Loads its own list via listVendorKategoriAction() whenever it
// opens (rather than trusting a prop, which would go stale after any
// mutation until the parent's router.refresh() lands), and calls onChanged()
// (the parent's refresh(), i.e. router.refresh()) after every add/rename/
// delete so the Produk tab's own kategoriList prop — used by QuickAddProduk's
// Select — is kept in sync too.
function KelolaKategoriDialog({
  open, onOpenChange, onChanged,
}: { open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => void }) {
  const [items, setItems] = useState<VendorKategoriRow[]>([]);
  const [newNama, setNewNama] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingNama, setEditingNama] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    listVendorKategoriAction().then((r) => {
      if (!r.success) { toast.error(r.error); return; }
      setItems(r.data);
    });
  }, [open]);

  async function reload() {
    const r = await listVendorKategoriAction();
    if (r.success) setItems(r.data);
  }

  function handleAdd() {
    if (!newNama.trim()) return;
    startTransition(async () => {
      const r = await createVendorKategoriAction(newNama.trim());
      if (!r.success) { toast.error(r.error); return; }
      toast.success("Kategori ditambahkan.");
      setNewNama("");
      await reload();
      onChanged();
    });
  }

  function handleRename(id: number) {
    if (!editingNama.trim()) return;
    startTransition(async () => {
      const r = await renameVendorKategoriAction(id, editingNama.trim());
      if (!r.success) { toast.error(r.error); return; }
      toast.success("Kategori diperbarui.");
      setEditingId(null);
      await reload();
      onChanged();
    });
  }

  function handleDelete(id: number) {
    startTransition(async () => {
      const r = await deleteVendorKategoriAction(id);
      if (!r.success) { toast.error(r.error); return; }
      toast.success("Kategori dihapus.");
      await reload();
      onChanged();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Kelola Kategori Produk</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {items.length === 0 && <p className="text-sm text-muted-foreground">Belum ada kategori.</p>}
          {items.map((k) => (
            <div key={k.id} className="flex items-center gap-2 rounded-lg border p-2">
              {editingId === k.id ? (
                <>
                  <Input
                    value={editingNama}
                    onChange={(e) => setEditingNama(e.target.value)}
                    className="flex-1"
                    autoFocus
                  />
                  <Button size="sm" disabled={!editingNama.trim() || pending} onClick={() => handleRename(k.id)}>Simpan</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Batal</Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{k.nama}</span>
                  <Button variant="ghost" size="icon" onClick={() => { setEditingId(k.id); setEditingNama(k.nama); }}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" disabled={pending} onClick={() => handleDelete(k.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                </>
              )}
            </div>
          ))}
          <div className="flex items-end gap-2 rounded-lg border border-dashed p-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label className="text-xs">Kategori Baru</Label>
              <Input value={newNama} onChange={(e) => setNewNama(e.target.value)} placeholder="Nama kategori" />
            </div>
            <Button size="sm" disabled={!newNama.trim() || pending} onClick={handleAdd}>
              <Plus className="size-4" /> Tambah
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Tutup</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
