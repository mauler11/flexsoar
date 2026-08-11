/**
 * components/admin/consignments/transitions.ts
 *
 * The consignment state machine, mirrored from the CASE block in
 * `fn_advance_consignment` — 005_admin_guards.sql, which redefined the 002
 * original. Copied edge for edge, not inferred from the status names:
 *
 *   draft          -> submitted
 *   submitted      -> in_transit | draft
 *   in_transit     -> received
 *   received       -> authenticating
 *   authenticating -> authenticated | rejected
 *   authenticated  -> completed
 *   rejected       -> return_pending
 *   return_pending -> returned
 *   returned       -> (terminal)
 *   completed      -> (terminal)
 *
 * THIS IS UX, NOT ENFORCEMENT. The database raises
 * `illegal consignment transition x -> y` regardless of what the UI offers;
 * this table exists so the operator sees three buttons instead of ten, eight of
 * which would fail. If the two ever disagree the SQL is right and this file is
 * a bug — the screen still cannot do damage, it just lies about what it can do.
 */

import type { BadgeTone } from "@/components/ui/Badge";
import type { ConsignmentStatus } from "@/lib/db/types";

export const ALLOWED_TRANSITIONS: Readonly<
  Record<ConsignmentStatus, readonly ConsignmentStatus[]>
> = {
  draft: ["submitted"],
  submitted: ["in_transit", "draft"],
  in_transit: ["received"],
  received: ["authenticating"],
  authenticating: ["authenticated", "rejected"],
  authenticated: ["completed"],
  rejected: ["return_pending"],
  return_pending: ["returned"],
  returned: [],
  completed: [],
};

/** Every status, in pipeline order. The happy path first, then the return arm. */
export const STATUS_ORDER: readonly ConsignmentStatus[] = [
  "draft",
  "submitted",
  "in_transit",
  "received",
  "authenticating",
  "authenticated",
  "completed",
  "rejected",
  "return_pending",
  "returned",
];

export const STATUS_LABELS: Readonly<Record<ConsignmentStatus, string>> = {
  draft: "Draft",
  submitted: "Submitted",
  in_transit: "In transit",
  received: "Received",
  authenticating: "Authenticating",
  authenticated: "Authenticated",
  rejected: "Rejected",
  return_pending: "Return pending",
  returned: "Returned",
  completed: "Completed",
};

export function statusLabel(status: ConsignmentStatus): string {
  return STATUS_LABELS[status];
}

export function allowedTransitions(
  from: ConsignmentStatus,
): readonly ConsignmentStatus[] {
  return ALLOWED_TRANSITIONS[from] ?? [];
}

export function isAllowedTransition(
  from: ConsignmentStatus,
  to: ConsignmentStatus,
): boolean {
  return allowedTransitions(from).includes(to);
}

/** No outgoing edges. Nothing moves a consignment out of these. */
export function isTerminal(status: ConsignmentStatus): boolean {
  return allowedTransitions(status).length === 0;
}

/**
 * Which edges get the loud confirm.
 *
 * `rejected` sends the consignment down the return arm with no way back, and
 * the terminal states end it. `submitted -> draft` is the one genuine undo in
 * the machine, so it is confirmed like the rest but not styled as danger —
 * every transition writes an append-only `consignment_events` row that no
 * screen can delete, which is reason enough to ask first.
 */
export function isDestructive(to: ConsignmentStatus): boolean {
  return to === "rejected" || isTerminal(to);
}

/** Happy path blue, done green, the return arm amber, the rejection red. */
export function statusTone(status: ConsignmentStatus): BadgeTone {
  if (status === "rejected") return "danger";
  if (status === "return_pending" || status === "returned") return "warn";
  if (status === "completed") return "accent";
  if (status === "draft") return "neutral";
  return "info";
}
