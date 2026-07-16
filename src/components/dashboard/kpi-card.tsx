import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const TONE_TEXT: Record<string, string> = {
  default: "text-foreground",
  positive: "text-primary",
  warning: "text-warning",
  negative: "text-destructive",
};

const TONE_ICON_BG: Record<string, string> = {
  default: "bg-secondary text-foreground",
  positive: "bg-primary/15 text-primary",
  warning: "bg-warning/15 text-warning",
  negative: "bg-destructive/15 text-destructive",
};

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: "default" | "positive" | "warning" | "negative";
}) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="flex flex-row items-center justify-between gap-2 px-4">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
        {Icon && (
          <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", TONE_ICON_BG[tone])}>
            <Icon className="size-3.5" />
          </span>
        )}
      </CardHeader>
      <CardContent className="px-4">
        <p className={cn("font-display text-2xl font-semibold tabular-nums", TONE_TEXT[tone])}>{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
