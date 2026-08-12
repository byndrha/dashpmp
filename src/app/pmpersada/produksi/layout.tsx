import { requirePmpersada } from "@/lib/require-access";

export default async function PmpersadaProduksiLayout({ children }: { children: React.ReactNode }) {
  await requirePmpersada();
  return children;
}
