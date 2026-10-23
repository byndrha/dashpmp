// Penentuan "host" halaman /embed: iframe Dashboard App ByChat (web), atau
// React Native WebView (app mobile ByChat, halaman dibuka penuh, bukan iframe).

export type EmbedHost = "webview" | "iframe" | "mandiri";

interface WindowMirip {
  parent: unknown;
  ReactNativeWebView?: { postMessage?: unknown };
}

export function deteksiEmbedHost(w: WindowMirip & object): EmbedHost {
  if (typeof w.ReactNativeWebView?.postMessage === "function") return "webview";
  return w.parent !== w ? "iframe" : "mandiri";
}

// Mode iframe/web: hanya origin ByChat yang diizinkan. Mode WebView: pesan
// disuntik app lewat injectJavaScript, jadi origin-nya halaman ini sendiri
// (atau kosong pada event yang dibuat langsung di document Android).
export function asalPesanDiterima(host: EmbedHost, origin: string, allowedOrigins: string[], originSendiri: string): boolean {
  if (host === "webview") return origin === originSendiri || origin === "";
  if (host === "iframe") return allowedOrigins.includes(origin);
  return false;
}
