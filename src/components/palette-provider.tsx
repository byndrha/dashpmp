"use client";

import { createContext, useContext, useEffect, useState } from "react";

export const PALETTES = ["glacier", "lavender", "rose", "sage"] as const;
export type Palette = (typeof PALETTES)[number];

export const PALETTE_LABEL: Record<Palette, string> = {
  glacier: "Glacier",
  lavender: "Lavender",
  rose: "Rose",
  sage: "Sage",
};

// Swatch color per palette, hardcoded rather than read from CSS vars since
// this needs to show ALL four options at once regardless of which one is
// currently applied to <html> — same hue/lightness as each palette's
// --primary (dark-mode value, reads well on both light and dark menu
// backgrounds).
export const PALETTE_SWATCH: Record<Palette, string> = {
  glacier: "oklch(0.7 0.14 175)",
  lavender: "oklch(0.7 0.13 300)",
  rose: "oklch(0.7 0.14 350)",
  sage: "oklch(0.68 0.12 150)",
};

const STORAGE_KEY = "palette";
const DEFAULT_PALETTE: Palette = "glacier";

function isPalette(value: string | null): value is Palette {
  return !!value && (PALETTES as readonly string[]).includes(value);
}

// Reads whatever the pre-hydration inline script (PALETTE_INIT_SCRIPT,
// rendered in the root layout's <head>) already wrote to <html> — avoids
// needing a mount-time effect that calls setState to pick up the persisted
// value. On the server `document` doesn't exist, so this falls back to the
// default; that's fine since nothing renders palette-dependent JSX before
// the client has actually mounted (see AppearanceMenu's useHasMounted).
function readPaletteFromDom(): Palette {
  if (typeof document === "undefined") return DEFAULT_PALETTE;
  const attr = document.documentElement.getAttribute("data-palette");
  return isPalette(attr) ? attr : DEFAULT_PALETTE;
}

interface PaletteContextValue {
  palette: Palette;
  setPalette: (palette: Palette) => void;
}

const PaletteContext = createContext<PaletteContextValue | null>(null);

export function PaletteProvider({ children }: { children: React.ReactNode }) {
  const [palette, setPaletteState] = useState<Palette>(readPaletteFromDom);

  useEffect(() => {
    document.documentElement.setAttribute("data-palette", palette);
  }, [palette]);

  function setPalette(next: Palette) {
    setPaletteState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }

  return <PaletteContext.Provider value={{ palette, setPalette }}>{children}</PaletteContext.Provider>;
}

export function usePalette(): PaletteContextValue {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error("usePalette must be used within a PaletteProvider");
  return ctx;
}

// Inline, pre-hydration script (rendered via dangerouslySetInnerHTML in the
// root layout <head>) so the palette attribute is set before first paint —
// same FOUC-avoidance trick next-themes uses internally for the `.dark`
// class, needed here too since PaletteProvider's own effect only runs after
// React hydrates.
export const PALETTE_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  STORAGE_KEY
)});var valid=${JSON.stringify(PALETTES)};if(p&&valid.indexOf(p)!==-1){document.documentElement.setAttribute('data-palette',p);}}catch(e){}})();`;
