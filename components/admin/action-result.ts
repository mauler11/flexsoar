/**
 * components/admin/action-result.ts
 *
 * What every admin Server Action returns, and how a thrown error becomes one.
 *
 * AGENT_RULES: "Surface server errors verbatim on failure. Never swallow one."
 * So `message` is the server's own words — a ContractError message, a Postgres
 * `raise exception` text — never a friendly rewrite. `code` is carried
 * alongside so a screen can *add* context for the codes it knows about, which
 * is addition, not replacement.
 *
 * Shared by client and server components, so it holds no imports that would
 * drag the contract into a client bundle. Types only, plus one pure function.
 */

import type { ContractErrorCode } from "@/lib/api/contract";

export type ActionResult =
  | { ok: true }
  | { ok: false; message: string; code?: ContractErrorCode };

/**
 * Normalises anything thrown inside an action into a result.
 *
 * ContractError carries a code worth branching on; everything else keeps its
 * message and nothing more. A non-Error throw is stringified rather than
 * reported as "something went wrong", because "something went wrong" has never
 * helped anyone grading a shoe at 2am.
 */
export function failure(thrown: unknown): ActionResult {
  if (thrown instanceof Error) {
    const code = (thrown as { code?: ContractErrorCode }).code;
    return code
      ? { ok: false, message: thrown.message, code }
      : { ok: false, message: thrown.message };
  }
  return { ok: false, message: String(thrown) };
}
