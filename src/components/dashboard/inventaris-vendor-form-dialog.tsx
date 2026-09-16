// src/components/dashboard/inventaris-vendor-form-dialog.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { VendorRow } from "@/lib/queries/inventaris-vendor";
import { createVendorAction, updateVendorAction } from "@/app/grup/inventaris/actions";

// kategoriList is deliberately NOT a prop here — creating/editing a vendor
// record itself needs no kategori (kategori applies to vendor_produk, added
// later from the detail page's Produk tab, see QuickAddProduk in
// inventaris-vendor-detail.tsx).
//
// Passing vendorToEdit switches the dialog into edit mode: fields prefill
// from the vendor and Simpan calls updateVendorAction(vendorToEdit.id, ...)
// instead of createVendorAction(...). updateVendorAction already syncs the
// edit to every linked company's BusinessPartner server-side.
export function InventarisVendorFormDialog({
  open,
  onOpenChange,
  vendorToEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorToEdit?: VendorRow | null;
}) {
  const router = useRouter();
  const [nama, setNama] = useState("");
  const [npwp, setNpwp] = useState("");
  const [npwpAlamat, setNpwpAlamat] = useState("");
  const [catatan, setCatatan] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isEdit = Boolean(vendorToEdit);

  function reset() {
    setNama("");
    setNpwp("");
    setNpwpAlamat("");
    setCatatan("");
    setError(null);
  }

  // Prefill from vendorToEdit (or clear for a fresh "Tambah Vendor") the
  // moment `open` flips to true, since this dialog stays mounted across
  // opens/closes and only receives the "please open now" signal via the
  // `open` prop, not through its own onOpenChange. Adjusting state during
  // render (React's documented pattern for "state that depends on a prop
  // change") instead of in a useEffect avoids the extra
  // render-then-effect-then-render cascade.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      if (vendorToEdit) {
        setNama(vendorToEdit.nama);
        setNpwp(vendorToEdit.npwp ?? "");
        setNpwpAlamat(vendorToEdit.npwpAlamat ?? "");
        setCatatan(vendorToEdit.catatan ?? "");
        setError(null);
      } else {
        reset();
      }
    }
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const input = {
        nama: nama.trim(),
        npwp: npwp.trim() || null,
        npwpAlamat: npwpAlamat.trim() || null,
        catatan: catatan.trim() || null,
      };
      const result = vendorToEdit ? await updateVendorAction(vendorToEdit.id, input) : await createVendorAction(input);
      if (!result.success) {
        setError(result.error);
        return;
      }
      toast.success(vendorToEdit ? "Vendor diperbarui." : "Vendor ditambahkan.");
      reset();
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Vendor" : "Tambah Vendor"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>Nama Vendor</Label>
            <Input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="PT Contoh Sejahtera" />
          </div>
          <div className="flex flex-col gap-1">
            <Label>NPWP</Label>
            <Input value={npwp} onChange={(e) => setNpwp(e.target.value)} placeholder="12.345.678.9-012.000" />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Alamat NPWP</Label>
            <Textarea value={npwpAlamat} onChange={(e) => setNpwpAlamat(e.target.value)} rows={2} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Catatan</Label>
            <Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={2} />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Batal</Button>
          <Button disabled={!nama.trim() || pending} onClick={handleSubmit}>
            {pending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
