import { readFile } from "node:fs/promises";
import path from "node:path";
import { auth } from "@/lib/auth";

// Serves the self-contained exported-artifact bundle dropped at
// static/prima-maesa-putra.html — that file isn't a page/layout/route Next
// recognizes, so it needs an explicit handler. Gated behind login (any
// authenticated user, no specific module permission — this isn't part of
// the module system, just a standalone report), same baseline as every
// other page in mkesindo; layout.tsx itself doesn't enforce auth, each
// route does.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const filePath = path.join(process.cwd(), "src/app/static/prima-maesa-putra.html");
  const html = await readFile(filePath, "utf-8");
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
