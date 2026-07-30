"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

// Minimal sign-out for /grup and /pmputra — those accounts have no MSSQL
// DashboardUser row, so the MKEsindo UserMenu (which drives its "Pengaturan
// Akun" dialog off one) doesn't apply here.
export function SignOutButton() {
  return (
    <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => signOut({ callbackUrl: "/login" })}>
      <LogOut className="size-4" />
      Keluar
    </Button>
  );
}
