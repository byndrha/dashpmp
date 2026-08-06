import { unstable_rethrow } from "next/navigation";

// Marks a thrown error's message as deliberately written for the end
// user (a business-validation failure, e.g. "Total muatan melebihi
// kapasitas maksimum armada") — runAction lets an AppError's .message
// reach the client as plain data, bypassing React's production RSC
// error redaction (which otherwise replaces EVERY thrown error's
// message with a generic "An error occurred in the Server Components
// render..." string, confirmed by reading
// node_modules/next/dist/compiled/react-server-dom-webpack/cjs/
// react-server-dom-webpack-client.node.production.js's resolveErrorProd()).
// Any error that is NOT an AppError is assumed unsafe to show verbatim
// (could be a raw SQL error, a stack trace, internal schema detail) and
// gets a safe generic message instead — the same protection the React
// redaction gave, just phrased in plain Indonesian instead of a
// confusing framework message.
export class AppError extends Error {}

export type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { success: true, data: await fn() };
  } catch (err) {
    // Several actions call requireModuleAccess/requirePmputra/etc (see
    // src/lib/require-access.ts), which redirect() on failure — redirect()
    // works by throwing a special Next.js control-flow error tagged with a
    // "NEXT_REDIRECT" digest. unstable_rethrow detects that (and
    // notFound()'s equivalent) and rethrows it untouched so Next.js's own
    // machinery still performs the redirect, instead of it being caught
    // here and turned into a "Terjadi kesalahan tak terduga" response.
    // Must be the first line of the catch block per Next's own docs
    // (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/
    // unstable_rethrow.md).
    unstable_rethrow(err);
    if (err instanceof AppError) return { success: false, error: err.message };
    console.error(err);
    return { success: false, error: "Terjadi kesalahan tak terduga. Silakan coba lagi." };
  }
}
