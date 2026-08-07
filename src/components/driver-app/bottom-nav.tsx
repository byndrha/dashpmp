"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Map, History, User } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/driver-app", label: "Tugas", icon: ClipboardList },
  { href: "/driver-app/peta", label: "Peta", icon: Map },
  { href: "/driver-app/riwayat", label: "Riwayat", icon: History },
  { href: "/driver-app/profil", label: "Profil", icon: User },
] as const;

export function DriverBottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background">
      {TABS.map((tab) => {
        const active = tab.href === "/driver-app" ? pathname === "/driver-app" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]",
              active ? "text-primary" : "text-muted-foreground"
            )}
          >
            <tab.icon className="size-5" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
