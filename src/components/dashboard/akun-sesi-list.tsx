"use client";

import { useState, useTransition } from "react";
import { LogOut, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/format";
import { revokeSesiAction } from "@/app/grup/akun/sesi/actions";
import type { AkunSesiRow } from "@/lib/queries/akun";

export function AkunSesiList({ sesiList }: { sesiList: AkunSesiRow[] }) {
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleRevoke(sesiId: string) {
    setError(null);
    setPendingIds((prev) => new Set(prev).add(sesiId));
    startTransition(async () => {
      try {
        const result = await revokeSesiAction(sesiId);
        if (!result.success) setError(result.error);
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(sesiId);
          return next;
        });
      }
    });
  }

  if (sesiList.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Tidak ada sesi aktif.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-xs text-destructive">{error}</p>}
      {sesiList.map((s) => (
        <Card key={s.sesiId} className="flex flex-row items-center justify-between gap-3 p-4">
          <div className="flex min-w-0 items-start gap-3">
            <Monitor className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="font-medium">
                {s.nama} <span className="font-normal text-muted-foreground">({s.username})</span>
              </p>
              <p className="truncate text-xs text-muted-foreground" title={s.userAgent ?? undefined}>
                {s.userAgent ?? "Tidak diketahui"}
              </p>
              <p className="text-xs text-muted-foreground">
                {s.ipAddress ?? "IP tidak diketahui"} &middot; Login {formatRelativeTime(s.createdAt)} &middot;
                Terakhir aktif {formatRelativeTime(s.lastSeenAt)}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="destructive"
            disabled={pendingIds.has(s.sesiId)}
            onClick={() => handleRevoke(s.sesiId)}
          >
            <LogOut className="size-4" />
            Logout
          </Button>
        </Card>
      ))}
    </div>
  );
}
