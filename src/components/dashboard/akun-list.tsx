"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Pencil, KeyRound, Trash2, Phone, Mail, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import type { AkunRow, PerusahaanDirektoriOption, PeranRow, CreateAkunInput, UpdateAkunInput } from "@/lib/queries/akun";
import { createAkunAction, updateAkunAction, resetAkunPasswordAction, deleteAkunAction } from "@/app/grup/akun/actions";

const DIREKTUR_FILTER = "direktur";
const ALL_FILTER = "all";

function scopeLabel(a: Pick<AkunRow, "perusahaanNama">): string {
  return a.perusahaanNama ?? "Direktur (PMP Group)";
}

// Shared by the create and edit forms: PT dropdown, then a Peran dropdown
// filtered to that PT's own roles, or hidden entirely for "Direktur".
function ScopeFields({
  perusahaanList,
  peranList,
  perusahaanId,
  peranId,
  onPerusahaanChange,
  onPeranChange,
}: {
  perusahaanList: PerusahaanDirektoriOption[];
  peranList: PeranRow[];
  perusahaanId: number | null;
  peranId: number | null;
  onPerusahaanChange: (id: number | null) => void;
  onPeranChange: (id: number | null) => void;
}) {
  const peranOptions = peranList.filter((p) => p.perusahaanId === perusahaanId);
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label>Perusahaan</Label>
        <Select
          value={perusahaanId != null ? String(perusahaanId) : DIREKTUR_FILTER}
          onValueChange={(v) => {
            const next = v === DIREKTUR_FILTER ? null : Number(v);
            onPerusahaanChange(next);
            onPeranChange(null);
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              {() => (perusahaanId == null ? "Direktur (PMP Group)" : perusahaanList.find((p) => p.id === perusahaanId)?.nama ?? "")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DIREKTUR_FILTER}>Direktur (PMP Group)</SelectItem>
            {perusahaanList.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.nama}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {perusahaanId != null && (
        <div className="flex flex-col gap-1.5">
          <Label>Peran</Label>
          <Select value={peranId != null ? String(peranId) : ""} onValueChange={(v) => onPeranChange(v ? Number(v) : null)}>
            <SelectTrigger className="w-full">
              <SelectValue>{() => peranOptions.find((p) => p.id === peranId)?.nama ?? "Pilih peran"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {peranOptions.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.nama}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {peranOptions.length === 0 && (
            <p className="text-xs text-muted-foreground">Belum ada peran untuk PT ini — buat dulu di halaman Peran &amp; Otoritas.</p>
          )}
        </div>
      )}
    </>
  );
}

function CreateDialog({
  open,
  onOpenChange,
  perusahaanList,
  peranList,
  onSubmit,
  pending,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  perusahaanList: PerusahaanDirektoriOption[];
  peranList: PeranRow[];
  onSubmit: (input: CreateAkunInput) => void;
  pending: boolean;
  error: string | null;
}) {
  const [perusahaanId, setPerusahaanId] = useState<number | null>(null);
  const [peranId, setPeranId] = useState<number | null>(null);

  function handleSubmit(formData: FormData) {
    onSubmit({
      nama: String(formData.get("nama") ?? ""),
      username: String(formData.get("username") ?? ""),
      password: String(formData.get("password") ?? ""),
      email: String(formData.get("email") ?? "") || null,
      nomorTelepon: String(formData.get("nomorTelepon") ?? "") || null,
      perusahaanId,
      peranId,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tambah Akun</DialogTitle>
          <DialogDescription>Buat akun login baru untuk PT mana pun, atau akun Direktur lintas-PT.</DialogDescription>
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
          <ScopeFields
            perusahaanList={perusahaanList}
            peranList={peranList}
            perusahaanId={perusahaanId}
            peranId={peranId}
            onPerusahaanChange={setPerusahaanId}
            onPeranChange={setPeranId}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending || (perusahaanId != null && peranId == null)} className="ml-auto">
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
  perusahaanList,
  peranList,
  onOpenChange,
  onSubmit,
  pending,
  error,
}: {
  akun: AkunRow;
  perusahaanList: PerusahaanDirektoriOption[];
  peranList: PeranRow[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: UpdateAkunInput) => void;
  pending: boolean;
  error: string | null;
}) {
  const [perusahaanId, setPerusahaanId] = useState<number | null>(akun.perusahaanId);
  const [peranId, setPeranId] = useState<number | null>(akun.peranId);
  const [status, setStatus] = useState(akun.isActive ? "active" : "inactive");

  function handleSubmit(formData: FormData) {
    onSubmit({
      id: akun.id,
      nama: String(formData.get("nama") ?? ""),
      email: String(formData.get("email") ?? "") || null,
      nomorTelepon: String(formData.get("nomorTelepon") ?? "") || null,
      perusahaanId,
      peranId,
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
            <Label htmlFor="nomorTelepon">Nomor Telepon</Label>
            <Input id="nomorTelepon" name="nomorTelepon" defaultValue={akun.nomorTelepon ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" defaultValue={akun.email ?? ""} />
          </div>
          <ScopeFields
            perusahaanList={perusahaanList}
            peranList={peranList}
            perusahaanId={perusahaanId}
            peranId={peranId}
            onPerusahaanChange={setPerusahaanId}
            onPeranChange={setPeranId}
          />
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
            <Button type="submit" disabled={pending || (perusahaanId != null && peranId == null)} className="ml-auto">
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
  akun: AkunRow;
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

export function AkunList({
  akunList,
  perusahaanList,
  peranList,
}: {
  akunList: AkunRow[];
  perusahaanList: PerusahaanDirektoriOption[];
  peranList: PeranRow[];
}) {
  const [filter, setFilter] = useState<string>(ALL_FILTER);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AkunRow | null>(null);
  const [resetting, setResetting] = useState<AkunRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    if (filter === ALL_FILTER) return akunList;
    if (filter === DIREKTUR_FILTER) return akunList.filter((a) => a.perusahaanId == null);
    return akunList.filter((a) => a.perusahaanKode === filter);
  }, [akunList, filter]);

  function handleCreate(input: CreateAkunInput) {
    setError(null);
    startTransition(async () => {
      const result = await createAkunAction(input);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setCreating(false);
    });
  }

  function handleUpdate(input: UpdateAkunInput) {
    setError(null);
    startTransition(async () => {
      const result = await updateAkunAction(input);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setEditing(null);
    });
  }

  function handleResetPassword(id: number, password: string) {
    setError(null);
    startTransition(async () => {
      const result = await resetAkunPasswordAction(id, password);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setResetting(null);
    });
  }

  function handleDelete(akun: AkunRow) {
    if (!confirm(`Hapus akun "${akun.nama}" (@${akun.username})? Tindakan ini tidak dapat dibatalkan.`)) return;
    startTransition(async () => {
      const result = await deleteAkunAction(akun.id);
      if (!result.success) {
        alert(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">{filtered.length} akun.</p>
          <Select value={filter} onValueChange={(v) => setFilter(v ?? ALL_FILTER)}>
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue>
                {() => {
                  if (filter === ALL_FILTER) return "Semua PT";
                  if (filter === DIREKTUR_FILTER) return "Direktur (PMP Group)";
                  return perusahaanList.find((p) => p.kode === filter)?.nama ?? filter;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER}>Semua PT</SelectItem>
              <SelectItem value={DIREKTUR_FILTER}>Direktur (PMP Group)</SelectItem>
              {perusahaanList.map((p) => (
                <SelectItem key={p.kode} value={p.kode}>
                  {p.nama}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
        {filtered.map((a) => (
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
                <Badge variant={a.peranNama === "Super Administrator" ? "default" : "outline"} className="h-5 px-1.5 text-[10px]">
                  {a.peranNama ?? "Direktur"}
                </Badge>
                <Badge variant={a.isActive ? "outline" : "destructive"} className="h-5 px-1.5 text-[10px]">
                  {a.isActive ? "Aktif" : "Nonaktif"}
                </Badge>
              </div>

              <div className="flex flex-col gap-1 border-t pt-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="size-3" /> {scopeLabel(a)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="size-3" /> {a.nomorTelepon || "-"}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="size-3" /> {a.email || "-"}
                </span>
                <span>Login terakhir: {a.lastLoginAt ? formatDate(a.lastLoginAt) : "-"}</span>
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Tidak ada akun untuk filter ini.</p>
        )}
      </div>

      <CreateDialog
        open={creating}
        onOpenChange={setCreating}
        perusahaanList={perusahaanList}
        peranList={peranList}
        onSubmit={handleCreate}
        pending={pending}
        error={error}
      />
      {editing && (
        <EditDialog
          key={editing.id}
          akun={editing}
          perusahaanList={perusahaanList}
          peranList={peranList}
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
