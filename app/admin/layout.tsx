/**
 * app/admin/layout.tsx
 *
 * Shared admin chrome: every admin page gets a top bar with Admin home on
 * the left and a way back to the market on the right. Previously each page
 * rendered bare with no navigation — dead ends unless you retyped the URL.
 * Pages keep their own requireAdminPage() guards; this shell is chrome only.
 */
import Link from "next/link";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-overlay">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
          <Link
            href="/admin"
            className="text-sm font-extrabold uppercase tracking-tight text-accent hover:brightness-110"
          >
            ← Admin
          </Link>
          <Link
            href="/market"
            className="text-xs text-muted hover:text-foreground"
          >
            Back to Market
          </Link>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
