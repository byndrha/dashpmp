"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { updateOwnProfileAction, changeOwnPasswordAction } from "@/app/(dashboard)/profile-actions";

export interface OwnProfile {
  nama: string;
  username: string;
  nomorTelepon: string | null;
  email: string | null;
}

function ProfileForm({ profile }: { profile: OwnProfile }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      try {
        await updateOwnProfileAction({
          nama: String(formData.get("nama") ?? ""),
          nomorTelepon: String(formData.get("nomorTelepon") ?? "") || null,
          email: String(formData.get("email") ?? "") || null,
        });
        setSuccess(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan profil.");
      }
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="profileNama">Nama</Label>
        <Input id="profileNama" name="nama" defaultValue={profile.nama} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Username</Label>
        <Input value={profile.username} disabled className="text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="profileTelepon">Nomor Telepon</Label>
        <Input id="profileTelepon" name="nomorTelepon" defaultValue={profile.nomorTelepon ?? ""} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="profileEmail">Email</Label>
        <Input id="profileEmail" name="email" type="email" defaultValue={profile.email ?? ""} />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {success && <p className="text-xs text-primary">Profil tersimpan.</p>}
      <Button type="submit" size="sm" className="ml-auto" disabled={pending}>
        {pending ? "Menyimpan..." : "Simpan Profil"}
      </Button>
    </form>
  );
}

function PasswordForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(false);
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
    if (newPassword !== confirmPassword) {
      setError("Konfirmasi password baru tidak cocok.");
      return;
    }
    startTransition(async () => {
      try {
        await changeOwnPasswordAction({ currentPassword, newPassword });
        setSuccess(true);
        (document.getElementById("changePasswordForm") as HTMLFormElement | null)?.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal mengubah password.");
      }
    });
  }

  return (
    <form id="changePasswordForm" action={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="currentPassword">Password Saat Ini</Label>
        <Input id="currentPassword" name="currentPassword" type="password" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="newPassword">Password Baru</Label>
        <Input id="newPassword" name="newPassword" type="password" minLength={6} required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirmPassword">Konfirmasi Password Baru</Label>
        <Input id="confirmPassword" name="confirmPassword" type="password" minLength={6} required />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {success && <p className="text-xs text-primary">Password berhasil diubah.</p>}
      <Button type="submit" size="sm" className="ml-auto" disabled={pending}>
        {pending ? "Menyimpan..." : "Ubah Password"}
      </Button>
    </form>
  );
}

export function AccountSettingsDialog({
  open,
  onOpenChange,
  profile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: OwnProfile;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pengaturan Akun</DialogTitle>
          <DialogDescription>Ubah data profil dan password akun Anda sendiri.</DialogDescription>
        </DialogHeader>
        <ProfileForm profile={profile} />
        <Separator />
        <PasswordForm />
      </DialogContent>
    </Dialog>
  );
}
