"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateOwnProfileAction } from "@/app/mkesindo/(dashboard)/profile-actions";
import type { OwnProfile } from "@/components/dashboard/account-settings-dialog";

export function PengaturanAkunForm({ profile }: { profile: OwnProfile }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await updateOwnProfileAction({
        nama: String(formData.get("nama") ?? ""),
        nomorTelepon: String(formData.get("nomorTelepon") ?? "") || null,
        email: String(formData.get("email") ?? "") || null,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSuccess(true);
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="font-display text-base font-semibold">Pengaturan Akun</h1>
      </header>

      <form action={handleSubmit} className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nama">Nama</Label>
          <Input id="nama" name="nama" defaultValue={profile.nama} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Username</Label>
          <Input value={profile.username} disabled className="text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nomorTelepon">Nomor Telepon</Label>
          <Input id="nomorTelepon" name="nomorTelepon" defaultValue={profile.nomorTelepon ?? ""} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" defaultValue={profile.email ?? ""} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && <p className="text-sm text-primary">Profil tersimpan.</p>}
        <Button type="submit" disabled={pending}>
          {pending ? "Menyimpan..." : "Simpan Perubahan"}
        </Button>
      </form>
    </div>
  );
}
