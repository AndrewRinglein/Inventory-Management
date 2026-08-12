# Bingo Halls — Ops Database & Inventory

**Integration guide for external systems.**
Project: `lkcfbgnuodqzvowschjn` · Postgres 15 on Supabase · schema `public`
Halls: `sc` = Santa Clara, `rwc` = Redwood City

---

## 1. Connecting

```
SUPABASE_URL  = https://lkcfbgnuodqzvowschjn.supabase.co
SUPABASE_KEY  = sb_publishable_t3vO3q1Y7PRH3qVp_64dfg_L4Zr1fIT
```

The publishable key is safe in a client bundle — it grants nothing on its own. Every
table has row-level security on, and every policy is scoped to the `authenticated`
role. **An unauthenticated request sees zero rows, not an error.** If your integration
returns empty arrays everywhere, you are not signed in.

Sign in with the shared service account, then use the resulting JWT for all traffic:

```js
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
await db.auth.signInWithPassword({
  email: process.env.OPS_EMAIL,
  password: process.env.OPS_PASSWORD,
});
// every db.from(...) call from here carries the authenticated JWT
```

Put the credentials in environment variables. Do not commit them.

Direct Postgres on 5432 also works if your host can reach it, but the PostgREST
endpoint above is the supported path and the one the app itself uses.

**Do not use the service-role key for read integrations.** It bypasses RLS entirely
and there is no reason a reporting system needs that.

### Edge functions

Three exist, all requiring a valid JWT: `send-email` (sends a PO or export through
Resend and writes an `emails` row), `weekly-export`, and `read-invoice`. Call them at
`{SUPABASE_URL}/functions/v1/{slug}`.

---

## 2. Read this before you write any query

These are the six things that have actually bitten people working in this database.

**Numerics arrive as strings.** PostgREST serialises Postgres `numeric` as a JSON
string to preserve precision. `"58.80" + 4` is `"58.804"`, not `62.80`. Coerce every
money and rate column with `Number()` the moment you read it. This applies to
`products.cost`, `products.base_cost`, `boxes.cost`, all of `purchase_orders`, and
`stock_adjustment_lines.each_value`.

**One box row is one countable unit.** `boxes` is not a quantity table — there is a
row per physical box, tote, or pack sitting on a shelf. To count inventory you count
rows. There is no `qty` column and adding one would break the state machine below.

**Inventory on hand means `state IN ('in_inventory','opened')`.** A box that has been
opened but is still in play is still a whole box, at full value. This is deliberate —
the halls run as charities and partial-box valuation was rejected. Never value a box
fractionally.

**Historical sessions are records, not transactions.** `sessions.historical = true`
marks the year of pre-system play imported for run-rate analysis. Those rows describe
what was played before the system held inventory. A database trigger refuses to let
them be applied to stock. Filter them out of anything that touches current inventory,
and include them in anything measuring consumption over time.

**Receiving writes to two different tables.** Receiving against a purchase order
creates a `shipments` row; recording a delivery with no PO creates a `deliveries` row.
Querying only one of them makes a hall look empty. **Use the `stock_arrivals` view**,
which unions both.

**`events` is mostly audit noise.** Of roughly 9,100 rows, about 9,070 are raw
`insert` / `update` / `delete` audit trail written by triggers; fewer than fifty are
the human-meaningful feed. Always filter:
`.not('kind','in','("insert","update","delete")')`.

---

## 3. Domain model

### Halls and vendors

`halls` is two rows, `sc` and `rwc`. The id is a plain text code and it appears as
`hall_id` on nearly every table.

`vendors` are the distributors. Five exist: `bv` (Bingo Vision), `md` (Marathon
Distributors), `pbf` (Pollard / Pacific Gaming / Bingo Fiesta), `cbs` (California
Bingo Service), and `unknown` — a placeholder for stock whose source has not been
confirmed. `tax_rate` defaults to 0.0975. `packing_fee` is the per-unit collation
charge, overridable per product.

### Products — the pricing model

A product is a game title as the hall buys it. Three columns describe how a purchase
unit breaks down, and getting them wrong is how valuations go wrong:

| Column | Means |
|---|---|
| `base_cost` | price of **one deal** |
| `pack_units` | deals per **ordered unit** (what you buy) |
| `split_boxes` | countable **inventory units** per ordered unit (what you shelve) |

From those, the value of a single shelved box is:

```
perBoxValue = base_cost * pack_units / split_boxes
```

`products.cost` is the cost of one ordered unit and is **maintained by a trigger** —
`sync_product_cost` recomputes it as `round(base_cost * pack_units, 2)` on every write
where `base_cost` is not null. Do not set `cost` directly on such a product; set
`base_cost` and let the trigger settle it.

`stock_unit` is one of `box`, `pack`, `tote`, `dozen` and is the noun the UI uses.
`type` is `flash`, `strip`, `paper`, or `supply`; changing it in the app carries a
default shape (a strip becomes 8× deals, for instance), so a type change made by raw
SQL will leave the shape stale.

`packing_rate` overrides the vendor's `packing_fee` for that product; `packing_units`
is how many units the rate applies to. Packing is a **service**, not goods.

`taxable` is false for supplies (daubers and the like), which are exempt.
`aliases` is a text array of names seen on session sheets that resolve to this
product; the importer learns them, and matching goes through it.
`vendor_sku` is the distributor's own catalogue code.
`active = false` means the product is retired — it still appears in historical usage
but should not be offered for ordering.

### Tax

**Tax falls on goods only.** Packing and collation are untaxed services. This was
verified against three vendors' own invoice tax summaries. The calculation is:

```
goods    = Σ qty × cost                            (priced lines only)
packing  = Σ qty × packing_each                    (priced lines only)
subtotal = goods + packing
tax      = (Σ qty × cost where taxable) × tax_rate
total    = subtotal + tax
```

Lines with `price_tbd = true` are excluded from all totals and counted separately —
a PO with any of them is *partial*, and its stated total is a floor, not a figure.

### Boxes and the state machine

Every box moves through states, enforced by the `boxes_state_guard` trigger. Illegal
transitions raise an exception rather than being silently ignored:

```
on_order ──────► in_inventory ──────► opened ──────► sold_out
    │                  │                 ▲               │
    │                  │                 └───────────────┘  (undo)
    │                  ▼                 │
    └────────────► missing ──────────────┘ (in_inventory / on_order — late arrival, undo)
                        opened ──► in_inventory  (undo)
```

The same trigger stamps `received_at`, `opened_at`, and `sold_out_at` when the
corresponding state is first entered, so you do not need to set them yourself.

`session_id` and `session_tag` mark the session that consumed a box. `delivery_id`,
`shipment_id`, and `po_id` are its provenance. `adjustment_id` links boxes created or
removed by a manual adjustment. `unrecorded = true` flags stock that exists on the
shelf without paperwork behind it. `price_tbd` on a box means it arrived before its
price was known.

### Purchase orders

`purchase_orders.num` is unique and comes from a counter in `settings` under the key
`po_sequence`. **If you insert a PO directly, advance that counter**, or the next PO
the app creates will collide on the unique index and fail — this has happened, and it
lost an $85,000 order.

`status` runs `draft → sent → partial → closed`. `recorded_only = true` means the PO
was created after the fact to document a delivery that arrived without one; it was
never sent to a vendor. `vendor_ref` holds the vendor's invoice number.
`archived_at` soft-deletes; archived POs stay queryable.

`po_lines.kind` is `item` or `fee`. Lines snapshot the product name at order time in
`name_snapshot`, so a later rename does not rewrite history, and snapshot the pricing
shape (`base_cost`, `pack_units`, `split_boxes`, `taxable`) for the same reason.

### Sessions and play

A `sessions` row is one bingo session: a hall, a date, and a `part` of `''`, `AM`, or
`PM` (unique together). `applied_at` is stamped when its consumption was taken out of
stock; null means it has not been applied. `historical` is described above.

`session_plays` is what was played: `category` is `on-site` or `pre-sale`, `name_raw`
is the text exactly as it appeared on the source sheet, and `product_id` is the match
— **nullable**, because not everything resolves. `match_how` and `match_score` record
how confident the match was.

`session_assignments` is the pre-sale assignment of a product to a session.

> Note on `part`: the inventory `sessions` table uses `''` for a single daily session,
> while the scheduling `sched_sessions` table uses `'single'`. They are separate
> domains and do not join.

### Adjustments

`stock_adjustments` + `stock_adjustment_lines` record a deliberate manual correction
with a reason and a note. Reasons are constrained to `swap`, `damaged`, `miscount`,
`found`, `returned`, `transfer`. A line carries `delta` (non-zero, signed) and
`each_value`. A swap is simply two lines with opposite signs — there is no constraint
forcing them to balance, because a swap is rarely one-for-one.

Read them through the `adjustment_history` view, which joins in the game name, type,
distributor, and computed `value_change`.

Note `booked_hall` (the hall the adjustment was filed under) can differ from a line's
`hall_id` — that is how a transfer between halls is represented.

### Events

An append-only feed. `kind` is the event type, `entity` / `entity_id` point at the
subject, and `detail` is jsonb — conventionally carrying `hall`, `label`, `note`, and
`reason`.

Insert is restricted by policy to this whitelist:

```
eom · adjust · session.apply · session.undo · po.record
po.reprice · po.archive · delivery.add · email.send · count
```

An insert of any other kind is rejected by RLS. There is **no DELETE policy on
`events`** — an authenticated client cannot remove a row, by design.

---

## 4. Views — query these first

Three views exist precisely so integrations do not have to re-derive the joins.

### `game_usage` — what was played, when

`session_plays` joined to `sessions`, `products`, and `vendors`. Columns:
`hall_id, session_date, month, part, weekday, historical, category, name_raw,
product_id, game, game_type, vendor_id, distributor, still_stocked, qty, serial`.

This is the run-rate view. `month` is pre-truncated for grouping. Include
`historical` rows for trend work; exclude them for anything about current stock.

### `stock_arrivals` — everything that came in

The union of `shipments` (received against a PO) and `deliveries` (recorded without
one), normalised. Columns: `id, source, hall_id, received_at, received_ts, vendor_id,
po_id, po_ref, invoice_no, note, photos, boxes`. `source` is `'shipment'` or
`'delivery'`; `boxes` is the count of boxes attributable to that arrival.

Use this for any "what was received" question. Reading `deliveries` alone is the bug
that made Redwood City's dashboard look empty.

### `adjustment_history` — corrections with their reasons

Described above.

---

## 5. Query recipes

**Current inventory by game, one hall**

```sql
select p.id, p.name, p.type, v.name as distributor,
       count(*) as boxes,
       round(count(*) * (p.base_cost * p.pack_units / p.split_boxes), 2) as value
from boxes b
join products p on p.id = b.product_id
left join vendors v on v.id = p.vendor_id
where b.hall_id = 'sc'
  and b.state in ('in_inventory','opened')
group by p.id, p.name, p.type, v.name
order by p.name;
```

Via PostgREST, `boxes` has no aggregate support — select the rows and group in your
own code, or add a view.

**Run rate: boxes per session, by month**

```sql
select hall_id, month, count(distinct session_date || part) as sessions,
       sum(qty) as boxes,
       round(sum(qty)::numeric / count(distinct session_date || part), 1) as per_session
from game_usage
where game_type = 'flash'
group by hall_id, month
order by hall_id, month;
```

For reference, the established rates are roughly 17–21 boxes per session at Redwood
City and 39–44 at Santa Clara.

**Recent arrivals**

```js
const { data } = await db.from('stock_arrivals')
  .select('*').eq('hall_id', 'rwc')
  .order('received_ts', { ascending: false }).limit(20);
```

**The human activity feed**

```js
const { data } = await db.from('events')
  .select('*')
  .not('kind', 'in', '("insert","update","delete")')
  .order('at', { ascending: false }).limit(200);
```

**Open purchase orders with money outstanding**

```sql
select po.num, po.hall_id, v.name as vendor, po.status, po.total,
       po.price_tbd_lines, po.sent_at
from purchase_orders po join vendors v on v.id = po.vendor_id
where po.status in ('sent','partial') and po.archived_at is null
order by po.sent_at;
```

Treat `total` as provisional whenever `price_tbd_lines > 0`.

---

## 6. Writing

Read-only integrations are strongly preferred. If you must write:

Move stock by **updating `boxes.state`**, never by deleting box rows. The trigger will
reject an illegal transition, which is the safety net working.

Log anything a person would want to see afterwards to `events`, using a kind from the
whitelist. If you skip this, the change is invisible in the app's History tab.

Applying a session is: mark its boxes consumed, then stamp `sessions.applied_at`. The
stamp goes **last**, and that ordering matters — an interrupted run leaves the stamp
unset, so a naive retry will double-consume. Guard by checking whether any box already
carries that `session_id` before applying.

Inserting a purchase order means advancing `settings.po_sequence` in the same
transaction.

Deleting a product is not supported — set `active = false`.

---

## 7. Scheduling domain (`sched_*`)

A separate staffing and timekeeping system shares the database. It does **not** join
to inventory beyond `hall_id`, and nothing in it affects stock.

`sched_staff` (people), `sched_sessions` (a scheduled session, with attendance, sales,
and RPA), `sched_roles` and `sched_hall_roles` / `sched_hall_role_needs` /
`sched_hall_role_times` (what roles a hall needs, by day type and part),
`sched_assignments` (person → session → role slot, with accept/decline),
`sched_time_entries` (clock in/out, meal and rest break compliance, premiums owed),
`sched_break_decisions` and `sched_break_punches` (break tracking),
`sched_commission_payouts` and `sched_session_shares` (commission split),
`sched_staff_availability` and `sched_staff_role_capability` (who can work what,
when), `sched_caller_positions`, `sched_hall_days`, `sched_rpa_defaults`.

Conventions here: `dow` is 0–6 with 0 = Sunday; `part` is `single` / `AM` / `PM`;
`day_type` is `weekday` / `weekend`; `sched_sessions.status` is `draft` / `planned` /
`deployed`.

This domain has not been worked on in the same depth as inventory — the structure
above is accurate but the business rules are not documented here.

---

## 8. Settings

`settings` is a key/value table with jsonb values. Keys: `admin_pin`, `email`,
`halls_config`, `po_email`, `po_sequence`, `scheduler`, `scheduler_manager_pin`,
`sender`. Note that PINs live here in plaintext — treat the table as sensitive and do
not expose it through any integration that does not need it.

---

## 9. Known open items

Anything reading this data should be aware these are unsettled:

Biker tote valuation is unresolved — $323 or $646 per tote depending on how the
catalogue's 80-deal unit maps to a tote, across 238 totes. The Marathon dauber line
from invoice 5812121 sits as a single $987 placeholder product rather than its three
real SKUs. A late-July Marathon delivery of roughly 44 boxes across 12 titles has not
been located, and Santa Clara's reconciliation carries about 51 boxes of unexplained
variance that points at it. Strip and Biker run rates are not recoverable from the
historical session files — those columns held ticket counts, not box counts.
