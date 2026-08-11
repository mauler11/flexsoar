/**
 * app/admin/grading/page.tsx
 *
 * The grading screen. Right now it hosts the rubric panel and nothing else:
 * the queue of received items, the photo viewer and the authenticate toggle
 * need `getItems()` and `gradeItem()`, which landed on main in 008 and are not
 * in this worktree — see docs/handoff/admin.md.
 *
 * The middleware /admin gate is optimistic and does not run on Server Action
 * invocations from an already-loaded page, so `is_admin` is re-checked here
 * (docs/HANDOFF-shared.md item 7). This turns a raw Postgres FORBIDDEN into a 404.
 */

import type { Metadata } from "next";
import { requireAdminPage } from "@/components/admin/auth";
import { RubricPanel } from "@/components/admin/grading/RubricPanel";

export const metadata: Metadata = {
  title: "Grading — FlexSoar admin",
};

export default async function GradingPage() {
  await requireAdminPage("/admin/grading");

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-mono text-lg uppercase tracking-tight">Grading</h1>
        <p className="font-mono text-[11px] leading-snug tracking-tight text-muted">
          The float is the product. Grade what is in front of you, under the same
          lamp every time, and take the worse score when you are torn.
        </p>
      </header>

      <RubricPanel />
    </main>
  );
}
