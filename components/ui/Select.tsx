/**
 * components/ui/Select.tsx
 *
 * Chunky pixel native select with an optional label and inline error. Native
 * <select> keeps keyboard and screen-reader behaviour for free.
 */
"use client";

import { forwardRef } from "react";
import { cn } from "./cn";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
  label?: string;
  error?: string | null;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, label, error, className, id, ...rest },
  ref,
) {
  const selectId = id ?? (label ? `select-${label}` : undefined);
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          htmlFor={selectId}
          className="font-mono text-[10px] uppercase tracking-tight text-muted"
        >
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        aria-invalid={error ? true : undefined}
        className={cn(
          "border bg-overlay px-2 py-1.5 font-mono text-[13px] tracking-tight text-foreground",
          "pixel-shadow-sm",
          "disabled:cursor-not-allowed disabled:opacity-40",
          error
            ? "border-[#FF4444] focus-visible:outline-[#FF4444]"
            : "border-line-strong hover:border-muted",
          className,
        )}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-raised">
            {option.label}
          </option>
        ))}
      </select>
      {error && (
        <p className="font-mono text-[10px] tracking-tight text-[#FF4444]">
          {error}
        </p>
      )}
    </div>
  );
});
