"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { MitraEsBalokList } from "@/components/dashboard/mitra-es-balok-list";
import { MitraEsBalokDetailDialog } from "@/components/dashboard/mitra-es-balok-detail-dialog";
import { MitraEsBalokFormDialog, emptyMitraForm } from "@/components/dashboard/mitra-es-balok-form-dialog";
import type { MitraCard, MitraDetailData, WilayahOption } from "@/lib/queries/mitra-es-balok";
import {
  getMitraDetailAction,
  createMitraAction,
  updateMitraAction,
  setMitraSuspendedAction,
  deleteMitraAction,
} from "./actions";

const KODE = "pmputra";

export function MitraPageClient({ cards, wilayahOptions }: { cards: MitraCard[]; wilayahOptions: WilayahOption[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<MitraCard | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [editTarget, setEditTarget] = useState<MitraDetailData | null>(null);

  function handleAddNew() {
    setFormMode("create");
    setEditTarget(null);
    setFormOpen(true);
  }

  function handleEdit(data: MitraDetailData) {
    setDetailOpen(false);
    setFormMode("edit");
    setEditTarget(data);
    setFormOpen(true);
  }

  async function handleEditFromCard(card: MitraCard) {
    const detail = await getMitraDetailAction(card.sumber, card.agenId);
    if (detail) handleEdit(detail);
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
        onEdit={handleEditFromCard}
        onSuspendToggle={handleSuspendToggle}
        onDelete={handleDelete}
      />

      <MitraEsBalokDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        kode={KODE}
        sumber={selected?.sumber ?? "utama"}
        agenId={selected?.agenId ?? null}
        fetchDetail={(_, sumber, agenId) => getMitraDetailAction(sumber, agenId)}
        onEdit={handleEdit}
      />

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
                wilayahId: null,
                alamat: editTarget.alamat ?? "",
                hargaBalokKecil: editTarget.hargaBalokKecil,
                hargaBalokBesar: editTarget.hargaBalokBesar,
                maksimumHutang: editTarget.maksimumHutang,
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
