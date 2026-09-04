"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getRiwayatProduksiForPosisiAction,
  updateBatchQtyAction,
  deleteBatchAction,
  type RiwayatProduksiRowWithNama,
} from "@/app/mkesindo/produksi/actions";

function formatPeriodeLabel(windowEnd: Date): string {
  const windowStart = new Date(windowEnd.getTime() - 24 * 3600000);
  const fmt = (d: Date) => d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return `${fmt(windowStart)} — ${fmt(windowEnd)}`;
}

// Desktop-only counterpart to produksi-app's RiwayatPosisiList (mobile,
// tambah-produksi-dialog.tsx) — same underlying data (getRiwayatProduksiForPosisiAction),
// but adds per-row Ubah/Hapus. Retroactive stock correction is deliberately
// an admin/supervisor-only capability (this component lives only on
// /mkesindo/produksi), not something exposed on the mobile app a floor
// operator uses mid-shift.
function BatchRow({ row, onChanged }: { row: RiwayatProduksiRowWithNama; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(String(row.Qty10KG));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const terpakai = row.Qty10KG - row.SisaQty10KG;
  const bisaDihapus = terpakai === 0;

  function handleSimpan() {
    setError(null);
    startTransition(async () => {
      const result = await updateBatchQtyAction(row.BatchID, Number(qty) || 0);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setEditing(false);
      onChanged();
    });
  }

  function handleHapus() {
    if (!confirm(`Hapus input ${row.Qty10KG} kantong dari ${row.MesinNama} ini? Tindakan ini tidak bisa dibatalkan.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteBatchAction(row.BatchID);
      if (!result.success) {
        setError(result.error);
        return;
      }
      onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-1 border-b border-border py-1.5 last:border-b-0">
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="min-w-0 truncate">
          {new Date(row.TanggalLabel).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
          {" — Shift "}
          {row.Shift}
          {" — "}
          {row.JamPanen}
          {" — "}
          {row.MesinNama}
        </span>
        {!editing && (
          <div className="flex shrink-0 items-center gap-1">
            <span className="font-medium text-foreground">{row.Qty10KG} kantong 10kg</span>
            {terpakai > 0 && <span>(terpakai {terpakai})</span>}
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              disabled={pending}
              onClick={() => {
                setQty(String(row.Qty10KG));
                setError(null);
                setEditing(true);
              }}
            >
              <Pencil className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              disabled={pending || !bisaDihapus}
              title={!bisaDihapus ? `Sudah ${terpakai} kantong terpakai — tidak bisa dihapus` : undefined}
              onClick={handleHapus}
            >
              <Trash2 className="size-3 text-destructive" />
            </Button>
          </div>
        )}
      </div>
      {editing && (
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            min={terpakai}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="h-7 w-24 text-xs"
          />
          <Button size="sm" className="h-7 px-2 text-xs" disabled={pending} onClick={handleSimpan}>
            Simpan
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={pending} onClick={() => setEditing(false)}>
            Batal
          </Button>
        </div>
      )}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

export function RiwayatPosisiListDesktop({ posisiId }: { posisiId: number }) {
  // Berapa periode 24-jam ke belakang dari sekarang -- 0 = 24 jam terakhir
  // s.d. sekarang, 1 = 24 jam sebelum itu, dst. Direset ke 0 tiap kali
  // pallete yang dilihat berganti (lihat effect di bawah).
  const [offsetPeriods, setOffsetPeriods] = useState(0);
  // Paired with the posisiId+offset it was fetched for (not just the raw
  // rows) so switching pallete or periode mid-load can't briefly show the
  // PREVIOUS combination's rows under the new heading — same pattern as
  // produksi-app's own RiwayatPosisiList (tambah-produksi-dialog.tsx).
  const [state, setState] = useState<{ posisiId: number; offsetPeriods: number; rows: RiwayatProduksiRowWithNama[] } | null>(
    null
  );

  const [now] = useState(() => new Date());
  const windowEnd = new Date(now.getTime() - offsetPeriods * 24 * 3600000);

  function load() {
    getRiwayatProduksiForPosisiAction(posisiId, windowEnd.toISOString()).then((result) => {
      if (result.success) setState({ posisiId, offsetPeriods, rows: result.data });
    });
  }

  useEffect(() => {
    let cancelled = false;
    getRiwayatProduksiForPosisiAction(posisiId, windowEnd.toISOString()).then((result) => {
      if (cancelled) return;
      if (result.success) setState({ posisiId, offsetPeriods, rows: result.data });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posisiId, offsetPeriods]);

  const rows = state && state.posisiId === posisiId && state.offsetPeriods === offsetPeriods ? state.rows : null;

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">Riwayat &amp; Kelola Stok Pallete Ini</p>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-6"
            onClick={() => setOffsetPeriods((p) => p + 1)}
            title="Periode sebelumnya"
          >
            <ChevronLeft className="size-3" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-6"
            disabled={offsetPeriods === 0}
            onClick={() => setOffsetPeriods((p) => Math.max(0, p - 1))}
            title="Periode berikutnya"
          >
            <ChevronRight className="size-3" />
          </Button>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">{formatPeriodeLabel(windowEnd)}</p>
      {rows === null ? (
        <p className="text-xs text-muted-foreground">Memuat...</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Belum ada riwayat.</p>
      ) : (
        <div className="flex max-h-56 flex-col overflow-y-auto">
          {rows.map((r) => (
            <BatchRow key={r.BatchID} row={r} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}
