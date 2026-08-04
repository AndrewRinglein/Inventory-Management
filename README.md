# Bingo Inventory & Ordering

Inventory, ordering, receiving, and box-lifecycle tracking for two bingo halls
(Santa Clara and Redwood City), run from one PC per hall.

Built July 2026 from the approved mockup. See `SETUP.md` for going live.

## What it does

- **Purchase** — order builder over the full 4-vendor catalog (348 games with ticket counts
  and $/ticket); quantities persist per hall; review generates up to 8 emails
  (4 vendor POs + 4 accounting copies), editable, sent only on "Send all".
- **Receiving** — pick the PO, photograph the delivery invoice (AI pre-fills line items),
  check in boxes with serials, confirm → reconciliation (received / missing) → shortage email
  to the vendor + delivered-$ email to accounting + payment record.
- **Inventory** — live per-game counts (in stock / opened / on order / value), sortable
  headers, game search, set-asides for sessions, one-click Open.
- **Open Boxes** — scan modes (Open / Sold out) for the barcode scanner, manual serial
  lookup, sold-out and back-to-stock actions.
- **Accounting** — payments created from actual deliveries, short-delivery flags, mark paid.
- **Add / Update Games** — catalog editing with tickets + $/ticket columns and filters;
  price edits PIN-protected.
- **Scanner** — any USB/Bluetooth keyboard-wedge scanner works; burst detection, duplicate
  protection, 10-second undo, beep + screen flash.

## Architecture

- React (Vite) single-page app — `src/`
- Supabase: Postgres (schema + seed in `supabase/migrations/`), auth, storage,
  edge functions (`send-email`, `read-invoice`, `weekly-export`)
- **Demo mode**: with no `.env`, the app runs entirely in the browser (localStorage) with the
  seeded catalog — same UI, emails logged not sent. Password: `bingo`.
- One store interface, two implementations: `src/lib/store/demoStore.js`,
  `src/lib/store/supabaseStore.js`. Screens never know which is active.
- Box lifecycle (`on_order → in_inventory → opened → sold_out`, + `missing`) enforced twice:
  in `src/lib/logic/boxes.js` and by a Postgres trigger.
- Every change to boxes, POs, products, payments is audited to the `events` table by DB trigger.

## Commands

```
npm install       # once
npm run dev       # local development
npm run build     # production build -> dist/
npm test          # 16 unit tests: PO math, numbering, state machine, scan resolver, emails
```

## Roles (v1.1)

Role comes from the URL — distribute one bookmark per person (a shared site password still
gates entry; this is deliberately lightweight, per decision):

| Link | Role | Can |
|---|---|---|
| `/?role=admin` | Super Admin | everything, incl. catalog edits + Settings |
| `/?role=sc` | Inventory Master — Santa Clara | order, receive, scan, set-aside **in SC**; RWC read-only |
| `/?role=rwc` | Inventory Master — Redwood City | same, halls reversed |
| `/?role=accountant` | Accountant | read everything, mark invoices paid; no POs, no inventory changes |

Add `&demo` to any link for **test mode** — a staged sandbox (browser-local, fake data at every
lifecycle stage: sent/partial/closed POs, boxes in all states, open + paid invoices) with a
"Reset demo data" button. The real database is never touched from a demo link.

Note: because roles live in the URL by design, enforcement is in the app layer (UI + client
checks + audit trail), not the database — anyone with the admin link has admin. This was an
explicit trade-off for simplicity; upgrading to real per-user logins later is a contained change.

## Security decisions (as agreed)

Review-then-send on all emails (no extra confirm dialogs); test mode routes everything to one
inbox until switched off. Admin PIN (default **1234 — change it**) guards Settings, prices,
vendor addresses. Hall PCs stay signed in. Weekly export email + Supabase daily backups.
