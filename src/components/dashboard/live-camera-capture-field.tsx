"use client";

import { Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useLiveCameraCapture } from "@/hooks/use-live-camera-capture";
import { PhotoStatusOverlay, type PhotoUploadStatus } from "@/components/ui/photo-status-overlay";

export function LiveCameraCaptureField({
  label,
  photoUrl,
  size,
  onCapture,
  onTogglePress,
  active,
  disabled,
  status,
}: {
  label: string;
  photoUrl: string | null;
  size: "main" | "toggle";
  onCapture: (file: File) => void;
  onTogglePress?: () => void;
  active: boolean;
  disabled?: boolean;
  status?: PhotoUploadStatus;
}) {
  const { videoRef, displayedPhotoUrl, showLive, error, retry, handleTap } = useLiveCameraCapture({
    label,
    photoUrl,
    active: size === "main" && active,
    disabled,
    onCapture,
  });

  function handleAreaClick() {
    if (disabled) return;
    if (size === "toggle") {
      onTogglePress?.();
      return;
    }
    handleTap();
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
                retry();
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
      <PhotoStatusOverlay status={status} />
    </div>
  );
}
