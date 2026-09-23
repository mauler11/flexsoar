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

function RowIcon({ children }: { children: React.ReactNode }) {
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
      {children}
    </svg>
  );
}

function TruckIcon() {
  return (
    <RowIcon>
      <rect x="1" y="4" width="14" height="11" rx="1" />
      <path d="M15 8h4l3 3v4h-7V8z" />
      <circle cx="5.5" cy="18.5" r="2" />
      <circle cx="17.5" cy="18.5" r="2" />
    </RowIcon>
  );
}

function SupportIcon() {
  return (
    <RowIcon>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </RowIcon>
  );
}

function SettingsIcon() {
  return (
    <RowIcon>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </RowIcon>
  );
}

function LogoutIcon() {
  return (
    <RowIcon>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </RowIcon>
  );
}

export function UserMenu({ handle, title }: { handle: string; title?: string | null }) {
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
                <p className="truncate text-sm font-extrabold">
                  @{handle}
                  {title && (
                    <span className="ml-1.5 rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-accent">
                      {title}
                    </span>
                  )}
                </p>
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

            <Link href="/shipments" onClick={close} className={row}>
              <TruckIcon />
              Shipments
            </Link>
            <Link href="/contact" onClick={close} className={row}>
              <SupportIcon />
              Support
            </Link>
            <Link href="/settings" onClick={close} className={row}>
              <SettingsIcon />
              Settings
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium text-muted transition hover:bg-background hover:text-foreground"
              >
                <span className="flex items-center gap-3">
                  <LogoutIcon />
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
