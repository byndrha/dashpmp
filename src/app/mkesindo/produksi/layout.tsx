import { requireProduksi } from "@/lib/require-access";

export default async function ProduksiLayout({ children }: { children: React.ReactNode }) {
  await requireProduksi();
  return children;
}
