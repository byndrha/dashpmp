"use client";

import { useState } from "react";
import Link from "next/link";
import { User } from "lucide-react";
import { cn } from "@/lib/utils";
import { PemasaranAppBottomNav } from "@/components/pemasaran-app/bottom-nav";
import { AppearanceMenu } from "@/components/dashboard/appearance-menu";

export type PemasaranAppTabKey = "beranda" | "mitra" | "pemasaran";

const TAB_PATHS: Record<PemasaranAppTabKey, string> = {
  beranda: "/mkesindo/pemasaran-app",
  mitra: "/mkesindo/pemasaran-app/mitra",
  pemasaran: "/mkesindo/pemasaran-app/pemasaran",
};

export function PemasaranAppTabShell({
  initialTab,
  userName,
  beranda,
  mitra,
  pemasaran,
}: {
  initialTab: PemasaranAppTabKey;
  userName: string;
  beranda: React.ReactNode;
  mitra: React.ReactNode;
  pemasaran: React.ReactNode;
}) {
  const [activeTab, setActiveTab] = useState<PemasaranAppTabKey>(initialTab);
  const [visited, setVisited] = useState<Set<PemasaranAppTabKey>>(() => new Set([initialTab]));

  function handleChangeTab(tab: PemasaranAppTabKey) {
    setActiveTab(tab);
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
    window.history.replaceState(null, "", TAB_PATHS[tab]);
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background px-4 py-2.5">
        <h1 className="font-display text-base font-semibold">Aplikasi Pemasaran</h1>
        <div className="flex items-center gap-1">
          <AppearanceMenu />
          <Link href="/mkesindo/pemasaran-app/profil" className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm hover:bg-accent">
            <User className="size-4" />
            {userName}
          </Link>
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        {visited.has("beranda") && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "beranda" && "hidden")}>{beranda}</div>
        )}
        {visited.has("mitra") && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "mitra" && "hidden")}>{mitra}</div>
        )}
        {visited.has("pemasaran") && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "pemasaran" && "hidden")}>{pemasaran}</div>
        )}
      </div>
      <PemasaranAppBottomNav activeTab={activeTab} onChange={handleChangeTab} />
    </div>
  );
}
