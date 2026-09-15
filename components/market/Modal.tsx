/**
 * components/market/Modal.tsx
 *
 * Centred modal shell, portalled to document.body. The portal is
 * load-bearing, not cosmetic: the sticky header carries `backdrop-blur`,
 * and backdrop-filter makes it a containing block for fixed-position
 * descendants — any modal rendered inside the header centres inside the
 * 60px header strip instead of the viewport (clipped top, shifted body).
 * Portalling escapes the filtered ancestor so centring is viewport-true.
 */
"use client";

import { createPortal } from "react-dom";

export function Modal({
  onClose,
  closeLabel = "Close",
  panelClassName = "max-w-md",
  children,
}: {
  onClose: () => void;
  closeLabel?: string;
  panelClassName?: string;
  children: React.ReactNode;
}) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={closeLabel}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/70"
      />
      <div
        className={`relative max-h-[90vh] w-full overflow-y-auto rounded-2xl border border-line bg-background shadow-soft ${panelClassName}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
