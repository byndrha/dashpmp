"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function ProduksiHeader({ userName }: { userName: string }) {
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-background px-4">
      <div>
        <p className="text-sm font-semibold">Modul Produksi</p>
        <p className="text-xs text-muted-foreground">{userName}</p>
      </div>
      <Button variant="ghost" size="icon-sm" onClick={() => signOut({ callbackUrl: "/login" })}>
        <LogOut className="size-4" />
      </Button>
    </header>
  );
}
