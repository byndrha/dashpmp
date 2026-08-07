"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function ProfilLogoutButton() {
  return (
    <Button variant="outline" className="w-full" onClick={() => signOut({ callbackUrl: "/login" })}>
      <LogOut className="size-4" />
      Keluar
    </Button>
  );
}
