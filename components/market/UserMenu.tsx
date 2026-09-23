/**
 * components/market/UserMenu.tsx
 *
 * The @handle button at the far right of the header: click slides an
 * account panel — handle + View profile, then Shipments, Support,
 * Settings, Log Out. Deliberately no wallet block: money lives in the
 * header chip, the Wallet button, and /payouts — not duplicated here.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";

function RowIcon({ d }: { d: string }) {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-muted"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export function UserMenu({ handle }: { handle: string }) {
  const [open, setOpen] = useState(false);
  const initial = (handle.slice(0, 1) || "?").toUpperCase();

  function close() {
    setOpen(false);
  }

  const row =
    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition hover:bg-background";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Account menu for @${handle}`}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-accent bg-accent text-sm font-black text-[#0B0B0B] transition hover:brightness-110"
      >
        {initial}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close account menu"
            onClick={close}
            className="fixed inset-0 z-40 cursor-default bg-transparent"
          />
          <div className="absolute right-0 z-50 mt-2 flex w-72 flex-col gap-1 rounded-2xl border border-line bg-raised p-3 shadow-soft">
            <div className="flex items-center gap-3 px-1 pb-2">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-accent bg-accent text-sm font-black text-[#0B0B0B]"
              >
                {initial}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold">@{handle}</p>
                <Link
                  href={`/u/${handle}`}
                  onClick={close}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  View profile
                </Link>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close account menu"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-lg leading-none text-muted transition hover:bg-overlay hover:text-foreground"
              >
                ×
              </button>
            </div>

            <Link href={`/u/${handle}`} onClick={close} className={row}>
              <RowIcon d="M4 7h16M4 12h16M4 17h10" />
              Shipments
            </Link>
            <Link href="/contact" onClick={close} className={row}>
              <RowIcon d="M4 6h16v12H4z M4 7l8 6 8-6" />
              Support
            </Link>
            <Link href="/settings" onClick={close} className={row}>
              <RowIcon d="M4 8h16M4 16h16" />
              Settings
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium text-muted transition hover:bg-background hover:text-foreground"
              >
                <span className="flex items-center gap-3">
                  <RowIcon d="M9 21H6a2 2 0 01-2-2V5a2 2 0 012-2h3M16 17l5-5-5-5M21 12H9" />
                  Log Out
                </span>
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
