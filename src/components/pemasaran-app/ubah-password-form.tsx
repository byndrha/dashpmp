"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeOwnPasswordAction } from "@/app/mkesindo/(dashboard)/profile-actions";

export function UbahPasswordForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

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
      const result = await changeOwnPasswordAction({ currentPassword, newPassword });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSuccess(true);
      (document.getElementById("ubahPasswordForm") as HTMLFormElement | null)?.reset();
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="font-display text-base font-semibold">Ubah Password</h1>
      </header>

      <form id="ubahPasswordForm" action={handleSubmit} className="flex flex-col gap-3 p-4">
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
        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && <p className="text-sm text-primary">Password berhasil diubah.</p>}
        <Button type="submit" disabled={pending}>
          {pending ? "Menyimpan..." : "Ganti Password"}
        </Button>
      </form>
    </div>
  );
}
