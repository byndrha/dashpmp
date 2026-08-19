// Cloudflare Worker — "Aplikasi sedang melakukan perbaikan" fallback page.
//
// WHAT THIS DOES
// Forwards every request to the real origin (Coolify) unchanged. Only when
// Cloudflare itself can't get a valid response from that origin — the
// classic "Bad Gateway" family (502, 520-526) that Cloudflare renders on
// its own, before the request ever reaches this app's Next.js code — does
// this Worker swap in a small self-contained maintenance page instead.
// Every other response (200, 404, a real in-app 500, etc.) passes through
// exactly as the origin sent it; this Worker never touches those.
//
// WHY THIS HAS TO LIVE HERE, NOT IN THE NEXT.JS APP
// When the origin is genuinely unreachable (mid-deploy restart, container
// crash, etc.), no code running INSIDE that origin — including a custom
// Next.js error page — can run to intercept the request; Cloudflare
// generates its own error page before the request gets anywhere near this
// app. A Worker runs on Cloudflare's edge, in front of the origin, which is
// the only place that can catch this specific failure mode.
//
// HOW TO DEPLOY (Cloudflare dashboard, no CLI needed)
// 1. dash.cloudflare.com -> your zone (pabrikespmp.com) -> Workers & Pages
//    -> Create -> Create Worker.
// 2. Give it a name (e.g. "dashpmp-maintenance-fallback"), then open the
//    editor and replace the default script with the full contents of this
//    file, then Deploy.
// 3. Back in the zone -> Workers Routes (or the Worker's own "Triggers" ->
//    "Routes" tab) -> Add route: pattern dash.pabrikespmp.com/* ->
//    attach this Worker.
// 4. That's it — DNS/proxy status and everything else about the domain
//    stays exactly as it is today; this only adds a Worker in the request
//    path for that one hostname.

// Cloudflare's own "couldn't reach/talk to the origin" status codes. A real
// error FROM the app itself (e.g. a genuine 500 from Next.js, still fully
// rendered and served by the origin) is deliberately NOT in this list —
// only intercept the case where Cloudflare had to generate the page itself
// because the origin never gave it anything usable.
const ORIGIN_DOWN_STATUS_CODES = new Set([502, 520, 521, 522, 523, 524, 525, 526]);

const MAINTENANCE_HTML = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="refresh" content="30" />
<title>Aplikasi sedang melakukan perbaikan</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #0b0f14;
    color: #e6edf3;
  }
  .card {
    max-width: 420px;
    text-align: center;
  }
  .icon {
    font-size: 40px;
    margin-bottom: 16px;
  }
  h1 {
    font-size: 20px;
    font-weight: 600;
    margin: 0 0 8px;
  }
  p {
    margin: 0 0 4px;
    font-size: 14px;
    line-height: 1.5;
    color: #8b949e;
  }
  .retry {
    margin-top: 20px;
    font-size: 12px;
    color: #6e7681;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">🛠️</div>
    <h1>Aplikasi sedang melakukan perbaikan</h1>
    <p>Mohon tunggu sebentar, kami sedang memperbarui sistem.</p>
    <p>Halaman ini akan otomatis memuat ulang secara berkala.</p>
    <p class="retry">Jika masalah berlanjut lebih dari beberapa menit, hubungi tim teknis.</p>
  </div>
</body>
</html>`;

export default {
  async fetch(request, env, ctx) {
    let response;
    try {
      response = await fetch(request);
    } catch (err) {
      // A thrown fetch (DNS failure, connection refused, etc.) is the same
      // "origin unreachable" situation as a 502/521/etc. status — show the
      // same maintenance page rather than letting the Worker itself error.
      return new Response(MAINTENANCE_HTML, {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (ORIGIN_DOWN_STATUS_CODES.has(response.status)) {
      return new Response(MAINTENANCE_HTML, {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return response;
  },
};
