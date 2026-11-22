"use client";

import { GalatHalaman } from "@/components/dashboard/galat-halaman";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <GalatHalaman error={error} reset={reset} berandaHref="/pmputra" />;
}
