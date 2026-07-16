"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-md border-destructive/30">
        <CardHeader>
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <CardTitle>Gagal memuat data</CardTitle>
          </div>
          <CardDescription>
            Query ke database gagal atau memakan waktu terlalu lama. Ini biasanya masalah koneksi
            ke SQL Server, bukan bug tampilan.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="rounded bg-muted p-2 font-mono text-xs text-muted-foreground break-words">
            {error.message}
          </p>
          <Button onClick={reset} className="w-full">
            Coba lagi
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
