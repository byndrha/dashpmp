"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MitraLocationField, type MitraLocationValue } from "@/components/dashboard/mitra-location-field";
import { setPabrikLocationAction } from "@/app/(dashboard)/akun/actions";

// Reuses MitraLocationField's generic lat/lng/alamat editing UI (search,
// "use my location", reverse geocode, draggable pin) for the single global
// Pabrik point instead of a per-mitra one — the field's API is already
// value/onChange, nothing mitra-specific about it beyond its name.
export function PabrikLocationSettings({ initial }: { initial: MitraLocationValue }) {
  const [value, setValue] = useState<MitraLocationValue>(initial);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setSaved(false);
    startTransition(async () => {
      await setPabrikLocationAction({
        latitude: value.latitude,
        longitude: value.longitude,
        alamat: value.alamat,
      });
      setSaved(true);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Lokasi Pabrik</CardTitle>
        <CardDescription>
          Titik awal &amp; akhir rute pengiriman. Dipakai di seluruh aplikasi (validasi rute, estimasi jarak mitra).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <MitraLocationField value={value} onChange={setValue} />
        <Button size="sm" className="self-end" disabled={pending} onClick={handleSave}>
          <Save className="size-3.5" />
          {pending ? "Menyimpan..." : "Simpan Lokasi Pabrik"}
        </Button>
        {saved && !pending && <p className="text-right text-xs text-primary">Tersimpan.</p>}
      </CardContent>
    </Card>
  );
}
