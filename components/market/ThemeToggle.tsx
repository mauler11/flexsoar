"use client";

/**
 * components/market/ThemeToggle.tsx
 *
 * Light-preview switch (Settings only). Dark is the product default;
 * this flips `.theme-light` on <html> and persists to localStorage.
 * No system-preference detection on purpose — explicit preview toggle,
 * reversible by tapping back. Defaults to dark on first paint to avoid
 * a flash (effect upgrades to stored value after mount).
 */

import { useEffect, useState } from "react";

const STORAGE_KEY = "fs-theme";

function applyTheme(light: boolean) {
  document.documentElement.classList.toggle("theme-light", light);
}

export function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "light") {
        setLight(true);
        applyTheme(true);
      }
    } catch {
      // Private mode — toggle still works for the session.
    }
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "light" : "dark");
    } catch {
      // Ignore persistence failure; the session toggle stands.
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={light}
      aria-label="Light theme preview"
      onClick={toggle}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        light ? "bg-accent" : "bg-line-strong"
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          light ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

/** Re-apply the stored theme on navigation (client layout mount). */
export function ThemeBoot() {
  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "light") {
        applyTheme(true);
      }
    } catch {
      // Stay dark.
    }
  }, []);
  return null;
}
