/**
 * components/auth/WelcomeForm.tsx
 *
 * Post-confirmation claim: the @-prefixed username picker plus the region
 * selector shown on /welcome to brand-new accounts. The handle saves
 * through the caller's own session — RLS grants handle-only self-update,
 * so no service key; the unique constraint is the final arbiter (a 23505
 * on a lost race surfaces as "taken", verbatim per AGENT_RULES). The
 * region saves through saveSignupRegionAction (fn_set_country, same
 * export the listing flow uses). Availability reads go through
 * public_profiles (the stranger-safe view, never the users table).
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { normalizeUsername } from "@/lib/auth/handle";
import { Button } from "@/components/ui/Button";
import {
  COUNTRIES,
  isValidCountryCode,
} from "@/components/market/intake/intake-config";
import { saveSignupRegionAction } from "@/app/(auth)/welcome/actions";

export function WelcomeForm({
  currentHandle,
  next,
}: {
  currentHandle: string;
  next: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentHandle);
  const [region, setRegion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  async function claim() {
    setError(null);
    const normalized = normalizeUsername(value);
    if (normalized.length < 3) {
      setError("Use at least 3 letters, numbers, or underscores.");
      return;
    }
    if (!isValidCountryCode(region)) {
      setError("Select your region from the list.");
      return;
    }
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      if (!uid) {
        setError("Session expired — sign in again.");
        setBusy(false);
        return;
      }
      if (normalized !== normalizeUsername(currentHandle)) {
        const taken = await supabase
          .from("public_profiles")
          .select("id, handle")
          .eq("handle", normalized)
          .maybeSingle();
        if (taken.error && taken.error.code !== "PGRST116") {
          setError(taken.error.message);
          setBusy(false);
          return;
        }
        const row = taken.data as { id?: unknown } | null;
        // A live row here belongs to someone else — except the same row
        // under a case variant, which the citext unique index treats as
        // identical anyway (falls to the 23505 handler below if raced).
        if (row && row.id !== uid) {
          setError(`@${normalized} is taken — try another.`);
          setBusy(false);
          return;
        }
        const saved = await supabase
          .from("users")
          .update({ handle: normalized })
          .eq("id", uid);
        if (saved.error) {
          setError(
            saved.error.code === "23505"
              ? `@${normalized} was just taken — try another.`
              : saved.error.message,
          );
          setBusy(false);
          return;
        }
      }
      const regionSaved = await saveSignupRegionAction(region);
      if (!regionSaved.ok) {
        setError(regionSaved.message);
        setBusy(false);
        return;
      }
      router.push(next);
      router.refresh();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "Could not save — try again.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label
          htmlFor="welcome-handle"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted"
        >
          Username
        </label>
        <div className="flex items-center rounded-xl border border-line-strong bg-raised px-3 transition-colors focus-within:border-muted hover:border-muted">
          <span aria-hidden className="text-sm font-semibold text-muted">
            @
          </span>
          <input
            id="welcome-handle"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
            placeholder="username"
            autoComplete="username"
            maxLength={24}
            className="w-full bg-transparent px-1 py-2.5 text-sm text-foreground placeholder:text-muted/50 focus:outline-none"
          />
        </div>
        <p className="text-[11px] text-muted">
          3–24 letters, numbers, underscores. This is your public @handle.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="welcome-region"
          className="text-[11px] font-semibold uppercase tracking-wide text-muted"
        >
          Region
        </label>
        <select
          id="welcome-region"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="w-full rounded-xl border border-line-strong bg-raised px-3 py-2.5 text-sm text-foreground focus:outline-none"
        >
          <option value="">Select region…</option>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        {region === "MY" ? (
          <p className="text-[11px] text-muted">
            Malaysian accounts can list, cash out via Stripe, and redeem.
          </p>
        ) : region ? (
          <p className="text-[11px] text-muted">
            Only Malaysian accounts receive Stripe cash payouts — other
            regions are paid in FlexSoar credit. Prices are identical either
            way.
          </p>
        ) : (
          <p className="text-[11px] text-muted">
            Required — it decides how sale proceeds reach you.
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-[#FF4444]">
          {error}
        </p>
      )}

      <Button
        type="button"
        size="lg"
        disabled={busy}
        onClick={claim}
        className="w-full py-3 text-base"
      >
        {busy ? "Saving…" : "Continue"}
      </Button>
    </div>
  );
}
