"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  return (
    <Button variant="outline" className="w-full gap-1.5 text-destructive" onClick={() => signOut({ callbackUrl: "/login" })}>
      <LogOut className="size-4" /> Keluar dari Akun
    </Button>
  );
}
