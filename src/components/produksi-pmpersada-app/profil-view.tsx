"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function ProfilProduksiAppView({ userName }: { userName: string }) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <p className="text-sm text-muted-foreground">Masuk sebagai</p>
        <p className="text-lg font-semibold">{userName}</p>
      </div>
      <Button variant="outline" onClick={() => signOut({ callbackUrl: "/login" })}>
        <LogOut className="size-4" />
        Keluar
      </Button>
    </div>
  );
}
