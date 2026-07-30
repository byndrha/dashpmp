"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil, KeyRound, Trash2, Mail, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import type { AkunDirektoriRow, AkunDirektoriScope, PerusahaanDirektoriOption } from "@/lib/queries/akun-direktori";
import {
  createAkunDirektoriAction,
  updateAkunDirektoriAction,
  resetAkunDirektoriPasswordAction,
  deleteAkunDirektoriAction,
} from "@/app/grup/akun/direktori/actions";

const SCOPE_LABEL: Record<AkunDirektoriScope, string> = {
  direktur: "Direktur",
  pmputra: "Finance PMPutra",
};

function CreateDialog({
  open,
  onOpenChange,
  pmputraId,
  onSubmit,
  pending,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pmputraId: number | null;
  onSubmit: (input: Parameters<typeof createAkunDirektoriAction>[0]) => void;
  pending: boolean;
  error: string | null;
}) {
  const [scope, setScope] = useState<AkunDirektoriScope>("direktur");

  function handleSubmit(formData: FormData) {
    onSubmit({
      nama: String(formData.get("nama") ?? ""),
      username: String(formData.get("username") ?? ""),
      password: String(formData.get("password") ?? ""),
      email: String(formData.get("email") ?? "") || null,
      scope,
      perusahaanId: scope === "pmputra" ? pmputraId : null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tambah Akun Direktori</DialogTitle>
          <DialogDescription>Akun Direktur (ringkasan PMP Group) atau Finance PT Prima Maesa Putra.</DialogDescription>
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
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Scope</Label>
            <Select value={scope} onValueChange={(v) => setScope((v as AkunDirektoriScope) ?? "direktur")}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => SCOPE_LABEL[v as AkunDirektoriScope]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direktur">Direktur — Ringkasan PMP Group</SelectItem>
                <SelectItem value="pmputra">Finance PMPutra — PT Prima Maesa Putra</SelectItem>
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

function EditDialog({
  akun,
  pmputraId,
  onOpenChange,
  onSubmit,
  pending,
  error,
}: {
  akun: AkunDirektoriRow;
  pmputraId: number | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: Parameters<typeof updateAkunDirektoriAction>[0]) => void;
  pending: boolean;
  error: string | null;
}) {
  const [scope, setScope] = useState<AkunDirektoriScope>(akun.scope);
  const [status, setStatus] = useState(akun.isActive ? "active" : "inactive");

  function handleSubmit(formData: FormData) {
    onSubmit({
      id: akun.id,
      nama: String(formData.get("nama") ?? ""),
      email: String(formData.get("email") ?? "") || null,
      scope,
      perusahaanId: scope === "pmputra" ? pmputraId : null,
      isActive: status === "active",
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Akun &mdash; {akun.nama}</DialogTitle>
          <DialogDescription>Username &ldquo;{akun.username}&rdquo; tidak dapat diubah.</DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nama">Nama</Label>
            <Input id="nama" name="nama" defaultValue={akun.nama} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" defaultValue={akun.email ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Scope</Label>
            <Select value={scope} onValueChange={(v) => setScope((v as AkunDirektoriScope) ?? "direktur")}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => SCOPE_LABEL[v as AkunDirektoriScope]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="direktur">Direktur — Ringkasan PMP Group</SelectItem>
                <SelectItem value="pmputra">Finance PMPutra — PT Prima Maesa Putra</SelectItem>
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
  akun,
  onOpenChange,
  onSubmit,
  pending,
  error,
}: {
  akun: AkunDirektoriRow;
  onOpenChange: (open: boolean) => void;
  onSubmit: (id: number, password: string) => void;
  pending: boolean;
  error: string | null;
}) {
  function handleSubmit(formData: FormData) {
    onSubmit(akun.id, String(formData.get("password") ?? ""));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset Password &mdash; {akun.nama}</DialogTitle>
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

export function AkunDirektoriList({
  akunList,
  perusahaanList,
}: {
  akunList: AkunDirektoriRow[];
  perusahaanList: PerusahaanDirektoriOption[];
}) {
  const pmputraId = perusahaanList.find((p) => p.kode === "pmputra")?.id ?? null;
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AkunDirektoriRow | null>(null);
  const [resetting, setResetting] = useState<AkunDirektoriRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCreate(input: Parameters<typeof createAkunDirektoriAction>[0]) {
    setError(null);
    startTransition(async () => {
      try {
        await createAkunDirektoriAction(input);
        setCreating(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan akun.");
      }
    });
  }

  function handleUpdate(input: Parameters<typeof updateAkunDirektoriAction>[0]) {
    setError(null);
    startTransition(async () => {
      try {
        await updateAkunDirektoriAction(input);
        setEditing(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan akun.");
      }
    });
  }

  function handleResetPassword(id: number, password: string) {
    setError(null);
    startTransition(async () => {
      try {
        await resetAkunDirektoriPasswordAction(id, password);
        setResetting(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal reset password.");
      }
    });
  }

  function handleDelete(akun: AkunDirektoriRow) {
    if (!confirm(`Hapus akun "${akun.nama}" (@${akun.username})? Tindakan ini tidak dapat dibatalkan.`)) return;
    startTransition(async () => {
      try {
        await deleteAkunDirektoriAction(akun.id);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Gagal menghapus akun.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{akunList.length} akun direktori terdaftar.</p>
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
        {akunList.map((a) => (
          <Card key={a.id} className="py-3.5">
            <CardContent className="flex flex-col gap-2 px-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{a.nama}</p>
                  <p className="font-data text-xs text-muted-foreground">@{a.username}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => {
                      setError(null);
                      setEditing(a);
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
                      setResetting(a);
                    }}
                  >
                    <KeyRound className="size-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="size-7" disabled={pending} onClick={() => handleDelete(a)}>
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="default" className="h-5 px-1.5 text-[10px]">
                  {SCOPE_LABEL[a.scope]}
                </Badge>
                <Badge variant={a.isActive ? "outline" : "destructive"} className="h-5 px-1.5 text-[10px]">
                  {a.isActive ? "Aktif" : "Nonaktif"}
                </Badge>
              </div>

              <div className="flex flex-col gap-1 border-t pt-2 text-xs text-muted-foreground">
                {a.perusahaanNama && (
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="size-3" /> {a.perusahaanNama}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="size-3" /> {a.email || "-"}
                </span>
                <span>Login terakhir: {a.lastLoginAt ? formatDate(a.lastLoginAt) : "-"}</span>
              </div>
            </CardContent>
          </Card>
        ))}
        {akunList.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Belum ada akun direktori.</p>
        )}
      </div>

      <CreateDialog
        open={creating}
        onOpenChange={setCreating}
        pmputraId={pmputraId}
        onSubmit={handleCreate}
        pending={pending}
        error={error}
      />
      {editing && (
        <EditDialog
          akun={editing}
          pmputraId={pmputraId}
          onOpenChange={(open) => !open && setEditing(null)}
          onSubmit={handleUpdate}
          pending={pending}
          error={error}
        />
      )}
      {resetting && (
        <ResetPasswordDialog
          akun={resetting}
          onOpenChange={(open) => !open && setResetting(null)}
          onSubmit={handleResetPassword}
          pending={pending}
          error={error}
        />
      )}
    </div>
  );
}
