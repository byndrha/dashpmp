# Tab-Shell Satpam-App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/mkesindo/satpam-app` a real 3-tab navbar (Inspeksi/Patroli/Tamu), moving the existing Beranda content under "Inspeksi" and adding placeholder "Segera Hadir" stubs for Patroli/Tamu, following this codebase's established keep-alive tab-shell pattern.

**Architecture:** Extract the current Beranda content into a header-less `InspeksiPanel`, build a new `SatpamTabShell` (mirroring `DriverTabShell`/`ProduksiTabShell`'s keep-alive `visited`-Set + `hidden`-class pattern, owning the shared header), then cut over the routes: a new `(tabs)/` route group with one `page.tsx` per tab, replacing the single old `page.tsx`.

**Tech Stack:** Next.js App Router (Server Components + a `"use client"` shell), Tailwind, shadcn/ui `Tabs`, `lucide-react` icons.

**Spec:** docs/superpowers/specs/2026-09-01-satpam-tab-shell-design.md

## Global Constraints

- The bottom nav MUST be a plain flex sibling, never `fixed` — `src/components/driver-app/bottom-nav.tsx`'s own code comment documents why: a `fixed` nav paired with `flex-1` content above it lets the content silently extend full-height behind the nav, so a floating control in that content can end up overlapping and stealing clicks from the nav. Confirmed real production lesson, not theoretical.
- Tab switches inside the shell NEVER touch Next.js's router (no `router.push`) — only `window.history.replaceState` for cosmetic URL sync. Real navigation only happens when the browser/user hits a different URL directly (e.g. the full-screen Inspeksi capture route), which naturally re-runs the relevant Server Component.
- Every tab, once visited, stays mounted (`visited: Set<SatpamTabKey>`) and is hidden via a Tailwind `hidden` class toggle — never conditionally unmounted — so switching back to an already-visited tab is instant with no re-fetch and no lost local state (e.g. the BERANGKAT/DATANG sub-tab selection inside Inspeksi).
- Because a Next.js App Router `page.tsx` and a route-group `(tabs)/page.tsx` sibling would both resolve to the exact same URL (`/mkesindo/satpam-app`) and cannot coexist, the old `src/app/mkesindo/satpam-app/page.tsx` MUST be deleted in the same task/commit that creates `src/app/mkesindo/satpam-app/(tabs)/page.tsx` — never as a separate, later task.
- Every one of the 3 new `(tabs)/*/page.tsx` files fetches the SAME Inspeksi data (`getSatpamInspectionList`, `getSatpamTimeline`, `getUserById`) and passes it to `SatpamTabShell` as required (non-optional) props, regardless of which tab that page represents. This is a deliberate refinement over a gap in the spec's own wording: if only the Inspeksi-tab page fetched this data, switching to the Inspeksi tab from a page that landed on Patroli or Tamu would show empty data with no fetch-on-switch logic to fill it in (Patroli/Tamu need no such logic since they carry no data at all, but Inspeksi does). Fetching this small, cheap dataset (a short pending-inspection list + today's timeline) on every route avoids needing to build any lazy-fetch machinery for it.
- No automated test suite exists in this repo (no "test" script in package.json, no jest/vitest). Verification per task is `npx tsc --noEmit` + `npm run lint`; Task 3 additionally requires a manual browser click-through (or, if no `isSatpam` test credentials are available in this environment — an established, recurring limitation this session — a careful, documented code-review trace instead).

---

### Task 1: Extract `InspeksiPanel` from the current Beranda content

**Files:**
- Create: `src/components/satpam-app/inspeksi-panel.tsx`

**Interfaces:**
- Consumes: `SatpamInspectionCard`, `SatpamTimelineEntry` (types, already exist in `@/lib/queries/satpam-inspection`), `getVehicleChecksForJadwalAction` (already exists in `@/app/mkesindo/(dashboard)/delivery/actions`), `CheckSummary` (already exists in `@/components/vehicle-check-summary`), `VehicleCheckRow` (type, already exists in `@/lib/vehicle-check-types`), `formatTime`/`formatDate`/`formatKemasanQty` (already exist in `@/lib/format`), `VerticalTimeline`/`VerticalTimelineItem` (already exist in `@/components/ui/vertical-timeline`).
- Produces (consumed by Task 2): `InspeksiPanel({ cards: SatpamInspectionCard[]; timeline: SatpamTimelineEntry[] })` — a React component with no header of its own (the header moves to the shell), no `userName`/`profile` props.

This task does NOT touch `src/components/satpam-app/beranda-client.tsx` or any route file yet — `beranda-client.tsx` keeps working exactly as today until Task 3's cutover. This new file is unused by anything until Task 2 imports it; that's expected and fine (same pattern as sub-project #2a's Task 1).

- [ ] **Step 1: Write `src/components/satpam-app/inspeksi-panel.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { User, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatTime, formatDate, formatKemasanQty } from "@/lib/format";
import type { SatpamInspectionCard, SatpamTimelineEntry } from "@/lib/queries/satpam-inspection";
import { VerticalTimeline, VerticalTimelineItem } from "@/components/ui/vertical-timeline";
import { CheckSummary } from "@/components/vehicle-check-summary";
import { getVehicleChecksForJadwalAction } from "@/app/mkesindo/(dashboard)/delivery/actions";
import type { VehicleCheckRow } from "@/lib/vehicle-check-types";

function InspectionCard({ card }: { card: SatpamInspectionCard }) {
  const router = useRouter();
  const ready = card.status === "Terbit";
  // Kedatangan shows when the armada is estimated back at the pabrik
  // (JamAktualBerangkat + estimated travel time), not the original
  // departure schedule — falls back to jamJadwal only if the estimate
  // genuinely isn't available (see the field's own doc comment).
  const displayTime = card.tipe === "DATANG" && card.jamEstimasiKedatangan ? card.jamEstimasiKedatangan : card.jamJadwal;

  return (
    <Card className={`flex flex-row overflow-hidden p-0 ${ready ? "border-warning/40" : ""}`}>
      <div className={`w-2 shrink-0 ${ready ? "bg-warning" : "bg-border"}`} />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-display text-lg font-semibold leading-tight">
              {card.armadaNama}
              {card.vehicleNo && card.vehicleNo !== card.armadaNama ? ` — ${card.vehicleNo}` : ""}
            </p>
            <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <User className="size-4" /> {card.driverName ?? "Belum ada driver"}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="flex items-center gap-1 rounded bg-muted px-2 py-1 font-mono text-sm">
              <Clock className="size-3.5" /> {formatTime(displayTime)}
            </span>
            <span className="text-xs text-muted-foreground">{formatDate(displayTime)}</span>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between border-t pt-2">
          <span className="text-sm text-muted-foreground">
            {card.tipe === "DATANG" ? formatKemasanQty(card.qtyRetur10KG, card.qtyRetur5KG) : formatKemasanQty(card.qty10KG, card.qty5KG)}
          </span>
          {ready ? (
            <Button
              size="sm"
              className="bg-warning text-warning-foreground hover:bg-warning/90"
              onClick={() => router.push(`/mkesindo/satpam-app/inspeksi/${card.jadwalId}?tipe=${card.tipe}`)}
            >
              Inspeksi
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled>
              Proses Muat
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

// Departed/completed cards used to simply vanish from the active list with
// no way back in — this makes the "Riwayat Hari Ini" entry clickable to
// re-open a read-only view of what was actually recorded (photos +
// odometer + fuel + muatan), fetched on demand via the same
// getVehicleChecksForJadwalAction the desktop dialog already uses.
function TimelineCard({ entry }: { entry: SatpamTimelineEntry }) {
  const [open, setOpen] = useState(false);
  const [check, setCheck] = useState<VehicleCheckRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpen() {
    setOpen(true);
    if (check) return;
    setLoading(true);
    setError(null);
    getVehicleChecksForJadwalAction(entry.jadwalId)
      .then((checks) => {
        const found = checks.find((c) => c.vehicleCheckId === entry.vehicleCheckId);
        if (!found) {
          setError("Data cek kendaraan tidak ditemukan.");
          return;
        }
        setCheck(found);
      })
      .catch(() => setError("Gagal memuat data cek kendaraan."))
      .finally(() => setLoading(false));
  }

  return (
    <>
      <Card
        role="button"
        tabIndex={0}
        onClick={handleOpen}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && handleOpen()}
        className="cursor-pointer p-3 text-left transition-colors active:bg-muted/50"
      >
        <p className="text-sm font-medium">
          {entry.tipe === "BERANGKAT" ? "Cek Berangkat" : "Cek Datang"} — {entry.armadaNama}
          {entry.vehicleNo && entry.vehicleNo !== entry.armadaNama ? ` (${entry.vehicleNo})` : ""}
        </p>
        <p className="text-xs text-muted-foreground">
          {entry.driverName ?? "Tanpa driver"} &mdash; {entry.odometerKM.toLocaleString("id-ID")} KM
        </p>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {entry.tipe === "BERANGKAT" ? "Cek Berangkat" : "Cek Datang"} — {entry.armadaNama}
            </DialogTitle>
          </DialogHeader>
          {loading && <p className="text-sm text-muted-foreground">Memuat...</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {check && <CheckSummary check={check} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

// Konten tab "Inspeksi" — diekstrak dari SatpamBerandaClient lama, minus
// <header>-nya (header sekarang dimiliki SatpamTabShell, dipakai bersama
// oleh ketiga tab). Polling 30 detik dipertahankan apa adanya: router.refresh()
// tetap benar di arsitektur baru karena ini adalah re-render Server
// Component sungguhan untuk route (tabs)/*/page.tsx yang sedang dimuat,
// yang hanya memengaruhi prop data route itu sendiri.
export function InspeksiPanel({
  cards,
  timeline,
}: {
  cards: SatpamInspectionCard[];
  timeline: SatpamTimelineEntry[];
}) {
  const [tab, setTab] = useState<"BERANGKAT" | "DATANG">("BERANGKAT");
  const filtered = cards.filter((c) => c.tipe === tab);
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 30000);
    return () => clearInterval(id);
  }, [router]);

  return (
    <div className="flex flex-col bg-background">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "BERANGKAT" | "DATANG")} className="flex-1">
        <div className="px-4 pt-3">
          <TabsList className="w-full">
            <TabsTrigger value="BERANGKAT" className="flex-1">
              Keberangkatan
            </TabsTrigger>
            <TabsTrigger value="DATANG" className="flex-1">
              Kedatangan
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value={tab} className="flex flex-col gap-3 px-4 py-4">
          <p className="text-sm text-muted-foreground">Menunggu Inspeksi ({filtered.length})</p>
          {filtered.map((c) => (
            <InspectionCard key={`${c.jadwalId}-${c.tipe}`} card={c} />
          ))}
          {filtered.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">Tidak ada yang perlu diinspeksi.</p>
          )}
        </TabsContent>
      </Tabs>
      <div className="flex flex-col gap-3 border-t px-4 py-4">
        <h2 className="font-display text-base font-semibold">Riwayat Hari Ini</h2>
        {timeline.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Belum ada aktivitas hari ini.</p>
        ) : (
          <VerticalTimeline>
            {timeline.map((entry, i) => (
              <VerticalTimelineItem key={entry.vehicleCheckId} time={formatTime(entry.checkedAt)} isLast={i === timeline.length - 1}>
                <TimelineCard entry={entry} />
              </VerticalTimelineItem>
            ))}
          </VerticalTimeline>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/satpam-app/inspeksi-panel.tsx
git commit -m "feat: extract InspeksiPanel from the satpam-app Beranda content"
```

---

### Task 2: Build `SatpamTabShell`, `SatpamBottomNav`, `ComingSoonPanel`

**Files:**
- Create: `src/components/satpam-app/satpam-bottom-nav.tsx`
- Create: `src/components/satpam-app/coming-soon-panel.tsx`
- Create: `src/components/satpam-app/satpam-tab-shell.tsx`

**Interfaces:**
- Consumes: `InspeksiPanel` (from Task 1, `@/components/satpam-app/inspeksi-panel`), `AppearanceMenu` (already exists, `@/components/dashboard/appearance-menu`), `UserMenu` (already exists, `@/components/dashboard/user-menu`), `OwnProfile` (type, already exists, `@/components/dashboard/account-settings-dialog`), `SatpamInspectionCard`/`SatpamTimelineEntry` (types, already exist, `@/lib/queries/satpam-inspection`), `cn` (already exists, `@/lib/utils`).
- Produces (consumed by Task 3): `SatpamTabKey = "inspeksi" | "patroli" | "tamu"` (exported type), `SatpamTabShell({ initialTab: SatpamTabKey; userName: string; profile: OwnProfile | null; initialCards: SatpamInspectionCard[]; initialTimeline: SatpamTimelineEntry[] })` — note `initialCards`/`initialTimeline` are REQUIRED, not optional, per this plan's Global Constraints (every page fetches this data regardless of its own tab).

None of these three files are wired into any route yet — that happens in Task 3. This task is independently verifiable via `tsc`/lint only.

- [ ] **Step 1: Write `src/components/satpam-app/satpam-bottom-nav.tsx`**

```tsx
"use client";

import { ClipboardCheck, Footprints, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SatpamTabKey } from "./satpam-tab-shell";

const TABS: { key: SatpamTabKey; label: string; icon: typeof ClipboardCheck }[] = [
  { key: "inspeksi", label: "Inspeksi", icon: ClipboardCheck },
  { key: "patroli", label: "Patroli", icon: Footprints },
  { key: "tamu", label: "Tamu", icon: UserPlus },
];

// Plain buttons, not <Link> — tab switching is a client-side state change
// inside SatpamTabShell (all 3 tabs stay mounted once visited), not a
// Next.js route navigation.
//
// Not `fixed` — a normal flex sibling in SatpamTabShell's h-dvh column, so
// its height is naturally reserved from the flex-1 content area above it.
// See this plan's Global Constraints for why a `fixed` nav is unsafe here.
export function SatpamBottomNav({ activeTab, onChange }: { activeTab: SatpamTabKey; onChange: (tab: SatpamTabKey) => void }) {
  return (
    <nav className="flex border-t border-border bg-background">
      {TABS.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]",
              active ? "text-primary" : "text-muted-foreground"
            )}
          >
            <tab.icon className="size-5" />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Write `src/components/satpam-app/coming-soon-panel.tsx`**

```tsx
import { Construction } from "lucide-react";

// Placeholder generik untuk tab yang kontennya belum dibangun (Patroli,
// Tamu) — sub-proyek terpisah nanti akan mengganti pemanggil ComingSoonPanel
// dengan panel sungguhan, komponen ini sendiri tidak perlu diubah saat itu.
export function ComingSoonPanel({ title }: { title: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <Construction className="size-10 text-muted-foreground" />
      <p className="font-display text-base font-semibold">Fitur {title} segera hadir.</p>
    </div>
  );
}
```

- [ ] **Step 3: Write `src/components/satpam-app/satpam-tab-shell.tsx`**

```tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { AppearanceMenu } from "@/components/dashboard/appearance-menu";
import { UserMenu } from "@/components/dashboard/user-menu";
import type { OwnProfile } from "@/components/dashboard/account-settings-dialog";
import { InspeksiPanel } from "@/components/satpam-app/inspeksi-panel";
import { ComingSoonPanel } from "@/components/satpam-app/coming-soon-panel";
import { SatpamBottomNav } from "@/components/satpam-app/satpam-bottom-nav";
import type { SatpamInspectionCard, SatpamTimelineEntry } from "@/lib/queries/satpam-inspection";

export type SatpamTabKey = "inspeksi" | "patroli" | "tamu";

const TAB_PATHS: Record<SatpamTabKey, string> = {
  inspeksi: "/mkesindo/satpam-app",
  patroli: "/mkesindo/satpam-app/patroli",
  tamu: "/mkesindo/satpam-app/tamu",
};

// Keep-alive tab shell mirroring DriverTabShell/ProduksiTabShell -- every
// tab visited so far stays mounted (CSS `hidden` toggling, never actual
// unmount), so switching back to one already visited is instant. Tab
// switches deliberately never touch Next.js's router; the URL is kept
// cosmetically in sync via history.replaceState only.
export function SatpamTabShell({
  initialTab,
  userName,
  profile,
  initialCards,
  initialTimeline,
}: {
  initialTab: SatpamTabKey;
  userName: string;
  profile: OwnProfile | null;
  initialCards: SatpamInspectionCard[];
  initialTimeline: SatpamTimelineEntry[];
}) {
  const [activeTab, setActiveTab] = useState<SatpamTabKey>(initialTab);
  const [visited, setVisited] = useState<Set<SatpamTabKey>>(() => new Set([initialTab]));

  function handleChangeTab(tab: SatpamTabKey) {
    setActiveTab(tab);
    setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
    window.history.replaceState(null, "", TAB_PATHS[tab]);
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background px-4 py-2.5">
        <h1 className="font-display text-base font-semibold">Aplikasi Satpam</h1>
        <div className="flex items-center gap-1">
          <AppearanceMenu />
          <UserMenu name={userName} profile={profile} />
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        {visited.has("inspeksi") && (
          <div className={cn("h-full overflow-y-auto", activeTab !== "inspeksi" && "hidden")}>
            <InspeksiPanel cards={initialCards} timeline={initialTimeline} />
          </div>
        )}
        {visited.has("patroli") && (
          <div className={cn("h-full", activeTab !== "patroli" && "hidden")}>
            <ComingSoonPanel title="Patroli" />
          </div>
        )}
        {visited.has("tamu") && (
          <div className={cn("h-full", activeTab !== "tamu" && "hidden")}>
            <ComingSoonPanel title="Tamu" />
          </div>
        )}
      </div>
      <SatpamBottomNav activeTab={activeTab} onChange={handleChangeTab} />
    </div>
  );
}
```

- [ ] **Step 4: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/satpam-app/satpam-bottom-nav.tsx src/components/satpam-app/coming-soon-panel.tsx src/components/satpam-app/satpam-tab-shell.tsx
git commit -m "feat: add the satpam-app tab shell, bottom nav, and coming-soon placeholder"
```

---

### Task 3: Cut over the routes — new `(tabs)/` group, remove the old page and Beranda client

**Files:**
- Create: `src/app/mkesindo/satpam-app/(tabs)/layout.tsx`
- Create: `src/app/mkesindo/satpam-app/(tabs)/page.tsx`
- Create: `src/app/mkesindo/satpam-app/(tabs)/patroli/page.tsx`
- Create: `src/app/mkesindo/satpam-app/(tabs)/tamu/page.tsx`
- Delete: `src/app/mkesindo/satpam-app/page.tsx`
- Delete: `src/components/satpam-app/beranda-client.tsx`

**Interfaces:**
- Consumes: `requireSatpam` (already exists, `@/lib/require-access`), `getSatpamInspectionList`/`getSatpamTimeline` (already exist, `@/lib/queries/satpam-inspection`), `getBusinessDateISO` (already exists, `@/lib/business-date`), `getUserById` (already exists, `@/lib/queries/akun`), `SatpamTabShell`/`SatpamTabKey` (from Task 2, `@/components/satpam-app/satpam-tab-shell`).
- Produces: nothing further downstream in this plan — this is the final task and the point where the whole feature becomes live and reachable.

This task creates a HARD requirement described in this plan's Global Constraints: the old `src/app/mkesindo/satpam-app/page.tsx` and the new `src/app/mkesindo/satpam-app/(tabs)/page.tsx` cannot coexist (both resolve to `/mkesindo/satpam-app`) — do all the creates and both deletes in this one task/commit, never split across commits.

- [ ] **Step 1: Write `src/app/mkesindo/satpam-app/(tabs)/layout.tsx`**

```tsx
import { requireSatpam } from "@/lib/require-access";

// Shared auth gate for every tab under (tabs)/ -- each page.tsx below also
// calls requireSatpam() itself (needed for session.user.id/name regardless),
// this is defense-in-depth, same pattern as driver-app's (tabs)/layout.tsx.
export default async function SatpamTabsLayout({ children }: { children: React.ReactNode }) {
  await requireSatpam();
  return children;
}
```

- [ ] **Step 2: Write `src/app/mkesindo/satpam-app/(tabs)/page.tsx`**

```tsx
import type { Metadata } from "next";
import { requireSatpam } from "@/lib/require-access";
import { getSatpamInspectionList, getSatpamTimeline } from "@/lib/queries/satpam-inspection";
import { getBusinessDateISO } from "@/lib/business-date";
import { getUserById } from "@/lib/queries/akun";
import { SatpamTabShell } from "@/components/satpam-app/satpam-tab-shell";

export const metadata: Metadata = { title: "Inspeksi" };

export default async function SatpamInspeksiPage() {
  const session = await requireSatpam();
  const businessDateISO = getBusinessDateISO();
  const [cards, timeline, profile] = await Promise.all([
    getSatpamInspectionList(businessDateISO),
    getSatpamTimeline(businessDateISO),
    getUserById(Number(session.user.id)),
  ]);

  return (
    <SatpamTabShell
      initialTab="inspeksi"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialCards={cards}
      initialTimeline={timeline}
    />
  );
}
```

- [ ] **Step 3: Write `src/app/mkesindo/satpam-app/(tabs)/patroli/page.tsx`**

```tsx
import type { Metadata } from "next";
import { requireSatpam } from "@/lib/require-access";
import { getSatpamInspectionList, getSatpamTimeline } from "@/lib/queries/satpam-inspection";
import { getBusinessDateISO } from "@/lib/business-date";
import { getUserById } from "@/lib/queries/akun";
import { SatpamTabShell } from "@/components/satpam-app/satpam-tab-shell";

export const metadata: Metadata = { title: "Patroli" };

export default async function SatpamPatroliPage() {
  const session = await requireSatpam();
  const businessDateISO = getBusinessDateISO();
  const [cards, timeline, profile] = await Promise.all([
    getSatpamInspectionList(businessDateISO),
    getSatpamTimeline(businessDateISO),
    getUserById(Number(session.user.id)),
  ]);

  return (
    <SatpamTabShell
      initialTab="patroli"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialCards={cards}
      initialTimeline={timeline}
    />
  );
}
```

- [ ] **Step 4: Write `src/app/mkesindo/satpam-app/(tabs)/tamu/page.tsx`**

```tsx
import type { Metadata } from "next";
import { requireSatpam } from "@/lib/require-access";
import { getSatpamInspectionList, getSatpamTimeline } from "@/lib/queries/satpam-inspection";
import { getBusinessDateISO } from "@/lib/business-date";
import { getUserById } from "@/lib/queries/akun";
import { SatpamTabShell } from "@/components/satpam-app/satpam-tab-shell";

export const metadata: Metadata = { title: "Tamu" };

export default async function SatpamTamuPage() {
  const session = await requireSatpam();
  const businessDateISO = getBusinessDateISO();
  const [cards, timeline, profile] = await Promise.all([
    getSatpamInspectionList(businessDateISO),
    getSatpamTimeline(businessDateISO),
    getUserById(Number(session.user.id)),
  ]);

  return (
    <SatpamTabShell
      initialTab="tamu"
      userName={session.user.name ?? session.user.username}
      profile={profile}
      initialCards={cards}
      initialTimeline={timeline}
    />
  );
}
```

- [ ] **Step 5: Delete the old route and the old Beranda client**

```bash
rm src/app/mkesindo/satpam-app/page.tsx
rm src/components/satpam-app/beranda-client.tsx
```

- [ ] **Step 6: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean. Confirm specifically that nothing still imports `SatpamBerandaClient` or the deleted `beranda-client.tsx` path (a leftover import would show up as a `tsc` module-not-found error).

- [ ] **Step 7: Manual browser verification**

Open `/mkesindo/satpam-app` logged in as an `isSatpam` account. Confirm:
1. Header (title "Aplikasi Satpam" + appearance/user menus) and a 3-tab bottom nav (Inspeksi/Patroli/Tamu) both appear.
2. The Inspeksi tab shows the same content as the old Beranda screen did: BERANGKAT/DATANG sub-tabs, the pending-inspection card list, "Riwayat Hari Ini" below.
3. Tapping "Patroli" and "Tamu" each show the "Fitur {title} segera hadir." placeholder.
4. Switching from Inspeksi to Patroli and back to Inspeksi preserves whichever BERANGKAT/DATANG sub-tab was selected (proof the keep-alive/no-unmount behavior works).
5. The browser's address bar updates cosmetically to `/mkesindo/satpam-app/patroli` and `/mkesindo/satpam-app/tamu` when those tabs are active, without a full page reload.
6. Tapping "Inspeksi" on a ready card still opens the full-screen `LiveInspeksiClient` capture flow exactly as before (this route was never touched by this plan).

If no `isSatpam` test credentials are available in this environment, fall back to a careful, itemized code-review trace against this same 6-item checklist instead of skipping this step silently (documented, established pattern from every prior feature this session that hit this same wall).

- [ ] **Step 8: Commit**

```bash
git add "src/app/mkesindo/satpam-app/(tabs)" src/app/mkesindo/satpam-app/page.tsx src/components/satpam-app/beranda-client.tsx
git commit -m "feat: cut over satpam-app to the new Inspeksi/Patroli/Tamu tab shell"
```
