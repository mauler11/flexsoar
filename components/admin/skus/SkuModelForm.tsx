/**
 * components/admin/skus/SkuModelForm.tsx
 *
 * Create / edit one MODEL (027): brand + model + colourway, the oracle
 * base price, and the sprite base/palette every size variant inherits. This
 * replaces the old flat-SKU SkuForm.tsx — there is no per-size price or
 * palette any more, because there is no per-size art any more.
 *
 * Identity (brand/model/colorway) is settable only at creation. Once a model
 * exists, updateSkuModel()'s input has no brand/model/colorway field — 027
 * gives sku_models a unique index on the identity triple and leaves renaming
 * for a future merge tool (027_sku_models.sql's own follow-up list). So the
 * edit form shows identity read-only; there is no contract export to change
 * it, and reaching around that into a raw table write is exactly what
 * AGENT_RULES forbids.
 *
 * Saving confirms: base_price_cents sets the TIER of every future mint of
 * EVERY SIZE of this model (fn_tier_for_sku reads the model, not the
 * variant). Existing cards keep the tier they were minted with.
 */
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createSkuModelAction,
  updateSkuModelAction,
  type CreateSkuModelResult,
  type UpdateSkuModelResult,
} from "@/app/admin/skus/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { SkuModel } from "@/lib/db/types";
import { DEFAULT_PALETTE } from "@/lib/sprites";

/** The glyphs the shipped sprite maps resolve. */
const KNOWN_GLYPHS = new Set(Object.keys(DEFAULT_PALETTE));

interface Draft {
  brand: string;
  model: string;
  colorway: string;
  base_price_cents: string;
  price_confidence: string;
  sprite_key: string;
  palette: string;
}

function draftFrom(model: SkuModel | null): Draft {
  return {
    brand: model?.brand ?? "",
    model: model?.model ?? "",
    colorway: model?.colorway ?? "",
    base_price_cents:
      model?.base_price_cents == null ? "" : String(model.base_price_cents),
    price_confidence:
      model?.price_confidence == null ? "" : String(model.price_confidence),
    sprite_key: model?.sprite_key ?? "",
    palette: model?.palette == null ? "" : JSON.stringify(model.palette, null, 2),
  };
}

interface ParsedCommon {
  basePriceCents: number | null;
  priceConfidence: number | null;
  spriteKey: string | null;
  palette: Record<string, string> | null;
  paletteWarning: string | null;
}

type Parsed =
  | { ok: true; common: ParsedCommon; identity: { brand: string; model: string; colorway: string } | null }
  | { ok: false; errors: Partial<Record<keyof Draft, string>> };

function parseDraft(draft: Draft, isCreate: boolean): Parsed {
  const errors: Partial<Record<keyof Draft, string>> = {};

  if (isCreate) {
    if (!draft.brand.trim()) errors.brand = "required";
    if (!draft.model.trim()) errors.model = "required";
    if (!draft.colorway.trim()) errors.colorway = "required";
  }

  let basePriceCents: number | null = null;
  const priceText = draft.base_price_cents.trim();
  if (priceText !== "") {
    if (!/^\d+$/.test(priceText) || Number(priceText) <= 0) {
      errors.base_price_cents = "integer cents only, > 0 — 18999, never 189.99";
    } else {
      basePriceCents = Number(priceText);
    }
  }

  let priceConfidence: number | null = null;
  if (draft.price_confidence.trim() !== "") {
    priceConfidence = Number(draft.price_confidence);
    if (!/^\d(\.\d{1,2})?$/.test(draft.price_confidence.trim()) || priceConfidence > 1) {
      errors.price_confidence = "0.00 to 1.00";
      priceConfidence = null;
    }
  }

  let palette: Record<string, string> | null = null;
  let paletteWarning: string | null = null;
  if (draft.palette.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(draft.palette);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        errors.palette = "a JSON object of glyph -> #hex";
      } else {
        const entries = Object.entries(parsed);
        const bad = entries.find(
          ([, v]) => typeof v !== "string" || !/^#[0-9a-fA-F]{3,8}$/.test(v),
        );
        if (bad) {
          errors.palette = `"${bad[0]}" is not a #hex colour`;
        } else {
          palette = parsed as Record<string, string>;
          const unknown = entries.filter(([glyph]) => !KNOWN_GLYPHS.has(glyph));
          const missing = [...KNOWN_GLYPHS].filter(
            (glyph) => !(glyph in (parsed as object)),
          );
          const warnings = [
            unknown.length
              ? `keys not in the sprite maps (render nothing): ${unknown.map(([g]) => g).join(", ")}`
              : null,
            missing.length
              ? `glyphs left unmapped (render transparent): ${missing.join(", ")}`
              : null,
          ].filter(Boolean);
          paletteWarning = warnings.length ? warnings.join(" · ") : null;
        }
      }
    } catch {
      errors.palette = "not valid JSON";
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    common: {
      basePriceCents,
      priceConfidence,
      spriteKey: draft.sprite_key.trim() === "" ? null : draft.sprite_key.trim(),
      palette,
      paletteWarning,
    },
    identity: isCreate
      ? { brand: draft.brand.trim(), model: draft.model.trim(), colorway: draft.colorway.trim() }
      : null,
  };
}

export function SkuModelForm({ model }: { model: SkuModel | null }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(model));
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<CreateSkuModelResult | UpdateSkuModelResult | null>(null);
  const [pending, startTransition] = useTransition();

  const parsed = parseDraft(draft, model === null);
  const errors = parsed.ok ? {} : parsed.errors;

  function set<K extends keyof Draft>(key: K, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setResult(null);
  }

  function save() {
    if (!parsed.ok) return;
    startTransition(async () => {
      if (model) {
        const outcome = await updateSkuModelAction(model.id, {
          base_price_cents: parsed.common.basePriceCents,
          price_confidence: parsed.common.priceConfidence,
          sprite_key: parsed.common.spriteKey,
          palette: parsed.common.palette,
        });
        setResult(outcome);
        setConfirming(false);
        return;
      }

      const outcome = await createSkuModelAction({
        brand: parsed.identity!.brand,
        model: parsed.identity!.model,
        colorway: parsed.identity!.colorway,
        basePriceCents: parsed.common.basePriceCents,
      });
      setResult(outcome);
      setConfirming(false);
      if (outcome.ok) router.push(`/admin/skus/${outcome.modelId}`);
    });
  }

  const field = (key: keyof Draft) => ({
    value: draft[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => set(key, event.target.value),
    error: (errors as Partial<Record<keyof Draft, string>>)[key] ?? null,
    disabled: pending,
  });

  return (
    <div className="flex flex-col gap-3 border border-line bg-raised p-3">
      <h2 className="font-mono text-[13px] uppercase tracking-tight">
        {model ? "Model" : "New model"}
      </h2>

      {model ? (
        <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
          {model.brand} · {model.model} · {model.colorway} — identity is fixed
          after creation. There is no contract export to rename a model; a
          duplicate should be merged by a future tool, not by editing this one.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {model === null && (
          <>
            <Input label="Brand" {...field("brand")} />
            <Input label="Model" {...field("model")} />
            <Input label="Colorway" {...field("colorway")} />
          </>
        )}
        <Input
          label="Oracle price (cents)"
          inputMode="numeric"
          hint="Drives tier for FUTURE mints of every size. Empty = unpriced, unmintable."
          {...field("base_price_cents")}
        />
        {model !== null && (
          <>
            <Input
              label="Price confidence"
              inputMode="decimal"
              hint="0.00–1.00, optional."
              {...field("price_confidence")}
            />
            <Input
              label="Sprite key"
              hint="'low-top' or 'high-top' — the shipped base maps. Shared by every size."
              {...field("sprite_key")}
            />
          </>
        )}
      </div>

      {model !== null && (
        <div className="flex flex-col gap-1">
          <label
            htmlFor="model-palette"
            className="font-mono text-[10px] uppercase tracking-tight text-muted"
          >
            Palette JSON
          </label>
          <textarea
            id="model-palette"
            value={draft.palette}
            onChange={(event) => set("palette", event.target.value)}
            rows={6}
            disabled={pending}
            placeholder={`{ "D": "#1A1A1A", "C": "#9A9A9A", … } — the 9 glyphs are D C c B b W I i G`}
            className="border border-line-strong bg-overlay px-2 py-1.5 font-mono text-[12px] tracking-tight text-foreground placeholder:text-muted/50 pixel-shadow-sm hover:border-muted disabled:cursor-not-allowed disabled:opacity-40"
          />
          {"palette" in errors && (
            <p className="font-mono text-[10px] tracking-tight text-[#FF4444]">
              {(errors as Partial<Record<keyof Draft, string>>).palette}
            </p>
          )}
          {parsed.ok && parsed.common.paletteWarning && (
            <p className="font-mono text-[10px] leading-snug tracking-tight text-[#E8B33A]">
              Palette warning — saving anyway is allowed: {parsed.common.paletteWarning}
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => setConfirming(true)} disabled={pending || !parsed.ok}>
          {model ? "Save changes" : "Create model"}
        </Button>
        {!parsed.ok && (
          <span className="font-mono text-[10px] tracking-tight text-muted">
            Fix the marked fields first.
          </span>
        )}
      </div>

      <div aria-live="polite">
        {result?.ok && (
          <p className="border border-accent bg-overlay p-2 font-mono text-[11px] tracking-tight text-accent">
            Saved.
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
            {result.code === "FORBIDDEN" && (
              <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
                The row exists but this session was not allowed to write it —
                this session is not an admin (or lost it since sign-in);
                nothing was changed.
              </p>
            )}
            {result.code === "NOT_FOUND" && (
              <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
                No model with this id exists — it may have been deleted since
                this page loaded. Nothing was changed; go back to the catalog.
              </p>
            )}
            {result.code === "SKU_MODEL_IDENTITY_REQUIRED" && (
              <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
                Brand, model and colorway are all required to create a model.
              </p>
            )}
          </div>
        )}
      </div>

      <Modal
        open={confirming}
        onClose={() => !pending && setConfirming(false)}
        title={model ? "Save model changes" : "Create model"}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Confirm save"}
            </Button>
          </>
        }
      >
        <p className="font-mono text-[11px] leading-snug tracking-tight">
          {model
            ? "The oracle price sets the tier of every future mint, of every size, of this model. Cards already minted keep the tier they were minted with — this cannot re-tier them."
            : "Creates the model. Add a size on its page next — a model with no size variant cannot mint and cannot carry art."}
        </p>
      </Modal>
    </div>
  );
}
