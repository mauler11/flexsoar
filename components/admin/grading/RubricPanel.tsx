/**
 * components/admin/grading/RubricPanel.tsx
 *
 * The grading panel. Six component scores in, one float out.
 *
 * THE FLOAT IS NOT AN INPUT. The grader types the six components; the float is
 * the weighted sum of them, computed live and shown read-only. There is no
 * field for it, nothing here suggests a component score, and no default is
 * pre-filled — rubric §1: "Do not decide the float first and reverse-engineer
 * components to justify it." The total stays blank until all six are scored,
 * for the same reason.
 *
 * The preview uses rubric.ts (integer maths, client-safe). The float that is
 * SAVED is derived server-side by the contract's gradeFloatFromComponents(),
 * and 008's items_grade_components_sum constraint rejects anything that is
 * not the weighted sum — so the number on screen either matches what mints or
 * the save fails loudly. GRADE_COMPONENTS_MISMATCH and
 * GRADE_COMPONENTS_INCOMPLETE get a sentence of context; the server's own
 * message is always shown verbatim.
 *
 * THE BAND CHECK WARNS, IT DOES NOT BLOCK. The grader picks the band the shoe
 * obviously belongs to off the anchors; if the computed float lands somewhere
 * else, that is a signal a component is wrong — rubric §2 says go back and find
 * it, never adjust the total. So the mismatch is loud and nothing is disabled
 * by it.
 *
 * components/ui has no textarea, so the notes field is styled inline to match
 * Input rather than added to the shared set. Noted in docs/handoff/admin.md.
 */
"use client";

import { useState, useTransition } from "react";
import { gradeItemAction } from "@/app/admin/grading/actions";
import type { ActionResult } from "@/components/admin/action-result";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import type { GradeComponents } from "@/lib/api/contract";
import type { UUID } from "@/lib/db/types";
import {
  BAND_ANCHORS,
  RUBRIC_COMPONENTS,
  RUBRIC_VERSION,
  bandAnchor,
  bandForFloatMilli,
  computeFloatMilli,
  contributionTenThousandths,
  formatBandRange,
  formatContribution4,
  formatFloat3,
  parseComponentScore,
  type BandId,
  type ComponentId,
  type ComponentScores,
} from "./rubric";

export interface RubricPanelProps {
  itemId: UUID;
  /** The stored grade, when re-opening an already-graded item. */
  initialGrade?: GradeComponents | null;
  initialNotes?: string | null;
  /** Blocks saving with the reason shown on the button (e.g. already minted). */
  saveBlocked?: string | null;
}

type ScoreDraft = Record<ComponentId, string>;

function draftFrom(grade: GradeComponents | null | undefined): ScoreDraft {
  const draft = {} as ScoreDraft;
  for (const component of RUBRIC_COMPONENTS) {
    const value = grade?.[component.id];
    draft[component.id] = value == null ? "" : Number(value).toFixed(2);
  }
  return draft;
}

/** A sentence of context per constraint, ADDED to the verbatim message. */
function constraintContext(result: ActionResult & { ok: false }): string | null {
  switch (result.code) {
    case "GRADE_COMPONENTS_MISMATCH":
      return (
        "The database recomputed the weighted sum and got a different float " +
        "than the one sent. The float here is derived from the components " +
        "server-side (contract helper, exact integer arithmetic matching the " +
        "008 numeric rounding), so this points at drift between the contract " +
        "and 008 — re-save once, and if it persists, file it."
      );
    case "GRADE_COMPONENTS_INCOMPLETE":
      return (
        "The database got a partial set of component scores. It is all six " +
        "or none — there is no partial grade."
      );
    default:
      return null;
  }
}

export function RubricPanel({
  itemId,
  initialGrade,
  initialNotes,
  saveBlocked,
}: RubricPanelProps) {
  const [draft, setDraft] = useState<ScoreDraft>(() => draftFrom(initialGrade));
  const [expectedBand, setExpectedBand] = useState<BandId | "">("");
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  // ---- derived: parse, then compute. Never the other way round. ----

  const parsed = RUBRIC_COMPONENTS.map((component) => ({
    component,
    raw: draft[component.id],
    result: parseComponentScore(draft[component.id]),
  }));

  const scores: ComponentScores | null = parsed.every((p) => p.result.ok)
    ? (Object.fromEntries(
        parsed.map((p) => [
          p.component.id,
          p.result.ok ? p.result.hundredths : 0,
        ]),
      ) as ComponentScores)
    : null;

  const floatMilli = scores ? computeFloatMilli(scores) : null;
  const computedBand = floatMilli === null ? null : bandForFloatMilli(floatMilli);
  const expected = expectedBand === "" ? null : bandAnchor(expectedBand);
  const mismatch =
    computedBand !== null && expected !== null && computedBand.id !== expected.id;

  function setScore(id: ComponentId, value: string) {
    setDraft((current) => ({ ...current, [id]: value }));
    setResult(null);
  }

  function save() {
    if (!scores || saveBlocked) return;
    // Hundredths back to the 0.00–1.00 numbers the contract takes.
    const components = Object.fromEntries(
      RUBRIC_COMPONENTS.map((c) => [c.id, scores[c.id] / 100]),
    ) as unknown as GradeComponents;

    startTransition(async () => {
      setResult(await gradeItemAction({ itemId, components, notes }));
    });
  }

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      {/* ---------------- left: the six components ---------------- */}
      <div className="flex flex-col gap-3">
        <header className="flex items-baseline justify-between gap-2">
          <h2 className="font-mono text-[13px] uppercase tracking-tight">
            Score the six components
          </h2>
          <span className="font-mono text-[10px] tracking-tight text-muted">
            rubric {RUBRIC_VERSION} · docs/GRADING_RUBRIC.md
          </span>
        </header>

        <ul className="flex flex-col gap-2">
          {parsed.map(({ component, raw, result: parse }) => {
            const inputId = `score-${component.id}`;
            const anchorsId = `${inputId}-anchors`;
            const error = raw.trim() !== "" && !parse.ok ? parse.error : null;
            const contribution = parse.ok
              ? contributionTenThousandths(parse.hundredths, component.weightPercent)
              : null;

            return (
              <li
                key={component.id}
                className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3 border border-line bg-raised p-2"
              >
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor={inputId}
                    className="font-mono text-[11px] uppercase tracking-tight"
                  >
                    {component.label}{" "}
                    <span className="text-muted">({component.weightPercent}%)</span>
                  </label>
                  <div
                    id={anchorsId}
                    className="font-mono text-[10px] leading-snug tracking-tight text-muted"
                  >
                    <p>
                      <span className="text-foreground">0.00</span> {component.zero}
                    </p>
                    <p>
                      <span className="text-foreground">1.00</span> {component.one}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1">
                  <Input
                    id={inputId}
                    value={raw}
                    onChange={(event) => setScore(component.id, event.target.value)}
                    error={error}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    disabled={pending}
                    aria-describedby={
                      error ? `${anchorsId} ${inputId}-error` : anchorsId
                    }
                    className="w-full text-right"
                  />
                  <span className="font-mono text-[10px] tracking-tight text-muted">
                    {contribution === null
                      ? `× ${component.weightPercent}%`
                      : `× ${component.weightPercent}% = ${formatContribution4(contribution)}`}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>

        {/* ---------------- the computed float ---------------- */}
        <div className="flex flex-col gap-2 border border-line-strong bg-overlay p-3 pixel-shadow-sm">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-tight text-muted">
              Computed float
            </span>
            {computedBand && (
              <Badge tone={mismatch ? "warn" : "accent"}>{computedBand.label}</Badge>
            )}
          </div>

          <output
            htmlFor={RUBRIC_COMPONENTS.map((c) => `score-${c.id}`).join(" ")}
            className="font-mono text-3xl tracking-tight tabular-nums"
          >
            {floatMilli === null ? (
              <span className="text-muted">—.———</span>
            ) : (
              formatFloat3(floatMilli)
            )}
          </output>

          {floatMilli === null ? (
            <p className="font-mono text-[10px] tracking-tight text-muted">
              Score all six components. The total appears once they are all in —
              never decide it first.
            </p>
          ) : (
            <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
              {parsed
                .map((p) =>
                  formatContribution4(
                    contributionTenThousandths(
                      p.result.ok ? p.result.hundredths : 0,
                      p.component.weightPercent,
                    ),
                  ),
                )
                .join(" + ")}{" "}
              = {formatFloat3(floatMilli)}
            </p>
          )}
          <p className="font-mono text-[10px] tracking-tight text-muted">
            Weighted sum, rounded to 3 decimals. Not typable — change a component
            to change it. The database rejects any float that is not this sum.
          </p>
        </div>

        {/* ---------------- the sanity check ---------------- */}
        <div className="flex flex-col gap-2">
          <Select
            label="Band from the anchors"
            id="expected-band"
            value={expectedBand}
            onChange={(event) => setExpectedBand(event.target.value as BandId | "")}
            options={[
              { value: "", label: "— which band does this shoe obviously sit in? —" },
              ...BAND_ANCHORS.map((anchor) => ({
                value: anchor.id,
                label: `${anchor.label}  ${formatBandRange(anchor)}`,
              })),
            ]}
          />

          <div aria-live="polite">
            {mismatch && computedBand && expected && (
              <div className="flex flex-col gap-1 border border-[#E8B33A] bg-overlay p-2">
                <p className="font-mono text-[11px] uppercase tracking-tight text-[#E8B33A]">
                  Band mismatch — not a blocker
                </p>
                <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
                  The components compute to {formatFloat3(floatMilli ?? 0)}, which
                  is {computedBand.label} ({formatBandRange(computedBand)}). You
                  read the shoe as {expected.label} ({formatBandRange(expected)}).
                  One of the six scores is wrong — go back and find it. Do not
                  adjust the total.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ---------------- notes ---------------- */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="grading-notes"
            className="font-mono text-[10px] uppercase tracking-tight text-muted"
          >
            Grading notes
          </label>
          <textarea
            id="grading-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={3}
            disabled={pending}
            placeholder="Restoration, odd wear, anything a dispute would need."
            className="border border-line-strong bg-overlay px-2 py-1.5 font-mono text-[13px] tracking-tight text-foreground placeholder:text-muted/50 pixel-shadow-sm hover:border-muted disabled:cursor-not-allowed disabled:opacity-40"
          />
        </div>

        {/* ---------------- save ---------------- */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={save}
              disabled={pending || !scores || Boolean(saveBlocked)}
              title={saveBlocked ?? undefined}
            >
              {pending ? "Saving…" : initialGrade ? "Re-save grade" : "Save grade"}
            </Button>
            <span className="font-mono text-[10px] tracking-tight text-muted">
              {saveBlocked ??
                (scores
                  ? "Writes the six components and their weighted sum."
                  : "All six components required.")}
            </span>
          </div>

          <div aria-live="polite">
            {result?.ok && (
              <p className="border border-accent bg-overlay p-2 font-mono text-[11px] tracking-tight text-accent">
                Grade saved.
              </p>
            )}
            {result && !result.ok && (
              <div className="flex flex-col gap-1 border border-[#FF4444] bg-overlay p-2">
                <p className="font-mono text-[10px] uppercase tracking-tight text-[#FF4444]">
                  Save failed{result.code ? ` — ${result.code}` : ""}
                </p>
                <p className="font-mono text-[11px] leading-snug tracking-tight text-foreground">
                  {result.message}
                </p>
                {constraintContext(result) && (
                  <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
                    {constraintContext(result)}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---------------- right: the band anchors ---------------- */}
      <aside className="flex flex-col gap-2">
        <h2 className="font-mono text-[13px] uppercase tracking-tight">
          Band anchors
        </h2>
        <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
          Reference only. The float lands where the components put it; the
          anchors tell you whether to go back and re-check one.
        </p>
        <Table>
          <THead>
            <Tr>
              <Th>Band</Th>
              <Th>Range</Th>
              <Th>What it looks like</Th>
            </Tr>
          </THead>
          <TBody>
            {BAND_ANCHORS.map((anchor) => {
              const isComputed = computedBand?.id === anchor.id;
              return (
                <Tr
                  key={anchor.id}
                  className={
                    isComputed ? "border-l-2 border-l-accent bg-overlay" : undefined
                  }
                >
                  <Td className="whitespace-nowrap">
                    {anchor.label}
                    {isComputed && (
                      <span className="sr-only"> — the computed float lands here</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap tabular-nums text-muted">
                    {formatBandRange(anchor)}
                  </Td>
                  <Td className="text-muted">{anchor.look}</Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </aside>
    </section>
  );
}
