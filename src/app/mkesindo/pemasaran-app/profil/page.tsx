import Link from "next/link";
import { Settings, KeyRound } from "lucide-react";
import { requireMarketing } from "@/lib/require-access";
import { getUserById } from "@/lib/queries/akun";
import { Card, CardContent } from "@/components/ui/card";
import { SignOutButton } from "@/components/pemasaran-app/sign-out-button";

export default async function ProfilPage() {
  const session = await requireMarketing();
  const profile = await getUserById(Number(session.user.id));

  return (
    <div className="flex min-h-screen flex-col bg-background p-4">
      <h1 className="mb-4 font-display text-lg font-semibold">Profil</h1>
      <Card className="mb-4">
        <CardContent className="p-4">
          <p className="font-semibold">{profile?.nama ?? session.user.name}</p>
          <p className="text-xs text-muted-foreground">{profile?.username ?? session.user.username}</p>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <Link href="/mkesindo/pemasaran-app/profil/akun" className="flex items-center gap-3 rounded-lg border border-border p-3">
          <Settings className="size-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Pengaturan Akun</p>
            <p className="text-xs text-muted-foreground">Nama, username, telepon, email</p>
          </div>
        </Link>
        <Link href="/mkesindo/pemasaran-app/profil/password" className="flex items-center gap-3 rounded-lg border border-border p-3">
          <KeyRound className="size-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Ubah Password</p>
            <p className="text-xs text-muted-foreground">Ganti password akun Anda</p>
          </div>
        </Link>
      </div>

      <div className="mt-4">
        <SignOutButton />
      </div>
    </div>
  );
}
