"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { Clock, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { shiftDari } from "@/lib/produksi-operasional";
import { takeAwayMulaiMuatAction, takeAwaySelesaiMuatAction } from "@/app/mkesindo/produksi/actions";
import type { ActionResult } from "@/lib/action-result";
import type { TakeAwayMuatanPendingRow, TakeAwayMuatanSelesaiRow } from "@/lib/queries/takeaway-muatan";

const VARIANT_LABEL: Record<string, string> = { "5kg": "kantong 5kg", "10kg": "kantong 10kg" };
const VARIANT_CHIP: Record<string, string> = { "5kg": "5KG", "10kg": "10KG" };

export function TakeAwayMuatanList({
  initialPending,
  fetchSelesaiList,
  onAfterMuat,
}: {
  initialPending: TakeAwayMuatanPendingRow[];
  fetchSelesaiList: () => Promise<ActionResult<TakeAwayMuatanSelesaiRow[]>>;
  onAfterMuat: () => void;
}) {
  const [pendingList, setPendingList] = useState(initialPending);
  const [selected, setSelected] = useState<TakeAwayMuatanPendingRow | null>(null);
  const [selesaiList, setSelesaiList] = useState<TakeAwayMuatanSelesaiRow[] | null>(null);
  const sekarang = useSekarang();

  function refreshSelesaiList() {
    fetchSelesaiList().then((result) => {
      if (result.success) setSelesaiList(result.data);
    });
  }

  useEffect(() => {
    refreshSelesaiList();
    // Only ever meant to fire once on mount — fetchSelesaiList is a stable
    // action reference for this component instance's whole lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDone(takeAwayMuatanId: number) {
    setPendingList((prev) => prev.filter((r) => r.takeAwayMuatanId !== takeAwayMuatanId));
    setSelected(null);
    refreshSelesaiList();
    onAfterMuat();
  }

  function handleMulaiMuatDone(takeAwayMuatanId: number) {
    const stamped = new Date();
    setPendingList((prev) => prev.map((r) => (r.takeAwayMuatanId === takeAwayMuatanId ? { ...r, jamMulaiMuat: stamped } : r)));
    setSelected((prev) => (prev && prev.takeAwayMuatanId === takeAwayMuatanId ? { ...prev, jamMulaiMuat: stamped } : prev));
  }

  if (selected) {
    return (
      <IsiMuatanScreen
        row={selected}
        onBack={() => setSelected(null)}
        onMulaiMuatDone={handleMulaiMuatDone}
        onDone={() => handleDone(selected.takeAwayMuatanId)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      <p className="text-sm font-medium text-muted-foreground">TakeAway — Menunggu/Sedang Dimuat</p>
      {pendingList.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">Tidak ada order TakeAway yang menunggu diproses.</p>
      ) : (
        pendingList.map((row) => (
          <button key={row.takeAwayMuatanId} type="button" onClick={() => setSelected(row)} className="text-left">
            <KartuTakeAway
              nama={row.customerName}
              soVoucherNo={row.soVoucherNo}
              variant={row.variant}
              qty={row.qtyDipesan}
              dibuatPada={row.dibuatPada}
              status={row.jamMulaiMuat != null ? "dimuat" : "menunggu"}
              sejak={row.jamMulaiMuat}
              sekarang={sekarang}
            />
          </button>
        ))
      )}

      {selesaiList != null && selesaiList.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <p className="text-sm font-medium text-muted-foreground">TakeAway — Baru Selesai</p>
          {selesaiList.map((row) => (
            <KartuTakeAway
              key={row.takeAwayMuatanId}
              nama={row.customerName}
              soVoucherNo={row.soVoucherNo}
              variant={row.variant}
              qty={row.qtyDimuat}
              qtyDipesan={row.qtyDipesan}
              dibuatPada={row.dibuatPada}
              status="selesai"
              sejak={row.jamSelesaiMuat}
              sekarang={sekarang}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Kartu pesanan TakeAway ─────────────────────────────────────────────────
// [Nama mitra                        (Menunggu)]
// SO 003655 · Masuk 21 Nov 16.07
// [10KG 6]  [Shift 2 → 3]            ⏱ Menunggu 2j 15m
// Shift = shift (WIB) saat pesanan masuk; "→ n" bila shift yang sekarang
// (atau yang menyelesaikan) berbeda — tanggung jawab sudah berpindah.

type StatusTakeAway = "menunggu" | "dimuat" | "selesai";

// "Sekarang" (dibulatkan ke menit) yang diperbarui tiap menit — supaya lama
// menunggu terus berjalan. Lewat useSyncExternalStore dengan snapshot server
// null: lama menunggu hanya dihitung di browser, jadi HTML server & client
// tidak pernah berbeda (hydration mismatch) karena selisih jam.
function langgananMenit(cb: () => void): () => void {
  const id = setInterval(cb, 30_000);
  return () => clearInterval(id);
}
function menitSekarang(): number {
  return Math.floor(Date.now() / 60_000) * 60_000;
}
function useSekarang(): number | null {
  return useSyncExternalStore(langgananMenit, menitSekarang, () => null);
}

function durasi(ms: number): string {
  const menit = Math.max(0, Math.floor(ms / 60_000));
  const hari = Math.floor(menit / 1440);
  const jam = Math.floor((menit % 1440) / 60);
  const m = menit % 60;
  if (hari > 0) return `${hari} hari ${jam}j`;
  if (jam > 0) return `${jam}j ${m}m`;
  return `${m}m`;
}

function waktuWib(d: Date): string {
  const x = new Date(d);
  const tgl = x.toLocaleDateString("id-ID", { day: "2-digit", month: "short", timeZone: "Asia/Jakarta" });
  const jam = x.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
  return `${tgl} ${jam}`;
}

// "MKE/SO/003655/2026-11/003/001" → "SO 003655".
function soSingkat(voucherNo: string | null): string | null {
  if (!voucherNo) return null;
  const p = voucherNo.split("/");
  return p.length >= 3 ? `${p[1]} ${p[2]}` : voucherNo;
}

const STATUS: Record<StatusTakeAway, { label: string; kelas: string }> = {
  menunggu: { label: "Menunggu", kelas: "bg-muted text-muted-foreground" },
  dimuat: { label: "Sedang dimuat", kelas: "bg-amber-500/15 text-amber-600" },
  selesai: { label: "Selesai", kelas: "bg-emerald-500/15 text-emerald-600" },
};

// Menunggu lebih lama dari ini ditandai merah.
const BATAS_MENUNGGU_MS = 2 * 60 * 60_000;
// Belum selesai lebih dari 24 jam sejak masuk = "Tidak dilaksanakan"
// (permintaan pengguna 2026-11-22). Daftar menunggu sendiri dibatasi 5 hari.
const BATAS_TIDAK_DILAKSANAKAN_MS = 24 * 60 * 60_000;
const STATUS_TIDAK_DILAKSANAKAN = { label: "Tidak dilaksanakan", kelas: "bg-destructive/15 text-destructive" };

function KartuTakeAway({
  nama,
  soVoucherNo,
  variant,
  qty,
  qtyDipesan,
  dibuatPada,
  status,
  sejak,
  sekarang,
}: {
  nama: string;
  soVoucherNo: string | null;
  variant: string;
  qty: number;
  qtyDipesan?: number;
  dibuatPada: Date;
  status: StatusTakeAway;
  sejak: Date | null; // mulai muat (dimuat) / selesai muat (selesai)
  sekarang: number | null; // null saat render server (lihat useSekarang)
}) {
  const dibuat = new Date(dibuatPada).getTime();
  const akhir = status === "selesai" && sejak ? new Date(sejak).getTime() : (sekarang ?? dibuat);
  const siap = status === "selesai" || sekarang != null;
  const lama = akhir - dibuat;
  const shiftMasuk = shiftDari(new Date(dibuat));
  const shiftKini = shiftDari(new Date(akhir));
  // Tanggung jawab berpindah bila shift saat ini/selesai berbeda dari shift masuk.
  const pindah = shiftKini !== shiftMasuk;
  const tidakDilaksanakan = status !== "selesai" && siap && lama > BATAS_TIDAK_DILAKSANAKAN_MS;
  const terlambat = (status === "menunggu" && lama > BATAS_MENUNGGU_MS) || tidakDilaksanakan;
  const so = soSingkat(soVoucherNo);
  const st = tidakDilaksanakan ? STATUS_TIDAK_DILAKSANAKAN : STATUS[status];

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border bg-card p-3",
        status === "selesai" && "bg-muted/20",
        terlambat && "border-destructive/40"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate font-semibold leading-tight">{nama}</p>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", st.kelas)}>{st.label}</span>
      </div>
      <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
        {so && (
          <span className="inline-flex items-center gap-1" title={soVoucherNo ?? undefined}>
            <FileText className="size-3" />
            {so}
          </span>
        )}
        {so && <span>·</span>}
        <span>Masuk {waktuWib(dibuatPada)}</span>
        {status === "selesai" && sejak && (
          <>
            <span>·</span>
            <span>Selesai {waktuWib(sejak)}</span>
          </>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 dark:text-sky-400">
          {VARIANT_CHIP[variant] ?? variant}
          <span className="font-bold">
            {qty.toLocaleString("id-ID")}
            {qtyDipesan != null && qtyDipesan !== qty && <span className="font-medium opacity-70">/{qtyDipesan}</span>}
          </span>
        </span>
        <span
          className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground/80"
          title={
            pindah
              ? `Masuk di Shift ${shiftMasuk}, ${status === "selesai" ? "diselesaikan" : "kini tanggung jawab"} Shift ${shiftKini}`
              : `Shift ${shiftMasuk}`
          }
        >
          Shift {shiftMasuk}
          {pindah && ` → ${shiftKini}`}
        </span>
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1 text-[11px]",
            terlambat ? "font-semibold text-destructive" : "text-muted-foreground"
          )}
        >
          <Clock className="size-3" />
          {!siap ? "Menunggu …" : status === "selesai" ? `Selesai dalam ${durasi(lama)}` : `Menunggu ${durasi(lama)}`}
        </span>
      </div>
    </div>
  );
}

// Step 1/2 gate: a row already resumed after backing out mid-flow skips
// straight to the confirmation screen (row.jamMulaiMuat is already set), a
// fresh one shows the explicit "Mulai Muat" screen first — same pattern as
// IsiMuatanScreen in kartu-pengiriman-list.tsx.
function IsiMuatanScreen({
  row,
  onBack,
  onMulaiMuatDone,
  onDone,
}: {
  row: TakeAwayMuatanPendingRow;
  onBack: () => void;
  onMulaiMuatDone: (takeAwayMuatanId: number) => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"mulai" | "konfirmasi">(row.jamMulaiMuat != null ? "konfirmasi" : "mulai");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (step === "mulai") {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Button variant="outline" size="sm" onClick={onBack} className="w-fit">
          Kembali
        </Button>
        <p className="font-semibold">{row.customerName}</p>
        <p className="text-sm">
          {row.qtyDipesan} {VARIANT_LABEL[row.variant] ?? row.variant}
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await takeAwayMulaiMuatAction(row.takeAwayMuatanId);
              if (!result.success) {
                setError(result.error);
                return;
              }
              onMulaiMuatDone(row.takeAwayMuatanId);
              setStep("konfirmasi");
            });
          }}
        >
          {pending ? "Memproses..." : "Mulai Muat"}
        </Button>
      </div>
    );
  }

  return <KonfirmasiScreen row={row} onBack={onBack} onDone={onDone} />;
}

function KonfirmasiScreen({
  row,
  onBack,
  onDone,
}: {
  row: TakeAwayMuatanPendingRow;
  onBack: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSelesai() {
    startTransition(async () => {
      const result = await takeAwaySelesaiMuatAction(row.takeAwayMuatanId);
      if (!result.success) {
        setConfirmOpen(false);
        setError(result.error);
        return;
      }
      onDone();
    });
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <Button variant="outline" size="sm" onClick={onBack} className="w-fit">
        Kembali
      </Button>
      <p className="font-semibold">{row.customerName}</p>
      <p className="text-sm">
        Qty dimuat: {row.qtyDipesan} {VARIANT_LABEL[row.variant] ?? row.variant} (sesuai pesanan)
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button disabled={pending} onClick={() => setConfirmOpen(true)}>
        Selesai Muat
      </Button>

      <Dialog open={confirmOpen} onOpenChange={(open) => !open && !pending && setConfirmOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Selesaikan Muat — {row.customerName}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Surat Jalan/Invoice akan diterbitkan dan masuk antrian cetak untuk {row.qtyDipesan}{" "}
            {VARIANT_LABEL[row.variant] ?? row.variant}.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={pending} onClick={() => setConfirmOpen(false)}>
              Tidak
            </Button>
            <Button disabled={pending} onClick={handleSelesai}>
              {pending ? "Memproses..." : "Ya, Selesai Muat"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
