/**
 * components/ui/Input.tsx
 *
 * Rounded dark text field with an optional label, hint, and inline error.
 * "use client" so it can be controlled from interactive forms.
 */
"use client";

import { forwardRef } from "react";
import { cn } from "./cn";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string | null;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, className, id, ...rest },
  ref,
) {
  const inputId = id ?? (label ? `input-${label}` : undefined);
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          htmlFor={inputId}
          className="text-[11px] font-semibold uppercase tracking-wide text-muted"
        >
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={
          error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
        }
        className={cn(
          "rounded-xl border bg-raised px-3 py-2 text-[13px] text-foreground placeholder:text-muted/50",
          "disabled:cursor-not-allowed disabled:opacity-40",
          error
            ? "border-[#FF4444] focus-visible:outline-[#FF4444]"
            : "border-line-strong hover:border-muted",
          className,
        )}
        {...rest}
      />
      {error && (
        <p
          id={`${inputId}-error`}
          className="text-xs text-[#FF4444]"
        >
          {error}
        </p>
      )}
      {!error && hint && (
        <p
          id={`${inputId}-hint`}
          className="text-xs text-muted"
        >
          {hint}
        </p>
      )}
    </div>
  );
});
