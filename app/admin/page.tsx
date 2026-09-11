/**
 * app/admin/page.tsx
 *
 * Admin home: one card per work queue. Every admin page links back here
 * through the shared layout shell, so no section is a dead end.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/components/admin/auth";

export const metadata: Metadata = {
  title: "Admin — FlexSoar",
};

const SECTIONS: ReadonlyArray<{
  href: string;
  title: string;
  body: string;
}> = [
  {
    href: "/admin/submissions",
    title: "Submissions",
    body: "Review seller submissions — grade, price, approve or reject.",
  },
  {
    href: "/admin/grading",
    title: "Grading",
    body: "Grade queue and individual item grading sessions.",
  },
  {
    href: "/admin/mint",
    title: "Mint",
    body: "Mint approved items into cards.",
  },
  {
    href: "/admin/consignments",
    title: "Consignments",
    body: "Track consignments through intake to completion.",
  },
  {
    href: "/admin/fulfilment",
    title: "Fulfilment",
    body: "Redemptions, shipments, vault intake and defaults.",
  },
  {
    href: "/admin/skus",
    title: "SKUs",
    body: "Catalog models, variants, oracle prices and art.",
  },
  {
    href: "/admin/requests",
    title: "Requests",
    body: "Seller product requests waiting for a model decision.",
  },
];

export default async function AdminHomePage() {
  await requireAdminPage("/admin");

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Admin</h1>
        <p className="mt-1 text-sm text-muted">
          Every queue, one screen. Pick where the work is.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="flex flex-col gap-1 rounded-2xl border border-line bg-raised p-4 transition hover:border-line-strong hover:shadow-soft"
          >
            <span className="text-base font-extrabold tracking-tight">
              {section.title}
            </span>
            <span className="text-[13px] leading-snug text-muted">
              {section.body}
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
