## Requested dependencies

Requested by track/data, and **now installed on `main`** — see the next
section. `package.json` was never edited from this branch, per AGENT_RULES.md.

- @supabase/ssr@^0.12.4 — SSR-safe Supabase clients with cookie-based
  sessions. `createServerClient` in `lib/supabase/server.ts` and
  `middleware.ts`, `createBrowserClient` in `lib/supabase/client.ts`.
- @supabase/supabase-js@^2.112.2 — the underlying client `@supabase/ssr`
  returns. Peer of the above; listed explicitly because `lib/db/errors.ts`,
  `lib/api/contract.ts` and `scripts/seed.ts` are written against its
  `PostgrestError` and query-builder shapes.
- stripe@^22.4.0 — `app/api/webhooks/stripe/route.ts` only, for
  `webhooks.constructEventAsync()` signature verification. The webhook is
  the sole caller of `purchaseCard()`; no client code imports this.

### Installed — nothing outstanding

All three are on `main` (`@supabase/ssr` 0.12.4, `@supabase/supabase-js`
2.112.2, `stripe` 22.4.0) and `lib/db/vendor-shims.d.ts` has been deleted.
`tsc --noEmit` passes against the real published types with no code changes.

`package.json` on this branch does not list them — a track agent may not edit
it — so this worktree's `node_modules` was synced with `npm i --no-save`. The
two converge when track/data merges into `main`. If you need to re-sync a fresh
worktree of this branch before that merge:

```bash
npm i --no-save @supabase/ssr@^0.12.4 @supabase/supabase-js@^2.112.2 stripe@^22.4.0
```

### Environment variables the code reads

Already in `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server-only. Read through a dynamic
  `process.env[name]` lookup so no bundler can inline it into client code.

Still needed for the Stripe webhook (see HANDOFF.md):

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
