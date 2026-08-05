"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { PaletteProvider } from "@/components/palette-provider";
import { NativeStatusBarSync } from "@/components/native-status-bar-sync";
import { LocationTrackingBootstrap } from "@/components/location-tracking-bootstrap";
import { AppVersionGate } from "@/components/app-version-gate";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
        <PaletteProvider>
          <NativeStatusBarSync />
          <LocationTrackingBootstrap />
          <AppVersionGate>{children}</AppVersionGate>
        </PaletteProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
