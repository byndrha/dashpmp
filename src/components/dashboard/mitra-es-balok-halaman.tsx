"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MitraEsBalokList } from "@/components/dashboard/mitra-es-balok-list";
import { MitraEsBalokDetailDialog } from "@/components/dashboard/mitra-es-balok-detail-dialog";
import { MitraEsBalokFormDialog, type AksiMitraEsBalok } from "@/components/dashboard/mitra-es-balok-form-dialog";
import { kunciKartu } from "@/lib/mitra-es-balok-form";
import type { MitraCard, SumberAgen } from "@/lib/queries/mitra-es-balok";

export interface AksiHalamanMitraEsBalok extends AksiMitraEsBalok {
  setSuspended: (sumber: SumberAgen, agenId: string, isActive: boolean) => Promise<void>;
  hapus: (sumber: SumberAgen, agenId: string) => Promise<void>;
}

// Isi halaman /…/mitra Es Balok (daftar + detail + form), dipakai bersama
// pmputra/pmpersada/pmpakis. `aksi` = server action halaman masing-masing;
// WAJIB objek konstan level modul (dipakai sebagai dependensi efek form).
export function MitraEsBalokHalaman({ kode, cards, aksi }: { kode: string; cards: MitraCard[]; aksi: AksiHalamanMitraEsBalok }) {
  const router = useRouter();
  // Simpan kunci, bukan objek: setelah router.refresh() kartu terpilih ikut
  // data terbaru. Kunci memuat AgenDetailID supaya kartu ganda Agen yang
  // sama tidak tertukar.
  const [kunciTerpilih, setKunciTerpilih] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [form, setForm] = useState<{ card: MitraCard | null; seri: number } | null>(null);

  const perKunci = useMemo(() => new Map(cards.map((c) => [kunciKartu(c), c])), [cards]);
  const jumlahPerAgen = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) m.set(`${c.sumber}:${c.agenId}`, (m.get(`${c.sumber}:${c.agenId}`) ?? 0) + 1);
    return m;
  }, [cards]);
  const terpilih = kunciTerpilih ? (perKunci.get(kunciTerpilih) ?? null) : null;

  function bukaForm(card: MitraCard | null) {
    setDetailOpen(false);
    setForm((f) => ({ card, seri: (f?.seri ?? 0) + 1 }));
  }

  async function handleSuspendToggle(card: MitraCard) {
    try {
      await aksi.setSuspended(card.sumber, card.agenId, !card.isActive);
      router.refresh();
    } catch {
      toast.error("Gagal mengubah status Mitra.");
    }
  }

  async function handleDelete(card: MitraCard) {
    if (!confirm(`Hapus Mitra "${card.nama}"? Tindakan ini tidak bisa dibatalkan lewat aplikasi ini.`)) return;
    try {
      await aksi.hapus(card.sumber, card.agenId);
      router.refresh();
    } catch {
      toast.error("Gagal menghapus Mitra.");
    }
  }

  return (
    <>
      <MitraEsBalokList
        kode={kode}
        cards={cards}
        onAddNew={() => bukaForm(null)}
        onSelect={(card) => {
          setKunciTerpilih(kunciKartu(card));
          setDetailOpen(true);
        }}
        onEdit={(card) => bukaForm(card)}
        onSuspendToggle={handleSuspendToggle}
        onDelete={handleDelete}
      />

      <MitraEsBalokDetailDialog open={detailOpen} onOpenChange={setDetailOpen} kode={kode} data={terpilih} onEdit={(c) => bukaForm(c)} />

      {form && (
        <MitraEsBalokFormDialog
          key={form.seri}
          open
          onOpenChange={(o) => {
            if (!o) setForm(null);
          }}
          kode={kode}
          card={form.card}
          jumlahKartuAgen={form.card ? (jumlahPerAgen.get(`${form.card.sumber}:${form.card.agenId}`) ?? 1) : 1}
          aksi={aksi}
          onSelesai={() => {
            setForm(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
