import type { Metadata } from "next";
import { EmbedMitra } from "@/components/embed/embed-mitra";

// Halaman iframe "Dashboard App" ByChat. Otoritas = token bertanda tangan
// ByChat (diverifikasi server di /api/bychat/*); halaman ini sengaja tidak
// memeriksa sesi login dashpmp. Origin ByChat yang diterima dibaca saat
// runtime dari env supaya bisa diubah tanpa build ulang.
export const metadata: Metadata = { title: "Mitra (ByChat)" };
export const dynamic = "force-dynamic";

export default function EmbedMitraPage() {
  const origins = (process.env.BYCHAT_EMBED_ORIGINS || "https://chat.byndrha.id")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return <EmbedMitra allowedOrigins={origins} />;
}
