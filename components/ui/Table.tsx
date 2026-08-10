/**
 * components/ui/Table.tsx
 *
 * Composable pixel table primitives. Server-component safe — build rows from
 * any data (including fixtures) and add interactive cells on top.
 */
import type { ReactNode } from "react";
import { cn } from "./cn";

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  children: ReactNode;
  className?: string;
}

export function Table({ children, className, ...rest }: TableProps) {
  return (
    <div className="w-full overflow-x-auto border border-line bg-raised">
      <table
        className={cn(
          "w-full border-collapse text-left font-mono text-[11px] tracking-tight",
          className,
        )}
        {...rest}
      >
        {children}
      </table>
    </div>
  );
}

export function THead({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <thead
      className={cn(
        "border-b border-line bg-overlay text-[10px] uppercase tracking-tight text-muted",
        className,
      )}
    >
      {children}
    </thead>
  );
}

export function TBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <tbody className={cn("divide-y divide-line", className)}>{children}</tbody>
  );
}

export function Tr({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <tr className={cn("transition-colors hover:bg-overlay", className)}>
      {children}
    </tr>
  );
}

export function Th({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <th scope="col" className={cn("px-2 py-1.5 font-normal", className)}>
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <td className={cn("px-2 py-1.5 align-top", className)}>{children}</td>;
}
