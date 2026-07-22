"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

// Keeps the native status bar icon color in sync with the app's light/dark
// theme when running inside the Capacitor native shell. Because this app is
// loaded via server.url (the real deployed site, not bundled local files),
// this is the one place status-bar styling can be driven from — it no-ops
// entirely in a regular browser, where StatusBar has no meaning.
export function NativeStatusBarSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    StatusBar.setStyle({ style: resolvedTheme === "dark" ? Style.Dark : Style.Light }).catch(() => {});
  }, [resolvedTheme]);

  return null;
}
