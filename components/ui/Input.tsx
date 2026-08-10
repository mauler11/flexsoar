/**
 * components/ui/Input.tsx
 *
 * Chunky pixel text field with an optional label, hint, and inline error.
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
          className="font-mono text-[10px] uppercase tracking-tight text-muted"
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
          "border bg-overlay px-2 py-1.5 font-mono text-[13px] tracking-tight text-foreground placeholder:text-muted/50",
          "pixel-shadow-sm",
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
          className="font-mono text-[10px] tracking-tight text-[#FF4444]"
        >
          {error}
        </p>
      )}
      {!error && hint && (
        <p
          id={`${inputId}-hint`}
          className="font-mono text-[10px] tracking-tight text-muted"
        >
          {hint}
        </p>
      )}
    </div>
  );
});
