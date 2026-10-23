# Privy `signMessage` proof: how to run it (founder, in a browser)

This runs `docs/handoff/solana-p1b.md` section 7, steps 1-5, against an embedded Privy Solana test wallet. **I have not run it and did not
use any Privy credential.** The seller flow depends on one fact I cannot establish from here: that Privy's `signMessage` signs the exact
61 bytes it is given, with no prefix, wrapper or string re-encoding. The program verifies a plain Ed25519 signature over those bytes, so a
wallet that changes them cannot be used for listings.

## What you need (all yours, none of it in the repo)

1. **A Privy development app**, not your production app, with email login and **embedded wallets for Solana** enabled, and
   `http://localhost:3000` in its allowed origins. Use a throwaway email address.
2. In the repo root create or edit **`.env.local`** (it is gitignored) with your dev app's id:
   ```
   NEXT_PUBLIC_PRIVY_APP_ID=<your Privy DEVELOPMENT app id>
   ```
   Your normal `.env.local` already has what the rest of the app needs. If you have no Supabase values at all, the app's proxy still
   insists they exist; any HTTPS placeholder is enough for this page because it never calls Supabase (for example
   `NEXT_PUBLIC_SUPABASE_URL=https://placeholder.invalid` and `NEXT_PUBLIC_SUPABASE_ANON_KEY=local-only`). No real Supabase, Helius,
   Stripe or other credentials are needed.
3. A current **Chrome, Edge, Firefox or Safari** (WebCrypto Ed25519). Step 0 of the page tells you if yours cannot.

## Run it

1. From the repo root: `npm run dev`
2. Open **http://localhost:3000/dev/privy-sign-proof**
3. Click **Log in (throwaway email)**, enter the code Privy emails you. If it says there is no embedded Solana wallet, click
   **Create FlexSoar wallet** (the existing button).
4. Click **Run proof (steps 1-5)**. Privy may ask you to approve each signature (four signatures: the listing vector, then three awkward
   messages). Approve every prompt.
5. Read the banner:
   - **PROOF PASSED** and every row PASS: Privy signs the exact bytes. Click **Copy report as JSON** and send it to me or save it next
     to the rehearsal log.
   - **STOP: step N failed**: do not change anything in the program. Copy the report and send it to me.

The page sends nothing anywhere except Privy's own login traffic, signs no transaction and creates no on-chain activity.

## What a pass looks like (8 rows)

| Step | Check | Expected |
|---|---|---|
| 0 | this browser verifies Ed25519 (RFC 8032 test vector 1) | PASS: a known-good signature verifies, so later "false" results mean something |
| 1 | message is the shared 61-byte listing vector | PASS: length 61, sha256 `f7125fc0f364c4134469517178192ce16d44875818d6cd30e5768cdf28de9830` |
| 2 | wallet returns a 64-byte signature | PASS |
| 3 | signature verifies over the UNMODIFIED 61 bytes under the wallet address | **PASS is the whole point.** FAIL means the wallet signed something other than the bytes it was given |
| 4 | negative controls: the same signature does NOT verify over (a) the message with the Solana `\xffsolana offchain` prefix, (b) the message's hex string, (c) the message with one bit flipped | PASS, each shown as `false (good)` |
| 5 (x3) | a message with a leading `0x00`; `0xff`/`0x00` interleaved; invalid UTF-8 sequences, each signed and verified over its exact bytes | PASS x3: catches string coercion the vector alone would not |

## If it stops

| Step that failed | Meaning | What to do |
|---|---|---|
| 0 | Your browser cannot do Ed25519 verification | Use another browser and rerun. Nothing about Privy is learned yet |
| 2 | The wallet refused, threw, or returned a signature that is not 64 bytes | Send me the detail line. Often a declined prompt |
| 3 | **Privy wrapped or re-encoded the message** (prefix, string coercion, hex/base64) | **STOP.** Do not "fix" it by changing what the program verifies. Options are a different Privy signing API, a different connector, or an off-chain-message format change in the program, which needs its own review |
| 4 | A signature verifies over a variant | Treat as a broken check; send me the report. This should not happen with an honest wallet |
| 5 | The wallet signs ordinary text fine but corrupts raw bytes | **STOP**, same as step 3: a message with high or non-UTF-8 bytes (every real listing has them) would fail on chain |

## Cross-checking the result without trusting the page

The report holds the public address, the message hex and the signature hex. This Node snippet verifies step 3 independently:

```js
const { createPublicKey, verify } = require('node:crypto');
const bs58alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const decode = s => { let n = 0n; for (const c of s) n = n * 58n + BigInt(bs58alphabet.indexOf(c)); return Buffer.from(n.toString(16).padStart(64, '0'), 'hex'); };
const report = require('./privy-proof-report.json');           // the JSON you copied
const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), decode(report.address)]), format: 'der', type: 'spki' });
console.log(verify(null, Buffer.from(report.messageHex, 'hex'), key, Buffer.from(report.signatureHex, 'hex')));   // must print true
```

## Safety and scope

- The page exists only in development. A production build returns **404** for the route and contains none of the runner's code (checked
  on this machine with a production build and server: `status=404`; the runner strings are absent from every output chunk). The runner also
  refuses to render when `NODE_ENV` is not `development`.
- It is not linked from anywhere. Delete `app/dev/` and `lib/solana/privy-proof.ts` after the result is recorded if you prefer.
- The logic is `lib/solana/privy-proof.ts`, unit-tested (`tests/solana-privy-proof.test.ts`, 14 tests) with signers that wrap with the
  off-chain prefix, sign the hex or base64 string, coerce through UTF-8, return short signatures, throw, or sign with another key: each is
  stopped at the step this table says. That proves the proof can fail; it proves nothing about Privy itself.

## PP1 - wallet detection fix (2026-10-23)

Symptom: logged in, dashboard shows an SVM embedded wallet, page said "no embedded Solana wallet yet", and "Create" answered "User already has an embedded wallet".
Root cause: the page took wallets from `useWallets()` of `@privy-io/react-auth` (3.42.0), which returns Ethereum `ConnectedWallet`s only, then filtered with `firstSolanaWallet`
(`chainType === "solana"`). Solana embedded wallets exist only in `useWallets()` from `@privy-io/react-auth/solana` (`ConnectedStandardSolanaWallet`, which has no `chainType` field), so
the list never contained the wallet and, even if it had, the filter would have rejected it. Fix: the page now uses the Solana hook and its own `ready` flag, via
`lib/solana/privy-wallet-detect.ts` (`detectSolanaWallet`: waiting until Privy AND the wallets list are ready, then found/missing), shows the detected address and what the hook returned,
and offers "Create" (Solana `useCreateWallet`) only in the missing state. `lib/solana/privy-proof.ts` and every verification step are unchanged.
Not fixed here (other lane): `components/market/EmbeddedWalletSection.tsx` and `components/market/SendDialog.tsx` use the same root `useWallets()` + `firstSolanaWallet` pattern and very likely have
the same bug in the main app; file with the market track. Unverified: I could not run Privy live, so the fix is proven by the 3.42.0 type definitions and unit tests, not by a login.
