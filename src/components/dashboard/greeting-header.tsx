"use client";

import { useEffect, useState } from "react";

// Greeting reflects the viewing device's own local time/timezone (client-side
// only) — deliberately independent from the WIB business-date rollover used
// for "which day's transactions to show" elsewhere in the dashboard.
function greeting(hour: number): string {
  if (hour < 11) return "Selamat pagi";
  if (hour < 15) return "Selamat siang";
  if (hour < 19) return "Selamat sore";
  return "Selamat malam";
}

export function GreetingHeader({ name }: { name: string }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // Reads the device's clock/timezone, an external system React can't know
    // about during server rendering — this can only run after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(new Date());
  }, []);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold">
        {now ? greeting(now.getHours()) : "Halo"}
        {name ? `, ${name}` : ""}
      </h1>
      <p className="text-sm text-muted-foreground">
        {now
          ? new Intl.DateTimeFormat("id-ID", { dateStyle: "full" }).format(now)
          : " "}
      </p>
    </div>
  );
}
