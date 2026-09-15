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
- @aws-sdk/client-s3@^3.1107.0 — the S3-compatible client for Cloudflare R2
  photo uploads (`components/admin/r2.ts`). The presigned PUT flow means the
  browser uploads bytes straight to R2; the keys never leave the server.
- @aws-sdk/s3-request-presigner@^3.1107.0 — `getSignedUrl` for the presigned
  PUT, peer of the client above.

### Installed — nothing outstanding

All five are on `main` (`@supabase/ssr` 0.12.4, `@supabase/supabase-js`
2.112.2, `stripe` 22.4.0, `@aws-sdk/client-s3` 3.1107.0,
`@aws-sdk/s3-request-presigner` 3.1107.0) and `lib/db/vendor-shims.d.ts` has
been deleted. `tsc --noEmit` passes against the real published types with no
code changes.

`package.json` on this branch does not list them — a track agent may not edit
it — so this worktree's `node_modules` was synced with `npm i --no-save`. The
two converge when track/data merges into `main`. If you need to re-sync a fresh
worktree of this branch before that merge:

```bash
npm i --no-save @supabase/ssr@^0.12.4 @supabase/supabase-js@^2.112.2 stripe@^22.4.0 @aws-sdk/client-s3@^3.1107.0 @aws-sdk/s3-request-presigner@^3.1107.0
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

Still needed for the R2 photo upload (see docs/handoff/admin.md):

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `R2_PUBLIC_URL` — public base for rendered photos (a public bucket domain),
  e.g. `https://media.flexsoar.com`. The `getItemPhotoUploadUrl()` signer
  refuses to run without it, since a photo with no public URL can never be
  displayed or saved.

### Privy embedded wallets (Phase B — Courtyard play, human installs)

Requested package (human installs — `package.json` untouched per AGENT_RULES.md):

- `@privy-io/react-auth` — PrivyProvider (`embeddedWallets.solana.createOnLogin:
  'users-without-wallets'`). No `solana.rpcs` override and no
  `toSolanaWalletConnectors()`: broadcasts go out over each wallet's own
  connection (same as Phantom), and Phantom/external stays working through
  the pre-existing `window.solana` path, untouched. `useWallets()` gives the
  embedded wallet; it speaks our unsigned-tx flow natively
  (`signAndSendTransaction({ chain: 'solana:devnet', transaction, address })`,
  `signMessage({ message, address })` for the link-wallet proof — shapes
  verified against the installed `.d.ts`, signatures arrive as bytes).
  Supabase sessions stay authoritative for the ledger — Privy is a key
  manager, not an identity replacement; the embedded address links through
  the existing link-wallet proof into `users.solana_address`, and the buy
  panel signs with whichever key matches the quoted buyer wallet.

Installed 2026-09-15: `@privy-io/react-auth@3.42.0` (human `npm install`;
shapes verified against its bundled `.d.ts`). The `@solana/kit` peer family
is deliberately NOT installed: it only feeds Privy's own embedded-wallet UI
flows, which we don't use — we call the wallet-standard methods directly
with our web3.js v1 transactions. If a future Privy UI is adopted, install
`@solana/kit @solana-program/memo @solana-program/system
@solana-program/token` and add the webpack externals from their install
guide (we build with `--webpack`, so the externals apply).

Environment variable (`.env.local` + Vercel; public, not secret):

- `NEXT_PUBLIC_PRIVY_APP_ID` — from the Privy dashboard (paste back here).

### Solana settlement (program + routes ship; install + keys before use)

Requested packages (human installs — `package.json` untouched per AGENT_RULES.md):

- `@solana/web3.js@^1.98` — frontend transaction construction for the
  `buy` instruction (`solana/` program SDK, unwritten until this lands).
  The settle VERIFY path (`lib/solana/verify.ts`) deliberately uses plain
  `fetch` and needs nothing.
- `@coral-xyz/anchor@^0.31` — IDL-typed program client, same SDK as above.

Environment variables (`.env.local` + Vercel; never commit):

- `HELIUS_API_KEY` — Helius project key. **Rotate immediately if ever
  pasted anywhere but the dashboards** — a leaked key spends your
  credits. Same key serves both clusters via different URLs.
- `SOLANA_CLUSTER` — `devnet` for all build/test; `mainnet-beta` only
  at launch.
- `SOLANA_USDC_MINT` — devnet `3KQDvM6cvu4pPqmvmaWEmcRhNeSd293ETeSDBX1GrcqL`
  (own test mint, created 2026-09-15 via `solana/scripts/mint-test-usdc.mjs`;
  mint authority = deployer keypair; buyer funded with 1000 test-USDC);
  mainnet `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.
- `SOLANA_PROGRAM_ID` — devnet `CgvCAabXMe1axVCK81yAtRyNFnLM5oExtvh5K16TDcSF`
  (deployed 2026-09-14, upgrade authority = deployer keypair).
  Config PDA `BA63u3E7ShsiqdDhDrgkKmXLhtXe6YjLYfPgZGuN6jKC`
  (initialized 2026-09-14, admin = treasury = deployer wallet on devnet).
- `SOLANA_TREASURY` — FlexSoar USDC fee sink (multisig on mainnet).
- `SOLANA_QUOTE_SECRET` — random 32+ bytes; signs price quotes.
- `SOLANA_MAX_TRADE_UNITS` — optional, defaults to 500000000 (500 USDC,
  mirrors the program cap).
- `SOLANA_MYR_PER_USD` — optional operator pin (e.g. `4.70`), used ONLY when
  both free FX providers are unreachable. The used rate is auditable per
  trade inside the quote (`fxMyr`). Set it if your network blocks the free
  endpoints; otherwise leave unset and quotes ride live FX.

Toolchain (not installable from here — needs WSL2/Linux):

- Rust stable + Solana CLI + Anchor 0.31.x, then from `solana/`:
  `anchor build && anchor deploy --provider.cluster devnet`.
