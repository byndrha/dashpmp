import { requireMarketing } from "@/lib/require-access";

export default async function PemasaranAppTabsLayout({ children }: { children: React.ReactNode }) {
  await requireMarketing();
  return children;
}
