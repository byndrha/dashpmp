import type { ReactNode } from "react";

// Compact vertical activity timeline: a thin rail with one dot per entry
// on the left, entry content on the right. Deliberately NOT a
// calendar/agenda view — spacing between entries is always the same
// fixed gap, never proportional to the real time elapsed between them
// (a 5-minute gap and a 5-hour gap between two entries look identical).
export function VerticalTimeline({ children }: { children: ReactNode }) {
  return <div className="flex flex-col">{children}</div>;
}

export function VerticalTimelineItem({
  time,
  isLast = false,
  children,
}: {
  time: string;
  isLast?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-primary" />
        {!isLast && <span className="w-px flex-1 bg-border" />}
      </div>
      <div className="flex-1 pb-3">
        <p className="mb-1 font-mono text-xs text-muted-foreground">{time}</p>
        {children}
      </div>
    </div>
  );
}
