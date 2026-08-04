# Android Offline Fallback + Satpam Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two independent, small pieces of work bundled into one plan since they were requested together: (1) replace Android WebView's built-in "no connection" error screen with a branded skeleton + auto-retrying popup, per the approved design spec; (2) add the existing user-menu/appearance-toggle to the top-right corner of the Satpam mobile app's home screen, matching the pattern already used by the regular dashboard header.

**Architecture:** Part A (Tasks 1-3) is entirely native Android code (`android/` project) — a `BridgeWebViewClient` subclass that intercepts main-frame load failures and redirects to a bundled local HTML asset, wired in via Capacitor's official `Bridge.setWebViewClient` extension point. Part B (Task 4) is a small Next.js change reusing two already-built, already-shipped components (`UserMenu`, `AppearanceMenu`) verbatim on the Satpam home screen, following the exact same data-fetching pattern the regular `(dashboard)/layout.tsx` already uses.

**Tech Stack:** Part A: Java, Android WebView APIs, Capacitor 8 Android bridge (`@capacitor/android`). Part B: Next.js Server Component + existing shadcn/dropdown-menu components.

## Global Constraints

- Part A must not touch the Next.js web app at all — Android-native files only.
- Part A must not change the existing camera-permission bridging (`BridgeWebChromeClient`) — this change only touches `WebViewClient`, a separate class.
- Part A's local fallback page must be fully self-contained (no external CSS/JS/font/image references) since it has to render correctly with zero connectivity.
- Part A's retry navigation must return to the exact URL that failed, not just the app's root, and must only ever navigate to `https://dash.pabrikespmp.com/...` (the app's real domain) — never anywhere else.
- Part B reuses `UserMenu`/`AppearanceMenu` exactly as they already exist — no new props, no visual variants. Only `NotificationBell` is deliberately excluded (the user asked for "tombol pengguna dan toggle tampilan" specifically, not the notification bell).
- Part B only touches the Satpam **home screen** (`/satpam-app`), not the full-screen live-inspection camera screen (`/satpam-app/inspeksi/[jadwalId]`) — that screen is a deliberately immersive, minimal-chrome camera view (per the earlier design spec) where adding a dropdown menu would clash with its established layout; the user's request named the `/satpam-app` route specifically.

---

## Task 1: `offline.html` fallback asset

**Files:**
- Create: `android/app/src/main/assets/offline.html`

**Interfaces:**
- Consumes: nothing (fully self-contained static asset).
- Produces: a static HTML page reachable at `file:///android_asset/offline.html?target=<url-encoded-url>` — Task 2 loads it by this exact path.

- [ ] **Step 1: Create the asset directory and file**

Confirm `android/app/src/main/assets/` already exists (it does — it currently holds `capacitor.config.json`, `capacitor.plugins.json`, and the `public/` folder synced from `capacitor-www/`). This new file sits as a sibling of `public/`, so `npx cap sync` never touches or removes it.

Write `android/app/src/main/assets/offline.html`:

```html
<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>PMP Group</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    height: 100%;
    background: oklch(0.16 0.025 240);
    color: oklch(0.94 0.02 200);
    font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
    overflow: hidden;
  }
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 20px;
    gap: 16px;
  }
  .wordmark {
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.01em;
    padding: 4px 0 12px;
  }
  .skeleton-block {
    height: 88px;
    border-radius: 12px;
    background: oklch(0.24 0.03 240);
    position: relative;
    overflow: hidden;
  }
  .skeleton-block::after {
    content: "";
    position: absolute;
    inset: 0;
    transform: translateX(-100%);
    background: linear-gradient(90deg, transparent, oklch(0.32 0.03 240 / 60%), transparent);
    animation: shimmer 1.6s infinite;
  }
  @keyframes shimmer {
    100% { transform: translateX(100%); }
  }
  .banner {
    position: fixed;
    left: 16px;
    right: 16px;
    bottom: 24px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-radius: 12px;
    background: oklch(0.75 0.15 55);
    color: oklch(0.18 0.02 60);
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: oklch(0.18 0.02 60);
    flex-shrink: 0;
    animation: pulse 1.2s infinite;
  }
  @keyframes pulse {
    50% { opacity: 0.35; }
  }
</style>
</head>
<body>
  <div class="shell">
    <div class="wordmark">PMP Group</div>
    <div class="skeleton-block"></div>
    <div class="skeleton-block"></div>
    <div class="skeleton-block"></div>
    <div class="skeleton-block"></div>
  </div>
  <div class="banner">
    <span class="dot"></span>
    Tidak ada koneksi internet
  </div>
  <script>
    (function () {
      var FALLBACK = "https://dash.pabrikespmp.com/";
      var params = new URLSearchParams(window.location.search);
      var target = params.get("target");
      // URLSearchParams.get() already percent-decodes the value — the
      // native side encodes it once with Uri.encode(), so no further
      // decoding happens here.
      var destination = target && /^https:\/\/dash\.pabrikespmp\.com\//.test(target) ? target : FALLBACK;

      function checkConnection() {
        fetch(destination, { method: "HEAD", mode: "no-cors", cache: "no-store" })
          .then(function () {
            window.location.href = destination;
          })
          .catch(function () {
            // still offline — keep polling
          });
      }

      setInterval(checkConnection, 3000);
    })();
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify**

Open the file in a browser directly (`file://` path) to confirm the skeleton shimmer animates and the banner renders correctly — this checks the CSS/layout only; the `fetch`-based retry polling cannot be meaningfully tested outside the real Android WebView (no real navigation target to reach), which Task 3 covers.

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/assets/offline.html
git commit -m "Add branded offline fallback page for Android WebView"
```

---

## Task 2: `OfflineAwareWebViewClient`

**Files:**
- Create: `android/app/src/main/java/com/pabrikespmp/dashboard/OfflineAwareWebViewClient.java`

**Interfaces:**
- Consumes: `com.getcapacitor.Bridge`, `com.getcapacitor.BridgeWebViewClient` (both from `@capacitor/android`, already a project dependency).
- Produces: `OfflineAwareWebViewClient(Bridge bridge)` constructor — Task 3 instantiates this and installs it via `Bridge.setWebViewClient`.

- [ ] **Step 1: Write the class**

```java
package com.pabrikespmp.dashboard;

import android.net.Uri;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

// Replaces Android's built-in "no connection" error screen with the app's
// own branded offline.html asset whenever the top-level page fails to
// load — covers both a cold start with no connectivity and an in-app
// navigation attempted while offline (both are the same WebView-level
// event: a failed main-frame load). Sub-resource failures (e.g. one
// broken image on an otherwise-fine page) fall through to Capacitor's
// normal handling, unchanged.
public class OfflineAwareWebViewClient extends BridgeWebViewClient {

    private static final String OFFLINE_PAGE = "file:///android_asset/offline.html";

    public OfflineAwareWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request.isForMainFrame()) {
            view.loadUrl(OFFLINE_PAGE + "?target=" + Uri.encode(request.getUrl().toString()));
            return;
        }
        super.onReceivedError(view, request, error);
    }
}
```

This is a direct subclass of Capacitor's own `BridgeWebViewClient` (confirmed against the actual `@capacitor/android` source in `node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeWebViewClient.java`) — every other override (`shouldInterceptRequest`, `shouldOverrideUrlLoading`, `onPageFinished`, `onPageStarted`, `onReceivedHttpError`, `onRenderProcessGone`, `onPageCommitVisible`) is inherited unchanged, so nothing else about Capacitor's bridge behavior (URL scheme handling, plugin JS injection, WebViewListener notifications) is affected.

- [ ] **Step 2: Verify**

No local Android SDK/emulator is available in this environment (`ANDROID_HOME` is unset) — a real Gradle build cannot be run here. Verify by careful manual reading instead: confirm the package name (`com.pabrikespmp.dashboard`) matches `MainActivity.java`'s package exactly, confirm the imports match real class names from the `@capacitor/android` source referenced above, and confirm `onReceivedError`'s signature (`WebView, WebResourceRequest, WebResourceError`) matches `BridgeWebViewClient`'s exactly (this is the API-23+ overload; the project's `minSdkVersion` is 24, confirmed in `android/variables.gradle`, so this overload is safe to use).

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/java/com/pabrikespmp/dashboard/OfflineAwareWebViewClient.java
git commit -m "Add OfflineAwareWebViewClient to intercept main-frame load failures"
```

---

## Task 3: Wire it into `MainActivity`

**Files:**
- Modify: `android/app/src/main/java/com/pabrikespmp/dashboard/MainActivity.java`

**Interfaces:**
- Consumes: `OfflineAwareWebViewClient` (Task 2), `BridgeActivity.getBridge()`/`Bridge.setWebViewClient(BridgeWebViewClient)` (both public Capacitor APIs, confirmed in `node_modules/@capacitor/android`).

- [ ] **Step 1: Replace the file**

Current content is a bare one-line stub:

```java
package com.pabrikespmp.dashboard;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {}
```

Replace with:

```java
package com.pabrikespmp.dashboard;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void load() {
        super.load();
        getBridge().setWebViewClient(new OfflineAwareWebViewClient(getBridge()));
    }
}
```

`load()` is `protected` on `BridgeActivity` (confirmed in `node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeActivity.java`) and is exactly where Capacitor constructs the `Bridge` (`bridge = bridgeBuilder...create()`) before the initial page load begins — calling `super.load()` first guarantees `getBridge()` returns a fully-constructed, non-null bridge. `Bridge.setWebViewClient` immediately applies the new client to the live `WebView` (`this.webViewClient = client; webView.setWebViewClient(client);` — confirmed in `Bridge.java`), so this replaces Capacitor's default client before any page load (including the very first one) can occur.

- [ ] **Step 2: Verify**

Same constraint as Task 2 — no local Android SDK here. Verify by reading: confirm `load()`'s override signature exactly matches the parent (`protected void load()`, no parameters, no return value), confirm `getBridge()` is called after `super.load()` (never before — `bridge` is null until `load()` runs), confirm no other method in `MainActivity` needs updating.

If the user has Android Studio available, real verification is: `npx cap sync android`, open the project in Android Studio, build, install on a device/emulator, then toggle airplane mode and (a) force-close and reopen the app to see the offline page instead of the default WebView error, and (b) toggle airplane mode back on and confirm the app auto-navigates back to the real page within a few seconds. This plan cannot execute that verification itself — call this out plainly rather than claiming it passed.

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/java/com/pabrikespmp/dashboard/MainActivity.java
git commit -m "Install OfflineAwareWebViewClient on app start"
```

---

## Task 4: Satpam home screen header — user menu + appearance toggle

**Files:**
- Modify: `src/app/satpam-app/page.tsx`
- Modify: `src/components/satpam-app/beranda-client.tsx`

**Interfaces:**
- Consumes: `UserMenu` (existing, `src/components/dashboard/user-menu.tsx`, props `{ name: string; profile: OwnProfile | null }`), `AppearanceMenu` (existing, `src/components/dashboard/appearance-menu.tsx`, no props), `getUserById` (existing, `src/lib/queries/akun.ts`, `(id: number) => Promise<OwnProfileRow | null>`), `requireSatpam` (existing, returns the NextAuth `Session`).

- [ ] **Step 1: Fetch the profile in the Server Component**

Replace `src/app/satpam-app/page.tsx`:

```tsx
import { requireSatpam } from "@/lib/require-access";
import { getSatpamInspectionList } from "@/lib/queries/satpam-inspection";
import { getBusinessDateISO } from "@/lib/business-date";
import { getUserById } from "@/lib/queries/akun";
import { SatpamBerandaClient } from "@/components/satpam-app/beranda-client";

export default async function SatpamBerandaPage() {
  const session = await requireSatpam();
  const [cards, profile] = await Promise.all([
    getSatpamInspectionList(getBusinessDateISO()),
    getUserById(Number(session.user.id)),
  ]);

  return (
    <SatpamBerandaClient
      cards={cards}
      userName={session.user.name ?? session.user.username}
      profile={profile}
    />
  );
}
```

This mirrors `src/app/(dashboard)/layout.tsx`'s existing `getUserById(Number(session.user.id))` + `session.user.name ?? session.user.username` pattern exactly — the same real query, same fallback logic, no new code path invented.

- [ ] **Step 2: Render the header controls**

In `src/components/satpam-app/beranda-client.tsx`, add imports:

```tsx
import { UserMenu } from "@/components/dashboard/user-menu";
import { AppearanceMenu } from "@/components/dashboard/appearance-menu";
import type { OwnProfile } from "@/components/dashboard/account-settings-dialog";
```

Change the component signature and header:

```tsx
export function SatpamBerandaClient({
  cards,
  userName,
  profile,
}: {
  cards: SatpamInspectionCard[];
  userName: string;
  profile: OwnProfile | null;
}) {
  const [tab, setTab] = useState<"BERANGKAT" | "DATANG">("BERANGKAT");
  const filtered = cards.filter((c) => c.tipe === tab);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-4 py-3">
        <h1 className="font-display text-xl font-bold">Inspeksi Pengiriman</h1>
        <div className="flex items-center gap-1">
          <AppearanceMenu />
          <UserMenu name={userName} profile={profile} />
        </div>
      </header>
```

(The rest of the component — `Tabs`, `TabsList`, `TabsContent`, the card list — stays exactly as it already is; only the `header` element and the function signature change.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`, `npx eslint src/app/satpam-app/page.tsx src/components/satpam-app/beranda-client.tsx` — both clean. `npm run build` succeeds.

Live-verify in the browser: open `/satpam-app`, confirm the header now shows the appearance-toggle icon and the user-menu button top-right, confirm clicking the appearance toggle opens the same Mode Tampilan/Palet Warna dropdown used elsewhere in the app and actually changes the theme on this screen, confirm clicking the user menu opens the same dropdown (Pengaturan Akun / Keluar) as the regular dashboard, and confirm "Keluar" signs out correctly. Since a real Satpam session isn't available to this agent, if the Browser pane can't get past the login redirect, verify structurally instead (confirm imports/props/JSX are wired correctly by reading the diff) and note the live-click-through gap plainly, same as every other Satpam-app task this session.

- [ ] **Step 4: Commit**

```bash
git add src/app/satpam-app/page.tsx src/components/satpam-app/beranda-client.tsx
git commit -m "Add user menu and appearance toggle to Satpam home screen header"
```

---

## Task 5: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Re-run static checks for Part B**

Run: `npx tsc --noEmit`, `npx eslint src`, `npm run build` — all three clean.

- [ ] **Step 2: Confirm Part A's files are syntactically sound and correctly scoped**

Re-read `OfflineAwareWebViewClient.java` and `MainActivity.java` together and confirm: package names match, the class Task 3 instantiates is exactly the class Task 2 created, no other file in `android/` was touched, `offline.html` is not inside `assets/public/` (would make it vulnerable to being overwritten by `npx cap sync`).

- [ ] **Step 3: Confirm no leftover scratch files**

Run: `git status --short` — must be clean.

- [ ] **Step 4: Report the two verification gaps plainly**

This plan cannot verify, in this environment: (a) that the offline fallback actually intercepts a real WebView network failure on-device (no Android SDK/emulator available here — requires the user to build and test on a real device or emulator with airplane mode), and (b) a full authenticated click-through of the Satpam header controls (no Satpam credentials available to this agent). Both are pre-existing, disclosed limitations, not new gaps introduced by this plan — state them clearly in the final report rather than omitting them.
