/**
 * app/admin/requests/page.tsx
 *
 * Product request queue (044): pending rows first, then recently decided.
 * Approve creates the model + size variant (listable immediately) and
 * notifies the requester; reject records a note and notifies too.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/components/admin/auth";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { createServerSupabase } from "@/lib/supabase/server";
import type { SkuRequest } from "@/lib/db/types";
import { ReviewButtons } from "@/app/admin/requests/ReviewButtons";

export const metadata: Metadata = {
  title: "Product requests — FlexSoar admin",
};

export default async function RequestsPage() {
  await requireAdminPage("/admin/requests");

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("sku_requests")
    .select(
      "id, requester_id, brand, model, colorway, size_us, notes, photos, status, reviewed_at, review_note, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    throw new Error(`could not load requests: ${error.message}`);
  }

  const rows = ((data ?? []) as unknown as SkuRequest[]).sort((a, b) => {
    const rank = (s: string) => (s === "pending" ? 0 : 1);
    return rank(a.status) - rank(b.status);
  });
  const pendingCount = rows.filter((r) => r.status === "pending").length;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-mono text-lg uppercase tracking-tight">
            Product requests
          </h1>
          <p className="font-mono text-[11px] leading-snug tracking-tight text-muted">
            {pendingCount} pending. Approve creates the model + size variant;
            the requester is notified either way.
          </p>
        </div>
        <Link
          href="/admin/skus"
          className="font-mono text-[11px] tracking-tight text-muted hover:text-foreground"
        >
          ← Models
        </Link>
      </header>

      {rows.length === 0 ? (
        <EmptyState
          title="No requests"
          description="Sellers who can't find their shoe will land here."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-col gap-2 rounded-2xl border border-line bg-raised p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-extrabold tracking-tight">
                  {row.brand} {row.model}
                  {row.colorway ? ` · ${row.colorway}` : ""}
                  {row.size_us != null ? ` · US ${row.size_us}` : ""}
                </p>
                <Badge
                  tone={
                    row.status === "pending"
                      ? "warn"
                      : row.status === "approved"
                        ? "accent"
                        : "danger"
                  }
                >
                  {row.status}
                </Badge>
              </div>
              {row.notes && (
                <p className="text-[13px] text-muted">{row.notes}</p>
              )}
              <p className="text-xs text-muted">
                Requested {row.created_at.slice(0, 10)}
                {row.reviewed_at
                  ? ` · decided ${row.reviewed_at.slice(0, 10)}${row.review_note ? ` — ${row.review_note}` : ""}`
                  : ""}
              </p>
              {row.status === "pending" && (
                <ReviewButtons requestId={row.id} />
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
