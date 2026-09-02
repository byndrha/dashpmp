"use client";

import { useEffect, useRef, useState } from "react";

export interface WatermarkCaptureResult {
  file: File;
  latitude: number | null;
  longitude: number | null;
}

export interface UseWatermarkCameraCaptureOptions {
  label: string;
  active: boolean;
  onCapture: (result: WatermarkCaptureResult) => void;
}

export interface UseWatermarkCameraCaptureResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  error: string | null;
  capturing: boolean;
  retry: () => void;
  handleCapture: () => void;
}

// Format tanggal+jam WIB untuk watermark -- SENGAJA pin timeZone:"Asia/Jakarta"
// secara eksplisit (bukan mengandalkan zona waktu perangkat/browser), meniru
// teknik getWibTimeHHmm di business-date.ts. Ini murni formatter kosmetik
// untuk pemakai watermark foto (Patroli & Tamu), sehingga sengaja ditaruh di
// sini, bukan di business-date.ts yang jadi tumpuan logika penulisan tanggal
// ke database yang jauh lebih sensitif (lihat Global Constraints plan ini).
function formatWibWatermarkDateTime(now: Date): string {
  const formatter = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${formatter.format(now)} WIB`;
}

interface WatermarkData {
  alamat: string;
  latitude: number | null;
  longitude: number | null;
  cuaca: string;
  waktu: string;
}

interface GeocodeApiResponse {
  alamat?: string | null;
}

interface WeatherApiResponse {
  cuaca?: string;
  suhu?: number;
}

// Kumpulkan semua data watermark (lokasi, alamat, cuaca, waktu) sebelum foto
// digambar -- kalau lokasi gagal didapat sama sekali (izin ditolak/timeout),
// SEMUA bagian watermark yang bergantung padanya (alamat, koordinat, cuaca)
// ditulis "tidak tersedia", tapi foto tetap bisa diambil (lihat Global
// Constraints plan ini -- kegagalan GPS/geocode/cuaca tidak pernah
// menghalangi pengambilan foto).
async function collectWatermarkData(): Promise<WatermarkData> {
  const waktu = formatWibWatermarkDateTime(new Date());
  const position = await new Promise<GeolocationPosition | null>((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { timeout: 8000, maximumAge: 0 }
    );
  });

  if (!position) {
    return { alamat: "Lokasi tidak tersedia", latitude: null, longitude: null, cuaca: "Cuaca tidak tersedia", waktu };
  }

  const { latitude, longitude } = position.coords;
  const [geocodeResult, weatherResult] = await Promise.all([
    fetch(`/api/geocode?lat=${latitude}&lng=${longitude}`)
      .then((r) => r.json() as Promise<GeocodeApiResponse>)
      .catch(() => null),
    fetch(`/api/weather?lat=${latitude}&lng=${longitude}`)
      .then((r) => r.json() as Promise<WeatherApiResponse>)
      .catch(() => null),
  ]);

  const alamat = geocodeResult?.alamat ?? "Lokasi tidak tersedia";
  const cuaca =
    weatherResult?.cuaca != null && weatherResult?.suhu != null
      ? `${weatherResult.cuaca}, ${weatherResult.suhu}°C`
      : "Cuaca tidak tersedia";

  return { alamat, latitude, longitude, cuaca, waktu };
}

function drawWatermark(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, data: WatermarkData) {
  const lines = [
    data.alamat,
    data.latitude != null && data.longitude != null
      ? `${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}`
      : "Koordinat tidak tersedia",
    data.waktu,
    data.cuaca,
  ];
  const lineHeight = 22;
  const padding = 12;
  const boxHeight = lines.length * lineHeight + padding * 2;
  const boxY = canvas.height - boxHeight;

  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(0, boxY, canvas.width, boxHeight);

  ctx.fillStyle = "#ffffff";
  ctx.font = "16px sans-serif";
  ctx.textBaseline = "top";
  lines.forEach((line, i) => {
    ctx.fillText(line, padding, boxY + padding + i * lineHeight, canvas.width - padding * 2);
  });
}

export function useWatermarkCameraCapture({
  label,
  active,
  onCapture,
}: UseWatermarkCameraCaptureOptions): UseWatermarkCameraCaptureResult {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturingRef = useRef(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!active) {
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
        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
        if (capabilities?.torch) {
          track
            .applyConstraints({ advanced: [{ torch: true } as MediaTrackConstraintSet] })
            .catch(() => {
              // Device reported torch support but declined the constraint --
              // camera still works without flash, so this is not an error.
            });
        }
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
  }, [active, retryCount]);

  function handleCapture() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      capturingRef.current = false;
      setCapturing(false);
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    collectWatermarkData()
      .then((data) => {
        drawWatermark(ctx, canvas, data);
        canvas.toBlob(
          (blob) => {
            capturingRef.current = false;
            setCapturing(false);
            if (!blob) return;
            const file = new File([blob], `${label}.jpg`, { type: "image/jpeg" });
            onCapture({ file, latitude: data.latitude, longitude: data.longitude });
          },
          "image/jpeg",
          0.9
        );
      })
      .catch(() => {
        capturingRef.current = false;
        setCapturing(false);
      });
  }

  function retry() {
    setError(null);
    setRetryCount((c) => c + 1);
  }

  return { videoRef, error, capturing, retry, handleCapture };
}
