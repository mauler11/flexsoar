/**
 * components/market/UserMenu.tsx
 *
 * The @handle button at the far right of the header: click pops Profile /
 * Dashboard links plus the sign-out action. Replaces the old always-visible
 * handle link + sign-out text (and the removed XP chip) with the
 * Polymarket-arranged account popup, dark theme kept.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";

export function UserMenu({ handle }: { handle: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-[13px] text-muted transition hover:text-foreground"
      >
        @{handle}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close account menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-transparent"
          />
          <div className="absolute right-0 z-50 mt-2 flex w-44 flex-col gap-1 rounded-2xl border border-line bg-raised p-2 shadow-soft">
            <Link
              href={`/u/${handle}`}
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2 text-sm transition hover:bg-background"
            >
              Profile
            </Link>
            <Link
              href="/payouts"
              onClick={() => setOpen(false)}
              className="rounded-lg px-3 py-2 text-sm transition hover:bg-background"
            >
              Payouts
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-muted transition hover:bg-background hover:text-foreground"
              >
                Logout
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
