"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { LogOut, User, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AccountSettingsDialog, type OwnProfile } from "@/components/dashboard/account-settings-dialog";

export function UserMenu({ name, profile }: { name: string; profile: OwnProfile | null }) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="gap-2" />}>
          <User className="size-4" />
          {name}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{name}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!profile} onClick={() => setSettingsOpen(true)}>
              <Settings className="size-4" />
              Pengaturan Akun
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/login" })}>
              <LogOut className="size-4" />
              Keluar
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {profile && (
        <AccountSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} profile={profile} />
      )}
    </>
  );
}
