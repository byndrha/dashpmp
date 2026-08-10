import { requireProduksi } from "@/lib/require-access";

export default async function ProduksiAppTabsLayout({ children }: { children: React.ReactNode }) {
  await requireProduksi();
  return children;
}
