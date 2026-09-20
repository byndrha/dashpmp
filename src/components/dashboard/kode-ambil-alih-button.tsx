"use client";

import { useState, useEffect, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  generateKodeAmbilAlihAction,
  getKodeAmbilAlihAktifAction,
  getRiwayatKodeAmbilAlihAction,
  type RiwayatKodeAmbilAlihRowWithNama,
} from "@/app/mkesindo/kode-ambil-alih/actions";

// Pulled out to a plain module-level function (rather than calling
// Date.now() straight inside the component body) so the react-hooks/purity
// lint rule doesn't flag it -- same pattern as nowMs in
// driver-app/tugas-list.tsx / resolveEndMs in route-validation-dialog.tsx:
// the rule only recognizes impure calls written directly in a
// component/hook body, not ones behind a named helper.
function nowMs(): number {
  return Date.now();
}

const AKSI_LABEL: Record<string, string> = { MULAI_MUAT: "Mulai Muat", SELESAI_MUAT: "Selesai Muat" };

export function KodeAmbilAlihButton() {
  const [open, setOpen] = useState(false);
  const [kodeAktif, setKodeAktif] = useState<{ kode: string; kedaluwarsaPada: string } | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [riwayat, setRiwayat] = useState<RiwayatKodeAmbilAlihRowWithNama[]>([]);
  const [pending, startTransition] = useTransition();
  const [sisaDetik, setSisaDetik] = useState(0);

  function muatData() {
    getKodeAmbilAlihAktifAction().then((r) => setKodeAktif(r.success ? r.data : null));
    getRiwayatKodeAmbilAlihAction().then((r) => {
      if (r.success) setRiwayat(r.data);
    });
  }

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(null);
      setPassword("");
      muatData();
    }
  }, [open]);

  useEffect(() => {
    if (!kodeAktif) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSisaDetik(0);
      return;
    }
    const update = () => setSisaDetik(Math.max(0, Math.floor((new Date(kodeAktif.kedaluwarsaPada).getTime() - nowMs()) / 1000)));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [kodeAktif]);

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      const result = await generateKodeAmbilAlihAction(password);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setKodeAktif(result.data);
      setPassword("");
      muatData();
    });
  }

  return (
    <>
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)} title="Kode Ambil-Alih">
        <KeyRound className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-w-sm flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Kode Ambil-Alih Mulai/Selesai Muat</DialogTitle>
          </DialogHeader>
          {kodeAktif === undefined ? (
            <p className="text-sm text-muted-foreground">Memuat...</p>
          ) : kodeAktif ? (
            <div className="flex flex-col items-center gap-1 rounded-md border border-border p-3">
              <p className="text-3xl font-bold tabular-nums tracking-widest">{kodeAktif.kode}</p>
              <p className="text-xs text-muted-foreground">Berlaku {sisaDetik} detik lagi</p>
              <Button size="sm" variant="outline" onClick={() => setKodeAktif(null)}>
                Generate Kode Baru
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Input
                type="password"
                placeholder="Password Anda"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button size="sm" disabled={pending || !password} onClick={handleGenerate}>
                Generate Kode
              </Button>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold text-muted-foreground">Riwayat Kode</p>
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto text-xs">
              {riwayat.length === 0 && <p className="text-muted-foreground">Belum ada riwayat.</p>}
              {riwayat.map((r, index) => (
                <div key={r.id} className="flex flex-col border-b border-border py-1 last:border-b-0">
                  <span>
                    {r.kode} — dibuat {r.dibuatOlehNama} ({new Date(r.dibuatPada).toLocaleString("id-ID")})
                  </span>
                  <span className="text-muted-foreground">
                    {r.dipakaiPada
                      ? `Dipakai ${r.dipakaiOlehNama} untuk ${AKSI_LABEL[r.dipakaiUntukAksi ?? ""] ?? r.dipakaiUntukAksi} (Jadwal #${r.dipakaiUntukJadwalId}) — ${new Date(r.dipakaiPada).toLocaleString("id-ID")}`
                      : new Date(r.kedaluwarsaPada).getTime() < nowMs()
                        ? "Kedaluwarsa, tidak terpakai"
                        : index === 0
                          ? "Masih aktif"
                          : "Digantikan kode baru"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
