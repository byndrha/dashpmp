"use client";

import { useEffect, useMemo } from "react";
import { X } from "lucide-react";
import { LiveCameraCaptureField } from "@/components/dashboard/live-camera-capture-field";

// One object URL per captured File, created during render (memoized on the
// files array's identity) and revoked by the cleanup effect once that
// memoized set is replaced or the component unmounts — building these
// inline without memoization would leak a URL on every re-render.
function useObjectUrls(files: File[]): string[] {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => {
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [urls]);
  return urls;
}

// Merged "Bukti Pengiriman" + "Bukti Muatan" into this single multi-photo
// input — the driver captures as many proof photos as needed here instead
// of two separate boxes that only ever held one photo each.
export function MultiPhotoCaptureField({
  label,
  files,
  onChange,
}: {
  label: string;
  files: File[];
  onChange: (files: File[]) => void;
}) {
  const urls = useObjectUrls(files);

  function handleCapture(file: File) {
    onChange([...files, file]);
  }

  function handleRemove(index: number) {
    onChange(files.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="grid grid-cols-3 gap-2">
        {files.map((_, i) => (
          <div key={i} className="relative h-24 w-24">
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL, not a static build asset */}
            <img src={urls[i]} alt={`${label} ${i + 1}`} className="h-full w-full rounded-lg object-cover" />
            <button
              type="button"
              aria-label={`Hapus foto ${i + 1}`}
              onClick={() => handleRemove(i)}
              className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-md"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        <div className="h-24 w-24">
          <LiveCameraCaptureField label="Tambah Foto" photoUrl={null} size="main" active onCapture={handleCapture} />
        </div>
      </div>
    </div>
  );
}
