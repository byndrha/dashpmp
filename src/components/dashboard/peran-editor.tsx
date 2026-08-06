"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MODULE_KEYS, MODULE_LABEL, type ModuleKey, type PermissionMap } from "@/lib/permissions";
import type { PeranRow, PeranIzinRow, PerusahaanDirektoriOption } from "@/lib/queries/akun";
import {
  createPeranAction,
  deletePeranAction,
  setPeranIzinAction,
  setPeranSatpamAction,
  setPeranDriverAction,
} from "@/app/grup/akun/peran/actions";

function buildMap(izinList: PeranIzinRow[], peranId: number): PermissionMap {
  const map: PermissionMap = {};
  for (const key of MODULE_KEYS) {
    const row = izinList.find((r) => r.peranId === peranId && r.moduleKey === key);
    map[key] = { canView: row?.canView ?? false, canEdit: row?.canEdit ?? false };
  }
  return map;
}

function RoleCard({ peran, initialMap }: { peran: PeranRow; initialMap: PermissionMap }) {
  const [map, setMap] = useState(initialMap);
  const [isSatpam, setIsSatpam] = useState(peran.isSatpam);
  const [isDriver, setIsDriverState] = useState(peran.isDriver);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  function toggle(moduleKey: ModuleKey, field: "canView" | "canEdit") {
    setMap((prev) => {
      const current = prev[moduleKey] ?? { canView: false, canEdit: false };
      const next = { ...current, [field]: !current[field] };
      if (field === "canEdit" && next.canEdit) next.canView = true;
      if (field === "canView" && !next.canView) next.canEdit = false;
      return { ...prev, [moduleKey]: next };
    });
    setDirty(true);
  }

  function toggleSatpam() {
    setIsSatpam((prev) => !prev);
    setDirty(true);
  }

  function toggleDriver() {
    setIsDriverState((prev) => !prev);
    setDirty(true);
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const results = await Promise.all([
        ...MODULE_KEYS.map((key) =>
          setPeranIzinAction({
            peranId: peran.id,
            moduleKey: key,
            canView: map[key]?.canView ?? false,
            canEdit: map[key]?.canEdit ?? false,
          })
        ),
        setPeranSatpamAction(peran.id, isSatpam),
        setPeranDriverAction(peran.id, isDriver),
      ]);
      const failed = results.find((r) => !r.success);
      if (failed && !failed.success) {
        setError(failed.error);
        return;
      }
      setDirty(false);
    });
  }

  function handleDelete() {
    if (!confirm(`Hapus peran "${peran.nama}"?`)) return;
    setError(null);
    startTransition(async () => {
      const result = await deletePeranAction(peran.id);
      if (!result.success) {
        setError(result.error);
      }
    });
  }

  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="font-display text-sm">
          {peran.nama} <span className="font-normal text-muted-foreground">({peran.akunCount} akun)</span>
        </CardTitle>
        <Button variant="ghost" size="icon" className="size-7" disabled={pending} onClick={handleDelete}>
          <Trash2 className="size-3.5 text-destructive" />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="p-1.5 text-left font-medium">Modul</th>
                <th className="p-1.5 text-center font-medium">Lihat</th>
                <th className="p-1.5 text-center font-medium">Ubah</th>
              </tr>
            </thead>
            <tbody>
              {MODULE_KEYS.map((key) => (
                <tr key={key} className="border-t border-border">
                  <td className="p-1.5">{MODULE_LABEL[key]}</td>
                  <td className="p-1.5 text-center">
                    <input type="checkbox" className="accent-primary" checked={map[key]?.canView ?? false} onChange={() => toggle(key, "canView")} />
                  </td>
                  <td className="p-1.5 text-center">
                    <input type="checkbox" className="accent-primary" checked={map[key]?.canEdit ?? false} onChange={() => toggle(key, "canEdit")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label className="flex items-center gap-2 rounded-md border border-border p-2 text-xs">
          <input type="checkbox" className="accent-primary" checked={isSatpam} onChange={toggleSatpam} />
          <span>
            Peran Khusus: Satpam
            <span className="block text-muted-foreground">
              Hanya akun dengan peran ini yang bisa mengisi Cek Berangkat/Cek Datang di Validasi Rute.
            </span>
          </span>
        </label>
        <label className="flex items-center gap-2 rounded-md border border-border p-2 text-xs">
          <input type="checkbox" className="accent-primary" checked={isDriver} onChange={toggleDriver} />
          <span>
            Peran Khusus: Driver
            <span className="block text-muted-foreground">
              Akun dengan peran ini diarahkan ke Aplikasi Driver setelah login, dan hanya melihat tugas milik dirinya
              sendiri (perlu ditautkan ke identitas Driver lewat halaman Akun).
            </span>
          </span>
        </label>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button size="sm" className="w-fit" disabled={pending || !dirty} onClick={handleSave}>
          {pending ? "Menyimpan..." : "Simpan Otoritas"}
        </Button>
      </CardContent>
    </Card>
  );
}

function CreatePeranDialog({
  open,
  onOpenChange,
  perusahaanId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  perusahaanId: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createPeranAction(perusahaanId, String(formData.get("nama") ?? ""));
      if (!result.success) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Tambah Peran</DialogTitle>
          <DialogDescription>Peran baru dimulai tanpa akses ke modul apa pun.</DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nama">Nama Peran</Label>
            <Input id="nama" name="nama" required />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending} className="ml-auto">
              {pending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PeranEditor({
  peranList,
  izinList,
  perusahaanList,
}: {
  peranList: PeranRow[];
  izinList: PeranIzinRow[];
  perusahaanList: PerusahaanDirektoriOption[];
}) {
  const [perusahaanId, setPerusahaanId] = useState<number | null>(perusahaanList[0]?.id ?? null);
  const [creating, setCreating] = useState(false);

  const scoped = peranList.filter((p) => p.perusahaanId === perusahaanId);
  const superAdminRole = scoped.find((p) => p.isSuperAdmin);
  const otherRoles = scoped.filter((p) => !p.isSuperAdmin);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Perusahaan</Label>
        <Select value={perusahaanId != null ? String(perusahaanId) : ""} onValueChange={(v) => setPerusahaanId(v ? Number(v) : null)}>
          <SelectTrigger className="w-64">
            <SelectValue>{() => perusahaanList.find((p) => p.id === perusahaanId)?.nama ?? "Pilih PT"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {perusahaanList.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.nama}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {superAdminRole && (
        <Card size="sm" className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center gap-3 py-1">
            <ShieldCheck className="size-4 shrink-0 text-primary" />
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{superAdminRole.nama}</span> ({superAdminRole.akunCount} akun) selalu
              memiliki akses penuh (lihat &amp; ubah) ke seluruh modul, termasuk Akun &mdash; tidak dapat diatur di sini.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{otherRoles.length} peran lain untuk PT ini.</p>
        <Button disabled={perusahaanId == null} onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          Tambah Peran
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
        {otherRoles.map((peran) => (
          <RoleCard key={peran.id} peran={peran} initialMap={buildMap(izinList, peran.id)} />
        ))}
        {otherRoles.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Belum ada peran lain untuk PT ini.</p>
        )}
      </div>

      {perusahaanId != null && <CreatePeranDialog open={creating} onOpenChange={setCreating} perusahaanId={perusahaanId} />}
    </div>
  );
}
