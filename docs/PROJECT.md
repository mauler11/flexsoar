# FlexSoar — groundwork

Tokenized physical goods. A consigned shoe becomes a tradeable card with a
human-graded condition float; cards trade on-platform and burn back into
physical delivery.

## Setup

1. Create a Supabase project (free tier).
2. SQL editor → run `001_schema.sql`, then `002_operations.sql`.
3. `npx create-next-app@latest flexsoar --typescript --tailwind --app`
4. Storage: Cloudflare R2 for intake photos (10GB free). Supabase's 1GB
   will not survive ~8 photos per item.
5. Deploy to Netlify. Vercel's Hobby tier prohibits commercial use.

## Non-negotiable invariants

These are enforced in the database, not in application code. Do not add a
second write path that bypasses them.

- **Item ≠ Card.** One physical shoe, one claim, strictly 1:1.
- **Ledger is append-only.** `ledger_entries` blocks UPDATE and DELETE via
  trigger. `cards.owner_id` is a cache written in the same transaction.
- **Currency entries net to zero** per `txn_id`, enforced by a deferred
  constraint trigger.
- **No user balances.** Money moves buyer → seller directly. The ledger
  records settlement; it never holds funds. This is what keeps FlexSoar out
  of e-money / money transmitter territory.
- **Float is human-graded.** Assigned at intake by a person looking at the
  shoe, copied to the card at mint, immutable thereafter. Never generated.
- **Tier is value, float is condition.** Tier comes from the SKU's base
  oracle price. A pristine float on a cheap shoe is a mint-condition
  Common, not a Legendary.
- **Exceptional is a flag, not a tier.** Red border overrides the tier
  colour; `tier` still drives value bands and trade-up eligibility.
- **XP is non-transferable and never redeemable.**

## Build order

**Phase 1 — supply.** Nothing works without inventory.

1. Auth (Supabase) + user profile
2. Consignment intake form → `fn_advance_consignment`
3. Admin grading queue: photos, float assignment, authentication
4. `fn_mint_card`
5. Seller dashboard: consignment status, minted cards

**Phase 2 — market.**

6. Browse + search, filter by SKU / tier / float range
7. Card detail page: float bar, percentile badge, provenance chain
8. `fn_list_card` / `fn_cancel_listing`
9. Stripe Connect settlement → `fn_purchase_card` on webhook confirm
10. `fn_redeem_card` + fulfilment queue

**Phase 3 — progression.**

11. `fn_refresh_levels` on a nightly cron
12. Fee tiers applied at purchase (already wired in `fn_purchase_card`)
13. Early-access windows (already wired via `public_at` + RLS)
14. Watchlists + float alerts
15. Share-image generation on mint and rank-up

**Phase 4 — after PMF signal.** Auctions, deterministic trade-ups, float
registry pages, subscription tier.

## Deliberately not built

- **On-chain anything.** Off-chain records keep your full take rate instead
  of leaking to a 5% royalty on someone else's marketplace, and avoid gas,
  wallet onboarding, and an extra regulatory surface. Migrate when external
  liquidity is worth more than the fees.
- **FSC balances.** FSC is a display unit (1 FSC = 1 USD). Holding balances
  makes you an e-money issuer under BNM.
- **Randomized crates, luck boosters, randomized trade-ups, staked duels.**
  All four are consideration + chance + prize. Under the Common Gaming
  Houses Act 1953, *keeping* the venue is itself the offence — being
  peer-to-peer does not help.
- **Mobile app.** Ship the web app first.

## Budget

| Item | Cost |
|---|---|
| `.xyz` domain, first year | ~RM10 |
| Buffer | ~RM90 |
| Supabase / Netlify / Cloudflare R2 / Resend | free tier |

Consignment means you never buy inventory, which is why no cash liquidity
line is needed.

## Before launch

- Custody terms: who bears loss on a vaulted item.
- Dispute process: consigned shoe doesn't match its assigned float.
- A Malaysian gaming/fintech lawyer reviewing the marketplace structure and
  the float-grading disclosure.