import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { jalankanTick } from "@/lib/penagihan/mesin";

// Dipicu Coolify Scheduled Task tiap menit:
//   curl -fsS -X POST -H "x-cron-secret: $PENAGIHAN_CRON_SECRET" https://<host>/api/penagihan/tick
// Tanpa rahasia yang cocok -> 404 (tidak membuka keberadaan endpoint).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function rahasiaCocok(terima: string | null): boolean {
  const harus = process.env.PENAGIHAN_CRON_SECRET;
  if (!harus || harus.length < 16 || !terima) return false;
  const a = Buffer.from(terima);
  const b = Buffer.from(harus);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!rahasiaCocok(req.headers.get("x-cron-secret"))) return new NextResponse(null, { status: 404 });
  try {
    const hasil = await jalankanTick();
    return NextResponse.json({ ok: true, hasil }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("Penagihan: tick gagal:", (err as Error).message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
