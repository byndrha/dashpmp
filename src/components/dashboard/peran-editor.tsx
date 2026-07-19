"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MODULE_KEYS, MODULE_LABEL, type ModuleKey, type PermissionMap } from "@/lib/permissions";
import type { DashboardRoleRow } from "@/lib/queries/akun";
import { createRoleAction, deleteRoleAction, setRolePermissionAction } from "@/app/(dashboard)/akun/peran/actions";

interface RolePermissionRow {
  roleId: number;
  moduleKey: string;
  canView: boolean;
  canEdit: boolean;
}

function buildMap(rows: RolePermissionRow[], roleId: number): PermissionMap {
  const map: PermissionMap = {};
  for (const key of MODULE_KEYS) {
    const row = rows.find((r) => r.roleId === roleId && r.moduleKey === key);
    map[key] = { canView: row?.canView ?? false, canEdit: row?.canEdit ?? false };
  }
  return map;
}

function RoleCard({
  role,
  initialMap,
}: {
  role: DashboardRoleRow;
  initialMap: PermissionMap;
}) {
  const [map, setMap] = useState(initialMap);
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

  function handleSave() {
    setError(null);
    startTransition(async () => {
      try {
        await Promise.all(
          MODULE_KEYS.map((key) =>
            setRolePermissionAction({
              roleId: role.roleId,
              moduleKey: key,
              canView: map[key]?.canView ?? false,
              canEdit: map[key]?.canEdit ?? false,
            })
          )
        );
        setDirty(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan otoritas.");
      }
    });
  }

  function handleDelete() {
    if (!confirm(`Hapus peran "${role.roleName}"?`)) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteRoleAction(role.roleId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menghapus peran.");
      }
    });
  }

  return (
    <Card size="sm">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="font-display text-sm">
          {role.roleName} <span className="font-normal text-muted-foreground">({role.userCount} akun)</span>
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
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={map[key]?.canView ?? false}
                      onChange={() => toggle(key, "canView")}
                    />
                  </td>
                  <td className="p-1.5 text-center">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={map[key]?.canEdit ?? false}
                      onChange={() => toggle(key, "canEdit")}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button size="sm" className="w-fit" disabled={pending || !dirty} onClick={handleSave}>
          {pending ? "Menyimpan..." : "Simpan Otoritas"}
        </Button>
      </CardContent>
    </Card>
  );
}

function CreateRoleDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await createRoleAction(String(formData.get("roleName") ?? ""));
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menambah peran.");
      }
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
            <Label htmlFor="roleName">Nama Peran</Label>
            <Input id="roleName" name="roleName" required />
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
  roles,
  permissions,
}: {
  roles: DashboardRoleRow[];
  permissions: RolePermissionRow[];
}) {
  const [creating, setCreating] = useState(false);
  const superAdminRole = roles.find((r) => r.isSuperAdmin);
  const otherRoles = roles.filter((r) => !r.isSuperAdmin);

  return (
    <div className="flex flex-col gap-3">
      {superAdminRole && (
        <Card size="sm" className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center gap-3 py-1">
            <ShieldCheck className="size-4 shrink-0 text-primary" />
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{superAdminRole.roleName}</span> ({superAdminRole.userCount}{" "}
              akun) selalu memiliki akses penuh (lihat &amp; ubah) ke seluruh modul, termasuk Akun &mdash; tidak
              dapat diatur di sini.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{otherRoles.length} peran lain.</p>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          Tambah Peran
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
        {otherRoles.map((role) => (
          <RoleCard key={role.roleId} role={role} initialMap={buildMap(permissions, role.roleId)} />
        ))}
        {otherRoles.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Belum ada peran lain.</p>
        )}
      </div>

      <CreateRoleDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

// Re-export for callers that only need the Badge-friendly type shape.
export type { RolePermissionRow };
