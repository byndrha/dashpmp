"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil, Trash2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { ArmadaRow } from "@/lib/queries/armada";
import { createArmadaAction, updateArmadaAction, deleteArmadaAction } from "@/app/(dashboard)/delivery/actions";

// One dialog holding both the list and inline add/edit rows (no nested
// Dialog-inside-Dialog) — Armada only has a single field, so a full
// separate form dialog per action would be more chrome than the data
// warrants.
export function ArmadaManager({ armada }: { armada: ArmadaRow[] }) {
  const [open, setOpen] = useState(false);
  const [newNama, setNewNama] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingNama, setEditingNama] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    const nama = newNama.trim();
    if (!nama) return;
    setError(null);
    startTransition(async () => {
      try {
        await createArmadaAction(nama);
        setNewNama("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan armada.");
      }
    });
  }

  function startEdit(row: ArmadaRow) {
    setEditingId(row.ArmadaID);
    setEditingNama(row.Nama);
  }

  function handleUpdate() {
    const nama = editingNama.trim();
    if (!nama || editingId == null) return;
    setError(null);
    startTransition(async () => {
      try {
        await updateArmadaAction(editingId, nama);
        setEditingId(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan armada.");
      }
    });
  }

  function handleDelete(row: ArmadaRow) {
    if (!confirm(`Hapus armada "${row.Nama}"?`)) return;
    startTransition(async () => {
      try {
        await deleteArmadaAction(row.ArmadaID);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Gagal menghapus armada.");
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Kelola Armada
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kelola Armada</DialogTitle>
            <DialogDescription>Daftar kendaraan yang bisa dipilih saat menugaskan pengiriman.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                placeholder="Nama Kendaraan (mis. GrandMax 1972)"
                value={newNama}
                onChange={(e) => setNewNama(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <Button size="icon" className="shrink-0" disabled={pending || !newNama.trim()} onClick={handleCreate}>
                <Plus className="size-4" />
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex flex-col divide-y rounded-lg border">
              {armada.map((a) => (
                <div key={a.ArmadaID} className="flex items-center justify-between gap-2 px-3 py-2">
                  {editingId === a.ArmadaID ? (
                    <>
                      <Input
                        value={editingNama}
                        onChange={(e) => setEditingNama(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleUpdate()}
                        className="h-8"
                        autoFocus
                      />
                      <div className="flex shrink-0 items-center gap-1">
                        <Button variant="ghost" size="icon" className="size-7" disabled={pending} onClick={handleUpdate}>
                          <Check className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditingId(null)}>
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="text-sm">{a.Nama}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => startEdit(a)}>
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => handleDelete(a)}>
                          <Trash2 className="size-3.5 text-destructive" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {armada.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">Belum ada armada.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
