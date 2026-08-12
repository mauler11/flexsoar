"use client";

/**
 * components/market/intake/ConditionWizard.tsx
 *
 * Step 3 of the intake wizard: the six plain-language condition questions.
 * Each answer maps to a rubric component score; all six together produce the
 * self-declared float, previewed LIVE in the amber SelfDeclaredCondition panel
 * beside the questions — visually unmistakable from a FlexSoar grade.
 *
 * State is lifted to the wizard so the float survives step changes.
 */

import {
  CONDITION_QUESTIONS,
  type ConditionQuestion,
} from "@/components/market/intake/intake-config";
import type { GradeComponents } from "@/lib/db/grading";
import { SelfDeclaredCondition } from "@/components/market/intake/SelfDeclaredCondition";

export interface ConditionWizardProps {
  answers: Partial<GradeComponents>;
  onChange: (answers: Partial<GradeComponents>) => void;
}

export function ConditionWizard({ answers, onChange }: ConditionWizardProps) {
  const complete = CONDITION_QUESTIONS.every((q) => answers[q.key] != null);
  const components: GradeComponents | null = complete ? (answers as GradeComponents) : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <ol className="flex flex-col gap-3">
        {CONDITION_QUESTIONS.map((q, i) => (
          <QuestionRow
            key={q.key}
            index={i}
            question={q}
            value={answers[q.key] ?? null}
            onPick={(score) => onChange({ ...answers, [q.key]: score })}
          />
        ))}
      </ol>

      <div className="lg:sticky lg:top-4 lg:self-start">
        <SelfDeclaredCondition components={components} />
      </div>
    </div>
  );
}

function QuestionRow({
  index,
  question,
  value,
  onPick,
}: {
  index: number;
  question: ConditionQuestion;
  value: number | null;
  onPick: (score: number) => void;
}) {
  return (
    <li className="flex flex-col gap-1.5 border border-line-strong bg-overlay p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="font-mono text-[11px] font-bold uppercase tracking-tight text-foreground">
          {index + 1}. {question.question}
        </h4>
      </div>
      <p className="font-mono text-[10px] tracking-tight text-muted">
        {question.hint}
      </p>
      <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {question.options.map((option) => {
          const active = value === option.score;
          return (
            <button
              key={option.label}
              type="button"
              aria-pressed={active}
              onClick={() => onPick(option.score)}
              className={
                "border px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-tight transition-colors " +
                (active
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-line-strong bg-raised text-muted hover:border-muted hover:text-foreground")
              }
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </li>
  );
}