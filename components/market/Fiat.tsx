/**
 * components/market/Fiat.tsx
 *
 * Site-wide display currency. One context owns the code (default USDC =
 * exact figures; any fiat = live-FX estimate), persisted per device under
 * the same localStorage keys the wallet modal has always used, so existing
 * preferences carry over. Rates arrive from GET /api/fx (public data, no
 * auth). Ledger, Stripe, and quotes are untouched — MYR sen stays the unit
 * of account everywhere money moves; this only changes how numbers render.
 *
 *   <FiatAmount cents={priceCents} />   — MYR sen in, display string out
 *   <FiatSelect />                      — header currency picker
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
  code: string;
  rates: Record<string, number> | null;
  setCode: (code: string) => void;
  toggleFiat: () => void;
}

const FiatCtx = createContext<FiatState>({
  code: "MYR",
  rates: null,
  setCode: () => {},
  toggleFiat: () => {},
});

function isKnownCode(code: string | null): code is string {
  return !!code && (DISPLAY_CODES as readonly string[]).includes(code);
}

function readStored(): string {
  try {
    // Legacy shape (separate on/off flag) migrates here: flag off or junk
    // code means exact-by-default MYR; a stored fiat code carries over.
    if (window.localStorage.getItem("flexsoar-fiat") === "1") {
      const code = window.localStorage.getItem("flexsoar-fiat-code");
      if (isKnownCode(code) && code !== "MYR") return code;
    }
    return "MYR";
  } catch {
    return "MYR";
  }
}

function store(code: string) {
  try {
    window.localStorage.setItem("flexsoar-fiat", code === "MYR" || code === "USDC" ? "0" : "1");
    window.localStorage.setItem("flexsoar-fiat-code", code);
  } catch {
    // Private mode — preference just won't persist.
  }
}

export function FiatProvider({ children }: { children: ReactNode }) {
  const [code, setCodeState] = useState("MYR");
  const [rates, setRates] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    setCodeState(readStored());
    let live = true;
    fetch("/api/fx")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (live && body?.rates) setRates(body.rates);
      })
      .catch(() => {});
    const timer = setInterval(() => {
      fetch("/api/fx")
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          if (live && body?.rates) setRates(body.rates);
        })
        .catch(() => {});
    }, 600_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  const setCode = useCallback((next: string) => {
    setCodeState(next);
    store(next);
  }, []);

  const toggleFiat = useCallback(() => {
    // Quick flip between exact MYR and the last fiat (default USD).
    setCodeState((current) => {
      if (current !== "MYR") {
        store("MYR");
        return "MYR";
      }
      let last = "USD";
      try {
        const stored = window.localStorage.getItem("flexsoar-fiat-code");
        if (isKnownCode(stored) && stored !== "MYR") last = stored;
      } catch {
        // Private mode — fall back to USD.
      }
      store(last);
      return last;
    });
  }, []);

  return (
    <FiatCtx.Provider value={{ code, rates, setCode, toggleFiat }}>
      {children}
    </FiatCtx.Provider>
  );
}

export function useFiat(): FiatState {
  return useContext(FiatCtx);
}

/** MYR sen rendered in the site display currency (exact or ≈ estimate). */
export function FiatAmount({
  cents,
  className,
}: {
  cents: number;
  className?: string;
}) {
  const { code, rates } = useFiat();
  const shaped = formatFiatAmount(cents, code, rates);
  const fallback = `RM ${(cents / 100).toFixed(2)}`;
  if (!shaped) return <span className={className}>{fallback}</span>;
  return (
    <span
      className={className}
      title={shaped.estimated ? `Exact: ${fallback}` : undefined}
    >
      {shaped.estimated ? `≈ ${shaped.text}` : shaped.text}
    </span>
  );
}

/** Compact header currency picker driving the site display currency. */
export function FiatSelect({ className }: { className?: string }) {
  const { code, setCode } = useFiat();
  return (
    <select
      value={code}
      onChange={(e) => setCode(e.target.value)}
      aria-label="Display currency"
      title="Display currency — ledger and checkout stay MYR"
      className={
        className ??
        "rounded-xl border border-line-strong bg-raised px-2 py-1 text-xs font-semibold text-foreground focus:outline-none"
      }
    >
      {DISPLAY_CODES.map((c) =>
        c === "USDC" ? (
          <option key={c} value={c}>
            USDC — Exact
          </option>
        ) : (
          <option key={c} value={c}>
            {c}
          </option>
        ),
      )}
    </select>
  );
}
