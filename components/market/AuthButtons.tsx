/**
 * components/market/AuthButtons.tsx
 *
 * Signed-out header cluster, Courtyard-arranged: a quiet text "Log in" plus
 * a solid green pill "Sign up", opening the AuthModal popup instead of
 * navigating to /sign-in and /sign-up. The pages themselves keep working —
 * this is the popup entry point, not a replacement flow. Plain system type,
 * compact sizing — no oversized buttons, no mono display font.
 */
"use client";

import { useState } from "react";
import { AuthModal } from "@/components/auth/AuthModal";

export function AuthButtons() {
  const [mode, setMode] = useState<"sign-in" | "sign-up" | null>(null);

  return (
    <>
      <div className="flex shrink-0 items-center gap-1 sm:gap-3">
        <button
          type="button"
          onClick={() => setMode("sign-in")}
          className="rounded-full px-3 py-2 text-sm font-semibold text-foreground transition hover:text-accent sm:px-4"
        >
          Log in
        </button>
        <button
          type="button"
          onClick={() => setMode("sign-up")}
          className="rounded-full bg-accent px-4 py-2 text-sm font-bold text-[#0B0B0B] transition hover:brightness-110 sm:px-5"
        >
          Sign up
        </button>
      </div>
      {mode && <AuthModal initialMode={mode} onClose={() => setMode(null)} />}
    </>
  );
}
