/**
 * components/ui/Modal.tsx
 *
 * Chunky pixel dialog. Fixed overlay, Escape to close, body scroll locked
 * while open. Renders nothing until `open` is true.
 */
"use client";

import { useEffect } from "react";
import { cn } from "./cn";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  className,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 cursor-default bg-overlay/80"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative z-10 w-full max-w-md border border-line-strong bg-raised",
          "pixel-shadow-lg",
          className,
        )}
      >
        {title != null && (
          <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <h2 className="font-mono text-[11px] font-bold uppercase tracking-tight">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="px-1 font-mono text-muted hover:text-foreground"
            >
              ×
            </button>
          </header>
        )}
        <div className="px-3 py-3">{children}</div>
        {footer != null && (
          <footer className="flex justify-end gap-2 border-t border-line px-3 py-2">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
