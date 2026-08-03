"use client";

import { useRef, useState } from "react";
import { Camera, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function CameraCaptureField({
  label,
  onCapture,
  disabled,
}: {
  label: string;
  onCapture: (file: File) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    onCapture(file);
    // Allow re-capturing the same slot (browsers won't fire `change` again for
    // an identical file path otherwise).
    e.target.value = "";
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "flex flex-col items-center gap-1 rounded-lg border p-2 text-xs transition-colors",
        previewUrl ? "border-primary bg-primary/5" : "border-dashed border-border",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        disabled={disabled}
        onChange={handleChange}
        className="hidden"
      />
      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL, not a static asset next/image can optimize
        <img src={previewUrl} alt={label} className="h-16 w-full rounded object-cover" />
      ) : (
        <div className="flex h-16 w-full items-center justify-center rounded bg-muted/50">
          <Camera className="size-5 text-muted-foreground" />
        </div>
      )}
      <span className="flex items-center gap-1 text-center leading-tight">
        {previewUrl && <Check className="size-3 shrink-0 text-primary" />}
        {label}
      </span>
    </button>
  );
}
