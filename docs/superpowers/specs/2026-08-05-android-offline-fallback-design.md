# Android Offline Fallback — Design Spec

**Company:** PT Mitra Kelola Esindo / PMP Group. **Module:** Android app shell only (`android/` project) — no changes to the Next.js web app.

## Goal

Replace Android WebView's built-in "no connection" error page (the generic Chromium error screen) with the app's own branded fallback: a skeleton shell plus a small "Tidak ada koneksi" popup, which automatically reloads the real page once connectivity returns — with no tap required from the user.

This must cover both scenarios the user confirmed matter:
1. **Cold start** — the app is opened with no internet connection at all, so the very first page load fails.
2. **Mid-session navigation** — the user is already using the app and taps into a new screen (e.g. Beranda → Live Inspeksi) while offline, and that navigation's page load fails.

Both are the same underlying event from the WebView's point of view — a failed top-level (main-frame) page load — so one mechanism covers both.

## Non-goals

- **Not covered: connectivity lost while already viewing an already-loaded screen, with no navigation attempt.** The user confirmed "mid-session" means the navigation-failure case above, not a live in-page indicator while sitting on a screen that's already rendered and just has its background API calls silently failing. That would require a separate in-app (React/Next.js) connectivity listener — a different mechanism, not built here.
- **Not covered: HTTP-level errors (4xx/5xx from a reachable server).** This spec only intercepts network-level failures (DNS failure, connection refused, timeout — i.e., genuinely "no connection"), not the case where `dash.pabrikespmp.com` is reachable but returns an error response. A reachable server returning an error page is a different, legitimate failure mode outside this spec's scope.
- **No changes to the Next.js web app.** This is entirely an Android-native (`android/` project) change: one new native WebViewClient subclass, a one-line hook in `MainActivity`, and one new static HTML asset bundled in the APK.
- **No service worker / PWA approach.** A service worker can only help after it has successfully registered while online at least once — it cannot address a cold start with zero prior connectivity, which is explicitly in scope here. Native interception is the only mechanism that covers both required scenarios.

## Architecture

Three pieces, all confirmed against the actual Capacitor 8 Android library source (`node_modules/@capacitor/android`) rather than assumed:

**1. `OfflineAwareWebViewClient.java`** (new) — a subclass of Capacitor's own `com.getcapacitor.BridgeWebViewClient` (the class Capacitor already installs on the WebView by default). It overrides only `onReceivedError`: when the failed request `isForMainFrame()`, it redirects the WebView to the bundled local fallback page instead of letting Android's default error screen render, passing the URL that failed as a query parameter so the fallback page knows what to retry. Any non-main-frame failure (e.g. a single failed image request on an otherwise fine page) falls through to `super.onReceivedError(...)`, preserving Capacitor's existing behavior there unchanged.

**2. `MainActivity.java`** (modified) — currently a bare one-line `BridgeActivity` subclass. It gets a `load()` override that calls `super.load()` (unchanged Capacitor bridge setup) and then swaps in the new `OfflineAwareWebViewClient` via `getBridge().setWebViewClient(...)` — a public, intended Capacitor extension point (confirmed in `Bridge.java`: `setWebViewClient` immediately applies the client to the live WebView).

**3. `offline.html`** (new, bundled as a raw Android asset at `android/app/src/main/assets/offline.html`, sibling to the existing `assets/public/` synced web folder — confirmed this location is untouched by `npx cap sync`, so it survives every future web sync). A fully self-contained HTML/CSS/JS page — no external requests of any kind — since it must render correctly with zero connectivity. It:
   - Shows a branded skeleton shell (dark background matching the app's existing dark-mode token colors, shimmering placeholder blocks) so the screen never looks broken or blank.
   - Shows a small fixed banner/popup: "Tidak ada koneksi internet".
   - Reads the failed URL from its own `?target=` query parameter (falls back to the app's root URL if missing).
   - Polls connectivity every 3 seconds via a `fetch(..., { mode: "no-cors" })` request to the real domain (this avoids CORS entirely — a `no-cors` request that doesn't throw is enough signal that the network path is reachable again, without needing to read the response body/status).
   - The moment a poll succeeds, navigates `window.location.href` to the saved target URL — no tap needed. Because that URL's host/scheme matches the app's configured `server.url`, Capacitor's own `shouldOverrideUrlLoading` (confirmed in `Bridge.launchIntent`) lets it load normally in-place rather than handing off to an external browser.

## Interaction with the existing camera-permission bridge

Not affected. The custom WebViewClient only overrides `onReceivedError`; the camera permission bridging (`BridgeWebChromeClient.onPermissionRequest`, already relied on by the live vehicle-inspection features) lives on `WebChromeClient`, a separate class this change never touches.

## Visual content of `offline.html`

Reuses this app's existing dark-mode color values (the same ones already used across the dashboard and the Satpam mobile screens) rather than inventing a new palette — dark neutral background, light foreground text, a warm accent color for the popup banner. A text wordmark ("PMP Group") stands in for the logo image, since bundling and referencing an extra image asset just for this fallback page isn't worth the added dependency for a screen that's shown rarely and briefly.

## Files

- Create: `android/app/src/main/java/com/pabrikespmp/dashboard/OfflineAwareWebViewClient.java`
- Modify: `android/app/src/main/java/com/pabrikespmp/dashboard/MainActivity.java`
- Create: `android/app/src/main/assets/offline.html`

## Open risks, explicitly accepted

- The 3-second polling interval is a reasonable default, not empirically tuned — easy to adjust later if it feels too slow/fast in real use.
- This can only be verified by a real build installed on a device or emulator with airplane mode toggled — the project's Browser pane preview tooling has no way to simulate a native Android WebView's network-failure path, so this feature cannot be verified through the browser-based workflow used elsewhere in this project. The implementation plan must call this out explicitly rather than claim a verification method that doesn't apply here.
- If `dash.pabrikespmp.com` itself is down (not a client connectivity problem) while the client has real internet, the polling `fetch` may still resolve rather than throw depending on how the server/hosting responds to the request — in that narrow edge case the fallback page could reload into another failure. This is an accepted edge case, not something this spec adds retry-limit/backoff logic for.
