"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { MitraEsBalokList } from "@/components/dashboard/mitra-es-balok-list";
import { MitraEsBalokDetailDialog } from "@/components/dashboard/mitra-es-balok-detail-dialog";
import { MitraEsBalokFormDialog, emptyMitraForm } from "@/components/dashboard/mitra-es-balok-form-dialog";
import type { MitraCard, SumberAgen, WilayahOption } from "@/lib/queries/mitra-es-balok";
import { getWilayahOptionsAction, createMitraAction, updateMitraAction, setMitraSuspendedAction, deleteMitraAction } from "./actions";

const KODE = "pmpersada";

export function MitraPageClient({ cards, wilayahOptions: initialWilayahOptions }: { cards: MitraCard[]; wilayahOptions: WilayahOption[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<MitraCard | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editTarget, setEditTarget] = useState<MitraCard | null>(null);
  // Starts from the page-load fetch ("utama"), but is refetched whenever the
  // create form's Sumber selector changes -- pmpersada's/pmpakis's "logistik"
  // Wilayah options live in a different physical database than "utama"'s.
  const [wilayahOptions, setWilayahOptions] = useState<WilayahOption[]>(initialWilayahOptions);

  async function handleSumberChange(sumber: SumberAgen) {
    try {
      setWilayahOptions(await getWilayahOptionsAction(sumber));
    } catch {
      toast.error("Gagal memuat daftar Wilayah untuk sumber ini.");
    }
  }

  function handleAddNew() {
    setFormMode("create");
    setEditTarget(null);
    setWilayahOptions(initialWilayahOptions); // reset to "utama"'s list -- create always starts on "utama"
    setFormOpen(true);
  }

  function handleEdit(card: MitraCard) {
    setDetailOpen(false);
    setFormMode("edit");
    setEditTarget(card);
    setFormOpen(true);
  }

  async function handleSuspendToggle(card: MitraCard) {
    try {
      await setMitraSuspendedAction(card.sumber, card.agenId, !card.isActive);
      router.refresh();
    } catch {
      toast.error("Gagal mengubah status Mitra.");
    }
  }

  async function handleDelete(card: MitraCard) {
    if (!confirm(`Hapus Mitra "${card.nama}"? Tindakan ini tidak bisa dibatalkan lewat aplikasi ini.`)) return;
    try {
      await deleteMitraAction(card.sumber, card.agenId);
      router.refresh();
    } catch {
      toast.error("Gagal menghapus Mitra.");
    }
  }

  return (
    <>
      <MitraEsBalokList
        kode={KODE}
        cards={cards}
        onAddNew={handleAddNew}
        onSelect={(card) => {
          setSelected(card);
          setDetailOpen(true);
        }}
        onEdit={handleEdit}
        onSuspendToggle={handleSuspendToggle}
        onDelete={handleDelete}
      />

      <MitraEsBalokDetailDialog open={detailOpen} onOpenChange={setDetailOpen} kode={KODE} data={selected} onEdit={handleEdit} />

      <MitraEsBalokFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        kode={KODE}
        mode={formMode}
        initial={
          editTarget
            ? {
                nama: editTarget.nama,
                telepon: editTarget.telepon ?? "",
                wilayahId: editTarget.wilayahId,
                alamat: editTarget.alamat ?? "",
                hargaBalokKecil: editTarget.hargaBalokKecil,
                hargaBalokBesar: editTarget.hargaBalokBesar,
                maksimumHutang: editTarget.maksimumHutang,
                kapasitasBalokKecil: editTarget.kapasitasBalokKecil,
                kapasitasBalokBesar: editTarget.kapasitasBalokBesar,
                segmentasi: editTarget.segmentasi,
              }
            : emptyMitraForm()
        }
        initialSumber={editTarget?.sumber ?? "utama"}
        initialLocation={
          editTarget?.latitude != null && editTarget?.longitude != null
            ? { latitude: editTarget.latitude, longitude: editTarget.longitude, alamat: editTarget.alamat }
            : null
        }
        wilayahOptions={wilayahOptions}
        onSumberChange={handleSumberChange}
        onSubmit={async (input, sumber, location) => {
          if (formMode === "create") {
            await createMitraAction(sumber, input, location);
          } else if (editTarget) {
            await updateMitraAction(sumber, editTarget.agenId, input, location);
          }
          router.refresh();
        }}
      />
    </>
  );
}
