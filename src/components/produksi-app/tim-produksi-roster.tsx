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
import { setSusunanTimAction, getSemuaAnggotaTimAction, setKepalaHadirAction, setWakilHadirAction } from "@/app/mkesindo/produksi/actions";

const TAMBAH_PLACEHOLDER = "__pilih__";

function SortableRosterRow({
  entry,
  index,
  canEdit,
  pending,
  onRemove,
}: {
  entry: SusunanTimRow;
  index: number;
  canEdit: boolean;
  pending: boolean;
  onRemove: (anggotaId: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.anggotaId,
    disabled: !canEdit || pending,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-2 rounded-md border border-border px-2 py-1.5", isDragging && "z-10 opacity-70 shadow-lg")}
    >
      {canEdit && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={pending}
          className="shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
        >
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
          disabled={pending}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

function KepalaWakilRow({
  label,
  nama,
  hadir,
  pending,
  onToggle,
}: {
  label: string;
  nama: string;
  hadir: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  if (!hadir) {
    return (
      <div className="flex items-center justify-between rounded-md border border-dashed border-border px-2 py-1.5 text-sm text-muted-foreground">
        <span>{label} tidak hadir shift ini</span>
        <button
          type="button"
          onClick={onToggle}
          disabled={pending}
          className="rounded px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Tandai hadir kembali
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5">
      <span className="flex-1 text-sm">
        <span className="text-xs font-medium text-muted-foreground">{label}: </span>
        <span className="font-medium">{nama}</span>
      </span>
      <button
        type="button"
        title={`Tandai ${label} tidak hadir shift ini`}
        onClick={onToggle}
        disabled={pending}
        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export function TimProduksiRoster({
  tanggalUsaha,
  shift,
  susunanTim,
  kepalaAkunId,
  kepalaNama,
  kepalaHadir,
  wakilKepalaAkunId,
  wakilKepalaNama,
  wakilHadir,
  canEdit,
  onChanged,
}: {
  tanggalUsaha: string;
  shift: 1 | 2 | 3;
  susunanTim: SusunanTimRow[];
  kepalaAkunId: number | null;
  kepalaNama: string | null;
  kepalaHadir: boolean;
  wakilKepalaAkunId: number | null;
  wakilKepalaNama: string | null;
  wakilHadir: boolean;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [order, setOrder] = useState(susunanTim);
  const [semuaAnggota, setSemuaAnggota] = useState<AnggotaTimRow[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [kepalaPending, startKepalaTransition] = useTransition();
  const [wakilPending, startWakilTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleToggleKepala() {
    startKepalaTransition(async () => {
      const result = await setKepalaHadirAction(tanggalUsaha, shift, !kepalaHadir);
      if (result.success) onChanged();
    });
  }

  function handleToggleWakil() {
    startWakilTransition(async () => {
      const result = await setWakilHadirAction(tanggalUsaha, shift, !wakilHadir);
      if (result.success) onChanged();
    });
  }

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
        // Revert the rejected optimistic order back to the last known-good
        // server state instead of leaving it on screen.
        setOrder(susunanTim);
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
        {kepalaAkunId != null && kepalaNama != null && (
          <KepalaWakilRow label="Kepala Produksi" nama={kepalaNama} hadir={kepalaHadir} pending={kepalaPending} onToggle={handleToggleKepala} />
        )}
        {wakilKepalaAkunId != null && wakilKepalaNama != null && (
          <KepalaWakilRow label="Wakil Kepala Produksi" nama={wakilKepalaNama} hadir={wakilHadir} pending={wakilPending} onToggle={handleToggleWakil} />
        )}
        {order.length === 0 ? (
          <p className="text-xs text-muted-foreground">Belum ada anggota bertugas.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={order.map((o) => o.anggotaId)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-1.5">
                {order.map((entry, i) => (
                  <SortableRosterRow key={entry.anggotaId} entry={entry} index={i} canEdit={canEdit} pending={pending} onRemove={handleRemove} />
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
                  {a.nama} ({a.timNama})
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
