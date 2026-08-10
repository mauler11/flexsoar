# FlexSoar — parallel agent build plan

Four tracks with **zero file overlap**. Each agent runs in its own git
worktree, so two agents never touch the same working directory.

---

## Setup (do this once, yourself)

```bash
git init flexsoar && cd flexsoar
npx create-next-app@latest . --typescript --tailwind --app --eslint --src-dir=false
git add -A && git commit -m "scaffold"

# Run PHASE 0 here on main, alone, before anything else.
# Then create the worktrees:
git worktree add ../flexsoar-data     -b track/data
git worktree add ../flexsoar-design   -b track/design
git worktree add ../flexsoar-admin    -b track/admin
git worktree add ../flexsoar-market   -b track/market
```

Each agent gets pointed at its own directory. They cannot collide.

**Realistic advice:** four concurrent agents is more review load than one
person can absorb. Run **two at a time**. Recommended pairing:

1. Data + Design (no dependency on each other)
2. Admin + Market (both consume what Data and Design produced)

Rebase each track onto `main` before starting the second pair.

---

## PHASE 0 — contract freeze (run alone, on `main`)

Nothing parallelises until this exists. Paste into Claude Code:

```
You are setting up the shared contract for FlexSoar, a marketplace where
consigned sneakers become tradeable cards with a human-graded condition
float (0.000 = factory new, 1.000 = well worn).

Read 001_schema.sql, 002_operations.sql, and README.md in the repo root
before writing anything.

Produce ONLY these files. Do not build any UI or data-fetching logic.

1. lib/db/types.ts
   TypeScript types mirroring every table and enum in 001_schema.sql.
   Hand-write them; do not depend on a live Supabase connection.

2. lib/api/contract.ts
   One exported async function per RPC in 002_operations.sql:
   mintCard, listCard, cancelListing, purchaseCard, redeemCard,
   advanceConsignment, awardXp, refreshLevels
   plus read helpers: getCard, getCards, getListings, getListing,
   getConsignment, getConsignments, getUser, getSkus.
   Every one fully typed, every body: throw new Error("NOT_IMPLEMENTED").
   Add a file header: "FROZEN CONTRACT — signatures must not change.
   Only track/data may replace the bodies."

3. lib/mock/fixtures.ts
   Deterministic fixture data satisfying the types: 3 users at different
   levels, 6 SKUs, 12 items, 12 cards spanning all 5 tiers plus one
   is_exceptional, 8 listings (2 in early access), 2 consignments.

4. lib/domain/rarity.ts
   TIER_BANDS constant (tier, name, borderColor, minCents, maxCents)
   matching the tier_bands rows in 001_schema.sql.
   tierForPrice(cents), floatBand(float) -> "FN"|"MW"|"FT"|"WW"|"BS",
   EXCEPTIONAL_COLOR = "#FF4444".

5. DEPS.md — empty file with heading "## Requested dependencies".

Commit. Do not touch package.json beyond what create-next-app produced.
```

---

## Rules that go in EVERY track prompt

```
HARD RULES — violating these breaks the parallel build:

- You own ONLY the paths listed under YOUR PATHS. Do not create, edit, or
  delete any file outside them, for any reason.
- lib/api/contract.ts is FROZEN. Never change a signature. If you need
  something it doesn't expose, append the request to HANDOFF.md and work
  around it with a local adapter.
- NEVER edit package.json. If you need a dependency, append it to DEPS.md
  as "- package@version — why". The human installs it.
- NEVER edit app/globals.css or tailwind.config.ts unless you are
  track/design.
- NEVER edit the .sql files. They are the source of truth.
- Commit to your own branch only. Do not merge, rebase, or switch branches.
- If you are blocked, write the blocker to HANDOFF.md and keep going on
  something else. Do not invent a workaround that touches another track's
  files.

DOMAIN INVARIANTS — assume these, never work around them:

- Tier is VALUE (from the SKU's base oracle price). Float is CONDITION.
  A pristine float on a cheap shoe is a mint-condition Common, never a
  Legendary. Never let float change tier.
- is_exceptional is a FLAG, not a tier. It overrides the border colour to
  red; tier still drives value bands.
- Float is human-graded at intake and immutable after mint. There is no
  RNG anywhere in this codebase. If a task seems to need randomness,
  stop and write it to HANDOFF.md.
- No user balances exist. FSC is a display unit: 1 FSC = 1 USD. Never
  build a wallet, balance, or top-up flow.
- All writes go through lib/api/contract.ts. Never write SQL in a
  component, never call supabase.from(...).insert() outside track/data.
```

---

## TRACK A — data & auth (Claude Code, `../flexsoar-data`)

```
[paste HARD RULES + DOMAIN INVARIANTS]

YOUR PATHS (exclusive):
  lib/db/**, lib/api/**, lib/supabase/**, app/(auth)/**,
  app/api/webhooks/**, middleware.ts

Read 001_schema.sql, 002_operations.sql, lib/api/contract.ts first.

BUILD:
1. lib/supabase/server.ts and lib/supabase/client.ts — SSR-safe clients
   using @supabase/ssr and cookie-based sessions.
2. Replace every NOT_IMPLEMENTED body in lib/api/contract.ts with a real
   implementation. Mutations call the Postgres functions via .rpc().
   Reads use .from() with select projections — never select *.
   Signatures must not change.
3. app/(auth): sign-in, sign-up, sign-out. Email + magic link.
   Create the users row on first sign-in.
4. middleware.ts — refresh session, gate /admin behind users.is_admin.
5. app/api/webhooks/stripe/route.ts — verify signature, and ONLY on
   payment_intent.succeeded call purchaseCard(listingId, buyerId,
   paymentIntentId). Money settles in Stripe BEFORE the card moves.
   Never call purchaseCard from client code.
6. Error mapping: Postgres raise exceptions become typed errors
   (NotOwner, WrongStatus, EarlyAccessLocked, MintCapReached) so UI
   tracks can branch on them.

DONE WHEN: every contract function works against a live Supabase project,
and a seed script mints a card, lists it, and purchases it end to end.
```

---

## TRACK B — design system & sprites (OpenCode, `../flexsoar-design`)

```
[paste HARD RULES + DOMAIN INVARIANTS]

YOUR PATHS (exclusive):
  components/ui/**, components/card/**, lib/sprites/**,
  app/styleguide/**, app/globals.css, tailwind.config.ts

Read lib/domain/rarity.ts and lib/mock/fixtures.ts first.
Import fixtures for all previews. Do NOT fetch data. Pure props only.

VISUAL DIRECTION: near-black (#0B0B0B) surfaces, monospace type, chunky
pixel-art aesthetic. Rarity is signalled by border colour AND escalating
frame ornament — colour alone must never be the only signal, so cards stay
readable in greyscale and for colour-blind users.

BUILD:
1. lib/sprites/ — a sprite renderer. Base art is a string[] pixel map with
   a char->hex palette; render to inline SVG <rect> elements at any pixel
   scale. Support palette swap so one silhouette serves many colourways.
   Ship 2 base maps: high-top and low-top. Export renderSprite(map,
   palette, px).
2. components/card/CardFrame.tsx — rarity frames, ornament escalating with
   tier: Common 1px border only; Uncommon +corner studs; Rare +top accent
   bar; Epic +inner hairline; Legendary +edge marks; Exceptional red with
   a "1 OF 1" corner ribbon.
3. components/card/FloatBar.tsx — 0.000-1.000 scale, marker at position,
   band label (FN/MW/FT/WW/BS), colour shifting green->olive->brown.
4. components/card/CardTile.tsx (grid, ~180px) and CardDetail.tsx (hero).
   Both show float, percentile badge, mint number, price in FSC with the
   ringgit conversion beneath it.
5. components/ui/ — Button, Input, Select, Badge, Modal, Table, Toast,
   EmptyState, Skeleton.
6. app/styleguide/page.tsx — renders every component in every state from
   fixtures. This is the review surface.

DONE WHEN: /styleguide shows all 5 tiers plus exceptional, all 5 float
bands, and every ui primitive, with no data fetching anywhere.
```

---

## TRACK C — admin & operations (Claude Code, `../flexsoar-admin`)

```
[paste HARD RULES + DOMAIN INVARIANTS]

YOUR PATHS (exclusive):
  app/admin/**, components/admin/**

Import from lib/api/contract.ts and components/ui/**. If a component you
need doesn't exist yet, build a minimal local one under components/admin/
and note it in HANDOFF.md — do not add to components/ui/.

BUILD:
1. app/admin/consignments — list by status, detail view, transition
   buttons wired to advanceConsignment. Buttons must be disabled for
   transitions the state machine rejects (read the CASE block in
   fn_advance_consignment; don't guess the allowed edges).
2. app/admin/grading — the queue of received items. Photo viewer,
   float input (0.000-1.000, 3 decimals), grading notes, authenticate
   toggle. Show a reference rubric alongside the input.
   The float is typed by a human. Never compute or suggest it.
3. app/admin/mint — items that are graded + authenticated but unminted.
   Batch mint via mintCard. Surface MintCapReached clearly.
4. app/admin/fulfilment — redemption requests, address, carrier and
   tracking entry, mark shipped.
5. app/admin/skus — CRUD for the catalog, oracle price and float curve
   entry, sprite_key and palette JSON.

Every destructive action needs a confirm step. Every mutation shows the
server error verbatim on failure — never swallow one.

DONE WHEN: a shoe goes intake -> received -> authenticated -> graded ->
minted -> (later) shipped, entirely through the admin UI.
```

---

## TRACK D — public marketplace (OpenCode, `../flexsoar-market`)

```
[paste HARD RULES + DOMAIN INVARIANTS]

YOUR PATHS (exclusive):
  app/(market)/**, components/market/**

Import from lib/api/contract.ts and components/card/**, components/ui/**.
Until track/design lands, import fixtures from lib/mock/fixtures.ts and
render with plain divs; swap to real components on rebase.

BUILD:
1. app/(market)/page.tsx — browse grid. Filters: brand, model, size, tier,
   float range slider, price range. Sort by price, float, recency.
2. app/(market)/card/[id] — detail page. Sprite hero, float bar with
   percentile badge, full provenance chain (owner handle + level + price
   at each hop), mint number, oracle fair value.
3. Listing flow — owner-only. Price input which ALWAYS shows the oracle
   fair value beside it, with a visible warning when the price is more
   than 15% below oracle. Both sides see this; it is deliberate, it
   protects sellers from being sniped on mistakes. Never hide it.
4. Purchase flow — Stripe Checkout redirect. Do NOT call purchaseCard
   from the client; the webhook does that. Poll the order until settled.
5. Early access — listings before public_at show a countdown and a
   level-gate state for users below early_access_level. Handle the
   EarlyAccessLocked error on attempted purchase.
6. app/(market)/u/[handle] — public profile: level, rank name, owned
   cards, trade history.
7. Redemption request — from a card you own: address form, handling fee
   shown, confirm, then redeemCard.

DONE WHEN: browse, filter, view, list, buy, and redeem all work against
the contract, and early-access gating behaves correctly at both levels.
```

---

## Merge order

`design` → `data` → `admin` → `market`

Design first because it has no imports from the others. Data second
because admin and market both depend on it. Resolve HANDOFF.md requests
yourself between merges — never let an agent do a cross-track fix.
