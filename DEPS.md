## Requested dependencies

Requested by track/data. Nothing here is installed — `package.json` is
untouched, per AGENT_RULES.md. Install with:

```bash
npm i @supabase/ssr @supabase/supabase-js stripe
```

- @supabase/ssr@^0.7.0 — SSR-safe Supabase clients with cookie-based
  sessions. `createServerClient` in `lib/supabase/server.ts` and
  `middleware.ts`, `createBrowserClient` in `lib/supabase/client.ts`.
- @supabase/supabase-js@^2.58.0 — the underlying client `@supabase/ssr`
  returns. Peer of the above; listed explicitly because `lib/db/errors.ts`
  and `lib/api/contract.ts` are written against its `PostgrestError` and
  query-builder shapes.
- stripe@^18.0.0 — `app/api/webhooks/stripe/route.ts` only, for
  `webhooks.constructEventAsync()` signature verification. The webhook is
  the sole caller of `purchaseCard()`; no client code imports this.

Version ranges are the ones the code was written against — pin whatever
`npm i` resolves and re-run `npx tsc --noEmit`.

### After installing, delete the type shims

`lib/db/vendor-shims.d.ts` declares the three modules above so `tsc
--noEmit` passes before they exist. **TypeScript resolves ambient module
declarations before `node_modules`, so that file will keep shadowing the
real types after installation.** Delete it as part of the install:

```bash
rm lib/db/vendor-shims.d.ts && npx tsc --noEmit
```

Everything in `lib/supabase/**`, `lib/db/**`, and `lib/api/contract.ts` is
written against the real published APIs, so deleting the shims should not
require code changes.

### Environment variables the code reads

Already in `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server-only. Read through a dynamic
  `process.env[name]` lookup so no bundler can inline it into client code.

Still needed for the Stripe webhook (see HANDOFF.md):

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
