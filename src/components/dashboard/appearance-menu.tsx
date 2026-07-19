"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon, Monitor, Palette as PaletteIcon, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePalette, PALETTES, PALETTE_LABEL, PALETTE_SWATCH } from "@/components/palette-provider";

const MODE_OPTIONS = [
  { value: "light", label: "Terang", icon: Sun },
  { value: "dark", label: "Gelap", icon: Moon },
  { value: "system", label: "Sistem", icon: Monitor },
] as const;

const subscribeNoop = () => () => {};

// next-themes' `theme` value is only meaningful once the client has taken
// over (it's undefined during SSR/first paint) — this is the
// external-store-based equivalent of the classic "mounted" useState+effect
// flag, without calling setState inside an effect.
function useHasMounted() {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false
  );
}

export function AppearanceMenu() {
  const mounted = useHasMounted();
  const { theme, setTheme } = useTheme();
  const { palette, setPalette } = usePalette();

  const activeMode = mounted ? (theme ?? "system") : "dark";
  const TriggerIcon = mounted && theme === "light" ? Sun : mounted && theme === "system" ? Monitor : Moon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
        <TriggerIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Mode Tampilan</DropdownMenuLabel>
          {MODE_OPTIONS.map((opt) => (
            <DropdownMenuItem key={opt.value} onClick={() => setTheme(opt.value)}>
              <opt.icon className="size-4" />
              {opt.label}
              {activeMode === opt.value && <Check className="ml-auto size-3.5 text-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-1.5">
            <PaletteIcon className="size-3.5" />
            Palet Warna
          </DropdownMenuLabel>
          {PALETTES.map((p) => (
            <DropdownMenuItem key={p} onClick={() => setPalette(p)}>
              <span
                className="size-3.5 shrink-0 rounded-full ring-1 ring-border"
                style={{ backgroundColor: PALETTE_SWATCH[p] }}
              />
              {PALETTE_LABEL[p]}
              {palette === p && <Check className="ml-auto size-3.5 text-primary" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
