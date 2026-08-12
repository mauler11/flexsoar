/**
 * app/admin/submissions/[itemId]/page.tsx
 *
 * The review bench for one seller submission.
 *
 * Everything on this page exists to answer one question: is the seller's
 * declared condition true enough to mint a permanent card off? So the photos
 * are large and the declared scores sit beside them, the seller's record of
 * shipping and defaulting is on the same screen rather than a click away, and
 * the decision controls are last.
 *
 * The pixel art panel is the SKU's, not this item's: art lives on `skus`, so
 * attaching it here changes the artwork for every card of that SKU. The
 * uploader says so, and it still only stages — persisting `skus.art_url` needs
 * the contract write filed as docs/handoff/admin.md item 11.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/components/admin/auth";
import { getSellerHistory, getSubmission } from "@/components/admin/db-reads";
import { PhotoViewer } from "@/components/admin/grading/PhotoViewer";
import { toPhotoList } from "@/components/admin/grading/photos";
import { ArtUploader } from "@/components/admin/skus/ArtUploader";
import { DecisionControls } from "@/components/admin/submissions/DecisionControls";
import { DeclaredGrade } from "@/components/admin/submissions/DeclaredGrade";
import { Badge } from "@/components/ui/Badge";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";

export const metadata: Metadata = {
  title: "Review submission — FlexSoar admin",
};

function formatCents(cents: number | null): string {
  return cents == null ? "—" : `${(cents / 100).toFixed(2)} FSC`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toISOString().replace("T", " ").slice(0, 16);
}

export default async function ReviewSubmissionPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { itemId } = await params;
  await requireAdminPage(`/admin/submissions/${itemId}`);

  const submission = await getSubmission(itemId);
  if (!submission) notFound();

  const photos = toPhotoList(submission.photos);
  const seller = submission.consignor_id
    ? await getSellerHistory(submission.consignor_id, { excludeItemId: itemId })
    : null;

  // Why the buttons might be off. fn_approve_submission guards this in the
  // transaction; saying it before the click is the only thing this adds.
  const blocked =
    submission.status !== "pending_review"
      ? `This submission is ${submission.status.replace(/_/g, " ")} — it is no longer awaiting a decision.`
      : null;

  const itemLabel = `${submission.sku.brand} ${submission.sku.model} · ${submission.sku.colorway} · US ${submission.sku.size_us}`;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <nav className="font-mono text-[10px] uppercase tracking-tight text-muted">
        <Link href="/admin/submissions" className="hover:text-foreground">
          ← Submissions queue
        </Link>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-lg uppercase tracking-tight">
              {submission.sku.brand} {submission.sku.model}
            </h1>
            {submission.status === "pending_review" ? (
              <Badge tone="warn">Pending review</Badge>
            ) : (
              <Badge tone="neutral">
                {submission.status.replace(/_/g, " ")}
              </Badge>
            )}
            {submission.custody === "seller" && (
              <Badge tone="info">Seller holds it</Badge>
            )}
          </div>
          <p className="font-mono text-[10px] tracking-tight text-muted">
            {submission.sku.colorway} · US {submission.sku.size_us} · item{" "}
            {submission.id}
          </p>
          <p className="font-mono text-[10px] tracking-tight text-muted">
            Submitted {formatTimestamp(submission.created_at)}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1 border border-line bg-raised px-3 py-2 text-right">
          <p className="font-mono text-[10px] uppercase tracking-tight text-muted">
            Asking
          </p>
          <p className="font-mono text-xl tabular-nums">
            {formatCents(submission.asking_price_cents)}
          </p>
          <p className="font-mono text-[10px] tracking-tight text-muted">
            paid as {submission.submitted_payout} · SKU oracle{" "}
            {formatCents(submission.sku.market_price_cents)}
          </p>
        </div>
      </header>

      {seller?.is_restricted && (
        <p className="border border-[#FF4444] bg-overlay p-2 font-mono text-[11px] leading-snug tracking-tight text-[#FF4444]">
          {seller.handle} is restricted. Whatever put them there has not been
          lifted — read the seller record below before approving anything of
          theirs.
        </p>
      )}

      {photos.length < 8 && (
        <p className="border border-[#E8B33A] bg-overlay p-2 font-mono text-[10px] leading-snug tracking-tight text-[#E8B33A]">
          {photos.length}/8 photos. These are the only evidence for a grade
          nobody at FlexSoar has checked in person — a short set is a reason to
          ask for more, not to approve around.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <PhotoViewer photos={photos} />
        <div className="flex flex-col gap-4">
          <DeclaredGrade
            grade={submission.grade}
            storedFloat={submission.float_value}
            declared={submission.grade_source === "seller_declared"}
          />
          <ArtUploader
            skuId={submission.sku.id}
            currentArtUrl={submission.sku.art_url}
          />
          <DecisionControls
            itemId={submission.id}
            itemLabel={itemLabel}
            askingPriceCents={submission.asking_price_cents}
            marketPriceCents={submission.sku.market_price_cents}
            blocked={blocked}
          />
        </div>
      </div>

      {submission.grading_notes && (
        <div className="border border-line bg-raised p-3">
          <p className="font-mono text-[10px] uppercase tracking-tight text-muted">
            Notes on record
          </p>
          <p className="font-mono text-[11px] leading-snug tracking-tight whitespace-pre-wrap">
            {submission.grading_notes}
          </p>
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-[13px] uppercase tracking-tight">
          Seller record
        </h2>

        {!seller ? (
          <p className="border border-dashed border-line-strong bg-raised p-3 font-mono text-[11px] leading-snug tracking-tight text-muted">
            No seller row is readable for this submission. An item with no
            consignor cannot be approved into anyone&apos;s name.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 border border-line bg-raised p-3">
              <span className="font-mono text-[13px] tracking-tight">
                {seller.handle}
              </span>
              <span className="font-mono text-[10px] tracking-tight text-muted">
                L{seller.level}
              </span>
              <span className="font-mono text-[11px] tracking-tight">
                {seller.fulfilments_completed} fulfilment
                {seller.fulfilments_completed === 1 ? "" : "s"} completed
              </span>
              {seller.defaults_count > 0 ? (
                <Badge tone="danger">
                  {seller.defaults_count} default
                  {seller.defaults_count === 1 ? "" : "s"}
                </Badge>
              ) : (
                <Badge tone="accent">No defaults</Badge>
              )}
              {seller.is_restricted && <Badge tone="danger">Restricted</Badge>}
            </div>

            {seller.recent.length === 0 ? (
              <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
                Nothing else submitted. This is their first.
              </p>
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>Earlier submission</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Asked</Th>
                    <Th>Submitted</Th>
                  </Tr>
                </THead>
                <TBody>
                  {seller.recent.map((row) => (
                    <Tr key={row.id}>
                      <Td>
                        <span className="text-foreground">
                          {row.brand} {row.model}
                        </span>
                        <span className="text-muted"> · US {row.size_us}</span>
                      </Td>
                      <Td className="text-muted">
                        {row.status.replace(/_/g, " ")}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {formatCents(row.asking_price_cents)}
                      </Td>
                      <Td className="text-muted tabular-nums">
                        {formatTimestamp(row.created_at)}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </>
        )}
      </section>
    </main>
  );
}
