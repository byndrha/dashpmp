"use client";

// Pratinjau "Bagikan Semua Rute → Data Rute": setelah semua rute Terbit
// ditangkap, user menata dulu apa yang dibagikan — seret kartu untuk
// mengurutkan (kartu lain bergeser/snap ke petak grid), atau keluarkan
// kartu dari daftar. Tata letak grid di sini sama dengan gambar akhirnya
// (gridColumnsFor). Tombol Bagikan menggabungkan kartu yang tersisa sesuai
// urutan lalu menyalinnya ke papan klip.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Loader2, RotateCcw, Share2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { gridColumnsFor, mergeImagesGrid } from "@/lib/share-image";

export interface BagianRute {
  label: string;
  blob: Blob;
}

interface Kartu extends BagianRute {
  id: string;
  url: string;
}

function KartuRute({ kartu, nomor, onKeluarkan }: { kartu: Kartu; nomor: number; onKeluarkan: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: kartu.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group relative flex cursor-grab touch-none flex-col overflow-hidden rounded-lg border bg-card select-none active:cursor-grabbing",
        isDragging && "z-10 opacity-80 shadow-lg ring-2 ring-primary"
      )}
      {...attributes}
      {...listeners}
    >
      <div className="flex items-center gap-1.5 border-b bg-muted/60 px-2 py-1.5 text-xs font-semibold">
        <GripVertical className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground tabular-nums">
          {nomor}
        </span>
        <span className="min-w-0 flex-1 truncate">{kartu.label}</span>
        <button
          type="button"
          title="Keluarkan dari bagikan"
          aria-label={`Keluarkan ${kartu.label} dari bagikan`}
          // Jangan sampai klik tombol ini dianggap awal seret.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onKeluarkan}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- blob URL lokal, bukan aset */}
      <img src={kartu.url} alt={kartu.label} draggable={false} className="block w-full" />
    </div>
  );
}

// Isi dialog — baru di-mount saat dialog dibuka, jadi urutan awal cukup
// diambil dari state awal (tanpa effect).
function IsiPratinjau({
  semua,
  judul,
  namaBerkas,
  menyalin,
  setMenyalin,
  onTutup,
}: {
  semua: Kartu[];
  judul: string;
  namaBerkas: string;
  menyalin: boolean;
  setMenyalin: (v: boolean) => void;
  onTutup: () => void;
}) {
  const [urutan, setUrutan] = useState<string[]>(() => semua.map((k) => k.id));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const byId = useMemo(() => new Map(semua.map((k) => [k.id, k])), [semua]);
  const tampil = urutan.map((id) => byId.get(id)).filter((k): k is Kartu => !!k);
  const dikeluarkan = semua.length - tampil.length;
  // Jumlah kolom sama dengan gambar akhir (4, atau 6 bila >12 rute), tapi
  // tidak dipersempit saat rutenya sedikit — supaya kartu tetap seukuran
  // pratinjau, bukan melebar memenuhi dialog.
  const kolom = gridColumnsFor(Math.max(1, tampil.length));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setUrutan((u) => arrayMove(u, u.indexOf(String(active.id)), u.indexOf(String(over.id))));
  }

  async function bagikan() {
    if (tampil.length === 0) return;
    setMenyalin(true);
    // Promise gambar gabungan langsung diberikan ke ClipboardItem supaya
    // aktivasi klik user masih berlaku walau penggabungan butuh waktu.
    const gabungan = mergeImagesGrid(tampil.map(({ label, blob }) => ({ label, blob })));
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": gabungan })]);
      toast.success(`${tampil.length} rute disalin ke papan klip.`);
      onTutup();
    } catch {
      // Papan klip gambar tidak didukung/ditolak — unduh sebagai cadangan.
      try {
        const blob = await gabungan;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = namaBerkas;
        a.click();
        URL.revokeObjectURL(url);
        toast.warning("Papan klip tidak bisa dipakai — gambar diunduh sebagai gantinya.");
        onTutup();
      } catch {
        toast.error("Gagal menggabungkan gambar rute.");
      }
    } finally {
      setMenyalin(false);
    }
  }

  return (
    <>
      <div className="shrink-0 border-b px-4 pt-4 pb-3 pr-10">
        <DialogTitle className="text-base font-semibold">{judul}</DialogTitle>
        <DialogDescription className="text-xs">
          Seret kartu untuk mengatur urutan, klik × untuk mengeluarkan rute dari gambar yang dibagikan.
        </DialogDescription>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30 p-4">
        {tampil.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Semua rute dikeluarkan.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={urutan} strategy={rectSortingStrategy}>
              <div
                className="grid items-start gap-3"
                style={{ gridTemplateColumns: `repeat(${kolom}, minmax(0, 1fr))` }}
              >
                {tampil.map((k, i) => (
                  <KartuRute
                    key={k.id}
                    kartu={k}
                    nomor={i + 1}
                    onKeluarkan={() => setUrutan((u) => u.filter((id) => id !== k.id))}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            {tampil.length} dari {semua.length} rute dibagikan
          </span>
          {dikeluarkan > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={menyalin}
              onClick={() => setUrutan((u) => [...u, ...semua.map((k) => k.id).filter((id) => !u.includes(id))])}
            >
              <RotateCcw className="size-3.5" />
              Kembalikan {dikeluarkan} rute
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={menyalin} onClick={onTutup}>
            Batal
          </Button>
          <Button size="sm" disabled={menyalin || tampil.length === 0} onClick={bagikan}>
            {menyalin ? <Loader2 className="size-3.5 animate-spin" /> : <Share2 className="size-3.5" />}
            Bagikan
          </Button>
        </div>
      </div>
    </>
  );
}

export function PratinjauBagikanRute({
  bagian,
  judul,
  namaBerkas,
  onTutup,
}: {
  // null = dialog tertutup.
  bagian: BagianRute[] | null;
  judul: string;
  namaBerkas: string;
  onTutup: () => void;
}) {
  const [menyalin, setMenyalin] = useState(false);
  // Blob URL dibuat sekali per hasil tangkapan dan dilepas saat dialog
  // ditutup (di handler, bukan cleanup effect — StrictMode menjalankan
  // cleanup dua kali dan akan mematikan URL yang masih dipakai).
  const semua = useMemo<Kartu[]>(
    () => (bagian ?? []).map((b, i) => ({ ...b, id: `rute-${i}`, url: URL.createObjectURL(b.blob) })),
    [bagian]
  );
  function tutup() {
    for (const k of semua) URL.revokeObjectURL(k.url);
    onTutup();
  }

  return (
    <Dialog open={bagian != null} onOpenChange={(o) => !o && !menyalin && tutup()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        {bagian != null && (
          <IsiPratinjau
            semua={semua}
            judul={judul}
            namaBerkas={namaBerkas}
            menyalin={menyalin}
            setMenyalin={setMenyalin}
            onTutup={tutup}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
