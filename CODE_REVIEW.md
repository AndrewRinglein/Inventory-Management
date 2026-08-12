# Code review — Bingo Halls Inventory

Reviewed 12 August 2026. Scope: all of `src/`, `supabase/migrations/`,
`supabase/functions/`, `scripts/`, and the test suite — roughly 9,000 lines
excluding the catalog data file.

Every finding marked **CONFIRMED** I reproduced myself, either against the live
database, by executing the code, or by mutation-testing. Findings marked
**PLAUSIBLE** are code-reading results I did not independently reproduce; each
says what would confirm it.

**The whole test suite passes — 86 logic tests, all screens rendering, the
inner-component guard.** Not one of the defects below is caught by it. That is
itself the most important structural finding.

---

## The short version

Two problems are urgent and unrelated to each other. First, **three database
views are readable by anyone on the internet with no login** — the entire year of
play history, every stock adjustment with its notes, every delivery. Second, **the
"amount to pay" email overcharges the halls**, because it taxes the packing
service and ignores tax exemption; that figure is written directly into
`payments.amount`.

Everything else is ordinary software debt: races on hall switching, a handful of
double-submit buttons, two dead UI paths, and a migration history that can no
longer rebuild the database.

---

## 1 · CRITICAL — the three views leak the business to anonymous callers

`supabase/migrations/039_game_usage_view.sql:8`,
`040_stock_adjustments.sql:53`, `041_stock_arrivals_view.sql:15`

**CONFIRMED against the live database.** None of the three views is created
`with (security_invoker = true)`. In Postgres 15 a view runs with its *owner's*
privileges by default, so RLS on the underlying tables does not apply to anyone
querying the view.

I sent requests carrying only the publishable key — the one committed in the repo
and shipped inside the public GitHub Pages bundle — and **no Authorization header
at all**:

| Endpoint | Result |
|---|---|
| `GET /rest/v1/game_usage` | **HTTP 200 — 9,202 rows available** |
| `GET /rest/v1/adjustment_history` | **HTTP 200 — reasons, notes, dollar values** |
| `GET /rest/v1/stock_arrivals` | **HTTP 200 — vendors, PO numbers, invoice numbers** |
| `GET /rest/v1/boxes` *(control)* | `[]` — RLS correctly denies |
| `GET /rest/v1/products`, `settings`, `events`, `sessions` *(controls)* | `[]` — correctly denied |

The base tables are protected exactly as designed. The views walk straight past
that protection. A returned adjustment row included the free-text note *"Wanted
different than order"*, the actor, the hall and the value — so this is not
abstract metadata, it is the operating record.

The fix is one line per view:

```sql
alter view game_usage        set (security_invoker = true);
alter view adjustment_history set (security_invoker = true);
alter view stock_arrivals    set (security_invoker = true);
```

Apply that and re-run the three anonymous requests; they should come back `[]`.
Do this before anything else in this document.

---

## 2 · CRITICAL — the email sender is an open relay on the halls' own domain

`supabase/functions/send-email/index.ts:13,16`

**CONFIRMED against the live deployment.** Supabase's `verify_jwt` is satisfied by
the *publishable* key — it does not require a signed-in user. I posted with only
that key and an empty array:

```
POST /functions/v1/send-email
{"emails":[],"settings":{"testMode":true},"hall_id":"sc"}
→ HTTP 200 {"logs":[]}
```

That is the full handler path, reached and returned successfully, by a caller who
never logged in. A real `emails` array would have been delivered. (I deliberately
sent an empty one.)

The design defect that makes this serious is line 16: `settings` is destructured
from the **request body** rather than read from the `settings` table the way
`weekly-export/index.ts:31` correctly does. So `testMode`, `fromAddress`,
`testAddress` and `ccAddress` are all attacker-controlled, and nothing can be
enforced server-side. Mail leaves through the charity's verified Resend domain, so
SPF and DKIM pass and it arrives looking exactly like a genuine purchase order.
There is no rate limit and no cap on the array length.

`read-invoice/index.ts:19` has the same authorization posture and takes a
storage `path` straight from the body into a service-role download — an
unauthenticated read of any scanned invoice. It currently fails closed only by
accident: the probe returned `ANTHROPIC_API_KEY not set`, so the function is
non-functional rather than secured. `weekly-export` accepts the same key-only
auth; I did not fire it, because a successful call mails the full CSV export to
the accountant.

Fixes, in order: read settings from the table, never the body; verify the JWT
carries a real user (`sub` claim), not just a valid key; cap the array length; add
a per-caller rate limit.

---

## 3 · HIGH — the "amount to pay" email overcharges, and that number becomes the payment

`src/lib/logic/emails.js:429,453,454` → `src/components/Receiving.jsx:329`

**CONFIRMED by execution.** `buildDeliveredEmail` computes:

```js
const lineTotal = (l) => l.qty * ((Number(l.cost)||0) + (Number(l.packing_each)||0));
const received  = round2(receivedLines.reduce((a,l) => a + lineTotal(l), 0));
const tax       = round2(received * (Number(vendor.tax_rate)||0));
```

Two errors sit in those three lines. The tax base **includes packing**, and there
is **no `taxable !== false` check**. `poTotals` in `po.js:51-71` gets both right —
so the app disagrees with itself about the same order, and prints a "Difference"
line flagging its own discrepancy as worth a look.

I ran both cases:

| Case | App says pay | Correct | Error |
|---|---|---|---|
| BV case, $51,680 goods + $1,600 packing | **$58,474.80** | $58,318.80 | **+$156.00** |
| Marathon daubers, 10 × $98.70, exempt | **$1,083.23** | $987.00 | **+$96.23** |

`buildDeliveredEmail` returns `amount: owed`, and `Receiving.jsx:329` writes
`amount: delivered.amount` straight into `payments.amount`. The wrong figure is
what accounting is told to pay and what the ledger records.

**A third error compounds it on split lines.** `Receiving.jsx:299` pushes
`{ ...l, qty: got, cost: perBox }` — `got` is a count of *boxes* and `cost` is
divided down to per-box, but `packing_each` is spread through **undivided**, still
priced per *ordered unit*. One Biker case received as 16 totes:

```
lineTotal = 16 × (323 + 160) = $7,728      should be 5,168 + 160 = $5,328
with the tax bug on top:      $8,481.48    should be              $5,831.88
```

**$2,649.60 overstated on a single case.** `buildShortageEmail:433` overstates
"Missing value" the same way, and the rows print "$483.00 ea" for a tote worth
$323.

Given these three have been live, it is worth reconciling `payments` against the
vendor invoices before the next payment run.

---

## 4 · HIGH — four event writes are rejected by RLS *after* the mutation has committed

`src/lib/store/supabaseStore.js:174,200,544`, `src/components/AskDistributor.jsx:85`

**CONFIRMED by inspection against the live policy.** Migration 034 whitelists
exactly `eom, adjust, session.apply, session.undo, po.record, po.reprice,
po.archive, delivery.add, email.send, count`. The code emits four kinds that are
not on it:

| Call site | Kind emitted | On whitelist? |
|---|---|---|
| `supabaseStore.js:174` (un-archive) | `po.restore` | **no** |
| `supabaseStore.js:200` (delete PO) | `po.delete` | **no** |
| `supabaseStore.js:544` (assign) | `session.assign` | **no** |
| `AskDistributor.jsx:85` | `price_request` | **no** |

Each throws `new row violates row-level security policy`, and each runs *after*
its mutation has already committed. Deleting a PO removes the boxes, payments,
lines and the PO row, then throws — so the user sees "Could not delete that
order", the list never refreshes, and clicking Delete again hits `.single()` on
zero rows. The price-request path sends the emails and then reports failure, so
the operator sends them twice.

`History.jsx:25` already renders a `po.restore` badge, so the UI was written
expecting a kind the database refuses. Either add the four kinds to the policy or
stop emitting them — but the ordering is the deeper bug: log before you commit, or
tolerate a log failure without failing the operation.

---

## 5 · HIGH — `applySession` cannot reach the opened boxes it is written to prefer

`src/lib/store/supabaseStore.js:399-409`

**CONFIRMED by inspection.** The comment above the query is explicit that boxes
opened on the floor must be consumed first, and there is a client-side re-order to
enforce it because `'in_inventory'` sorts before `'opened'` alphabetically. But
`.limit(n * 2)` is applied by Postgres **after** the `ORDER BY`, so the truncation
happens before the client ever sees the rows.

Whenever a game has `in_inventory ≥ 2n`, the pool comes back containing zero
opened boxes and the re-order has nothing to reorder. Untouched shelf stock is
consumed instead, and the genuinely-opened boxes keep `session_id = null`
**permanently** — the same truncation recurs on every future session, so they are
never picked up. Inventory on hand stays inflated by exactly those boxes.

`demoStore.js:322` filters the whole array with no limit and gets it right, so
demo and production give different answers for the same session sheet. Drop the
`.limit()`, or run two queries (opened first, then top up from `in_inventory`).

---

## 6 · MEDIUM — hall-switch races: a slow response for the hall you left overwrites the one you're on

`src/App.jsx:70-75` is the root case. `reloadHall` awaits four queries and calls
`setBoxes/setPos/setPayments/setOrderQtyState` unconditionally — nothing checks
that `hall` still equals `h`. Switch halls twice in quick succession on a slow
connection and the late response wins: the header reads Redwood City while the
table lists Santa Clara boxes, and opening a box from that table mutates the wrong
hall's stock and reports success.

The same missing `live` guard appears in `Receiving.jsx:46`, `Receiving.jsx:133`
(where it also cross-wires PO lines — PO-A's quantities pre-filled under PO-B's
header, then confirmed against PO-B), `Orders.jsx:38`, `Dashboard.jsx:23` and
`Assign.jsx:42`. `History.jsx:63-74` is the one loader that already does it
correctly and is the pattern to copy.

**Related, `src/App.jsx:196-215` — CONFIRMED.** The scan handler's effect has deps
`[session]` with an eslint-disable, and `reloadHall` is
`useCallback(..., [hall])`. The effect carefully reads `hall` from `scanCtxRef`
for its own logic but then calls bare `reloadHall()`, which is permanently bound
to the hall you were in at first render. Every scan therefore reloads the wrong
hall's data once you have switched. Fix:
`const { hall } = scanCtxRef.current; await reloadHall(hall);`

---

## 7 · MEDIUM — double-submit on operations that cost money or stock

Four mutations fire without an in-flight guard or a disabled button:

- `Receiving.jsx:343` — "Send N email(s)": double-click sends the shortage email
  to the distributor and the pay notice to accounting **twice**.
- `Inventory.jsx:95` — "Open": double-click takes **two** boxes off the shelf; the
  Undo closure captures only the second box id, so Undo restores one and the other
  stays open with no record.
- `Games.jsx:60` — "+ Add game": creates two catalog rows with different ids, both
  of which then appear in every vendor email.
- `Orders.jsx:54` / `Accounting.jsx:11` — idempotent server-side, so the damage is
  limited to duplicate events in History.

`Review.commit`, `Orders.doResend` and `AskDistributor.send` all guard with `busy`
correctly — the pattern exists, it just was not applied to these.

---

## 8 · MEDIUM — two dead UI paths

**CONFIRMED both.** `Dashboard.jsx:80` navigates with `setScreen('receiving')`,
but the registry in `App.jsx:237` keys that screen as `intake`, and
`SCREENS[screen] || Dashboard` falls back silently. Every "Recently received" row
renders with `cursor: pointer` and does nothing when clicked. `Sidebar.jsx:43` and
`Orders.jsx:238` both use `'intake'` correctly.

`Purchase.jsx` imports `UpdateGame` (line 8) and sets `updPid` from three separate
buttons (lines 73, 199, 214), but **never renders the modal** — `grep` finds no
`<UpdateGame` in the file. The gold "update" chip and the `?` in the Base $ column
promise "Click to fill this in" and are inert. `Inventory.jsx:245` and
`Games.jsx:79` both render it properly.

---

## 9 · MEDIUM — the migration history can no longer rebuild the database

`031_record_august_deliveries.sql:33` states it plainly: *"The insert itself was
run against the live database; it is left out of this file deliberately."* By that
file's own tally, a clean `supabase db reset` comes up **$104,599.08 and 600 boxes
short**. Only two of the five August deliveries exist as replayable SQL.

Three further replay hazards, all confirmed by reading:

- `037_whole_boxes.sql:19` is a bare `insert into boxes ... select 'sc','P155',432.00`
  with no conflict guard. Every re-run silently adds another $432 case. This is the
  one statement that *corrupts* on replay rather than erroring.
- `032_merge_duplicate_games.sql:24-26,35` references `C864`, which only exists in
  the `data/` folder. Skip that folder and the Hold Your Horses merge matches zero
  rows and reports success.
- `data/2026-08-07_bv_1806034.sql:12` is now unrunnable at all — it inserts
  `po_lines` for products that `032:35` deletes.

This does not affect the running system, but it means there is no tested path back
from a disaster, and no way to stand up a staging copy. Worth taking a real
`pg_dump` on a schedule regardless of what the migrations say.

---

## 10 · The test suite does not test the things that broke

`tests/logic.test.js`

**CONFIRMED by mutation testing.** I patched `sumMoney` (`po.js:24`) to round every
element before accumulating — the exact round-then-sum error the helper exists to
prevent — and re-ran:

```
# pass 86
# fail 0
```

Zero failures. Nothing in the suite pins the rounding level. Two more gaps found
the same way: `tests/logic.test.js:104` asserts only that no line has
`kind === 'fee'`, which `buildDrafts` never emits any more, so the assertion is
unconditionally true and survives even a mutation that charges every vendor
packing on every line. And `buildDeliveredEmail`'s fixtures (line 327) carry no
`packing_each`, no `taxable: false` and no `split_boxes` — which is precisely why
finding 3 shipped.

Untested entirely: `poHtml` including its escaping, `repriceFromCatalog` and
`poFromRecord` (both of which rewrite a sent PO's stored totals), and every store
method.

---

## 11 · Live data issues, separate from the code

Two things I found in the database itself while verifying the above.

**~235 boxes currently on hand are valued at $0** because their product has
`base_cost = 0.00`. Concentrated in Redwood City: Halloween Daubers (81 boxes),
Glow Daubers in five colours (77), Cosmic (24 across both halls), Yellow Brick
Road and Pink Panther Strip (12 each). Inventory value is understated by whatever
those are worth.

**The Biker totes are inconsistent with each other.** Same physical item, two
different shapes:

| Product | `split_boxes` | Value per tote | On hand |
|---|---|---|---|
| P163 Biker (Fri/Sun/Mon) | 16 | $323.00 | 198 |
| P164 Biker (Sat/Sun AM) | 16 | $323.00 | 40 |
| R714 Biker (Tues/Thur) | 16 | $323.00 | 36 |
| **R715 Biker Double up** | **8** | **$646.00** | 14 |

This is the open Biker question showing up as divergent live data. Whichever
answer is right, all four should match.

---

## 12 · Lower severity, worth a ticket each

**PLAUSIBLE** unless noted — read from the code, not reproduced.

`demoStore.js:242` — `addAdjustment` has no rollback, where the Supabase store
explicitly implements one. A swap whose second line fails leaves phantom boxes and
an orphan header in memory, which the next unrelated `_save()` persists.

`demoStore.js:289` — `{...a, ...l}` lets the line id overwrite the adjustment id,
so History's swap detail is permanently blank in demo mode and correct in
production.

`demoStore.js:30` — `_save()` swallows `QuotaExceededError`. Invoice photos are
stored as data URLs in the same blob; past ~5 MB every write silently succeeds in
the UI and persists nothing.

`supabaseStore.js:103` — `createSentPos` is four un-transacted writes per PO. A
failure partway leaves a PO with a number and a total but no lines, or lines but
no boxes on order. Combined with the client-side read-modify-write of
`po_sequence` at `Review.jsx:54`, two clerks sending in the same minute collide on
the unique index and the second order is lost.

`Purchase.jsx:101` — every keystroke in a quantity cell writes to the server and
reloads the whole hall. Type "12" quickly and the cell can flip back to "1" under
the caret.

`Assign.jsx:58` — moving between two dates that both have no saved session does
not clear the picked games, because `current?.id` stays `undefined` on both sides.
Twelve games picked for one night can be saved and printed against another.

`weekly-export/index.ts:37` — three bare `.select()` calls with no pagination.
PostgREST caps at 1,000 rows, so with ~3,800 boxes the export accounting receives
is about a quarter of the inventory, labelled as complete. `supabaseStore.js:33`
solves this with `fetchAll`; the edge function never got it.

`send-email/index.ts:73` — the `emails` insert error is discarded, so a delivered
email can be reported as failed and the vendor gets the order twice.

`events` has **no index at all** — not on `at`, `kind`, or `(entity, entity_id)` —
while `getEvents` orders by `at desc` with a `not in` filter over 9,100 rows that
grow with every box movement. Also missing: any index on `po_lines` (including its
cascading FK), and `boxes.product_id`.

`001_schema.sql:151` — `boxes_state_guard` is `before update` only, so INSERT is
unguarded. Boxes are inserted directly as `sold_out` (`supabaseStore.js:431`) with
null `opened_at`/`sold_out_at`, dropping them out of date-ranged reports.

`sessions`, `deliveries`, `stock_adjustments` and `stock_adjustment_lines` all
declare `hall_id text not null` with **no FK to `halls`**, unlike `boxes`,
`payments` and `purchase_orders`. `payments` links to POs by `po_num text` with no
FK either.

Deploy: `.github/workflows/deploy.yml` and `scripts/deploy-pages.mjs` are two
competing publish paths and only one can be active — the other reports success and
changes nothing, which is the exact failure the guard script was written to
prevent. CI also has **no test step** despite `npm test` existing.

---

## What I checked and found clean

Worth recording so it does not get re-reviewed:

**No HTML injection in `emails.js`.** Every user-controlled value in `poHtml` —
`name_snapshot`, note and intro overrides (escaped *after* `fill`, which is the
correct order), addresses, vendor and hall names, `po.num` — goes through `esc`.
The seven unescaped interpolations are all numbers, `parseInt` output, `money()`
output or already-escaped. `esc` omits `'` but no attribute is single-quoted.

**The PO tax math is right and consistent end to end.** `poTotals` reproduces
invoice 1806034 exactly: 33,791.60 − 672.00 packing = 33,119.60 × 0.0975 =
3,229.16, total 37,020.76. Finding 3 is confined to the *delivered* email.

**`round2` is sound at money magnitudes.** Brute-forced every cent to $2,000 and
every dollar to $20,000 at 9.75% against exact decimal arithmetic — zero
mismatches. (It rounds negative halves toward zero, which only reaches the
variance line.)

**The BV strip shapes are correct in live data** — `pack_units = 8,
split_boxes = 8`, $64.60 a pack. An earlier reading of the migration chain
suggested an 8× overvaluation; I queried for it directly
(`pack_units > 1 and split_boxes = 1`) and got zero rows. Later migrations fixed
what 014 set up. Only the replay path is affected, which is finding 9.

**No inner component wraps a form field.** The eight that exist contain only
buttons, spans and `<td>`s. The Settings focus bug is genuinely fixed and the
guard is holding.

**Numerics-as-strings is handled** in the store layer and components — every money
expression goes through `Number()`, `parseInt`, `*` or `/`. The one bare `+` on a
quantity is `emails.js:433`, latent because `po_lines.qty` is `integer`.

**`applySession`'s double-apply guard is correct** in both stores, and
`addAdjustment`'s Supabase rollback is sound.

---

## Suggested order of work

1. `security_invoker` on the three views. One line each, closes the data leak.
2. Lock down `send-email` — settings from the table, real JWT check, array cap.
3. Fix the delivered-email tax base and the split-line packing, then reconcile
   `payments` against the invoices already paid.
4. Add the four missing event kinds to the RLS policy, and move `logEvent` so a
   failure cannot report a committed mutation as failed.
5. Drop the `.limit()` in `applySession`.
6. Add `live` guards to the six unguarded loaders; fix the scan closure.
7. `busy` flags on the four unguarded buttons.
8. `'receiving'` → `'intake'`; render `<UpdateGame>` in Purchase.
9. Index `events(at)`; add the missing FKs.
10. Write the tests that would have caught 3, 5 and 10 — then the rest.
