/**
 * components/ui/Select.tsx
 *
 * Rounded dark native select with an optional label and inline error. Native
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
          className="text-[11px] font-semibold uppercase tracking-wide text-muted"
        >
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        aria-invalid={error ? true : undefined}
        className={cn(
          "rounded-xl border bg-raised px-2.5 py-2 text-[13px] text-foreground",
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
        <p className="text-xs text-[#FF4444]">
          {error}
        </p>
      )}
    </div>
  );
});
