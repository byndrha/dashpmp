"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { PaletteProvider } from "@/components/palette-provider";
import { NativeStatusBarSync } from "@/components/native-status-bar-sync";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
        <PaletteProvider>
          <NativeStatusBarSync />
          {children}
        </PaletteProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
