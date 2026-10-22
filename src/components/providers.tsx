"use client";

import { usePathname } from "next/navigation";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { PaletteProvider } from "@/components/palette-provider";
import { NativeStatusBarSync } from "@/components/native-status-bar-sync";
import { LocationTrackingBootstrap } from "@/components/location-tracking-bootstrap";
import { AppVersionGate } from "@/components/app-version-gate";

export function Providers({ children }: { children: React.ReactNode }) {
  // /kartu (tautan publik) tidak punya pengaturan tampilan: selalu tema Terang.
  const forcedTheme = (usePathname() ?? "").startsWith("/kartu") ? "light" : undefined;
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem forcedTheme={forcedTheme} disableTransitionOnChange>
        <PaletteProvider>
          <NativeStatusBarSync />
          <LocationTrackingBootstrap />
          <AppVersionGate>{children}</AppVersionGate>
        </PaletteProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
