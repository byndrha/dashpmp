"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil, KeyRound, Phone, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import type { DashboardUserRow, DashboardRoleRow } from "@/lib/queries/akun";
import { createUserAction, updateUserAction, resetUserPasswordAction } from "@/app/(dashboard)/akun/actions";

function CreateUserDialog({
  open,
  onOpenChange,
  roles,
  onSubmit,
  pending,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: DashboardRoleRow[];
  onSubmit: (input: {
    nama: string;
    username: string;
    password: string;
    nomorTelepon: string | null;
    email: string | null;
    roleId: number;
  }) => void;
  pending: boolean;
  error: string | null;
}) {
  const [roleId, setRoleId] = useState(String(roles.find((r) => !r.isSuperAdmin)?.roleId ?? roles[0]?.roleId ?? ""));

  function handleSubmit(formData: FormData) {
    onSubmit({
      nama: String(formData.get("nama") ?? ""),
      username: String(formData.get("username") ?? ""),
      password: String(formData.get("password") ?? ""),
      nomorTelepon: String(formData.get("nomorTelepon") ?? "") || null,
      email: String(formData.get("email") ?? "") || null,
      roleId: Number(roleId),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tambah Akun</DialogTitle>
          <DialogDescription>Buat akun login baru untuk dashboard.</DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nama">Nama</Label>
            <Input id="nama" name="nama" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="username">Username</Label>
            <Input id="username" name="username" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" minLength={6} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nomorTelepon">Nomor Telepon</Label>
            <Input id="nomorTelepon" name="nomorTelepon" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Peran</Label>
            <Select value={roleId} onValueChange={(v) => setRoleId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => roles.find((r) => String(r.roleId) === v)?.roleName ?? "Pilih peran"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.roleId} value={String(r.roleId)}>
                    {r.roleName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

function EditUserDialog({
  user,
  onOpenChange,
  roles,
  onSubmit,
  pending,
  error,
}: {
  user: DashboardUserRow;
  onOpenChange: (open: boolean) => void;
  roles: DashboardRoleRow[];
  onSubmit: (input: {
    userId: number;
    nama: string;
    nomorTelepon: string | null;
    email: string | null;
    roleId: number;
    isActive: boolean;
  }) => void;
  pending: boolean;
  error: string | null;
}) {
  const [roleId, setRoleId] = useState(String(user.roleId));
  const [status, setStatus] = useState(user.isActive ? "active" : "inactive");

  function handleSubmit(formData: FormData) {
    onSubmit({
      userId: user.userId,
      nama: String(formData.get("nama") ?? ""),
      nomorTelepon: String(formData.get("nomorTelepon") ?? "") || null,
      email: String(formData.get("email") ?? "") || null,
      roleId: Number(roleId),
      isActive: status === "active",
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Akun &mdash; {user.nama}</DialogTitle>
          <DialogDescription>Username &ldquo;{user.username}&rdquo; tidak dapat diubah.</DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nama">Nama</Label>
            <Input id="nama" name="nama" defaultValue={user.nama} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nomorTelepon">Nomor Telepon</Label>
            <Input id="nomorTelepon" name="nomorTelepon" defaultValue={user.nomorTelepon ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" defaultValue={user.email ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Peran</Label>
            <Select value={roleId} onValueChange={(v) => setRoleId(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => roles.find((r) => String(r.roleId) === v)?.roleName ?? "Pilih peran"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.roleId} value={String(r.roleId)}>
                    {r.roleName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v ?? "active")}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => (v === "active" ? "Aktif" : "Nonaktif")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Aktif</SelectItem>
                <SelectItem value="inactive">Nonaktif</SelectItem>
              </SelectContent>
            </Select>
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

function ResetPasswordDialog({
  user,
  onOpenChange,
  onSubmit,
  pending,
  error,
}: {
  user: DashboardUserRow;
  onOpenChange: (open: boolean) => void;
  onSubmit: (userId: number, password: string) => void;
  pending: boolean;
  error: string | null;
}) {
  function handleSubmit(formData: FormData) {
    onSubmit(user.userId, String(formData.get("password") ?? ""));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset Password &mdash; {user.nama}</DialogTitle>
          <DialogDescription>Password baru berlaku langsung untuk login berikutnya.</DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">Password Baru</Label>
            <Input id="password" name="password" type="password" minLength={6} required />
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

export function AkunList({ users, roles }: { users: DashboardUserRow[]; roles: DashboardRoleRow[] }) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DashboardUserRow | null>(null);
  const [resetting, setResetting] = useState<DashboardUserRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCreate(input: Parameters<typeof createUserAction>[0]) {
    setError(null);
    startTransition(async () => {
      try {
        await createUserAction(input);
        setCreating(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan akun.");
      }
    });
  }

  function handleUpdate(input: Parameters<typeof updateUserAction>[0]) {
    setError(null);
    startTransition(async () => {
      try {
        await updateUserAction(input);
        setEditing(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan akun.");
      }
    });
  }

  function handleResetPassword(userId: number, password: string) {
    setError(null);
    startTransition(async () => {
      try {
        await resetUserPasswordAction(userId, password);
        setResetting(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal reset password.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{users.length} akun terdaftar.</p>
        <Button
          onClick={() => {
            setError(null);
            setCreating(true);
          }}
        >
          <Plus className="size-4" />
          Tambah Akun
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {users.map((u) => (
          <Card key={u.userId} className="py-3.5">
            <CardContent className="flex flex-col gap-2 px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{u.nama}</p>
                  <p className="font-data text-xs text-muted-foreground">@{u.username}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => {
                      setError(null);
                      setEditing(u);
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => {
                      setError(null);
                      setResetting(u);
                    }}
                  >
                    <KeyRound className="size-3.5" />
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={u.roleName === "Super Administrator" ? "default" : "outline"} className="h-5 px-1.5 text-[10px]">
                  {u.roleName}
                </Badge>
                <Badge variant={u.isActive ? "outline" : "destructive"} className="h-5 px-1.5 text-[10px]">
                  {u.isActive ? "Aktif" : "Nonaktif"}
                </Badge>
              </div>

              <div className="flex flex-col gap-1 border-t pt-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3" /> {u.nomorTelepon || "-"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="size-3" /> {u.email || "-"}
                </span>
                <span>Login terakhir: {u.lastLoginAt ? formatDate(u.lastLoginAt) : "-"}</span>
              </div>
            </CardContent>
          </Card>
        ))}
        {users.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Belum ada akun.</p>
        )}
      </div>

      <CreateUserDialog
        open={creating}
        onOpenChange={setCreating}
        roles={roles}
        onSubmit={handleCreate}
        pending={pending}
        error={error}
      />
      {editing && (
        <EditUserDialog
          user={editing}
          onOpenChange={(open) => !open && setEditing(null)}
          roles={roles}
          onSubmit={handleUpdate}
          pending={pending}
          error={error}
        />
      )}
      {resetting && (
        <ResetPasswordDialog
          user={resetting}
          onOpenChange={(open) => !open && setResetting(null)}
          onSubmit={handleResetPassword}
          pending={pending}
          error={error}
        />
      )}
    </div>
  );
}
