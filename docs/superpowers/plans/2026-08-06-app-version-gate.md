# App Version Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** When the Android Capacitor app opens, detect the running APK's `versionCode` and either block usage entirely (below minimum) or show a dismissible "update available" banner (below latest but not below minimum) — with zero server round-trip, driven entirely by constants in a code file.

**Architecture:** A new pure comparison function (`classifyAppVersion`) decides one of three states from two integers. A new client component (`AppVersionGate`) calls `@capacitor/app`'s `App.getInfo()` once on mount (native platforms only), runs the comparison against constants in `src/lib/app-version-config.ts`, and renders a full-screen non-dismissible block overlay, a dismissible top banner, or nothing. It replaces the current bare `{children}` pass-through in `providers.tsx` by wrapping children so the block state can suppress them.

**Tech Stack:** `@capacitor/app` (new dependency), existing React/Next.js client component conventions, Tailwind + shadcn design tokens already used across the dashboard, `lucide-react` icons.

## Global Constraints

- Config lives in `src/lib/app-version-config.ts` as plain exported constants — no DB table, no admin UI, no API endpoint/server action. Editing this file + deploying the web app is the entire "publish a new version rule" workflow.
- Comparison uses integer `versionCode` (Android `build` from `App.getInfo()`), never the human-readable `versionName` string, for the block/banner decision. `versionName` is display-only.
- Gating is `Capacitor.isNativePlatform()` — identical to the existing `LocationTrackingBootstrap`/`NativeStatusBarSync` pattern. Nothing renders on desktop/browser dashboard access.
- Block screen: full-screen overlay, no dismiss control of any kind (no close button, no Escape, no outside-click, no back-gesture bypass), no link/button — text instructions only: "Hubungi admin/IT perusahaan untuk mendapatkan pembaruan aplikasi sebelum melanjutkan."
- Banner: dismissible (X button), dismissal state is in-memory only (`useState`, not localStorage) — reappears every fresh app cold-start by design.
- On any error reading the version (plugin missing, `getInfo()` throws) — fail open: render nothing, never block the user due to a technical failure.
- No changes to iOS — this project has no active iOS release.

---

### Task 1: `classifyAppVersion` pure comparison function

**Files:**
- Create: `src/lib/app-version-config.ts`

**Interfaces:**
- Produces: `export const APP_MIN_VERSION_CODE = 1;`, `export const APP_LATEST_VERSION_CODE = 1;`, `export const APP_LATEST_VERSION_NAME = "1.0";`, `export type AppVersionStatus = "blocked" | "update-available" | "current";`, `export function classifyAppVersion(currentVersionCode: number, minVersionCode: number, latestVersionCode: number): AppVersionStatus`
- Consumed by: Task 3 (`AppVersionGate` component).

This project has no test runner configured (no `vitest`/`jest` in `package.json`, no `test` script, no existing `*.test.ts` files outside `node_modules`) — every feature in this codebase so far has been verified through manual/live checks, not automated unit tests. Don't introduce a test framework for one pure function. Instead, verify it with a disposable script run through `tsx` (already a project dependency, used for one-off scripts like `scripts/migrate-akun-sesi.ts` and the `seed:auth` npm script), then delete the script — it's a verification step, not a permanent artifact.

- [x] **Step 1: Write the implementation**

```ts
// Manually bumped alongside every APK release. APP_MIN_VERSION_CODE is
// raised once an old APK build is no longer safe to run (e.g. it lacks a
// native permission or plugin the current web bundle assumes exists).
// APP_LATEST_VERSION_CODE/_NAME track the newest available build so
// slightly-behind-but-still-supported devices get a non-blocking nudge.
// Because the web bundle is always loaded fresh from server.url, editing
// these constants and deploying is the entire "publish a new version
// rule" workflow — no DB, no admin UI, no API call.
export const APP_MIN_VERSION_CODE = 1;
export const APP_LATEST_VERSION_CODE = 1;
export const APP_LATEST_VERSION_NAME = "1.0";

export type AppVersionStatus = "blocked" | "update-available" | "current";

export function classifyAppVersion(
  currentVersionCode: number,
  minVersionCode: number,
  latestVersionCode: number
): AppVersionStatus {
  if (currentVersionCode < minVersionCode) return "blocked";
  if (currentVersionCode < latestVersionCode) return "update-available";
  return "current";
}
```

- [x] **Step 2: Verify it with a disposable script**

Create a scratch file `scripts/_verify-app-version.ts` (underscore prefix marks it disposable, not a permanent addition to `scripts/`):

```ts
import { classifyAppVersion } from "../src/lib/app-version-config";

const cases: Array<[number, number, number, string]> = [
  [1, 3, 5, "blocked"],
  [2, 3, 5, "blocked"],
  [3, 3, 5, "update-available"],
  [4, 3, 5, "update-available"],
  [5, 3, 5, "current"],
  [6, 3, 5, "current"],
  [1, 1, 1, "current"],
];

let failures = 0;
for (const [current, min, latest, expected] of cases) {
  const actual = classifyAppVersion(current, min, latest);
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"} classifyAppVersion(${current}, ${min}, ${latest}) => ${actual} (expected ${expected})`);
}
if (failures > 0) {
  console.error(`${failures} case(s) failed`);
  process.exit(1);
}
console.log("All cases passed");
```

Run: `npx tsx scripts/_verify-app-version.ts`
Expected: all 7 lines print `PASS`, final line `All cases passed`.

- [x] **Step 3: Delete the scratch verification script**

```bash
rm scripts/_verify-app-version.ts
```

- [x] **Step 4: Commit**

```bash
git add src/lib/app-version-config.ts
git commit -m "Add app version classification constants and comparison function"
```

---

### Task 2: Add `@capacitor/app` dependency and sync Android

**Files:**
- Modify: `package.json` (dependency addition via npm, not hand-edited)
- Modify (auto-generated by `cap sync`, commit as-is): `android/app/capacitor.build.gradle`, `android/capacitor.settings.gradle`, `android/app/src/main/assets/capacitor.plugins.json` (or equivalent generated registration file — actual filename depends on what `cap sync` touches, verify against `git status` output after running it)

**Interfaces:**
- Produces: `App.getInfo()` from `import { App } from "@capacitor/app";`, resolving to `{ build: string; version: string; ... }` (per `@capacitor/app`'s published `AppInfo` type) — consumed by Task 3.

- [x] **Step 1: Install the plugin**

Run: `npm install @capacitor/app`

- [x] **Step 2: Sync Android native project**

Run: `npx cap sync android`

Expected: command completes without error; it prints a summary of plugins found including `@capacitor/app`.

- [x] **Step 3: Confirm what changed**

Run: `git status`
Expected: `package.json`, `package-lock.json`, and one or more `android/` files touched by `cap sync` (e.g. `android/app/capacitor.build.gradle`, `android/capacitor.settings.gradle`). No manual edits needed to any of these — they are generated.

- [x] **Step 4: Commit**

```bash
git add package.json package-lock.json android/
git commit -m "Add @capacitor/app plugin for native version detection"
```

---

### Task 3: `AppVersionGate` component

**Files:**
- Create: `src/components/app-version-gate.tsx`

**Interfaces:**
- Consumes: `classifyAppVersion`, `APP_MIN_VERSION_CODE`, `APP_LATEST_VERSION_CODE`, `APP_LATEST_VERSION_NAME` from `@/lib/app-version-config` (Task 1); `App` from `@capacitor/app` (Task 2); `Capacitor` from `@capacitor/core` (already a dependency, same import used in `src/components/location-tracking-bootstrap.tsx`).
- Produces: `export function AppVersionGate({ children }: { children: React.ReactNode }): JSX.Element` — a component that wraps `children`, consumed by Task 4 (`providers.tsx`).

Before writing this file, read `src/components/location-tracking-bootstrap.tsx` for the exact native-gating pattern (`Capacitor.isNativePlatform()`, `useEffect` with a mount-once ref, cleanup) this component should mirror for consistency, and read `src/components/ui/dialog.tsx` briefly to confirm this component intentionally does NOT use it (the block screen must have zero dismiss path, which the shadcn Dialog primitive doesn't guarantee by default).

- [x] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { AlertTriangle, X } from "lucide-react";
import {
  classifyAppVersion,
  APP_MIN_VERSION_CODE,
  APP_LATEST_VERSION_CODE,
  APP_LATEST_VERSION_NAME,
  type AppVersionStatus,
} from "@/lib/app-version-config";

export function AppVersionGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AppVersionStatus | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    App.getInfo()
      .then((info) => {
        const currentVersionCode = parseInt(info.build, 10);
        if (Number.isNaN(currentVersionCode)) return;
        setStatus(
          classifyAppVersion(currentVersionCode, APP_MIN_VERSION_CODE, APP_LATEST_VERSION_CODE)
        );
      })
      .catch(() => {
        // Fail open: if we can't read the version, never block the user
        // over a technical failure.
      });
  }, []);

  if (status === "blocked") {
    return (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <h1 className="text-xl font-semibold text-foreground">Pembaruan Aplikasi Wajib</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Versi aplikasi ini sudah tidak didukung. Hubungi admin/IT perusahaan untuk mendapatkan
          pembaruan aplikasi sebelum melanjutkan.
        </p>
      </div>
    );
  }

  return (
    <>
      {status === "update-available" && !bannerDismissed && (
        <div className="flex items-center justify-between gap-3 bg-secondary px-4 py-2 text-sm text-secondary-foreground">
          <span>
            Versi baru (v{APP_LATEST_VERSION_NAME}) tersedia. Hubungi admin/IT untuk memperbarui
            aplikasi.
          </span>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            aria-label="Tutup"
            className="shrink-0 rounded p-1 hover:bg-secondary-foreground/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {children}
    </>
  );
}
```

- [x] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new type errors introduced by this file.

- [x] **Step 3: Commit**

```bash
git add src/components/app-version-gate.tsx
git commit -m "Add AppVersionGate component for forced/optional update UI"
```

---

### Task 4: Wire `AppVersionGate` into `providers.tsx`

**Files:**
- Modify: `src/components/providers.tsx`

**Interfaces:**
- Consumes: `AppVersionGate` from `@/components/app-version-gate` (Task 3).

The current file (read in full before editing):

```tsx
"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { PaletteProvider } from "@/components/palette-provider";
import { NativeStatusBarSync } from "@/components/native-status-bar-sync";
import { LocationTrackingBootstrap } from "@/components/location-tracking-bootstrap";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
        <PaletteProvider>
          <NativeStatusBarSync />
          <LocationTrackingBootstrap />
          {children}
        </PaletteProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
```

`NativeStatusBarSync` and `LocationTrackingBootstrap` render `null` and sit as siblings — they don't need to wrap anything. `AppVersionGate` is different: it must be able to suppress `children` entirely when blocked, so it wraps rather than sits alongside.

- [x] **Step 1: Edit the file**

Change the import block to add:

```tsx
import { AppVersionGate } from "@/components/app-version-gate";
```

Change the returned JSX from:

```tsx
        <PaletteProvider>
          <NativeStatusBarSync />
          <LocationTrackingBootstrap />
          {children}
        </PaletteProvider>
```

to:

```tsx
        <PaletteProvider>
          <NativeStatusBarSync />
          <LocationTrackingBootstrap />
          <AppVersionGate>{children}</AppVersionGate>
        </PaletteProvider>
```

- [x] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new type errors.

- [x] **Step 3: Manual verification in dev browser**

Run the dev server (`npm run dev` or the project's existing dev script) and load the dashboard in a normal desktop browser. Confirm the page renders exactly as before this change — no banner, no block screen, no layout shift — since `Capacitor.isNativePlatform()` is `false` in a plain browser and `AppVersionGate` renders only `children` unchanged.

Then, temporarily edit `src/components/app-version-gate.tsx`'s `useEffect` to force a status for visual inspection only (do not commit this): replace the body of the `useEffect` with `setStatus("blocked");` and reload — confirm the full-screen block overlay covers the entire viewport with no visible way to dismiss it (try Escape key, clicking outside — nothing should close it). Repeat with `setStatus("update-available");` and confirm the banner appears at the top, the X button dismisses it, and the rest of the dashboard remains fully usable underneath. Revert the temporary edit back to the real `App.getInfo()` logic before committing.

- [x] **Step 4: Commit**

```bash
git add src/components/providers.tsx
git commit -m "Wire AppVersionGate into the app-wide Providers tree"
```

---

### Task 5: Full verification pass

**Files:**
- None created — this task verifies the prior four tasks together.

**Interfaces:**
- Consumes: everything from Tasks 1-4.

- [x] **Step 1: Re-run the Task 1 verification cases**

Since this project has no persistent test suite, re-confirm `classifyAppVersion` still behaves correctly by recreating and running the same disposable script from Task 1, Step 2 (`scripts/_verify-app-version.ts`), then deleting it again. Expected: all 7 cases print `PASS`.

- [x] **Step 2: Full type-check**

Run: `npx tsc --noEmit`
Expected: no errors anywhere in the project.

- [x] **Step 3: Confirm `cap sync` state is committed and clean**

Run: `npx cap sync android` again, then `git status`.
Expected: no uncommitted changes appear — Task 2 already committed the generated files, and running sync again should be a no-op against a clean working tree.

- [x] **Step 4: Re-run the manual browser check from Task 4, Step 3**

Confirm once more, on the final committed code (not the temporary override), that:
- In a normal browser, nothing renders differently than before this feature existed.
- `AppVersionGate` gates purely on `Capacitor.isNativePlatform()`, so this is the full extent of what's testable outside a real Android device in this environment — actual on-device testing (confirming `App.getInfo()` returns the real `versionCode` from `android/app/build.gradle` and the three real status transitions) is the user's responsibility once they rebuild the APK outside this sandbox, per the established limitation from the earlier APK build attempt this session.

- [x] **Step 5: Commit if any fixes were needed**

If Steps 1-4 required any code changes to pass, commit them individually with descriptive messages before considering this plan complete. If everything already passed, no commit is needed for this task.
