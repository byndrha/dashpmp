import { requireProduksiView } from "@/lib/require-access";

export default async function ProduksiLayout({ children }: { children: React.ReactNode }) {
  await requireProduksiView();
  return children;
}
