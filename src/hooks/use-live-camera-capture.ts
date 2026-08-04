"use client";

import { useEffect, useRef, useState } from "react";

export interface UseLiveCameraCaptureOptions {
  label: string;
  photoUrl: string | null;
  active: boolean;
  disabled?: boolean;
  onCapture: (file: File) => void;
}

export interface UseLiveCameraCaptureResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  displayedPhotoUrl: string | null;
  showLive: boolean;
  error: string | null;
  retry: () => void;
  handleTap: () => void;
}

export function useLiveCameraCapture({
  label,
  photoUrl,
  active,
  disabled,
  onCapture,
}: UseLiveCameraCaptureOptions): UseLiveCameraCaptureResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturingRef = useRef(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const localPreviewUrlRef = useRef<string | null>(null);
  const [retaking, setRetaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    localPreviewUrlRef.current = localPreviewUrl;
  });

  useEffect(() => {
    return () => {
      if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current);
    };
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!active) setRetaking(false);
  }, [active]);

  const displayedPhotoUrl = retaking ? null : (localPreviewUrl ?? photoUrl);
  const showLive = active && !disabled && displayedPhotoUrl == null;

  useEffect(() => {
    if (!showLive) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      return;
    }
    let cancelled = false;
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
    if (!video || video.videoWidth === 0 || capturingRef.current) return;
    capturingRef.current = true;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      capturingRef.current = false;
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        capturingRef.current = false;
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

  function handleTap() {
    if (disabled) return;
    if (displayedPhotoUrl != null) {
      setRetaking(true);
      return;
    }
    if (showLive) {
      if (capturingRef.current) return;
      handleCapture();
    }
  }

  function retry() {
    setError(null);
    setRetryCount((c) => c + 1);
  }

  return { videoRef, displayedPhotoUrl, showLive, error, retry, handleTap };
}
