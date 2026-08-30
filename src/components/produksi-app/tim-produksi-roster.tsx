"use client";

import { useEffect, useState, useTransition } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { SusunanTimRow } from "@/lib/queries/aktivitas-produksi";
import type { AnggotaTimRow } from "@/lib/queries/tim-produksi";
import { setSusunanTimAction, getSemuaAnggotaTimAction } from "@/app/mkesindo/produksi/actions";

const TAMBAH_PLACEHOLDER = "__pilih__";

function SortableRosterRow({
  entry,
  index,
  canEdit,
  onRemove,
}: {
  entry: SusunanTimRow;
  index: number;
  canEdit: boolean;
  onRemove: (anggotaId: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.anggotaId,
    disabled: !canEdit,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-2 rounded-md border border-border px-2 py-1.5", isDragging && "z-10 opacity-70 shadow-lg")}
    >
      {canEdit && (
        <button type="button" {...attributes} {...listeners} className="shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing">
          <GripVertical className="size-4" />
        </button>
      )}
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
        {index + 1}
      </span>
      <span className="flex-1 text-sm">{entry.nama}</span>
      {canEdit && (
        <button
          type="button"
          title="Keluarkan dari susunan shift ini"
          onClick={() => onRemove(entry.anggotaId)}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function TimProduksiRoster({
  tanggalUsaha,
  shift,
  susunanTim,
  canEdit,
  onChanged,
}: {
  tanggalUsaha: string;
  shift: 1 | 2 | 3;
  susunanTim: SusunanTimRow[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [order, setOrder] = useState(susunanTim);
  const [semuaAnggota, setSemuaAnggota] = useState<AnggotaTimRow[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // susunanTim comes from the parent's own fetch (re-run after onChanged)
  // -- resync local drag/edit state whenever a fresh copy arrives, same
  // reasoning as every other "server state -> local editable copy" pattern
  // in this app (e.g. RouteValidationDialog's own `order` state).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrder(susunanTim);
  }, [susunanTim]);

  useEffect(() => {
    if (!canEdit) return;
    getSemuaAnggotaTimAction().then((result) => {
      if (result.success) setSemuaAnggota(result.data);
    });
  }, [canEdit]);

  function persist(next: SusunanTimRow[]) {
    setOrder(next);
    setError(null);
    startTransition(async () => {
      const result = await setSusunanTimAction(tanggalUsaha, shift, next.map((n) => n.anggotaId));
      if (!result.success) {
        setError(result.error);
        return;
      }
      onChanged();
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.findIndex((o) => o.anggotaId === active.id);
    const newIndex = order.findIndex((o) => o.anggotaId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    persist(arrayMove(order, oldIndex, newIndex));
  }

  function handleRemove(anggotaId: number) {
    persist(order.filter((o) => o.anggotaId !== anggotaId));
  }

  function handleTambah(value: string | null) {
    if (!value || value === TAMBAH_PLACEHOLDER) return;
    const anggotaId = Number(value);
    const anggota = semuaAnggota?.find((a) => a.anggotaId === anggotaId);
    if (!anggota || order.some((o) => o.anggotaId === anggotaId)) return;
    persist([...order, { anggotaId, nama: anggota.nama, urutan: order.length }]);
  }

  const tersedia = (semuaAnggota ?? []).filter((a) => !order.some((o) => o.anggotaId === a.anggotaId));

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Tim Produksi bertugas — Shift {shift}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {order.length === 0 ? (
          <p className="text-xs text-muted-foreground">Belum ada anggota bertugas.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={order.map((o) => o.anggotaId)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-1.5">
                {order.map((entry, i) => (
                  <SortableRosterRow key={entry.anggotaId} entry={entry} index={i} canEdit={canEdit} onRemove={handleRemove} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
        {canEdit && (
          <Select value={TAMBAH_PLACEHOLDER} onValueChange={handleTambah} disabled={pending}>
            <SelectTrigger>
              <SelectValue placeholder="Tambah dari tim lain..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TAMBAH_PLACEHOLDER} disabled>
                Tambah dari tim lain...
              </SelectItem>
              {tersedia.map((a) => (
                <SelectItem key={a.anggotaId} value={String(a.anggotaId)}>
                  {a.nama} (Shift {a.shift})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
