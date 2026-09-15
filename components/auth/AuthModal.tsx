/**
 * components/auth/AuthModal.tsx
 *
 * "Welcome to FlexSoar" popup wrapping the real AuthForm (Google OAuth +
 * magic-link email + @username on sign-up). No parallel auth logic: the
 * form inside is byte-for-byte the /sign-in and /sign-up flow, so the
 * pages keep working unchanged and there is exactly one implementation.
 * No password sign-up exists in production by design (magic link is the
 * product flow); the username is picked upfront on the email path because
 * magic links leave the site — a post-email modal step is impossible.
 */
"use client";

import { AuthForm } from "@/components/auth/AuthForm";

export function AuthModal({
  initialMode,
  onClose,
}: {
  initialMode: "sign-in" | "sign-up";
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/70"
      />
      <div className="relative w-full max-w-md rounded-2xl border border-line bg-background shadow-soft">
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
      </div>
    </div>
  );
}
