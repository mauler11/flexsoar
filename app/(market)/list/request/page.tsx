/**
 * app/(market)/list/request/page.tsx
 *
 * Product Request: the no-result path from the sell search. Sellers describe
 * the shoe and upload proof photos; the row waits in the admin queue
 * (/admin/requests) until approved (model + variant created, listable
 * immediately) or rejected with a note. Both outcomes notify the requester.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { SkuRequestForm } from "@/components/market/SkuRequestForm";

export const metadata: Metadata = {
  title: "Request a product — FlexSoar Market",
};

export default function RequestProductPage() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-4">
      <Link
        href="/list"
        className="w-fit text-[13px] font-semibold text-muted hover:text-foreground"
      >
        ← Back to search
      </Link>
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">
          Request a product
        </h1>
        <p className="mt-1 text-sm text-muted">
          Can&apos;t find your shoe? Tell us what it is with photos. Approved
          requests join the catalog — usually within a day.
        </p>
      </div>
      <SkuRequestForm />
    </div>
  );
}
