# Restrukturisasi Rute MKEsindo ke `/mkesindo` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every MKEsindo-owned route (dashboard modules, `/driver-app`, `/satpam-app`, `/invoice`, `/payment`, and their API routes) from the root to `/mkesindo/*`, so MKEsindo sits alongside `/pmputra` under `/grup` in the URL hierarchy, exactly as approved in `docs/superpowers/specs/2026-08-08-restrukturisasi-rute-mkesindo-design.md`.

**Architecture:** Physical folder moves (`git mv`), not `rewrites()` aliasing — the address bar must actually change on internal navigation. Every hardcoded path reference (`Link`, `router.push`, `redirect()`, `revalidatePath()`, `fetch()`) is updated directly; `next.config.ts`'s `redirects()` and `proxy.ts`'s `accountScope`-based dispatch are a safety net for old bookmarks/session flow, not a substitute for updating references.

**Tech Stack:** Next.js 16 (App Router, `proxy.ts` middleware), NextAuth v5, TypeScript, no automated test suite in this repo — verification is `npx tsc --noEmit`, `npm run lint`, `npm run build`, and live checks via the dev server (this project's established pattern; see every prior "full verification pass" task in this repo's history).

## Global Constraints

- `/akses-ditolak` stays reachable at the top level (`src/app/akses-ditolak/page.tsx`), no special layout — shared by every PT, not MKEsindo-specific.
- Every internal `Link`/`router.push`/`redirect()`/`revalidatePath()`/`fetch()` reference to a moved path must be updated directly. `next.config.ts` redirects and `proxy.ts` dispatch are a safety net only.
- `PUBLIC_PREFIXES` in `proxy.ts` must list `/mkesindo/invoice` and `/mkesindo/payment` (not `/invoice`/`/payment`) once those move, or the public token pages start requiring login.
- Android native app requires zero changes — `capacitor.config.ts` only points at the bare domain (`https://dash.pabrikespmp.com`), confirmed via that file and a zero-hit grep of `android/` for `driver-app`/`satpam-app`.
- API routes moving to `/api/mkesindo/...`: `pabrik-location`, `print/delivery-order/[deliveryOrderId]`, `routing`, `routing/multi`, `notifications/stream`, `upload/armada-foto`, `upload/doc-template`, `upload/driver-app`, `upload/satpam-check`, `upload/site-asset`. Staying unchanged: `auth/[...nextauth]`, `geocode`, `geocode/search`, `wilayah/districts`, `wilayah/regencies`.
- Out of scope: PMPutra invoice/payment pages (no Sales/Delivery/Invoice modules exist for PMPutra yet), and any change to `/pmputra` or `/grup` routing (already correct).
- Run `npx tsc --noEmit` and `npm run lint` after every task; both must be clean before moving to the next task.

## Scope Addendum (discovered during planning, not in the original spec)

Exploring `src/app/(dashboard)` turned up a file the spec didn't account for: `src/app/(dashboard)/static/prima-maesa-putra/route.ts`, which serves a static PMPutra report HTML file (`static/prima-maesa-putra.html`) at the public-but-login-gated URL `/static/prima-maesa-putra`. This is PMPutra's own content, physically homed inside MKEsindo's route group purely by past convenience — moving it under `/mkesindo` would be actively wrong (PMPutra content nested under MKEsindo's namespace), and no code or DB row references this URL by any name other than its current one (confirmed by grep — the only two hits are the route file's own comment and its hardcoded filesystem path string). Task 3 below extracts it to a new top-level `src/app/static/prima-maesa-putra/route.ts`, keeping its public URL **unchanged** at `/static/prima-maesa-putra` — same treatment as `/akses-ditolak`, and zero risk (no DB update needed, since the URL doesn't change).

---

### Task 1: Move `driver-app` and `satpam-app` to `/mkesindo/*`

**Files:**
- Move: `src/app/driver-app/**` → `src/app/mkesindo/driver-app/**`
- Move: `src/app/satpam-app/**` → `src/app/mkesindo/satpam-app/**`
- Modify: `src/app/mkesindo/driver-app/actions.ts:69,81`
- Modify: `src/components/driver-app/driver-tab-shell.tsx:40-43`
- Modify: `src/components/driver-app/steps/pengiriman-step.tsx:216`
- Modify: `src/components/driver-app/stop-flow.tsx:63`
- Modify: `src/components/satpam-app/live-inspeksi-client.tsx:213`
- Modify: `src/app/(dashboard)/layout.tsx:27,41`

**Interfaces:**
- Produces: `/mkesindo/driver-app` and `/mkesindo/satpam-app` as the real URLs for these two apps — every later task assumes these are already the live paths.

- [ ] **Step 1: Move the folders**

```bash
mkdir -p src/app/mkesindo
git mv src/app/driver-app src/app/mkesindo/driver-app
git mv src/app/satpam-app src/app/mkesindo/satpam-app
```

- [ ] **Step 2: Fix `revalidatePath` calls in the moved driver-app actions**

In `src/app/mkesindo/driver-app/actions.ts`:

```ts
// Before (appears twice, lines 69 and 81):
    revalidatePath("/driver-app");

// After (both occurrences):
    revalidatePath("/mkesindo/driver-app");
```

Use Edit with `old_string: 'revalidatePath("/driver-app");'`, `new_string: 'revalidatePath("/mkesindo/driver-app");'`, `replace_all: true`.

- [ ] **Step 3: Fix the tab-shell's own path table**

In `src/components/driver-app/driver-tab-shell.tsx`:

```ts
// Before:
const TAB_PATHS: Record<DriverTabKey, string> = {
  tugas: "/driver-app",
  peta: "/driver-app/peta",
  riwayat: "/driver-app/riwayat",
  profil: "/driver-app/profil",
};

// After:
const TAB_PATHS: Record<DriverTabKey, string> = {
  tugas: "/mkesindo/driver-app",
  peta: "/mkesindo/driver-app/peta",
  riwayat: "/mkesindo/driver-app/riwayat",
  profil: "/mkesindo/driver-app/profil",
};
```

- [ ] **Step 4: Fix the two hardcoded driver-app navigation targets**

In `src/components/driver-app/steps/pengiriman-step.tsx:216`:

```tsx
// Before:
          onClick={() => router.push("/driver-app")}

// After:
          onClick={() => router.push("/mkesindo/driver-app")}
```

In `src/components/driver-app/stop-flow.tsx:63`:

```ts
// Before:
    router.replace("/driver-app");

// After:
    router.replace("/mkesindo/driver-app");
```

- [ ] **Step 5: Fix the satpam-app navigation target**

In `src/components/satpam-app/live-inspeksi-client.tsx:213`:

```tsx
// Before:
      router.push("/satpam-app");

// After:
      router.push("/mkesindo/satpam-app");
```

- [ ] **Step 6: Fix the two confinement redirects in the dashboard layout**

In `src/app/(dashboard)/layout.tsx`:

```tsx
// Before (line 27):
    redirect("/satpam-app");

// After:
    redirect("/mkesindo/satpam-app");
```

```tsx
// Before (line 41):
    redirect("/driver-app");

// After:
    redirect("/mkesindo/driver-app");
```

(This file itself still physically lives at `src/app/(dashboard)/layout.tsx` until Task 3 — editing its content now is independent of when it physically moves.)

- [ ] **Step 7: Verify**

```bash
npx tsc --noEmit
npm run lint
grep -rn '"/driver-app\|"/satpam-app' src --include="*.ts" --include="*.tsx"
```

The grep must return **zero** results (every remaining reference is now prefixed `/mkesindo/`). Then start the dev server (`preview_start` with the project's `dev` config), log in as a driver-scoped account and a satpam-scoped account, and confirm both land on `/mkesindo/driver-app` and `/mkesindo/satpam-app` respectively, with in-app navigation (tabs, back buttons, post-submit redirects) staying on the new paths.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Move driver-app and satpam-app under /mkesindo"
```

---

### Task 2: Move `invoice` and `payment` to `/mkesindo/*`

**Files:**
- Move: `src/app/invoice/[token]/page.tsx` → `src/app/mkesindo/invoice/[token]/page.tsx`
- Move: `src/app/payment/[token]/page.tsx` → `src/app/mkesindo/payment/[token]/page.tsx`
- Modify: `src/components/dashboard/route-validation-dialog.tsx:283,641`
- Modify: `src/components/dashboard/sales-transaction-cards.tsx:68`
- Modify: `src/components/invoice-payment-redirect.tsx:15`
- Modify: `proxy.ts` (repo root) — `PUBLIC_PREFIXES`

**Interfaces:**
- Consumes: none from Task 1.
- Produces: `/mkesindo/invoice/[token]` and `/mkesindo/payment/[token]` as the live public (no-login) URLs — Task 7's redirect table and Task 8's verification depend on these being correct.

- [ ] **Step 1: Move the folders**

```bash
git mv src/app/invoice src/app/mkesindo/invoice
git mv src/app/payment src/app/mkesindo/payment
```

- [ ] **Step 2: Fix the two invoice-opening call sites in route-validation-dialog.tsx**

In `src/components/dashboard/route-validation-dialog.tsx:283`:

```tsx
// Before:
        window.open(`/invoice/${d.InvoiceToken}`, "_blank");

// After:
        window.open(`/mkesindo/invoice/${d.InvoiceToken}`, "_blank");
```

In `src/components/dashboard/route-validation-dialog.tsx:641`:

```tsx
// Before:
          window.open(`/invoice/${t.invoiceToken}`, "_blank");

// After:
          window.open(`/mkesindo/invoice/${t.invoiceToken}`, "_blank");
```

- [ ] **Step 3: Fix the invoice link in sales-transaction-cards.tsx**

In `src/components/dashboard/sales-transaction-cards.tsx:68`:

```tsx
// Before:
                href={`/invoice/${delivery.InvoiceToken}`}

// After:
                href={`/mkesindo/invoice/${delivery.InvoiceToken}`}
```

- [ ] **Step 4: Fix the payment redirect helper**

In `src/components/invoice-payment-redirect.tsx:15`:

```ts
// Before:
  const href = `/payment/${paymentToken}`;

// After:
  const href = `/mkesindo/payment/${paymentToken}`;
```

- [ ] **Step 5: Update `PUBLIC_PREFIXES` in the root `proxy.ts`**

In `proxy.ts` (repository root):

```ts
// Before:
const PUBLIC_PREFIXES = ["/login", "/api", "/invoice", "/payment"];

// After:
const PUBLIC_PREFIXES = ["/login", "/api", "/mkesindo/invoice", "/mkesindo/payment"];
```

- [ ] **Step 6: Verify**

```bash
npx tsc --noEmit
npm run lint
grep -rn '`/invoice/\|`/payment/\|"/invoice"\|"/payment"' src proxy.ts --include="*.ts" --include="*.tsx"
```

The grep must return zero results. Then start the dev server, open a real (or test) invoice token URL at `/mkesindo/invoice/<token>` in an incognito/no-session window and confirm it loads without being redirected to `/login` (proves `PUBLIC_PREFIXES` still exempts it), and confirm the "Lunas" auto-redirect on that page lands on `/mkesindo/payment/<token>`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Move invoice and payment under /mkesindo, update PUBLIC_PREFIXES"
```

---

### Task 3: Move the `(dashboard)` route group to `src/app/mkesindo`, extract `akses-ditolak` and the PMPutra static report

**Files:**
- Move (physical, real URL segment): `src/app/(dashboard)/{layout.tsx,page.tsx,error.tsx,loading.tsx,notification-actions.ts,profile-actions.ts}` → `src/app/mkesindo/`
- Move: `src/app/(dashboard)/{aging,delivery,electricity,mitra,pemasaran,pemesanan,pnl,sales,transaksi}` → `src/app/mkesindo/`
- Move: `src/app/(dashboard)/akses-ditolak` → `src/app/akses-ditolak` (top-level, unchanged URL)
- Move: `src/app/(dashboard)/static` → `src/app/static` (top-level, unchanged URL — see Scope Addendum above)
- Modify: `src/app/mkesindo/page.tsx`
- Modify: `src/app/mkesindo/profile-actions.ts`
- Modify: `src/app/mkesindo/{aging,delivery,mitra,pemasaran,pemesanan,pnl,sales}/actions.ts`
- Modify: `src/app/static/prima-maesa-putra/route.ts`

**Interfaces:**
- Consumes: `/mkesindo/driver-app`, `/mkesindo/satpam-app` from Task 1 (this task's `layout.tsx` already points to them after Task 1's edit).
- Produces: `/mkesindo` as the real URL for the beranda page and every one of the 9 module paths (`/mkesindo/pnl`, `/mkesindo/aging`, `/mkesindo/sales`, `/mkesindo/transaksi`, `/mkesindo/electricity`, `/mkesindo/delivery`, `/mkesindo/pemesanan`, `/mkesindo/mitra`, `/mkesindo/pemasaran`) — Task 4, 6, 7, and 8 all depend on these being live.

- [ ] **Step 1: Move every file and folder**

```bash
mkdir -p src/app/mkesindo
git mv "src/app/(dashboard)/layout.tsx" src/app/mkesindo/layout.tsx
git mv "src/app/(dashboard)/page.tsx" src/app/mkesindo/page.tsx
git mv "src/app/(dashboard)/error.tsx" src/app/mkesindo/error.tsx
git mv "src/app/(dashboard)/loading.tsx" src/app/mkesindo/loading.tsx
git mv "src/app/(dashboard)/notification-actions.ts" src/app/mkesindo/notification-actions.ts
git mv "src/app/(dashboard)/profile-actions.ts" src/app/mkesindo/profile-actions.ts
git mv "src/app/(dashboard)/aging" src/app/mkesindo/aging
git mv "src/app/(dashboard)/delivery" src/app/mkesindo/delivery
git mv "src/app/(dashboard)/electricity" src/app/mkesindo/electricity
git mv "src/app/(dashboard)/mitra" src/app/mkesindo/mitra
git mv "src/app/(dashboard)/pemasaran" src/app/mkesindo/pemasaran
git mv "src/app/(dashboard)/pemesanan" src/app/mkesindo/pemesanan
git mv "src/app/(dashboard)/pnl" src/app/mkesindo/pnl
git mv "src/app/(dashboard)/sales" src/app/mkesindo/sales
git mv "src/app/(dashboard)/transaksi" src/app/mkesindo/transaksi
git mv "src/app/(dashboard)/akses-ditolak" src/app/akses-ditolak
git mv "src/app/(dashboard)/static" src/app/static
rmdir "src/app/(dashboard)" 2>/dev/null || true
```

- [ ] **Step 2: Fix the module links and Marketing redirect in the beranda page**

In `src/app/mkesindo/page.tsx`:

```ts
// Before:
const MODULE_LINKS = [
  { href: "/pnl", label: "Keuangan", desc: "Laba rugi dan titik impas", icon: LineChart },
  { href: "/aging", label: "Piutang", desc: "Umur piutang per mitra", icon: Receipt },
  { href: "/sales", label: "Penjualan", desc: "Penjualan harian per wilayah", icon: ShoppingCart },
  { href: "/electricity", label: "Biaya Listrik", desc: "Biaya listrik vs pendapatan", icon: Zap },
  { href: "/delivery", label: "Pengiriman", desc: "Delivery order terbuka", icon: Truck },
];

// After:
const MODULE_LINKS = [
  { href: "/mkesindo/pnl", label: "Keuangan", desc: "Laba rugi dan titik impas", icon: LineChart },
  { href: "/mkesindo/aging", label: "Piutang", desc: "Umur piutang per mitra", icon: Receipt },
  { href: "/mkesindo/sales", label: "Penjualan", desc: "Penjualan harian per wilayah", icon: ShoppingCart },
  { href: "/mkesindo/electricity", label: "Biaya Listrik", desc: "Biaya listrik vs pendapatan", icon: Zap },
  { href: "/mkesindo/delivery", label: "Pengiriman", desc: "Delivery order terbuka", icon: Truck },
];
```

```ts
// Before:
    redirect("/pemasaran");

// After:
    redirect("/mkesindo/pemasaran");
```

- [ ] **Step 3: Fix `profile-actions.ts`'s revalidate target**

In `src/app/mkesindo/profile-actions.ts`:

```ts
// Before:
    revalidatePath("/", "layout");

// After:
    revalidatePath("/mkesindo", "layout");
```

- [ ] **Step 4: Fix every module's `revalidatePath` calls**

In `src/app/mkesindo/aging/actions.ts` — replace all 4 occurrences:

```ts
// Before:
    revalidatePath("/aging");
// After:
    revalidatePath("/mkesindo/aging");
```
Use Edit with `old_string: 'revalidatePath("/aging");'`, `new_string: 'revalidatePath("/mkesindo/aging");'`, `replace_all: true`.

In `src/app/mkesindo/delivery/actions.ts` — replace all 15 occurrences:
Use Edit with `old_string: 'revalidatePath("/delivery");'`, `new_string: 'revalidatePath("/mkesindo/delivery");'`, `replace_all: true`.

In `src/app/mkesindo/mitra/actions.ts` — three distinct strings appear, each needs its own `replace_all` pass:
- `old_string: 'revalidatePath("/mitra");'` → `new_string: 'revalidatePath("/mkesindo/mitra");'`, `replace_all: true` (6 occurrences)
- `old_string: 'revalidatePath("/transaksi");'` → `new_string: 'revalidatePath("/mkesindo/transaksi");'` (1 occurrence, line 38)
- `old_string: 'revalidatePath("/pemesanan");'` → `new_string: 'revalidatePath("/mkesindo/pemesanan");'` (1 occurrence, line 53)

In `src/app/mkesindo/pemasaran/actions.ts` — three distinct strings, each its own `replace_all` pass:
- `old_string: 'revalidatePath("/pemasaran");'` → `new_string: 'revalidatePath("/mkesindo/pemasaran");'`, `replace_all: true` (9 occurrences)
- `old_string: 'revalidatePath("/mitra");'` → `new_string: 'revalidatePath("/mkesindo/mitra");'`, `replace_all: true` (5 occurrences)
- `old_string: 'revalidatePath("/transaksi");'` → `new_string: 'revalidatePath("/mkesindo/transaksi");'`, `replace_all: true` (4 occurrences)

In `src/app/mkesindo/pemesanan/actions.ts` — two distinct strings, each its own `replace_all` pass:
- `old_string: 'revalidatePath("/pemesanan");'` → `new_string: 'revalidatePath("/mkesindo/pemesanan");'`, `replace_all: true` (6 occurrences)
- `old_string: 'revalidatePath("/delivery");'` → `new_string: 'revalidatePath("/mkesindo/delivery");'`, `replace_all: true` (6 occurrences)

In `src/app/mkesindo/pnl/actions.ts` — replace all 4 occurrences:
Use Edit with `old_string: 'revalidatePath("/pnl");'`, `new_string: 'revalidatePath("/mkesindo/pnl");'`, `replace_all: true`.

In `src/app/mkesindo/sales/actions.ts` — replace the 1 occurrence (line 25):
```ts
// Before:
    revalidatePath("/sales");
// After:
    revalidatePath("/mkesindo/sales");
```

- [ ] **Step 5: Fix the PMPutra static report's hardcoded filesystem path**

In `src/app/static/prima-maesa-putra/route.ts`:

```ts
// Before:
  const filePath = path.join(process.cwd(), "src/app/(dashboard)/static/prima-maesa-putra.html");

// After:
  const filePath = path.join(process.cwd(), "src/app/static/prima-maesa-putra.html");
```

This is a filesystem path, not a URL — its public URL stays `/static/prima-maesa-putra`, unchanged, per the Scope Addendum above.

- [ ] **Step 6: Verify**

```bash
npx tsc --noEmit
npm run lint
grep -rn '"/pnl"\|"/aging"\|"/sales"\|"/transaksi"\|"/electricity"\|"/delivery"\|"/pemesanan"\|"/mitra"\|"/pemasaran"' src/app/mkesindo --include="*.ts" --include="*.tsx"
```

The grep must return zero results (every remaining occurrence inside `src/app/mkesindo` is now prefixed). Note this grep is scoped to `src/app/mkesindo` only — `src/components/dashboard/app-sidebar.tsx` and `src/lib/queries/notifications.ts` still have unprefixed references at this point; that's expected, they're fixed in Task 4.

Then start the dev server and, logged in as an MKEsindo-scoped account, confirm `/mkesindo` loads the beranda page with working module link cards, `/mkesindo/pnl` (etc.) load their own module pages, `/akses-ditolak` still renders correctly when navigated to directly, and `/static/prima-maesa-putra` still serves its HTML when logged in.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Move MKEsindo dashboard modules under /mkesindo, extract akses-ditolak and static report to top level"
```

---

### Task 4: Fix remaining external references to the 9 module paths

**Files:**
- Modify: `src/components/dashboard/app-sidebar.tsx`
- Modify: `src/lib/pt-routes.ts`
- Modify: `src/lib/queries/notifications.ts:120,142,175`

**Interfaces:**
- Consumes: `/mkesindo/*` module paths from Task 3.
- Produces: `PT_ROUTES.mkesindo === "/mkesindo"` — Task 6's `proxy.ts` doesn't consume this directly (it's inlined there per that file's existing comment), but Task 8's end-to-end verification of the PT Switcher depends on it.

- [ ] **Step 1: Fix `AppSidebar`'s `NAV_ITEMS`**

In `src/components/dashboard/app-sidebar.tsx`:

```ts
// Before:
const NAV_ITEMS: { href: string; label: string; icon: typeof LayoutGrid; exact?: boolean; moduleKey: ModuleKey }[] = [
  { href: "/", label: "Beranda", icon: LayoutGrid, exact: true, moduleKey: "beranda" },
  { href: "/pnl", label: "Keuangan", icon: LineChart, moduleKey: "pnl" },
  { href: "/aging", label: "Piutang", icon: Receipt, moduleKey: "aging" },
  { href: "/sales", label: "Penjualan", icon: ShoppingCart, moduleKey: "sales" },
  { href: "/transaksi", label: "Transaksi", icon: ArrowLeftRight, moduleKey: "transaksi" },
  { href: "/electricity", label: "Biaya Listrik", icon: Zap, moduleKey: "electricity" },
  { href: "/delivery", label: "Pengiriman", icon: Truck, moduleKey: "delivery" },
  { href: "/pemesanan", label: "Pemesanan", icon: ClipboardList, moduleKey: "pemesanan" },
  { href: "/mitra", label: "Mitra", icon: Users, moduleKey: "mitra" },
  { href: "/pemasaran", label: "Pemasaran", icon: Megaphone, moduleKey: "pemasaran" },
];

// After:
const NAV_ITEMS: { href: string; label: string; icon: typeof LayoutGrid; exact?: boolean; moduleKey: ModuleKey }[] = [
  { href: "/mkesindo", label: "Beranda", icon: LayoutGrid, exact: true, moduleKey: "beranda" },
  { href: "/mkesindo/pnl", label: "Keuangan", icon: LineChart, moduleKey: "pnl" },
  { href: "/mkesindo/aging", label: "Piutang", icon: Receipt, moduleKey: "aging" },
  { href: "/mkesindo/sales", label: "Penjualan", icon: ShoppingCart, moduleKey: "sales" },
  { href: "/mkesindo/transaksi", label: "Transaksi", icon: ArrowLeftRight, moduleKey: "transaksi" },
  { href: "/mkesindo/electricity", label: "Biaya Listrik", icon: Zap, moduleKey: "electricity" },
  { href: "/mkesindo/delivery", label: "Pengiriman", icon: Truck, moduleKey: "delivery" },
  { href: "/mkesindo/pemesanan", label: "Pemesanan", icon: ClipboardList, moduleKey: "pemesanan" },
  { href: "/mkesindo/mitra", label: "Mitra", icon: Users, moduleKey: "mitra" },
  { href: "/mkesindo/pemasaran", label: "Pemasaran", icon: Megaphone, moduleKey: "pemasaran" },
];
```

`isActive={item.exact ? pathname === item.href : pathname.startsWith(item.href)}` (further down in the same file) needs no change — it already works correctly against the new `href` values.

- [ ] **Step 2: Fix `PT_ROUTES`**

In `src/lib/pt-routes.ts`:

```ts
// Before:
export const PT_ROUTES: Record<string, string> = {
  mkesindo: "/",
  pmputra: "/pmputra",
};

// After:
export const PT_ROUTES: Record<string, string> = {
  mkesindo: "/mkesindo",
  pmputra: "/pmputra",
};
```

- [ ] **Step 3: Fix the 3 notification `linkUrl` fields**

In `src/lib/queries/notifications.ts:120` (inside `scanPengajuanMitraBaru`):

```ts
// Before:
    linkUrl: "/pemasaran",
// After:
    linkUrl: "/mkesindo/pemasaran",
```

In `src/lib/queries/notifications.ts:142` (inside `scanSOBaru`):

```ts
// Before:
    linkUrl: "/transaksi",
// After:
    linkUrl: "/mkesindo/transaksi",
```

In `src/lib/queries/notifications.ts:175` (inside `scanSITerbayar`):

```ts
// Before:
    linkUrl: "/transaksi",
// After:
    linkUrl: "/mkesindo/transaksi",
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npm run lint
grep -rn '"/pnl"\|"/aging"\|"/sales"\|"/transaksi"\|"/electricity"\|"/delivery"\|"/pemesanan"\|"/mitra"\|"/pemasaran"' src --include="*.ts" --include="*.tsx"
```

The grep must now return zero results across the **entire** `src` tree. Start the dev server, confirm the MKEsindo sidebar's nav items all point at `/mkesindo/...` and highlight correctly as active, and trigger one of each notification type (or inspect existing unread notifications) to confirm clicking one navigates to the correct `/mkesindo/...` URL.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Update AppSidebar, PT_ROUTES, and notification links to /mkesindo paths"
```

---

### Task 5: Restructure API routes to `/api/mkesindo/*`

**Files:**
- Move: `src/app/api/pabrik-location` → `src/app/api/mkesindo/pabrik-location`
- Move: `src/app/api/print` → `src/app/api/mkesindo/print`
- Move: `src/app/api/routing` → `src/app/api/mkesindo/routing`
- Move: `src/app/api/notifications` → `src/app/api/mkesindo/notifications`
- Move: `src/app/api/upload/{armada-foto,doc-template,driver-app,satpam-check,site-asset}` → `src/app/api/mkesindo/upload/*`
- Modify: `src/components/dashboard/armada-dialog.tsx:140,158`
- Modify: `src/components/dashboard/doc-template-panel.tsx:63`
- Modify: `src/components/dashboard/mitra-location-field.tsx:73`
- Modify: `src/components/dashboard/notification-bell.tsx:59`
- Modify: `src/components/dashboard/pemesanan-form-dialog.tsx:152`
- Modify: `src/components/dashboard/route-validation-dialog.tsx:399,430,726`
- Modify: `src/components/dashboard/site-settings-panel.tsx:42`
- Modify: `src/components/driver-app/steps/konfir-kirim-step.tsx:18`
- Modify: `src/components/driver-app/steps/konfir-terima-step.tsx:15`
- Modify: `src/components/satpam-app/live-inspeksi-client.tsx:29`

**Interfaces:**
- Consumes: none from earlier tasks (API routes are independent of the page-route moves).
- Produces: every MKEsindo-specific API endpoint now lives under `/api/mkesindo/...` — Task 8's verification exercises each of these 10 endpoints.

- [ ] **Step 1: Move the API route folders**

```bash
mkdir -p src/app/api/mkesindo
git mv src/app/api/pabrik-location src/app/api/mkesindo/pabrik-location
git mv src/app/api/print src/app/api/mkesindo/print
git mv src/app/api/routing src/app/api/mkesindo/routing
git mv src/app/api/notifications src/app/api/mkesindo/notifications
mkdir -p src/app/api/mkesindo/upload
git mv src/app/api/upload/armada-foto src/app/api/mkesindo/upload/armada-foto
git mv src/app/api/upload/doc-template src/app/api/mkesindo/upload/doc-template
git mv src/app/api/upload/driver-app src/app/api/mkesindo/upload/driver-app
git mv src/app/api/upload/satpam-check src/app/api/mkesindo/upload/satpam-check
git mv src/app/api/upload/site-asset src/app/api/mkesindo/upload/site-asset
rmdir src/app/api/upload 2>/dev/null || true
```

(`src/app/api/routing/multi/route.ts` moves automatically as part of the `routing` folder move.)

- [ ] **Step 2: Fix the two armada-foto upload calls**

In `src/components/dashboard/armada-dialog.tsx` (lines 140 and 158, identical string):

```ts
// Before:
        const res = await fetch("/api/upload/armada-foto", { method: "POST", body: uploadData });
// After:
        const res = await fetch("/api/mkesindo/upload/armada-foto", { method: "POST", body: uploadData });
```

Use Edit with `old_string: '"/api/upload/armada-foto"'`, `new_string: '"/api/mkesindo/upload/armada-foto"'`, `replace_all: true`.

- [ ] **Step 3: Fix the remaining 9 single-occurrence call sites**

In `src/components/dashboard/doc-template-panel.tsx:63`:
```ts
// Before:
      const res = await fetch("/api/upload/doc-template", { method: "POST", body: formData });
// After:
      const res = await fetch("/api/mkesindo/upload/doc-template", { method: "POST", body: formData });
```

In `src/components/dashboard/mitra-location-field.tsx:73`:
```ts
// Before:
    fetch("/api/pabrik-location")
// After:
    fetch("/api/mkesindo/pabrik-location")
```

In `src/components/dashboard/notification-bell.tsx:59`:
```ts
// Before:
      source = new EventSource("/api/notifications/stream");
// After:
      source = new EventSource("/api/mkesindo/notifications/stream");
```

In `src/components/dashboard/pemesanan-form-dialog.tsx:152`:
```ts
// Before:
        window.open(`/api/print/delivery-order/${result.data.deliveryOrderId}`, "_blank");
// After:
        window.open(`/api/mkesindo/print/delivery-order/${result.data.deliveryOrderId}`, "_blank");
```

In `src/components/dashboard/route-validation-dialog.tsx:399`:
```ts
// Before:
    fetch("/api/pabrik-location")
// After:
    fetch("/api/mkesindo/pabrik-location")
```

In `src/components/dashboard/route-validation-dialog.tsx:430`:
```ts
// Before:
    fetch("/api/routing/multi", {
// After:
    fetch("/api/mkesindo/routing/multi", {
```

In `src/components/dashboard/route-validation-dialog.tsx:726`:
```ts
// Before:
    const res = await fetch("/api/upload/satpam-check", { method: "POST", body: formData });
// After:
    const res = await fetch("/api/mkesindo/upload/satpam-check", { method: "POST", body: formData });
```

In `src/components/dashboard/site-settings-panel.tsx:42`:
```ts
// Before:
      const res = await fetch("/api/upload/site-asset", { method: "POST", body: formData });
// After:
      const res = await fetch("/api/mkesindo/upload/site-asset", { method: "POST", body: formData });
```

In `src/components/driver-app/steps/konfir-kirim-step.tsx:18`:
```ts
// Before:
  const res = await fetch("/api/upload/driver-app", { method: "POST", body: formData });
// After:
  const res = await fetch("/api/mkesindo/upload/driver-app", { method: "POST", body: formData });
```

In `src/components/driver-app/steps/konfir-terima-step.tsx:15`:
```ts
// Before:
  const res = await fetch("/api/upload/driver-app", { method: "POST", body: formData });
// After:
  const res = await fetch("/api/mkesindo/upload/driver-app", { method: "POST", body: formData });
```

In `src/components/satpam-app/live-inspeksi-client.tsx:29`:
```ts
// Before:
  const res = await fetch("/api/upload/satpam-check", { method: "POST", body: formData });
// After:
  const res = await fetch("/api/mkesindo/upload/satpam-check", { method: "POST", body: formData });
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit
npm run lint
grep -rn '"/api/pabrik-location\|"/api/print\|"/api/routing\|"/api/notifications/stream\|"/api/upload/' src --include="*.ts" --include="*.tsx"
```

The grep must return zero results (every remaining occurrence is prefixed `/api/mkesindo/`). Start the dev server and exercise each moved endpoint live: upload an armada foto, upload a doc template, load the mitra-location map picker (pabrik-location), open the notification bell (SSE stream connects), print a delivery order, run a route validation (routing/multi), upload a satpam vehicle-check photo, change a site asset, and upload a driver-app delivery photo. Confirm each succeeds with no 404s in the Network tab.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Restructure MKEsindo API routes under /api/mkesindo"
```

---

### Task 6: Update `proxy.ts` for the new `/mkesindo` home

**Files:**
- Modify: `proxy.ts` (repository root)

**Interfaces:**
- Consumes: `/mkesindo` as MKEsindo's real home (Task 3), `/mkesindo/invoice`/`/mkesindo/payment` in `PUBLIC_PREFIXES` (Task 2, already applied).
- Produces: the final `accountScope`-based dispatch — Task 8's cross-role verification exercises every branch of this function.

- [ ] **Step 1: Replace the scope-branching logic**

In `proxy.ts` (repository root), replace the comment block and the `if (hasGroupAccess)` / pmputra / mkesindo section:

```ts
// Before:
// Next.js 16 renamed Middleware to Proxy (file/behavior otherwise
// identical) — see node_modules/next/dist/docs/01-app/01-getting-started/
// 16-proxy.md. Routes a session's accountScope (see auth.ts / next-auth.d.ts)
// to its own home: "pmputra" -> /pmputra, "mkesindo" -> everything except
// /grup and /pmputra. An account with cross-PT authority — isSuperAdmin, or
// accountScope "direktur" (Perusahaan "PMP Group", which sits above every
// PT) — is exempt from all of this and may go anywhere; see canAccessAllPT
// in require-access.ts for the same rule applied at the page/layout level.
//
// Public routes (login, API, static assets, public token pages) are
// checked explicitly in the function body rather than relied on via the
// matcher regex alone — the matcher below only trims obvious static-asset
// traffic for performance; the real "is this route gated" decision lives
// here where it's easy to audit.
const PUBLIC_PREFIXES = ["/login", "/api", "/mkesindo/invoice", "/mkesindo/payment"];

export const proxy = auth((req) => {
  const path = req.nextUrl.pathname;
  if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const scope = req.auth?.user?.accountScope;
  // No session (or a session predating this field) — let existing
  // page-level guards / the login page's own redirect handle it, same as
  // before this file existed.
  if (!scope) return NextResponse.next();

  // Inlined rather than imported from require-access.ts's canAccessAllPT()
  // to keep this file's own dependency graph self-contained (it runs in
  // the Edge runtime, unlike that module's other exports which use
  // next/navigation's redirect()) — keep the two definitions in sync.
  const isSuperAdmin = req.auth?.user?.isSuperAdmin ?? false;
  const hasGroupAccess = isSuperAdmin || scope === "direktur";
  if (hasGroupAccess) {
    return NextResponse.next();
  }

  if (scope === "pmputra" && !path.startsWith("/pmputra")) {
    return NextResponse.redirect(new URL("/pmputra", req.nextUrl));
  }
  if (scope === "mkesindo") {
    if (path.startsWith("/pmputra")) {
      return NextResponse.redirect(new URL("/", req.nextUrl));
    }
    // /grup (PMP Group — holding-level ringkasan + Akun/Perusahaan
    // administration, see require-access.ts's requireGrupAccess) is a
    // bridge only an account with cross-PT authority may cross — already
    // handled by the hasGroupAccess check above, so any mkesindo-scoped
    // account still reaching this line is not one.
    if (path.startsWith("/grup")) {
      return NextResponse.redirect(new URL("/", req.nextUrl));
    }
  }

  return NextResponse.next();
});

// After:
// Next.js 16 renamed Middleware to Proxy (file/behavior otherwise
// identical) — see node_modules/next/dist/docs/01-app/01-getting-started/
// 16-proxy.md. Routes a session's accountScope (see auth.ts / next-auth.d.ts)
// to its own home: "pmputra" -> /pmputra, "mkesindo" -> /mkesindo. An
// account with cross-PT authority — isSuperAdmin, or accountScope
// "direktur" (Perusahaan "PMP Group", which sits above every PT) — is
// exempt from the per-PT confinement below and may go anywhere; it still
// gets bounced off bare "/" to /mkesindo, since nothing is served there
// anymore (MKEsindo's dashboard moved to /mkesindo). See canAccessAllPT
// in require-access.ts for the same rule applied at the page/layout level.
//
// Public routes (login, API, static assets, public token pages) are
// checked explicitly in the function body rather than relied on via the
// matcher regex alone — the matcher below only trims obvious static-asset
// traffic for performance; the real "is this route gated" decision lives
// here where it's easy to audit.
const PUBLIC_PREFIXES = ["/login", "/api", "/mkesindo/invoice", "/mkesindo/payment"];

export const proxy = auth((req) => {
  const path = req.nextUrl.pathname;
  if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const scope = req.auth?.user?.accountScope;
  // No session (or a session predating this field) — let existing
  // page-level guards / the login page's own redirect handle it, same as
  // before this file existed.
  if (!scope) return NextResponse.next();

  // Inlined rather than imported from require-access.ts's canAccessAllPT()
  // to keep this file's own dependency graph self-contained (it runs in
  // the Edge runtime, unlike that module's other exports which use
  // next/navigation's redirect()) — keep the two definitions in sync.
  const isSuperAdmin = req.auth?.user?.isSuperAdmin ?? false;
  const hasGroupAccess = isSuperAdmin || scope === "direktur";
  if (hasGroupAccess) {
    if (path === "/") {
      return NextResponse.redirect(new URL("/mkesindo", req.nextUrl));
    }
    return NextResponse.next();
  }

  if (scope === "pmputra" && !path.startsWith("/pmputra")) {
    return NextResponse.redirect(new URL("/pmputra", req.nextUrl));
  }
  if (scope === "mkesindo" && !path.startsWith("/mkesindo")) {
    return NextResponse.redirect(new URL("/mkesindo", req.nextUrl));
  }

  return NextResponse.next();
});
```

The `config`/`matcher` export below this block is unchanged.

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
npm run lint
```

Start the dev server and, for each of the 4 account kinds, hit `/` directly (typed URL, not a client-side `router.push`, so the real server redirect is exercised — see this project's own prior debugging notes on why that distinction matters):
- mkesindo-scoped account → redirected to `/mkesindo`.
- pmputra-scoped account → redirected to `/pmputra`.
- direktur-scoped account → redirected to `/mkesindo`.
- superadmin account → redirected to `/mkesindo`.

Also confirm a superadmin/direktur account can still freely navigate to `/grup`, `/pmputra`, and `/mkesindo/*` without being bounced (the `hasGroupAccess` early return still allows every path except bare `/`).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Update proxy.ts: mkesindo scope confined to /mkesindo, cross-PT accounts default / to /mkesindo"
```

---

### Task 7: Add `next.config.ts` redirects for every old path

**Files:**
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: every `/mkesindo/*` destination from Tasks 1-3.
- Produces: a safety net for old bookmarks/links — no later task depends on this, it's purely a user-facing convenience layer, verified in Task 8.

- [ ] **Step 1: Add the `redirects()` function**

In `next.config.ts`:

```ts
// Before:
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["mssql"],
};

export default nextConfig;

// After:
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["mssql"],
  // Safety net for old MKEsindo bookmarks/links after the /mkesindo route
  // restructuring (docs/superpowers/specs/2026-08-08-restrukturisasi-rute-
  // mkesindo-design.md) — every internal reference was already updated
  // directly, this only catches traffic from outside the app. Bare "/" is
  // deliberately NOT listed here: it needs accountScope-aware dispatch
  // (pmputra -> /pmputra, mkesindo/direktur/superadmin -> /mkesindo), which
  // only proxy.ts can do — a static redirect here would fire before proxy.ts
  // ever runs (redirects() executes before Proxy in the Next.js request
  // pipeline) and send every account, including pmputra ones, to /mkesindo
  // first.
  async redirects() {
    return [
      { source: "/pnl/:path*", destination: "/mkesindo/pnl/:path*", permanent: false },
      { source: "/aging/:path*", destination: "/mkesindo/aging/:path*", permanent: false },
      { source: "/sales/:path*", destination: "/mkesindo/sales/:path*", permanent: false },
      { source: "/transaksi/:path*", destination: "/mkesindo/transaksi/:path*", permanent: false },
      { source: "/electricity/:path*", destination: "/mkesindo/electricity/:path*", permanent: false },
      { source: "/delivery/:path*", destination: "/mkesindo/delivery/:path*", permanent: false },
      { source: "/pemesanan/:path*", destination: "/mkesindo/pemesanan/:path*", permanent: false },
      { source: "/mitra/:path*", destination: "/mkesindo/mitra/:path*", permanent: false },
      { source: "/pemasaran/:path*", destination: "/mkesindo/pemasaran/:path*", permanent: false },
      { source: "/driver-app/:path*", destination: "/mkesindo/driver-app/:path*", permanent: false },
      { source: "/satpam-app/:path*", destination: "/mkesindo/satpam-app/:path*", permanent: false },
      { source: "/invoice/:path*", destination: "/mkesindo/invoice/:path*", permanent: false },
      { source: "/payment/:path*", destination: "/mkesindo/payment/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
```

`permanent: false` (307) is deliberate, not an oversight — a 308/301 gets cached by browsers, which would make a future rollback painful; `false` keeps this reversible for the life of the migration.

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
npm run lint
npm run build
```

The build must succeed (an invalid `redirects()` entry fails the build, not just lint). Start the dev server (a full `next dev` restart is required for `next.config.ts` changes — HMR does not pick these up) and, for each old path in the table above, type the old URL directly into the browser (e.g. `/pnl`, `/driver-app/peta`, `/invoice/<token>`) and confirm it 307-redirects to the corresponding `/mkesindo/...` URL. Confirm bare `/` is untouched by this table and still goes through `proxy.ts`'s dispatch from Task 6.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Add next.config.ts redirects for pre-restructuring MKEsindo URLs"
```

---

### Task 8: Full verification pass across every role

**Files:** none (verification only).

**Interfaces:** none — this task consumes the completed state of Tasks 1-7 and produces nothing further.

- [ ] **Step 1: Static checks**

```bash
npx tsc --noEmit
npm run lint
npm run build
```

All three must be clean.

- [ ] **Step 2: Repo-wide sanity grep**

```bash
grep -rn '"/pnl"\|"/aging"\|"/sales"\|"/transaksi"\|"/electricity"\|"/delivery"\|"/pemesanan"\|"/mitra"\|"/pemasaran"\|"/driver-app\|"/satpam-app\|`/invoice/\|`/payment/\|"/api/pabrik-location\|"/api/print\|"/api/routing\|"/api/notifications/stream\|"/api/upload/' src --include="*.ts" --include="*.tsx"
```

Must return zero results. Any hit is a missed reference that needs fixing before this task can close.

- [ ] **Step 3: Live verification per role**

Start the dev server and, for each account kind below, confirm both the destination and that nothing regressed:

- **mkesindo-scoped account:** login lands on `/mkesindo`; every sidebar nav item (`/mkesindo/pnl`, `.../aging`, `.../sales`, `.../transaksi`, `.../electricity`, `.../delivery`, `.../pemesanan`, `.../mitra`, `.../pemasaran`) loads its module; typing any old path (e.g. `/pnl`) redirects to the new one; typing `/pmputra` or `/grup` redirects back to `/mkesindo`; the PT Switcher is hidden (this scope has no cross-PT authority).
- **pmputra-scoped account:** login lands on `/pmputra`, unaffected by this entire migration; typing `/mkesindo` or `/mkesindo/pnl` redirects back to `/pmputra`.
- **direktur-scoped account (PMP Group):** login lands on `/mkesindo` (its new bootstrap default); PT Switcher visible and successfully switches to `/pmputra` and `/grup`; can navigate to any `/mkesindo/...` module directly.
- **superadmin account:** same as direktur, plus confirm `/grup/akun` and `/grup/perusahaan` administration pages are still reachable.
- **driver-scoped account:** login lands on `/mkesindo/driver-app`; complete one full delivery-flow screen transition (Tugas → Pengiriman → Konfir Kirim, using the camera-upload step) to confirm the `/api/mkesindo/upload/driver-app` endpoint still accepts uploads.
- **satpam-scoped account:** login lands on `/mkesindo/satpam-app`; run one vehicle-check inspection through to submission to confirm `/api/mkesindo/upload/satpam-check` still accepts uploads.

- [ ] **Step 4: Public/no-session paths**

In an incognito window (no session cookie): confirm a real invoice token URL at `/mkesindo/invoice/<token>` loads without redirecting to `/login`, and that its "Lunas" state auto-redirects to `/mkesindo/payment/<token>`, also without requiring login.

- [ ] **Step 5: Final commit**

If Steps 1-4 surfaced any fixes, commit them now with a message describing what the verification pass caught. If nothing needed fixing, no commit is needed for this task — Tasks 1-7's commits already cover the change in full.
