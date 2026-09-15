/**
 * components/market/AuthButtons.tsx
 *
 * Signed-out header cluster: Log In (quiet) + Sign Up (green), opening the
 * AuthModal popup instead of navigating to /sign-in and /sign-up. The
 * pages themselves keep working — this is the popup entry point, not a
 * replacement flow.
 */
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { AuthModal } from "@/components/auth/AuthModal";

export function AuthButtons() {
  const [mode, setMode] = useState<"sign-in" | "sign-up" | null>(null);

  return (
    <>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="md"
          variant="secondary"
          className="rounded-lg text-base"
          onClick={() => setMode("sign-in")}
        >
          Log In
        </Button>
        <Button
          size="md"
          variant="primary"
          className="rounded-lg text-base"
          onClick={() => setMode("sign-up")}
        >
          Sign Up
        </Button>
      </div>
      {mode && <AuthModal initialMode={mode} onClose={() => setMode(null)} />}
    </>
  );
}
