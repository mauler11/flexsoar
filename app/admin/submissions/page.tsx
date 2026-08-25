/**
 * app/admin/submissions/page.tsx
 *
 * The pending_review queue: shoes a seller has listed themselves and is still
 * holding, waiting on a decision.
 *
 * THIS IS NOT THE GRADING QUEUE. /admin/grading works stock that is already in
 * the warehouse, where a human grades what is physically in front of them.
 * Here the shoe is in the seller's house, the six component scores are the
 * SELLER'S claim, and the only evidence is the photos they uploaded. So the
 * queue leads with what a reviewer is actually deciding between rows on —
 * declared float, what they want for it, and how much the seller has been
 * trusted before.
 *
 * Oldest first: someone has been waiting since `created_at`.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/components/admin/auth";
import {
  getPendingSubmissions,
  getSellerTrust,
  type Submission,
} from "@/components/admin/db-reads";
import { toPhotoList } from "@/components/admin/grading/photos";
import { formatUsd } from "@/components/card/format";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import { gradeFloatFromComponents } from "@/lib/db/grading";

export const metadata: Metadata = {
  title: "Submissions — FlexSoar admin",
};

/** The float the declared components imply, or null when none were declared. */
function declaredFloat(submission: Submission): number | null {
  return submission.grade ? gradeFloatFromComponents(submission.grade) : null;
}

export default async function SubmissionsQueuePage() {
  await requireAdminPage("/admin/submissions");

  const submissions = await getPendingSubmissions();

  // One batched read for every seller in the queue rather than one per row.
  const trust = await getSellerTrust(
    submissions
      .map((submission) => submission.consignor_id)
      .filter((id): id is string => id !== null),
  );

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-mono text-lg uppercase tracking-tight">
          Submissions
        </h1>
        <p className="font-mono text-[11px] leading-snug tracking-tight text-muted">
          Seller-listed shoes awaiting review. The seller still has the shoe and
          graded it themselves — approving mints a card off their word, and the
          float is immutable after that.
        </p>
      </header>

      {submissions.length === 0 ? (
        <EmptyState
          title="Queue clear"
          description="No submission is waiting on a decision."
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              <Th>SKU</Th>
              <Th>Seller</Th>
              <Th className="text-right">Photos</Th>
              <Th className="text-right">Declared float</Th>
              <Th className="text-right">Asking</Th>
              <Th>Payout</Th>
              <Th>Waiting since</Th>
              <Th>
                <span className="sr-only">Open</span>
              </Th>
            </Tr>
          </THead>
          <TBody>
            {submissions.map((submission) => {
              const photoCount = toPhotoList(submission.photos).length;
              const float = declaredFloat(submission);
              const seller = submission.consignor_id
                ? trust.get(submission.consignor_id)
                : undefined;

              return (
                <Tr key={submission.id}>
                  <Td>
                    <span className="text-foreground">
                      {submission.sku.brand} {submission.sku.model}
                    </span>
                    <span className="text-muted">
                      {" "}
                      · {submission.sku.colorway} · US {submission.sku.size_us}
                    </span>
                  </Td>
                  <Td>
                    {submission.seller ? (
                      <>
                        {submission.seller.handle}
                        <span className="text-muted">
                          {" "}
                          · L{submission.seller.level}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted">(no seller on record)</span>
                    )}
                    {seller && (
                      <div className="flex flex-wrap items-center gap-1 pt-0.5">
                        {seller.is_restricted && (
                          <Badge tone="danger">Restricted</Badge>
                        )}
                        {seller.defaults_count > 0 && (
                          <Badge tone="warn">
                            {seller.defaults_count} default
                            {seller.defaults_count === 1 ? "" : "s"}
                          </Badge>
                        )}
                        <span className="text-muted">
                          {seller.fulfilments_completed} shipped
                        </span>
                      </div>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {photoCount < 8 ? (
                      <span className="text-[#E8B33A]">{photoCount}/8</span>
                    ) : (
                      <span className="text-muted">{photoCount}/8</span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {float == null ? (
                      <span className="text-[#E8B33A]">none</span>
                    ) : (
                      float.toFixed(3)
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {submission.asking_price_cents == null
                      ? "—"
                      : formatUsd(submission.asking_price_cents)}
                  </Td>
                  <Td className="text-muted">{submission.submitted_payout}</Td>
                  <Td className="text-muted tabular-nums">
                    {new Date(submission.created_at)
                      .toISOString()
                      .replace("T", " ")
                      .slice(0, 16)}
                  </Td>
                  <Td>
                    <Link
                      href={`/admin/submissions/${submission.id}`}
                      className="text-accent underline-offset-2 hover:underline"
                    >
                      Review
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
