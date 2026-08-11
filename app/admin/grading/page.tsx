/**
 * app/admin/grading/page.tsx
 *
 * The grading queue. Two views over the same pre-mint pipeline:
 *
 *   to grade        — no float yet
 *   to authenticate — no authenticity stamp yet
 *
 * Both filter to pending_intake and in_custody: everything later in an item's
 * life (minted, redemption_hold, shipped, released, returned) has left this
 * screen's jurisdiction. Grading and authentication are independent and can
 * happen in either order; an item leaves both queues when both are done, at
 * which point it is in_custody and belongs to /admin/mint.
 *
 * Oldest first, from getItems() — the shoe that has waited longest is next.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/components/admin/auth";
import { toPhotoList } from "@/components/admin/grading/photos";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import { getItems } from "@/lib/api/contract";

export const metadata: Metadata = {
  title: "Grading — FlexSoar admin",
};

type QueueView = "grade" | "authenticate";

function parseQueue(raw: string | string[] | undefined): QueueView {
  return raw === "authenticate" ? "authenticate" : "grade";
}

export default async function GradingQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireAdminPage("/admin/grading");

  const params = await searchParams;
  const queue = parseQueue(params.queue);

  const items = await getItems({
    status: ["pending_intake", "in_custody"],
    ...(queue === "grade" ? { graded: false } : { authenticated: false }),
    limit: 200,
  });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-mono text-lg uppercase tracking-tight">Grading</h1>
        <p className="font-mono text-[11px] leading-snug tracking-tight text-muted">
          The float is the product. Grade what is in front of you, under the
          same lamp every time, and take the worse score when you are torn.
        </p>
      </header>

      <nav className="flex gap-1" aria-label="Queue">
        <QueueLink label={`To grade`} href="/admin/grading" active={queue === "grade"} />
        <QueueLink
          label={`To authenticate`}
          href="/admin/grading?queue=authenticate"
          active={queue === "authenticate"}
        />
      </nav>

      {items.length === 0 ? (
        <EmptyState
          title="Queue clear"
          description={
            queue === "grade"
              ? "Every item in custody has a float."
              : "Every item in custody is authenticated or rejected."
          }
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>SKU</Th>
              <Th>Status</Th>
              <Th className="text-right">Photos</Th>
              <Th className="text-right">Float</Th>
              <Th>Authenticity</Th>
              <Th>
                <span className="sr-only">Open</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {items.map((item) => {
              const photoCount = toPhotoList(item.photos).length;
              return (
                <Tr key={item.id}>
                  <Td>
                    <span className="text-foreground">
                      {item.sku.brand} {item.sku.model}
                    </span>
                    <span className="text-muted">
                      {" "}
                      · {item.sku.colorway} · US {item.sku.size_us}
                    </span>
                  </Td>
                  <Td className="text-muted">
                    {item.status === "pending_intake" ? "Pending intake" : "In custody"}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {photoCount < 8 ? (
                      <span className="text-[#E8B33A]">{photoCount}/8</span>
                    ) : (
                      <span className="text-muted">{photoCount}/8</span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {item.float_value == null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      Number(item.float_value).toFixed(3)
                    )}
                  </Td>
                  <Td>
                    {item.authenticated_at ? (
                      <Badge tone="accent">Authentic</Badge>
                    ) : (
                      <Badge tone="neutral">Pending</Badge>
                    )}
                  </Td>
                  <Td>
                    <Link
                      href={`/admin/grading/${item.id}`}
                      className="text-accent underline-offset-2 hover:underline"
                    >
                      Open
                    </Link>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </main>
  );
}

function QueueLink({
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
