/**
 * app/admin/consignments/page.tsx
 *
 * The consignment queue, filtered by status.
 *
 * The filter is a link per status rather than a client-side control: the list
 * is a server read, the URL is the state, and a shared link opens the same
 * view. `?status=` accepts several, comma separated.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/components/admin/auth";
import {
  STATUS_ORDER,
  statusLabel,
  statusTone,
} from "@/components/admin/consignments/transitions";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import { getConsignments } from "@/lib/api/contract";
import { CONSIGNMENT_STATUSES, type ConsignmentStatus } from "@/lib/db/types";

export const metadata: Metadata = {
  title: "Consignments — FlexSoar admin",
};

function parseStatusFilter(raw: string | string[] | undefined): ConsignmentStatus[] {
  const text = Array.isArray(raw) ? raw.join(",") : raw;
  if (!text) return [];
  const wanted = text.split(",").map((part) => part.trim());
  // Unknown values are dropped rather than passed to PostgREST as a bad enum.
  return CONSIGNMENT_STATUSES.filter((status) => wanted.includes(status));
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toISOString().slice(0, 10);
}

export default async function ConsignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireAdminPage("/admin/consignments");

  const params = await searchParams;
  const statuses = parseStatusFilter(params.status);

  const consignments = await getConsignments(
    statuses.length ? { status: statuses, limit: 200 } : { limit: 200 },
  );

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-mono text-lg uppercase tracking-tight">Consignments</h1>
        <p className="font-mono text-[11px] tracking-tight text-muted">
          {consignments.length} shown
          {statuses.length
            ? ` · ${statuses.map(statusLabel).join(", ")}`
            : " · all statuses"}
        </p>
      </header>

      <nav className="flex flex-wrap gap-1" aria-label="Filter by status">
        <FilterLink label="All" href="/admin/consignments" active={!statuses.length} />
        {STATUS_ORDER.map((status) => (
          <FilterLink
            key={status}
            label={statusLabel(status)}
            href={`/admin/consignments?status=${status}`}
            active={statuses.length === 1 && statuses[0] === status}
          />
        ))}
      </nav>

      {consignments.length === 0 ? (
        <EmptyState
          title="Nothing here"
          description={
            statuses.length
              ? "No consignment is in that status right now."
              : "No consignments exist yet."
          }
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>Consignor</Th>
              <Th>Status</Th>
              <Th className="text-right">Items</Th>
              <Th>Created</Th>
              <Th>Submitted</Th>
              <Th>Received</Th>
              <Th>Completed</Th>
              <Th>
                <span className="sr-only">Detail</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {consignments.map((consignment) => (
              <Tr key={consignment.id}>
                <Td>
                  <span className="text-foreground">
                    {consignment.consignor.handle}
                  </span>
                  <span className="text-muted"> · L{consignment.consignor.level}</span>
                </Td>
                <Td>
                  <Badge tone={statusTone(consignment.status)}>
                    {statusLabel(consignment.status)}
                  </Badge>
                </Td>
                <Td className="text-right tabular-nums">{consignment.item_count}</Td>
                <Td className="text-muted tabular-nums">
                  {formatDate(consignment.created_at)}
                </Td>
                <Td className="text-muted tabular-nums">
                  {formatDate(consignment.submitted_at)}
                </Td>
                <Td className="text-muted tabular-nums">
                  {formatDate(consignment.received_at)}
                </Td>
                <Td className="text-muted tabular-nums">
                  {formatDate(consignment.completed_at)}
                </Td>
                <Td>
                  <Link
                    href={`/admin/consignments/${consignment.id}`}
                    className="text-accent underline-offset-2 hover:underline"
                  >
                    Open
                  </Link>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </main>
  );
}

function FilterLink({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={[
        "border px-2 py-1 font-mono text-[10px] uppercase tracking-tight",
        active
          ? "border-accent bg-accent text-[#0B0B0B]"
          : "border-line-strong bg-raised text-muted hover:border-muted hover:text-foreground",
      ].join(" ")}
    >
      {label}
    </Link>
  );
}
