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

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/Table";
import {
  BAND_ANCHORS,
  RUBRIC_COMPONENTS,
  RUBRIC_VERSION,
  bandAnchor,
  bandForFloatMilli,
  buildGradingNotes,
  computeFloatMilli,
  contributionTenThousandths,
  formatBandRange,
  formatContribution4,
  formatFloat3,
  parseComponentScore,
  parseGradingNotes,
  type BandId,
  type ComponentId,
  type ComponentScores,
} from "./rubric";

export interface RubricPanelProps {
  /**
   * Existing `items.grading_notes`, when re-opening an item that has already
   * been graded. A payload written by this panel repopulates every field;
   * anything else (prose from before the rubric) is left alone.
   */
  initialGradingNotes?: string | null;
}

type ScoreDraft = Record<ComponentId, string>;

function emptyDraft(): ScoreDraft {
  const draft = {} as ScoreDraft;
  for (const component of RUBRIC_COMPONENTS) draft[component.id] = "";
  return draft;
}

export function RubricPanel({ initialGradingNotes }: RubricPanelProps) {
  const restored = useMemo(
    () => parseGradingNotes(initialGradingNotes),
    [initialGradingNotes],
  );

  const [draft, setDraft] = useState<ScoreDraft>(() => {
    if (!restored) return emptyDraft();
    const seeded = emptyDraft();
    for (const component of RUBRIC_COMPONENTS) {
      seeded[component.id] = restored.components[component.id];
    }
    return seeded;
  });
  const [expectedBand, setExpectedBand] = useState<BandId | "">(
    () => restored?.expected_band ?? "",
  );
  const [notes, setNotes] = useState(() => restored?.notes ?? "");

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

  const gradingNotes =
    scores === null
      ? null
      : buildGradingNotes({
          scores,
          expectedBand: expectedBand === "" ? null : expectedBand,
          notes,
        });

  function setScore(id: ComponentId, value: string) {
    setDraft((current) => ({ ...current, [id]: value }));
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
          {parsed.map(({ component, raw, result }) => {
            const inputId = `score-${component.id}`;
            const anchorsId = `${inputId}-anchors`;
            const error = raw.trim() !== "" && !result.ok ? result.error : null;
            const contribution = result.ok
              ? contributionTenThousandths(result.hundredths, component.weightPercent)
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
            to change it.
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
            placeholder="Restoration, odd wear, anything a dispute would need."
            className="border border-line-strong bg-overlay px-2 py-1.5 font-mono text-[13px] tracking-tight text-foreground placeholder:text-muted/50 pixel-shadow-sm hover:border-muted"
          />
        </div>

        {/* ---------------- what gets stored ---------------- */}
        <div className="flex flex-col gap-2 border border-line bg-raised p-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-tight text-muted">
              items.grading_notes
            </span>
            <span className="font-mono text-[10px] tracking-tight text-muted">
              components ride in the JSON until they get columns
            </span>
          </div>
          <pre className="max-h-64 overflow-auto border border-line bg-overlay p-2 font-mono text-[10px] leading-snug tracking-tight text-muted">
            {gradingNotes ?? "// all six components required"}
          </pre>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled title="gradeItem() is not in this worktree yet">
              Save grade
            </Button>
            <span className="font-mono text-[10px] tracking-tight text-muted">
              gradeItem() landed on main in 008 but this branch has not been
              rebased onto it — see docs/handoff/admin.md.
            </span>
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
