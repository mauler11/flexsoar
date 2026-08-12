/**
 * app/admin/grading/[itemId]/page.tsx
 *
 * One item on the bench: the photo set, the rubric panel, and the
 * authenticate / reject controls.
 *
 * The item comes from getItem() on the contract, which since the 010-era
 * sync carries consignment_id/consignor_id — the getAdminItem() local adapter
 * it replaced is gone.
 *
 * A minted item is shown but everything is blocked: the card carries an
 * immutable copy of the float, and 008 refuses re-grading and rejection at
 * the database. The blocks here just say so before the click instead of
 * after.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPage } from "@/components/admin/auth";
import { ItemActions } from "@/components/admin/grading/ItemActions";
import { PhotoUploader } from "@/components/admin/grading/PhotoUploader";
import { PhotoViewer } from "@/components/admin/grading/PhotoViewer";
import { RubricPanel } from "@/components/admin/grading/RubricPanel";
import { toPhotoList } from "@/components/admin/grading/photos";
import { getItem } from "@/lib/api/contract";
import { Badge } from "@/components/ui/Badge";

export const metadata: Metadata = {
  title: "Grade item — FlexSoar admin",
};

export default async function GradeItemPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { itemId } = await params;
  await requireAdminPage(`/admin/grading/${itemId}`);

  const item = await getItem(itemId);
  if (!item) notFound();

  const photos = toPhotoList(item.photos);

  // Why saving might be off. 008 enforces all of this in the database; the
  // strings exist so the button says it before the constraint does.
  const saveBlocked = item.card_id
    ? "This item is minted — its float is immutable."
    : item.status !== "pending_intake" && item.status !== "in_custody"
      ? `This item is ${item.status.replace(/_/g, " ")} and cannot be graded.`
      : null;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <nav className="font-mono text-[10px] uppercase tracking-tight text-muted">
        <Link href="/admin/grading" className="hover:text-foreground">
          ← Grading queue
        </Link>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-lg uppercase tracking-tight">
              {item.sku.brand} {item.sku.model}
            </h1>
            {item.card_id && <Badge tone="info">Minted</Badge>}
            {item.status === "returned_to_consignor" && (
              <Badge tone="danger">Rejected</Badge>
            )}
          </div>
          <p className="font-mono text-[10px] tracking-tight text-muted">
            {item.sku.colorway} · US {item.sku.size_us} · item {item.id}
          </p>
          {item.consignment_id && (
            <Link
              href={`/admin/consignments/${item.consignment_id}`}
              className="font-mono text-[10px] uppercase tracking-tight text-accent underline-offset-2 hover:underline"
            >
              View consignment →
            </Link>
          )}
        </div>
        {item.float_value != null && (
          <div className="border border-line bg-raised px-3 py-2 text-right">
            <p className="font-mono text-[10px] uppercase tracking-tight text-muted">
              Stored float
            </p>
            <p className="font-mono text-xl tabular-nums">
              {Number(item.float_value).toFixed(3)}
            </p>
          </div>
        )}
      </header>

      {photos.length < 8 && (
        <p className="border border-[#E8B33A] bg-overlay p-2 font-mono text-[10px] leading-snug tracking-tight text-[#E8B33A]">
          {photos.length}/8 photos. The rubric requires the full 8-shot set
          before a float is entered — plus close-ups of any component scored
          above 0.30.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <PhotoViewer photos={photos} />
        <div className="flex flex-col gap-4">
          <PhotoUploader itemId={item.id} blocked={saveBlocked} />
          <ItemActions
            itemId={item.id}
            authenticatedAt={item.authenticated_at}
            custodyLocation={item.custody_location}
            blocked={saveBlocked}
          />
        </div>
      </div>

      {item.grading_notes && (
        <div className="border border-line bg-raised p-3">
          <p className="font-mono text-[10px] uppercase tracking-tight text-muted">
            Notes on record
          </p>
          <p className="font-mono text-[11px] leading-snug tracking-tight whitespace-pre-wrap">
            {item.grading_notes}
          </p>
        </div>
      )}

      <RubricPanel
        itemId={item.id}
        initialGrade={item.grade}
        initialNotes={item.grading_notes}
        saveBlocked={saveBlocked}
      />
    </main>
  );
}
