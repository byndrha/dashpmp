"use client";

import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function LiveCameraCaptureField({
  label,
  photoUrl,
  size,
  onCapture,
  onTogglePress,
  active,
  disabled,
}: {
  label: string;
  photoUrl: string | null;
  size: "main" | "toggle";
  onCapture: (file: File) => void;
  onTogglePress?: () => void;
  active: boolean;
  disabled?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const localPreviewUrlRef = useRef<string | null>(null);
  const [retaking, setRetaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    localPreviewUrlRef.current = localPreviewUrl;
  });

  // Best-effort release of the last captured frame's object URL when this
  // field's whole lifetime ends (dialog closed) — not on every re-render,
  // only true unmount, hence the empty deps array plus the ref above to
  // read the *latest* value at that point.
  useEffect(() => {
    return () => {
      if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current);
    };
  }, []);

  const displayedPhotoUrl = retaking ? null : (localPreviewUrl ?? photoUrl);
  const showLive = size === "main" && active && !disabled && displayedPhotoUrl == null;

  useEffect(() => {
    if (!showLive) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      return;
    }
    let cancelled = false;
    // Clears a stale permission error from a previous attempt at the start of
    // each new getUserMedia cycle (mount, or "Coba Lagi" retry) — not
    // derivable from render since it depends on this effect actually re-running.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => {
        if (!cancelled) setError("Izin kamera diperlukan untuk mengambil foto.");
      });
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [showLive, retryCount]);

  function handleCapture() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setLocalPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
        setRetaking(false);
        const file = new File([blob], `${label}.jpg`, { type: "image/jpeg" });
        onCapture(file);
      },
      "image/jpeg",
      0.9
    );
  }

  function handleAreaClick() {
    if (disabled) return;
    if (size === "toggle") {
      onTogglePress?.();
      return;
    }
    if (displayedPhotoUrl != null) {
      setRetaking(true);
      return;
    }
    if (showLive) {
      handleCapture();
    }
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={handleAreaClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleAreaClick();
        }
      }}
      aria-label={label}
      className={cn(
        "relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border bg-muted/30 text-xs",
        size === "main" ? "h-full w-full" : "h-20 w-20 shrink-0",
        disabled && "pointer-events-none cursor-not-allowed opacity-50"
      )}
    >
      {displayedPhotoUrl != null ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL or uploaded path, not a static build asset
        <img src={displayedPhotoUrl} alt={label} className="h-full w-full object-cover" />
      ) : showLive ? (
        error ? (
          <div className="flex flex-col items-center gap-1 p-2 text-center text-[10px] text-destructive">
            <span>Izin kamera diperlukan untuk mengambil foto.</span>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                setError(null);
                setRetryCount((c) => c + 1);
              }}
            >
              Coba Lagi
            </Button>
          </div>
        ) : (
          <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
        )
      ) : (
        <div className="flex flex-col items-center gap-1 text-muted-foreground">
          <Camera className="size-5" style={{ transform: "rotate(15deg)" }} />
          <span className="px-1 text-center leading-tight">{label}</span>
        </div>
      )}
    </div>
  );
}
