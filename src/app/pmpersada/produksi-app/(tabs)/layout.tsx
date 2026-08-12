import { requirePmpersadaProduksi } from "@/lib/require-access";

export default async function ProduksiAppTabsLayout({ children }: { children: React.ReactNode }) {
  await requirePmpersadaProduksi();
  return children;
}
