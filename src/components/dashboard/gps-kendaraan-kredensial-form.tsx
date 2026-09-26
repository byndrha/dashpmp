"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GpsKredensialRow, GpsProvider } from "@/lib/queries/gps-kendaraan-kredensial";
import { upsertGpsKredensialAction } from "@/app/grup/perusahaan/actions";

const PROVIDERS: { value: GpsProvider; label: string }[] = [
  { value: "hino", label: "Hino Connect" },
  { value: "solofleet", label: "SoloFleet" },
];

function ProviderRow({ provider, label, existing }: { provider: GpsProvider; label: string; existing: GpsKredensialRow | undefined }) {
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

export function GpsKendaraanKredensialForm({ existing }: { existing: GpsKredensialRow[] }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="font-display text-base font-semibold">Kredensial GPS Kendaraan</h2>
        <p className="text-sm text-muted-foreground">
          Dipakai oleh sinkronisasi posisi GPS armada dari Hino Connect dan SoloFleet. Password tidak pernah ditampilkan setelah
          tersimpan — kosongkan field password untuk mempertahankan yang sudah ada.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {PROVIDERS.map(({ value, label }) => (
          <ProviderRow key={value} provider={value} label={label} existing={existing.find((r) => r.provider === value)} />
        ))}
      </div>
    </div>
  );
}
