"use client";

import { cn } from "@/lib/utils";

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

// Drop-in 24-hour replacement for <input type="time"> — that native input's
// AM/PM display is governed by the browser/OS locale, not by any HTML
// attribute (this app's <html lang="id"> has no effect on it), so it can't
// be reliably suppressed across environments. Two plain <select>s guarantee
// 24-hour display everywhere, with the same "HH:MM" string value/onChange
// contract the native input already used at every call site, so it's a
// direct swap.
export function TimeInput({
  value,
  onChange,
  disabled,
  className,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  // Applied to the hour <select> (the first focusable element), so an
  // existing <Label htmlFor={id}> pointed at what used to be a single
  // <input type="time"> still moves focus into this replacement correctly.
  id?: string;
}) {
  const [hour = "00", minute = "00"] = value.split(":");

  return (
    <div
      className={cn(
        "flex h-8 w-fit items-center gap-0.5 rounded-lg border border-input bg-transparent px-2 py-1 text-base transition-colors",
        "has-[select:focus-visible]:border-ring has-[select:focus-visible]:ring-3 has-[select:focus-visible]:ring-ring/50",
        disabled && "pointer-events-none cursor-not-allowed bg-input/50 opacity-50",
        "md:text-sm dark:bg-input/30 dark:disabled:bg-input/80",
        className
      )}
    >
      <select
        id={id}
        value={hour}
        disabled={disabled}
        onChange={(e) => onChange(`${e.target.value}:${minute}`)}
        className="bg-transparent tabular-nums outline-none"
        aria-label="Jam"
      >
        {HOURS.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="text-muted-foreground">:</span>
      <select
        value={minute}
        disabled={disabled}
        onChange={(e) => onChange(`${hour}:${e.target.value}`)}
        className="bg-transparent tabular-nums outline-none"
        aria-label="Menit"
      >
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}
