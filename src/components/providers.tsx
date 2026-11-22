"use client";

import { usePathname } from "next/navigation";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { PaletteProvider } from "@/components/palette-provider";
import { NativeStatusBarSync } from "@/components/native-status-bar-sync";
import { LocationTrackingBootstrap } from "@/components/location-tracking-bootstrap";
import { AppVersionGate } from "@/components/app-version-gate";
import { useEmbedTema } from "@/lib/embed-theme";
import { PenampilKonfirmasi } from "@/components/konfirmasi";

export function Providers({ children }: { children: React.ReactNode }) {
  // /kartu (tautan publik) tidak punya pengaturan tampilan: selalu tema Terang.
  // /embed (iframe ByChat) mengikuti tema ByChat lewat pesan appContext.
  const pathname = usePathname() ?? "";
  const embedTema = useEmbedTema();
  const forcedTheme = pathname.startsWith("/kartu") ? "light" : pathname.startsWith("/embed") ? embedTema : undefined;
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem forcedTheme={forcedTheme} disableTransitionOnChange>
        <PaletteProvider>
          <NativeStatusBarSync />
          <LocationTrackingBootstrap />
          <AppVersionGate>{children}</AppVersionGate>
          {/* Dialog untuk konfirmasi() — pengganti window.confirm(). */}
          <PenampilKonfirmasi />
        </PaletteProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
