"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { AlertTriangle, X } from "lucide-react";
import {
  classifyAppVersion,
  APP_MIN_VERSION_CODE,
  APP_LATEST_VERSION_CODE,
  APP_LATEST_VERSION_NAME,
  type AppVersionStatus,
} from "@/lib/app-version-config";

export function AppVersionGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AppVersionStatus | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    App.getInfo()
      .then((info) => {
        const currentVersionCode = parseInt(info.build, 10);
        if (Number.isNaN(currentVersionCode)) return;
        setStatus(
          classifyAppVersion(currentVersionCode, APP_MIN_VERSION_CODE, APP_LATEST_VERSION_CODE)
        );
      })
      .catch(() => {
        // Fail open: if we can't read the version, never block the user
        // over a technical failure.
      });
  }, []);

  if (status === "blocked") {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <h1 className="text-xl font-semibold text-foreground">Pembaruan Aplikasi Wajib</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Versi aplikasi ini sudah tidak didukung. Hubungi admin/IT perusahaan untuk mendapatkan
          pembaruan aplikasi sebelum melanjutkan.
        </p>
      </div>
    );
  }

  return (
    <>
      {status === "update-available" && !bannerDismissed && (
        <div className="flex items-center justify-between gap-3 bg-secondary px-4 py-2 text-sm text-secondary-foreground">
          <span>
            Versi baru (v{APP_LATEST_VERSION_NAME}) tersedia. Hubungi admin/IT untuk memperbarui
            aplikasi.
          </span>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            aria-label="Tutup"
            className="shrink-0 rounded p-1 hover:bg-secondary-foreground/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {children}
    </>
  );
}
