"use client";

import { useState, useTransition, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { GpsKredensialRow, GpsProvider } from "@/lib/queries/gps-kendaraan-kredensial";
import { listGpsKredensialByPerusahaanAction, upsertGpsKredensialAction } from "@/app/grup/perusahaan/actions";

const PROVIDERS: { value: GpsProvider; label: string }[] = [
  { value: "hino", label: "Hino Connect" },
  { value: "solofleet", label: "SoloFleet" },
];

function ProviderRow({
  perusahaanId,
  provider,
  label,
  existing,
}: {
  perusahaanId: number;
  provider: GpsProvider;
  label: string;
  existing: GpsKredensialRow | undefined;
}) {
  // `existing` is already resolved by the time this component's parent
  // renders it (the dialog only mounts ProviderRow once `rows` has loaded —
  // see the "Memuat..." gate below), so this initial value is never stale
  // and no effect is needed to sync it later.
  const [username, setUsername] = useState(existing?.username ?? "");
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await upsertGpsKredensialAction({
        perusahaanId,
        provider,
        username,
        password: password.trim() ? password : null,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setPassword("");
      setSaved(true);
    });
  }

  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
      <legend className="px-1 text-xs font-medium text-muted-foreground">
        {label} {existing ? "(sudah dikonfigurasi)" : "(belum dikonfigurasi)"}
      </legend>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`gps-${provider}-username`}>Username</Label>
          <Input id={`gps-${provider}-username`} value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`gps-${provider}-password`}>Password</Label>
          <Input
            id={`gps-${provider}-password`}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={existing ? "(kosongkan untuk mempertahankan password saat ini)" : "wajib diisi"}
          />
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        {saved && !pending && <p className="text-xs text-primary">Tersimpan.</p>}
        <Button type="button" size="sm" onClick={handleSave} disabled={pending}>
          {pending ? "Menyimpan..." : "Simpan Kredensial"}
        </Button>
      </div>
    </fieldset>
  );
}

// Per-PT dialog — opened from a PT's own card on /grup/perusahaan. Each PT
// (MKEsindo, PMPutra, ...) has its own Hino Connect / SoloFleet account, so
// this is scoped to one perusahaanId at a time rather than one global form
// for the whole app.
export function GpsKendaraanKredensialDialog({
  perusahaanId,
  perusahaanNama,
  onOpenChange,
}: {
  perusahaanId: number | null;
  perusahaanNama: string;
  onOpenChange: (open: boolean) => void;
}) {
  // The parent (perusahaan-list.tsx) gives this dialog a fresh `key` every
  // time it opens for a (possibly different) PT, so this component fully
  // remounts on open/close — `rows` starting at `null` on each mount is
  // already the correct reset, no separate effect branch needed for it.
  const [rows, setRows] = useState<GpsKredensialRow[] | null>(null);

  useEffect(() => {
    if (perusahaanId == null) return;
    let cancelled = false;
    (async () => {
      const result = await listGpsKredensialByPerusahaanAction(perusahaanId);
      if (!cancelled && result.success) setRows(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [perusahaanId]);

  return (
    <Dialog open={perusahaanId != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Kredensial GPS Kendaraan — {perusahaanNama}</DialogTitle>
          <DialogDescription>
            Dipakai oleh sinkronisasi posisi GPS armada milik PT ini dari Hino Connect dan SoloFleet. Password tidak
            pernah ditampilkan setelah tersimpan — kosongkan field password untuk mempertahankan yang sudah ada.
          </DialogDescription>
        </DialogHeader>
        {perusahaanId != null && rows === null ? (
          <p className="text-sm text-muted-foreground">Memuat...</p>
        ) : (
          <div className="flex flex-col gap-3">
            {PROVIDERS.map(({ value, label }) => (
              <ProviderRow
                key={value}
                perusahaanId={perusahaanId!}
                provider={value}
                label={label}
                existing={rows?.find((r) => r.provider === value)}
              />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
