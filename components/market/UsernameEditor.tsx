"use client";

/**
 * components/market/UsernameEditor.tsx
 *
 * Inline username editing for Settings. Same rules as signup
 * (lib/auth/handle, mirrored from provision): lowercase, numbers,
 * underscores, 3–24 chars, exactly as typed — the server re-checks and
 * the unique index settles collisions with a plain "taken" message.
 * Success refreshes (header handle + profile URL move with the rename).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateHandleAction } from "@/app/(market)/actions";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Banner } from "@/components/market/Banner";

export function UsernameEditor({ initial }: { initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = value.trim() !== initial;

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateHandleAction(value);
      if (!result.ok) {
        setError(result.message ?? "Username update failed.");
        return;
      }
      setSaved(true);
      router.refresh();
      if (result.handle && result.handle !== initial) {
        router.replace(`/u/${result.handle}`);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        Username
      </span>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input
            aria-label="Username"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
              setSaved(false);
            }}
            disabled={pending}
            autoComplete="off"
          />
        </div>
        <Button
          type="button"
          size="md"
          disabled={pending || !dirty}
          onClick={save}
          className="shrink-0"
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className="text-xs text-muted">
        3–24 characters: lowercase letters, numbers, underscores.
      </p>
      {error && <Banner tone="error" title={error} />}
      {saved && !error && (
        <p role="status" className="text-xs font-semibold text-accent">
          Saved — your profile URL moved with it.
        </p>
      )}
    </div>
  );
}
