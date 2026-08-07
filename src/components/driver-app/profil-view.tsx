"use client";

import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import { ProfilLogoutButton } from "@/components/driver-app/profil-logout-button";
import type { DriverProfileRow } from "@/lib/queries/driver-profile";

export function ProfilView({ profile, driverName }: { profile: DriverProfileRow | null; driverName: string }) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <h1 className="font-display text-lg font-semibold">Profil</h1>
      <Card>
        <CardContent className="flex flex-col gap-2 px-4 py-3 text-sm">
          <p className="font-medium">{profile?.Name ?? driverName}</p>
          {profile ? (
            <>
              <p className="text-xs text-muted-foreground">Bergabung sejak: {profile.BergabungSejak ? formatDate(profile.BergabungSejak) : "-"}</p>
              <p className="text-xs text-muted-foreground">SIM: {profile.SimTypes.length > 0 ? profile.SimTypes.join(", ") : "-"}</p>
            </>
          ) : (
            <p className="text-xs text-destructive">Akun ini belum ditautkan ke data Driver, hubungi Admin.</p>
          )}
        </CardContent>
      </Card>
      <ProfilLogoutButton />
    </div>
  );
}
