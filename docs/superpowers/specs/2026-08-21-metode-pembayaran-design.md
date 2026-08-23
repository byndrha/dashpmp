# Configurable per-company payment methods (Metode Pembayaran)

## Context

Payment recording today is a single flat, hardcoded list — `PAYMENT_CHANNELS` in
`src/lib/pelunasan-types.ts` — of 3 `ChartOfAccountID` values (Kas Kecil `014`, Kas Besar `013`,
Bank Mandiri `01000096`), consumed only by the kasir-facing `PelunasanDialog`
(`src/components/dashboard/pelunasan-dialog.tsx` → `recordPayment()` in
`src/lib/queries/pelunasan.ts`). Two other surfaces show payment UI that's effectively a stub:

- **driver-app's `PembayaranStep`** (`src/components/driver-app/steps/pembayaran-step.tsx`) only
  has a working "Tunai" button; "Dynamic QR" and "QR Statis" are disabled placeholders
  ("Segera Hadir").
- **The public invoice page** (`src/app/mkesindo/invoice/[token]/page.tsx:83-88`) shows a
  hardcoded black box with the text "QRIS segera hadir" — no real QR of any kind.

This design replaces all of that with one shared, per-company-configurable payment-method system,
because the flat COA-keyed list has a real structural problem: **QRIS and Transfer both need to
point at the same bank account** (COA `01000096`), and a scheme keyed only by COA id can't tell
them apart. It also can't express which channels should even be offered on which surface (a
public invoice visitor can't be told "Tunai", and Kas Besar should never appear on driver-app).

Goal: one Postgres table describing every payment channel a company accepts, its accounting
destination, whether a note is mandatory, and which of driver-app / kasir / the public invoice
page may offer it — consumed by one shared UI component across all three surfaces, managed from
one admin screen.

## Decisions made during brainstorming

- **Two independent axes, not one.** `metode` (`TUNAI` / `QRIS` / `TRANSFER`) is which tab a
  channel appears under in the UI. `jenis` (`manual` / `qris_static` / `qris_dinamis`) is how that
  channel actually behaves. The QRIS tab holds two `jenis` values at once — this was the original
  design mistake being corrected (a single `jenis` column doing both jobs).
- **`UNIQUE (perusahaan_id, kode)`, not `UNIQUE (perusahaan_id, coa_id)`.** The COA-based
  constraint would illegally forbid Transfer and QRIS Statis from sharing a bank account, which
  they must be able to do. `kode` is a per-company slug (e.g. `qris-statis`) and is the row's real
  identity.
- **`wajib_catatan boolean` and `konteks text[]` are real columns, not `if` branches in a
  component.** `wajib_catatan` drives a UI note field's required-ness (`RecordPaymentInput.notes`
  already exists and is finally put to real use). `konteks` (subset of `driver` / `kasir` /
  `publik`) is both which surfaces render a channel AND — for the public invoice page — what was
  previously going to be hardcoded per-surface logic.
- **Transfer gets `wajib_catatan = true`.** There is no callback proving a bank transfer landed,
  so whoever records it (driver or kasir) must type a reference note as the audit trail.
- **Kas Besar (`013`) is kasir-only, not driver.** `konteks = ['kasir']` for that row — driver-app
  never needs to touch the big cash account.
- **Confirmed seed for MKEsindo** (used as the migration's seed data):

  | kode | metode | jenis | COA | konteks | wajib_catatan |
  |---|---|---|---|---|---|
  | `tunai-kecil` | TUNAI | manual | `014` Kas Kecil | driver, kasir | false |
  | `tunai-besar` | TUNAI | manual | `013` Kas Besar | kasir | false |
  | `transfer` | TRANSFER | manual | `01000096` Bank Mandiri | driver, kasir | true |
  | `qris-statis` | QRIS | qris_static | `01000096` Bank Mandiri | driver, kasir, publik | true |
  | `qris-dinamis` | QRIS | qris_dinamis | `01000096` Bank Mandiri | driver, kasir, publik | false |

- **QRIS Statis is an uploaded image (JPEG/PNG/WEBP), never SVG.** A bank-issued static QRIS is a
  raster sticker/printout, not vector art a company would draw itself. Stored through the same
  per-company Google Drive integration already used for driver-app/satpam photos
  (`uploadFile()` in `src/lib/storage/google-drive.ts`).
- **QRIS Dinamis targets Bank Mandiri's Snap BI (Standar Nasional Open API Pembayaran)
  QRIS MPM Dynamic API.** Consistent with Mandiri already being this app's bank for COA
  `01000096`. Per-company credentials (`client_id`, `client_secret`, `merchant_id`, `partner_id`)
  are stored encrypted, same `encryptSecret`/`decryptSecret` pair `perusahaan_koneksi.ts` already
  uses for DB passwords.
- **`jenis = qris_dinamis` is invisible, not disabled, until a company's Snap BI credentials are
  fully configured.** No company has real Mandiri merchant credentials yet (confirmed standing
  gap, see `[[pelunasan-module]]` memory — still true as of this design). Rather than a
  "Segera Hadir" dead button, the option simply doesn't render on any surface for a company
  without credentials, and reappears automatically once an admin fills them in. The actual
  generate-QR / poll-status Snap BI call is specified below but **cannot be integration-tested
  until real credentials exist for at least one company** — this is a known, explicit gap, not an
  oversight.
- **Existing `metode_pembayaran` rows are soft-deactivated (`is_active = false`), never hard
  deleted.** Historical payments reference a `kode` by value (see the new bridge table below); a
  hard delete would orphan that reference.

## Data model

### Postgres: `metode_pembayaran`

```
id                serial primary key
perusahaan_id     integer not null references perusahaan(id)
kode              text not null
metode            text not null check (metode in ('TUNAI', 'QRIS', 'TRANSFER'))
jenis             text not null check (jenis in ('manual', 'qris_static', 'qris_dinamis'))
coa_id            text not null              -- ChartOfAccountID on the company's own MSSQL
konteks           text[] not null            -- subset of {'driver','kasir','publik'}
wajib_catatan     boolean not null default false
catatan           text                       -- admin's own free-text note, not the payer's
qris_statis_image_path  text                 -- Google Drive path, only meaningful when jenis='qris_static'
urutan            integer not null default 0
is_active         boolean not null default true
created_at        timestamptz not null default now()
updated_at        timestamptz not null default now()

unique (perusahaan_id, kode)
unique (perusahaan_id) where jenis = 'qris_dinamis' and is_active   -- at most one live Dynamic QRIS per PT
```

### Postgres: `metode_pembayaran_snap_bi_kredensial`

One row per company, not per `metode_pembayaran` row (a company has one Mandiri merchant
relationship, however many `qris_dinamis` rows reference it — the partial unique index above
already caps that at one anyway).

```
perusahaan_id       integer primary key references perusahaan(id)
client_id           text not null
client_secret_encrypted  text not null
merchant_id         text not null
partner_id          text not null
updated_at          timestamptz not null default now()
```

### MSSQL: `DashboardSalesPaymentMetode`

Bridges a real `SalesPayment` row back to which `metode_pembayaran.kode` was actually used —
needed because `SalesPayment.ChartOfAccountID` alone is now ambiguous (Transfer and QRIS Statis
can share a COA). Denormalized on purpose: `MetodeKode` is a plain string copy of the Postgres
row's `kode`, not a real cross-database foreign key — same convention `SalesmanID` already uses to
bridge Postgres `akun` and MSSQL `DashboardPengirimanJadwal`.

```sql
CREATE TABLE DashboardSalesPaymentMetode (
  SalesPaymentID   VARCHAR(16)  NOT NULL PRIMARY KEY,
  MetodeKode       VARCHAR(64)  NOT NULL,
  Catatan          VARCHAR(500) NULL,
  CreatedDate      DATETIME     NOT NULL DEFAULT GETDATE()
)
```

## Admin management surface

New button **"Kelola Pembayaran"** per company row on `/grup/perusahaan`
(`src/components/dashboard/perusahaan-list.tsx`), opening a new dedicated dialog
(`PaymentMethodDialog`) — kept separate from the existing `PerusahaanFormDialog` rather than
adding a fourth sub-section to an already-dense dialog (it already holds Koneksi DB + Google
Drive blocks).

The dialog holds:

1. A table of that company's `metode_pembayaran` rows (kode / metode / jenis / COA / konteks /
   wajib catatan / active), with add/edit and an active-toggle (never a hard delete).
2. `coa_id` is picked from that company's real `ChartOfAccount` table (MSSQL) via a combobox, not
   typed freely — same pattern as COA pickers elsewhere in the app.
3. Editing a `jenis = qris_static` row shows an image upload field (JPEG/PNG/WEBP, 5MB cap, same
   validation as `src/app/api/mkesindo/upload/driver-app/route.ts`), written to that company's
   Google Drive, populating `qris_statis_image_path`.
4. A separate "Kredensial Snap BI" block (one per company): `client_id` / `client_secret` /
   `merchant_id` / `partner_id`. A `jenis = qris_dinamis` row can only be set `is_active = true`
   when this block is fully filled in — enforced server-side, not just hidden in the UI.

New server actions, all gated by `requireGrupAccess()` (same gate as the existing Koneksi
actions): `listMetodePembayaranAction`, `upsertMetodePembayaranAction`,
`uploadQrisStatisImageAction`, `upsertSnapBiKredensialAction`.

## Shared component: `QrPaymentPanel`

One component, three call sites, so none of driver-app / kasir / the public page re-implement the
same tab/validation logic.

**Props:** `perusahaanId: number`, `konteks: 'driver' | 'kasir' | 'publik'`, `amount: number`,
and (for the two interactive konteks) `onSubmit: (input: { metodeKode: string; catatan: string | null }) => Promise<void>`.

**Behavior:**

- Fetches active `metode_pembayaran` rows for `perusahaanId` filtered to rows whose `konteks`
  array contains the given `konteks`.
- Renders a tab per distinct `metode` present in that filtered set (so a `konteks='publik'` call
  typically renders only the QRIS tab, since Transfer/Tunai rows don't include `publik`).
- The QRIS tab renders a `jenis` sub-choice when both `qris_static` and `qris_dinamis` rows are
  present and active for that company/konteks.
- A catatan field appears and is required whenever the selected row's `wajib_catatan` is true —
  enforced again server-side inside the action `onSubmit` ultimately calls, never trusted from the
  client alone.
- For `konteks = 'publik'`: no `onSubmit`, no form — read-only display of the QRIS Statis image
  and/or a Dynamic QR (once Snap BI is live for that company). The public page never records a
  payment itself; that still happens via kasir/driver as it does today.

## Payment recording flow

`recordPayment()` (kasir) and `recordDriverPaymentAction`/its underlying query (driver) both
change shape the same way:

- Input gains `metodePembayaranKode: string` (replacing the old hardcoded
  `chartOfAccountId: PaymentChannelId` union) and keeps `notes: string | null`.
- The function resolves that `kode` → its `metode_pembayaran` row (Postgres) for the caller's
  `perusahaanId`, reads `coa_id` from it, and rejects if the row is missing, inactive, or
  `wajib_catatan` is true but `notes` is empty.
- The existing `SalesPayment`/`SalesPaymentDetail` INSERTs (MSSQL) are unchanged in shape, just
  fed `ChartOfAccountID` from the resolved row instead of the old union type.
- One more INSERT, in the same transaction, into `DashboardSalesPaymentMetode`
  (`SalesPaymentID`, `MetodeKode`, `Catatan`).

`PAYMENT_CHANNELS` and `PaymentChannelId` in `pelunasan-types.ts` are deleted once every call site
is migrated — nothing hardcoded should remain.

## Driver-app: `PembayaranStep`

Replaces the current two-disabled-buttons-plus-Tunai layout with
`<QrPaymentPanel perusahaanId={...} konteks="driver" amount={outstanding} onSubmit={...} />`.

- **Tunai / Transfer**: `onSubmit` calls the updated `recordDriverPaymentAction` directly —
  Transfer's mandatory catatan is the bank reference number the driver reads off the payer's
  transfer confirmation.
- **QRIS Statis**: shows the company's uploaded QRIS image; the driver has the payer scan it,
  then taps a confirm action that calls the same `onSubmit` path (also mandatory catatan, for the
  same no-callback reason as Transfer).
- **QRIS Dinamis**: only rendered once a company's Snap BI credentials exist. Generates a QR sized
  to the exact outstanding amount, polls Snap BI for payment confirmation, then calls the same
  recording path once confirmed. This path has no company to test against yet — implemented per
  this spec, not verified end-to-end, and invisible in production until credentials exist.
- The existing "Tanpa Pembayaran" skip (in `stop-flow.tsx`, bypassing `PembayaranStep` entirely)
  is untouched — it's a separate branch that never reaches this component.

## Kasir: `PelunasanDialog`

Swaps its current flat `PAYMENT_CHANNELS` radio/dropdown for
`<QrPaymentPanel perusahaanId={...} konteks="kasir" amount={...} onSubmit={...} />`, wired to the
updated `recordPayment()`. Kasir additionally sees Kas Besar (`tunai-besar`) and can select
QRIS Statis/Dinamis or Transfer exactly like driver-app does.

## Public invoice page

The hardcoded "QRIS segera hadir" box at `src/app/mkesindo/invoice/[token]/page.tsx:83-88` is
replaced with `<QrPaymentPanel perusahaanId={...} konteks="publik" amount={invoice.Netto} />`
(no `onSubmit`) — read-only QRIS display only, per the `konteks` rules above (Tunai/Transfer never
render here since their rows don't include `publik`). `invoice.IsPaid` continues to be flipped by
the existing kasir/driver recording flow; a Snap BI payment-notification webhook that could flip
it automatically is a natural follow-up once QRIS Dinamis is actually live for a company, but is
explicitly out of scope here (there is nothing to receive a webhook FOR yet).

## Global constraints

- `wajib_catatan` is validated server-side in the payment-recording function itself, never left to
  the UI alone.
- `metode_pembayaran` rows are soft-deactivated (`is_active = false`) only — never hard-deleted,
  since `DashboardSalesPaymentMetode.MetodeKode` references a `kode` by value.
- `jenis = qris_dinamis` cannot be `is_active = true` without a complete
  `metode_pembayaran_snap_bi_kredensial` row for that company — enforced in the upsert action.
- `UNIQUE (perusahaan_id, kode)` plus the partial `qris_dinamis` uniqueness index are real DB
  constraints, not just application-level checks.

## Known risk / explicit gap

The Snap BI QRIS Dynamic integration (generate-QR + poll/webhook confirmation) is specified
end-to-end but genuinely unverifiable until a company has real Bank Mandiri merchant credentials —
this has been a standing gap since the original Pelunasan module (see `[[pelunasan-module]]`
memory) and is not resolved by this design. This design's job is to make sure the *rest* of the
system (schema, admin config, the other four channels, all three surfaces) is fully real and
shippable without waiting on that integration, and that QRIS Dinamis slots in later without
another redesign.

## Implementation phase order

1. Postgres migration: `metode_pembayaran` + `metode_pembayaran_snap_bi_kredensial`, seeded with
   the 5 MKEsindo rows above.
2. MSSQL migration: `DashboardSalesPaymentMetode`.
3. Query layer: CRUD for `metode_pembayaran` (Postgres) + updated `recordPayment()` /
   `recordDriverPaymentAction` (MSSQL, writing the new bridge-table row in the same transaction).
4. `QrPaymentPanel` shared component.
5. Admin `PaymentMethodDialog` on `/grup/perusahaan` (image upload + Snap BI credentials form).
6. Wire driver-app `PembayaranStep`.
7. Wire kasir `PelunasanDialog`, retire `PAYMENT_CHANNELS`/`PaymentChannelId`.
8. Wire the public invoice page.
