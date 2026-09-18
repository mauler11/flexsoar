/**
 * components/market/Fiat.tsx
 *
 * Display currency, split in two on purpose:
 *
 *   - siteCode: market + card prices site-wide (default MYR = exact ledger
 *     figures; any other code = live-FX figure). Header selector drives it.
 *   - balanceCode: the wallet balance only (default USDC = exact on-chain
 *     figure). The wallet modal's selector + switch drive it; the header
 *     selector never touches it.
 *
 * Rates refresh every 60s from GET /api/fx (itself 60s-cached server-side,
 * so free providers see at most one request per minute per deployment, not
 * per client). No ≈ marks: figures are live-fetched, and every converted
 * figure keeps its exact value in the tooltip — while checkout, quotes,
 * and the ledger pin their own rates and stay MYR throughout.
 *
 *   <FiatAmount cents={priceCents} />   — MYR sen in, display string out
 *   <FiatSelect />                      — header site-currency picker
 */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { FIAT_CURRENCIES, formatFiatAmount } from "@/lib/solana/balances";

export const DISPLAY_CODES: readonly string[] = [
  "USDC",
  ...FIAT_CURRENCIES.map((c) => c.code),
];

interface FiatState {
  siteCode: string;
  setSiteCode: (code: string) => void;
  balanceCode: string;
  setBalanceCode: (code: string) => void;
  toggleBalanceFiat: () => void;
  rates: Record<string, number> | null;
}

const FiatCtx = createContext<FiatState>({
  siteCode: "MYR",
  setSiteCode: () => {},
  balanceCode: "USDC",
  setBalanceCode: () => {},
  toggleBalanceFiat: () => {},
  rates: null,
});

function isKnownCode(code: string | null): code is string {
  return !!code && (DISPLAY_CODES as readonly string[]).includes(code);
}

function readStored(key: string, fallback: string): string {
  try {
    const code = window.localStorage.getItem(key);
    if (isKnownCode(code)) return code;
    // One-time legacy migration for the balance code: the old shared
    // on/off flag + code pair becomes the wallet's own preference.
    if (key === "flexsoar-balance-code") {
      const legacy =
        window.localStorage.getItem("flexsoar-fiat") === "1"
          ? window.localStorage.getItem("flexsoar-fiat-code")
          : null;
      if (isKnownCode(legacy)) return legacy;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function store(key: string, code: string) {
  try {
    window.localStorage.setItem(key, code);
  } catch {
    // Private mode — preference just won't persist.
  }
}

export function FiatProvider({ children }: { children: ReactNode }) {
  const [siteCode, setSiteCodeState] = useState("MYR");
  const [balanceCode, setBalanceCodeState] = useState("USDC");
  const [rates, setRates] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    setSiteCodeState(readStored("flexsoar-site-code", "MYR"));
    setBalanceCodeState(readStored("flexsoar-balance-code", "USDC"));
    let live = true;
    async function load() {
      try {
        const res = await fetch("/api/fx");
        if (!res.ok) return;
        const body = (await res.json()) as { rates?: Record<string, number> };
        if (live && body?.rates) setRates(body.rates);
      } catch {
        // Rates stay stale; figures fall back to exact units.
      }
    }
    load();
    const timer = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  const setSiteCode = useCallback((next: string) => {
    if (!isKnownCode(next)) return;
    setSiteCodeState(next);
    store("flexsoar-site-code", next);
  }, []);

  const setBalanceCode = useCallback((next: string) => {
    if (!isKnownCode(next)) return;
    setBalanceCodeState(next);
    store("flexsoar-balance-code", next);
  }, []);

  const toggleBalanceFiat = useCallback(() => {
    // Quick flip between the exact USDC figure and the last fiat.
    // NOTE: fiatOn excludes MYR and USDC, so the "on" landing must be a
    // genuine fiat code — defaulting to MYR left the switch stuck off.
    setBalanceCodeState((current) => {
      if (current !== "USDC") {
        store("flexsoar-balance-code", "USDC");
        return "USDC";
      }
      let last = "USD";
      try {
        const stored = window.localStorage.getItem("flexsoar-balance-code");
        if (isKnownCode(stored) && stored !== "USDC" && stored !== "MYR") {
          last = stored;
        }
      } catch {
        // Private mode — fall back to USD.
      }
      store("flexsoar-balance-code", last);
      return last;
    });
  }, []);

  return (
    <FiatCtx.Provider
      value={{ siteCode, setSiteCode, balanceCode, setBalanceCode, toggleBalanceFiat, rates }}
    >
      {children}
    </FiatCtx.Provider>
  );
}

export function useFiat(): FiatState {
  return useContext(FiatCtx);
}

/** MYR sen rendered in the site display currency (exact MYR or live FX). */
export function FiatAmount({
  cents,
  className,
}: {
  cents: number;
  className?: string;
}) {
  const { siteCode, rates } = useFiat();
  const shaped = formatFiatAmount(cents, siteCode, rates);
  const fallback = `RM ${(cents / 100).toFixed(2)}`;
  if (!shaped) return <span className={className}>{fallback}</span>;
  return (
    <span
      className={className}
      title={shaped.estimated ? `Exact: ${fallback}` : undefined}
    >
      {shaped.text}
    </span>
  );
}

/**
 * Compact header site-currency picker: 3-letter code + native arrow,
 * squared corners. Drives prices only — the wallet balance has its own
 * selector inside the wallet modal.
 */
export function FiatSelect({ className }: { className?: string }) {
  const { siteCode, setSiteCode } = useFiat();
  return (
    <select
      value={siteCode}
      onChange={(e) => setSiteCode(e.target.value)}
      aria-label="Display currency"
      title="Display currency — ledger and checkout stay MYR"
      className={
        className ??
        "w-[4.5rem] rounded-md border border-line-strong bg-raised px-1.5 py-1 text-xs font-semibold text-foreground focus:outline-none"
      }
    >
      {DISPLAY_CODES.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}
