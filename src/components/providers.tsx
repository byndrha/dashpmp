"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { PaletteProvider } from "@/components/palette-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
        <PaletteProvider>{children}</PaletteProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
