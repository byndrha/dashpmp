import { requireDriver } from "@/lib/require-access";

// DriverTabShell (rendered by each tab's own page.tsx) now owns the bottom
// nav, the h-dvh flex layout, and cross-tab keep-alive state — this layout
// is just the shared auth gate.
export default async function DriverTabsLayout({ children }: { children: React.ReactNode }) {
  await requireDriver();
  return children;
}
