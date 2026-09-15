/**
 * components/auth/AuthModal.tsx
 *
 * "Welcome to FlexSoar" popup wrapping the real AuthForm (Google OAuth +
 * magic-link email). No parallel auth logic: the form inside is byte-for-byte
 * the /sign-in and /sign-up flow, so the pages keep working unchanged and
 * there is exactly one implementation. Centring comes from the portalled
 * Modal shell (the blurred sticky header would otherwise trap it).
 * No password sign-up exists in production by design (magic link is the
 * product flow). Usernames are claimed AFTER confirmation on /welcome —
 * magic links leave the site, so a post-email modal step is impossible.
 */
"use client";

import { AuthForm } from "@/components/auth/AuthForm";
import { Modal } from "@/components/market/Modal";

export function AuthModal({
  initialMode,
  onClose,
}: {
  initialMode: "sign-in" | "sign-up";
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between px-8 pt-6">
        <h2 className="text-lg font-bold tracking-tight">Welcome to FlexSoar</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-lg leading-none text-muted transition hover:text-foreground"
        >
          ×
        </button>
      </div>
      <AuthForm mode={initialMode} />
    </Modal>
  );
}
