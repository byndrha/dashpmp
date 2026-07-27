# Pengaturan Situs (Favicon & Meta Tag) — Design Spec

**Status:** Approved by user 2026-07-27, proceeding to implementation plan.

## Goal

The dashboard's title (`<title>`), meta description, favicon, and Open Graph preview image are all hardcoded at build time (`src/app/layout.tsx`'s static `metadata` export, plus the static `src/app/favicon.ico`/`src/app/icon.png` files). Changing any of them today requires editing code and redeploying.

Give Superadmin a settings panel to change these without a redeploy: Title, Description, Favicon, and an Open Graph image (the picture shown when the dashboard's link is shared, e.g. to WhatsApp). This is a **global, single set of values** — not per-PT, and not connected to the separate Perusahaan registry. `og:title`/`og:description` reuse the same Title/Description values rather than having their own separate fields, keeping the form to four inputs.

## Why this shape

- **`generateMetadata()` over the static `metadata` export**: Next.js's static `export const metadata` is resolved once at build time and can't reflect a database value without a rebuild. `generateMetadata()` (an async function, fully supported in this project's Next.js version — confirmed against `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md`) runs per-request and can fetch from the database, exactly like every other server component in this app already does for its own data. A route segment cannot export both `metadata` and `generateMetadata` — this plan replaces one with the other in `src/app/layout.tsx`.
- **Removing the static `favicon.ico`/`icon.png` files, not layering on top of them**: per the same Next.js docs (`.../01-metadata/app-icons.md`), file-based icon conventions have *higher priority* than anything set via `metadata`/`generateMetadata` and will silently override it. Keeping the old static files would mean an uploaded favicon is saved to the database but never actually shown. A default fallback image is kept at `public/brand/` instead (a plain static asset, not a special Next.js file-convention name), referenced by `generateMetadata()`'s `icons` field whenever no custom favicon has been uploaded.
- **File storage on local disk under `public/uploads/site/`, not a new mechanism**: this codebase already uploads user-supplied images this exact way for `src/app/api/upload/armada-foto/route.ts` (writes to `public/uploads/armada/`, returns a public path, 5MB limit, JPG/PNG/WEBP only). The new upload endpoint mirrors that pattern instead of introducing a different storage approach (e.g. storing image bytes in the database) — consistent with the existing precedent, and every upload gets a unique timestamped filename, so there's no cache-busting problem when a new favicon replaces an old one (the URL itself changes).
- **A card on `/akun`, not a new sidebar module**: per explicit user choice — this is one simple settings form, the same weight as the existing "Lokasi Pabrik" card already on that page, not a first-class feature deserving its own sidebar entry (unlike the separate Perusahaan registry, which the user deliberately gave its own module).
- **Runs in the root layout, so it applies everywhere**: `generateMetadata()` lives in `src/app/layout.tsx`, the outermost layout — it affects every route, including `/login` and the public token pages (`/invoice/[token]`, `/payment/[token]`), not just the authenticated dashboard. This matches the intent of "mengatur dasar web" (configuring the site's basics) rather than only the logged-in experience.

## Data model

New table, `DashboardSiteSettings` — single row, same pattern as `DashboardPabrikLocation`:

```sql
CREATE TABLE DashboardSiteSettings (
  ID INT IDENTITY PRIMARY KEY,
  Title VARCHAR(128) NOT NULL,
  Description VARCHAR(512) NULL,
  FaviconPath VARCHAR(256) NULL,
  OgImagePath VARCHAR(256) NULL,
  UpdatedAt DATETIME NOT NULL DEFAULT GETDATE()
);
```

Seed row (part of the same migration, Task 0), copying today's hardcoded values so behavior is unchanged until someone edits it:
```sql
INSERT INTO DashboardSiteSettings (Title, Description, FaviconPath, OgImagePath)
VALUES ('Dashboard PMP Group', 'Dashboard operasional PT Mitra Kelola Esindo (Ponorogo)', NULL, NULL);
```
`FaviconPath`/`OgImagePath` start `NULL` — `generateMetadata()` falls back to the default static assets under `public/brand/` until a Superadmin uploads a custom one.

## Backend

### `src/lib/queries/site-settings.ts` (new)
Mirrors `src/lib/queries/pabrik-location.ts`'s exact shape (`getPabrikLocation`/`setPabrikLocation`):

```ts
export interface SiteSettings {
  title: string;
  description: string | null;
  faviconPath: string | null;
  ogImagePath: string | null;
}

const SITE_SETTINGS_FALLBACK: SiteSettings = {
  title: "Dashboard PMP Group",
  description: "Dashboard operasional PT Mitra Kelola Esindo (Ponorogo)",
  faviconPath: null,
  ogImagePath: null,
};

export async function getSiteSettings(): Promise<SiteSettings>; // TOP 1 ... ORDER BY ID, falls back to SITE_SETTINGS_FALLBACK if the seeded row is ever somehow missing
export async function setSiteSettings(input: SiteSettings): Promise<void>; // UPDATE the single existing row (defensive INSERT fallback if missing, same as setPabrikLocation)
```

### `src/app/api/upload/site-asset/route.ts` (new)
Same shape as `src/app/api/upload/armada-foto/route.ts` (`requireSuperAdmin()` instead of `requireModuleAccess("delivery")`, same 5MB/JPG-PNG-WEBP validation, writes to `public/uploads/site/` instead of `public/uploads/armada/`). Accepts a `kind` form field (`"favicon"` or `"og-image"`) purely for the response's `path` naming prefix (e.g. `favicon-<timestamp>-<rand>.png` vs `og-<timestamp>-<rand>.png`) — no behavioral difference beyond the filename, since both are plain image uploads.

### `src/app/(dashboard)/akun/actions.ts`
Add `getSiteSettingsAction`/`setSiteSettingsAction`, mirroring the existing `getPabrikLocationAction`/`setPabrikLocationAction` in the same file exactly (`requireSuperAdmin()` first, `revalidatePath("/akun")` after write — and additionally `revalidatePath("/", "layout")` so the new title/favicon/OG values take effect on every route immediately, not just after that route is next visited fresh).

### `src/app/layout.tsx`
Replace:
```tsx
export const metadata: Metadata = {
  title: "Dashboard PMP Group",
  description: "Dashboard operasional PT Mitra Kelola Esindo (Ponorogo)",
};
```
with:
```tsx
export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  return {
    title: settings.title,
    description: settings.description ?? undefined,
    icons: { icon: settings.faviconPath || "/brand/default-favicon.png" },
    openGraph: {
      title: settings.title,
      description: settings.description ?? undefined,
      images: settings.ogImagePath ? [settings.ogImagePath] : undefined,
    },
  };
}
```
Remove `src/app/favicon.ico` and `src/app/icon.png`. Copy the current `icon.png`'s contents to a new `public/brand/default-favicon.png` (a plain static asset, not a Next.js special filename) so there's a real fallback image instead of a broken icon link when no custom favicon has been uploaded yet.

## Frontend

### `src/components/dashboard/site-settings-panel.tsx` (new)
Client component, same structure as `src/components/dashboard/pabrik-location-settings.tsx` (`useState` for the form value, `useTransition` for the save action, a "Tersimpan." confirmation message):
- Title — text input.
- Description — textarea.
- Favicon — current preview image (or a "belum ada, memakai default" placeholder) + file input; uploads via `/api/upload/site-asset` (`kind=favicon`) on file selection, same async-upload-then-set-path pattern already used by `src/components/dashboard/armada-dialog.tsx`'s photo field.
- Gambar Open Graph — same upload pattern (`kind=og-image`), plus a short caption explaining what it's for ("Gambar yang muncul saat link dashboard dibagikan, mis. ke WhatsApp").
- "Simpan Pengaturan Situs" button calling `setSiteSettingsAction`.

### `src/app/(dashboard)/akun/page.tsx`
Fetch `getSiteSettings()` alongside the existing `users`/`roles`/`pabrikLocation` fetch, render `<SiteSettingsPanel initial={siteSettings} />` as a new card below `PabrikLocationSettings`.

## Error handling

- `setSiteSettingsAction` validates `Title` is non-blank server-side (thrown `Error`, surfaced inline in the panel — same pattern as every other Superadmin settings action in this file).
- The upload route reuses `armada-foto`'s existing validation (file type, 5MB size cap) verbatim — no new validation rules invented.
- If `getSiteSettings()`'s DB call fails inside `generateMetadata()` (e.g. a transient DB outage), the whole app would fail to render any page, since the root layout can't resolve — this is an accepted, unavoidable consequence of moving title/favicon into the database (the same class of risk every other DB-backed page in this app already carries, just now extended to the root layout too). Not mitigated with a fallback-on-error inside `generateMetadata()`, since silently swallowing a real DB outage there would be worse (a dashboard silently showing the wrong branding) than surfacing the same error every other page already surfaces during an outage.

## Out of scope (explicitly not building)

- Per-PT favicon/meta tags tied to the Perusahaan registry — explicitly deferred; this is one global set of values for the current dashboard only.
- Separate `og:title`/`og:description` fields distinct from Title/Description — reused directly to keep the form small.
- Twitter Card–specific fields, `apple-icon`, PWA manifest, or any other metadata field beyond title/description/favicon/OG-image — not requested.
- Image resizing/cropping/dimension validation on upload (e.g. enforcing 1200×630 for the OG image) — uploads are stored and served as-is, matching how `armada-foto` uploads are already handled today.
