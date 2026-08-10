/**
 * components/ui/Button.tsx
 *
 * Chunky pixel button. Hard offset shadow, no rounding, uppercase mono type.
 * Renders an <a> when `href` is given, otherwise a <button>.
 *
 * "use client" because buttons are interactive by definition; the anchor form
 * still renders fine from a server component.
 */
"use client";

import { forwardRef } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render as an anchor when present. */
  href?: string;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "border-accent bg-accent text-[#0B0B0B] pixel-shadow hover:brightness-110",
  secondary:
    "border-line-strong bg-raised text-foreground pixel-shadow hover:border-muted",
  ghost:
    "border-transparent bg-transparent text-muted shadow-none hover:bg-raised hover:text-foreground",
  danger:
    "border-[#FF4444] bg-[#FF4444] text-[#0B0B0B] pixel-shadow hover:brightness-110",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-2 py-1 text-[10px]",
  md: "px-3 py-1.5 text-[11px]",
  lg: "px-4 py-2 text-sm",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonProps
>(function Button(
  { variant = "primary", size = "md", href, className, type, ...rest },
  ref,
) {
  const classes = cn(
    "inline-flex select-none items-center justify-center gap-1.5 border font-mono font-bold uppercase tracking-tight transition-colors",
    "active:translate-x-[3px] active:translate-y-[3px] active:shadow-none",
    "disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:active:translate-x-0 disabled:active:translate-y-0",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  );

  if (href != null) {
    return (
      <a href={href} className={classes}>
        {rest.children}
      </a>
    );
  }

  return (
    <button ref={ref} type={type ?? "button"} className={classes} {...rest} />
  );
});
