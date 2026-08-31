# FlexSoar — deploy runbook

Getting `flexsoar.net` live on Vercel, in Stripe **test mode**, so the Payoneer
application has a real site to point at.

Written for Windows `cmd`, one command per line where a command might prompt.

Nothing here touches live money. Stripe stays in test mode throughout.

---

## 0. A decision to make first: one Supabase project, or two?

Every migration so far has been run against a single Supabase project. Deploying
makes that project **production**. There is no separate prod database, and after
this, `npm run dev` on your laptop and `flexsoar.net` read and write the same rows.

Two options:

**Keep one project.** Correct for right now: zero users, twelve cards, and a
second project means re-running all 27 migrations and maintaining two sets of
env vars alone. This is the recommendation.

**Split later.** The moment there is a real consignor with a real shoe, running
an unverified migration straight against live stops being a calculated risk and
starts being someone else's inventory. That is the trigger to add a staging
project — not today, but know what the trigger is.

Either way, **section 1 is not optional** if you keep one project.

---

## 1. Clean the database before it is public

Your production database currently contains test artifacts from the browser
verification pass. They will be visible to anyone who finds the site.

### 1a. See what's there

```sql
select m.id, m.brand, m.model, m.colorway, m.base_price_cents,
       (select count(*) from skus s where s.model_id = m.id) as sizes,
       (select count(*) from cards c join skus s on s.id = c.sku_id
         where s.model_id = m.id) as cards,
       m.created_at
from sku_models m
order by m.created_at;
```

Expect the real Nike Air Max 1 / Seed Grey, plus the throwaways created during
the bench walkthrough — a Nike Air Jordan 1 / Chicago and a Nike Air Force 1 /
Black, both with zero cards.

### 1b. Delete the throwaways

Run per model id. The guards mean it refuses rather than orphaning anything:

```sql
delete from skus s
 where s.model_id = 'PASTE-MODEL-UUID'
   and not exists (select 1 from cards c where c.sku_id = s.id)
   and not exists (select 1 from items i where i.sku_id = s.id);

delete from sku_models
 where id = 'PASTE-MODEL-UUID'
   and not exists (select 1 from skus s where s.model_id = id);
```

If the second statement reports 0 rows, a variant survived because something
references it. Investigate rather than forcing it.

### 1c. The FSC test grant

`handla` holds 50,000 cents of FSC with no cash behind it. Since FSC is being
removed, reverse it now — section 3 of
`scripts/reset_fsc_and_seed_test_balance.sql`, currently commented out.

The only thing this costs is the ability to exercise the FSC checkout path in
test, which is being deleted anyway.

Afterwards, confirm:

```sql
select u.handle, fn_credit_balance(u.id) from users u
 where fn_credit_balance(u.id) <> 0;
```

Zero rows is the goal.

---

## 2. Enumerate the environment variables

Do not guess these. Read what the app actually uses:

```
type .env.local
```

```
findstr /s /n "process.env" lib\*.ts app\*.ts app\*.tsx
```

Every name that appears in both goes into Vercel.

**Two rules, and the first one is the one that ends projects:**

- Anything prefixed `NEXT_PUBLIC_` is shipped to the browser in plain text. The
  Supabase **service role key** must never carry that prefix. Check this by eye
  before you paste anything.
- `NEXT_PUBLIC_SITE_URL` (or whatever your callback uses to build absolute URLs)
  must be `https://flexsoar.net` in production, not `http://localhost:3000`.

---

## 3. Create the Vercel project

```
npm i -g vercel
```

```
vercel login
```

```
cd C:\Users\Family\flexsoar
```

```
vercel link
```

Accept the defaults; Next.js is detected automatically and needs no build
configuration.

Add the environment variables through the **dashboard** rather than the CLI —
Project → Settings → Environment Variables. Pasting secrets into `cmd` puts them
in your shell history, and the dashboard lets you scope each one to
Production / Preview / Development explicitly.

Then:

```
vercel --prod
```

It will give you a `*.vercel.app` URL. Open it. The site should load on that URL
before you touch DNS — if it 500s here, DNS will not fix it.

---

## 4. Point the domain

In Vercel: Project → Settings → Domains → add `flexsoar.net` and `www.flexsoar.net`.

Vercel will show the exact DNS records to create. **Use the values it shows you,
not values from any guide including this one** — they change, and a stale A
record is a silent failure.

Create those records at whichever registrar holds `flexsoar.net`. Propagation is
usually minutes; occasionally hours. Vercel issues the TLS certificate
automatically once the records resolve.

Check:

```
nslookup flexsoar.net
```

---

## 5. Supabase auth URLs

Supabase dashboard → Authentication → URL Configuration.

- **Site URL**: `https://flexsoar.net`
- **Redirect URLs**: add `https://flexsoar.net/callback` and
  `https://www.flexsoar.net/callback`. Keep `http://localhost:3000/callback` so
  local development still works.

Miss this and sign-in fails on the live site with a redirect error while working
perfectly on localhost.

---

## 6. Fix the email template while you are in here

Authentication → Email Templates → Magic Link. Set the link to:

```
{{ .SiteURL }}/callback?token_hash={{ .TokenHash }}&type=magiclink&next=/
```

Your callback already handles this stateless shape. Switching to it removes the
PKCE verifier cookie entirely — the cookies that accumulate on every sign-in,
never get cleaned up, and share one header with a hard size limit. That whole
class of problem disappears rather than being managed.

Do the same for any other template that carries a sign-in link (recovery,
invite, confirmation).

---

## 7. R2 CORS

Cloudflare dashboard → R2 → your bucket → Settings → CORS Policy:

```json
[
  {
    "AllowedOrigins": [
      "https://flexsoar.net",
      "https://www.flexsoar.net",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

This is one of the two things that genuinely cannot be tested locally. Verify it
by uploading art through the model bench on the live site, not by reading the
config back.

---

## 8. Stripe webhook endpoint

The signing secret is **per endpoint**. Your local CLI secret will not work in
production, and a mismatched secret means every webhook fails signature
verification — silently, from the app's point of view.

Stripe dashboard, **test mode** → Developers → Webhooks → Add endpoint:

- URL: `https://flexsoar.net/api/webhooks/stripe`
- Events: at minimum `checkout.session.completed` and
  `checkout.session.expired`. Add whatever else the handler switches on — check
  it rather than assuming.

Copy the new signing secret into Vercel as the webhook secret variable, then
redeploy:

```
vercel --prod
```

Send a test event from the Stripe dashboard and confirm a 200 in the webhook
log. This is the other thing that cannot be tested locally: redelivery
behaviour only exists against a real endpoint.

---

## 9. Verify

In this order. Steps 1–3 are the 026b checklist and step 1 alone would have
caught that incident.

1. `scripts/smoke_settlement.sql` in the Supabase editor — still passes
2. `https://flexsoar.net/` in a **private window**, signed out
3. `https://flexsoar.net/card/<id>` signed out
4. Sign up with a real email — confirm the magic link lands on the live site and
   the session sticks
5. `/admin/skus` as admin — the model bench loads, art thumbnails render from R2
6. Upload art on the live site — this is the real CORS test
7. A full test-mode purchase end to end, and confirm the webhook fired

If 2 or 3 return a 500 mentioning `permission denied for function`, that is the
026b failure mode returning — a policy helper missing an anon grant.

---

## 10. Before you point Payoneer at it

A reviewer will open the URL. They should see something that matches "online
marketplace for authenticated secondhand sneakers."

Minimum:

- **The front page says what the business is.** Right now nothing on `/` tells a
  visitor they can consign, which is the single most important sentence on the
  site for both a reviewer and a consignor.
- **Something at `/terms`.** A first draft is fine. An empty catalog on a new
  marketplace is normal; no terms at all is not.

An empty market grid is not a problem. An unexplained one is.

---

## Known-good state after this runbook

- `flexsoar.net` live on Vercel, TLS issued
- Stripe **test mode**, webhook endpoint registered and verified
- FSC liability at zero, test artifacts removed
- PKCE cookie class eliminated
- One Supabase project serving both dev and prod — revisit at the first real
  consignor

## Still not done, and still ahead of everything else

- No consignors
- Payoneer (or equivalent) not approved — the rail the whole FSC removal waits on
- Business entity not registered
- ToS not written
- `redemption_handling_fee_cents` is 1500 against real costs of 4000–8000, so a
  redemption today loses money
