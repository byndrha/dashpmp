import type { Metadata } from "next";

// page.tsx here is a client component ("use client"), which can't export
// `metadata` itself — this thin server layout is the only way to give the
// login route its own browser-tab title.
export const metadata: Metadata = { title: "Masuk" };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
