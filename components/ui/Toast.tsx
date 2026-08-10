/**
 * components/ui/Toast.tsx
 *
 * Toast provider + hook. Push a message from anywhere under the provider; it
 * renders bottom-right and auto-dismisses. Tones carry a leading pixel square
 * so they stay readable in greyscale.
 */
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "./cn";

export type ToastTone = "info" | "success" | "warn" | "danger";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  push: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE: Record<ToastTone, { border: string; text: string; square: string }> =
  {
    info: { border: "#3B9EFF", text: "#3B9EFF", square: "#3B9EFF" },
    success: { border: "#35F07A", text: "#35F07A", square: "#35F07A" },
    warn: { border: "#E8B33A", text: "#E8B33A", square: "#E8B33A" },
    danger: { border: "#FF4444", text: "#FF4444", square: "#FF4444" },
  };

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message: string, tone: ToastTone = "info") => {
      const id = nextId.current++;
      setToasts((list) => [...list, { id, message, tone }]);
      window.setTimeout(() => dismiss(id), 4500);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-72 flex-col gap-2"
      >
        {toasts.map((toast) => {
          const t = TONE[toast.tone];
          return (
            <div
              key={toast.id}
              role="status"
              className={cn(
                "pointer-events-auto border bg-raised px-3 py-2 font-mono text-[11px] leading-snug tracking-tight",
                "pixel-shadow",
              )}
              style={{ borderColor: t.border, color: t.text }}
            >
              <span
                aria-hidden
                className="mr-1.5 inline-block h-1.5 w-1.5 align-baseline"
                style={{ background: t.square }}
              />
              {toast.message}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}
