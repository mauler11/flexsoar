/**
 * components/admin/skus/SkuForm.tsx
 *
 * Create / edit one SKU. Money fields are typed in integer CENTS, labelled as
 * such — never a float of dollars (AGENT_RULES: money is always integer
 * cents). The palette is JSON, checked against the 9 sprite glyphs before
 * save: a key outside the set renders transparent pixels in the marketplace
 * with no error anywhere, so it warns loudly — but does not block, because
 * the glyph set belongs to track/design and may grow.
 *
 * Saving confirms: market_price_cents drives the tier of every FUTURE mint of
 * this SKU (existing cards keep the tier copied at mint — 003_retier.sql is
 * the museum of getting this wrong).
 *
 * FORBIDDEN vs NOT_FOUND on update matters here: upsertSku is a direct table
 * write under RLS, so a non-admin's update writes nothing silently and the
 * contract disambiguates by reading back. The two get different guidance.
 */
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upsertSkuAction, type UpsertSkuResult } from "@/app/admin/skus/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { Sku, UpsertSkuInput } from "@/lib/api/contract";
import { DEFAULT_PALETTE } from "@/lib/sprites";

/** The glyphs the shipped sprite maps resolve. */
const KNOWN_GLYPHS = new Set(Object.keys(DEFAULT_PALETTE));

interface Draft {
  brand: string;
  model: string;
  colorway: string;
  size_us: string;
  retail_price_cents: string;
  market_price_cents: string;
  price_confidence: string;
  sprite_key: string;
  palette: string;
  mint_cap: string;
}

function draftFrom(sku: Sku | null): Draft {
  return {
    brand: sku?.brand ?? "",
    model: sku?.model ?? "",
    colorway: sku?.colorway ?? "",
    size_us: sku?.size_us == null ? "" : String(sku.size_us),
    retail_price_cents:
      sku?.retail_price_cents == null ? "" : String(sku.retail_price_cents),
    market_price_cents:
      sku?.market_price_cents == null ? "" : String(sku.market_price_cents),
    price_confidence:
      sku?.price_confidence == null ? "" : String(sku.price_confidence),
    sprite_key: sku?.sprite_key ?? "",
    palette: sku?.palette == null ? "" : JSON.stringify(sku.palette, null, 2),
    mint_cap: sku?.mint_cap == null ? "" : String(sku.mint_cap),
  };
}

type Parsed =
  | { ok: true; input: UpsertSkuInput; paletteWarning: string | null }
  | { ok: false; errors: Partial<Record<keyof Draft, string>> };

function parseDraft(draft: Draft, skuId: string | undefined): Parsed {
  const errors: Partial<Record<keyof Draft, string>> = {};

  if (!draft.brand.trim()) errors.brand = "required";
  if (!draft.model.trim()) errors.model = "required";
  if (!draft.colorway.trim()) errors.colorway = "required";

  const size = Number(draft.size_us);
  if (!/^\d{1,2}(\.\d)?$/.test(draft.size_us.trim()) || size <= 0) {
    errors.size_us = "US size, one decimal (numeric(4,1))";
  }

  function cents(raw: string, key: keyof Draft): number | null {
    const text = raw.trim();
    if (text === "") return null;
    if (!/^\d+$/.test(text)) {
      errors[key] = "integer cents only — 18999, never 189.99";
      return null;
    }
    return Number(text);
  }
  const retail = cents(draft.retail_price_cents, "retail_price_cents");
  const market = cents(draft.market_price_cents, "market_price_cents");

  let confidence: number | null = null;
  if (draft.price_confidence.trim() !== "") {
    confidence = Number(draft.price_confidence);
    if (!/^\d(\.\d{1,2})?$/.test(draft.price_confidence.trim()) || confidence > 1) {
      errors.price_confidence = "0.00 to 1.00";
      confidence = null;
    }
  }

  let mintCap: number | null = null;
  if (draft.mint_cap.trim() !== "") {
    if (!/^\d+$/.test(draft.mint_cap.trim()) || Number(draft.mint_cap) < 1) {
      errors.mint_cap = "a positive integer, or empty for uncapped";
    } else {
      mintCap = Number(draft.mint_cap);
    }
  }

  let palette: UpsertSkuInput["palette"] = null;
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
          palette = parsed as UpsertSkuInput["palette"];
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
    paletteWarning,
    input: {
      ...(skuId ? { id: skuId } : {}),
      brand: draft.brand.trim(),
      model: draft.model.trim(),
      colorway: draft.colorway.trim(),
      size_us: size,
      retail_price_cents: retail,
      market_price_cents: market,
      price_confidence: confidence,
      sprite_key: draft.sprite_key.trim() === "" ? null : draft.sprite_key.trim(),
      palette,
      mint_cap: mintCap,
    },
  };
}

export function SkuForm({ sku }: { sku: Sku | null }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(sku));
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<UpsertSkuResult | null>(null);
  const [pending, startTransition] = useTransition();

  const parsed = parseDraft(draft, sku?.id);
  const errors = parsed.ok ? {} : parsed.errors;

  function set<K extends keyof Draft>(key: K, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setResult(null);
  }

  function save() {
    if (!parsed.ok) return;
    startTransition(async () => {
      const outcome = await upsertSkuAction(parsed.input);
      setResult(outcome);
      setConfirming(false);
      if (outcome.ok && !sku) router.push(`/admin/skus/${outcome.skuId}`);
    });
  }

  const field = (key: keyof Draft) => ({
    value: draft[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      set(key, event.target.value),
    error: (errors as Partial<Record<keyof Draft, string>>)[key] ?? null,
    disabled: pending,
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Brand" {...field("brand")} />
        <Input label="Model" {...field("model")} />
        <Input label="Colorway" {...field("colorway")} />
        <Input label="Size (US)" inputMode="decimal" {...field("size_us")} />
        <Input
          label="Retail price (cents)"
          inputMode="numeric"
          hint="Integer USD cents. 18999 = $189.99."
          {...field("retail_price_cents")}
        />
        <Input
          label="Oracle price (cents)"
          inputMode="numeric"
          hint="Drives tier for FUTURE mints only. Empty = unpriced, unmintable."
          {...field("market_price_cents")}
        />
        <Input
          label="Price confidence"
          inputMode="decimal"
          hint="0.00–1.00, optional."
          {...field("price_confidence")}
        />
        <Input
          label="Mint cap"
          inputMode="numeric"
          hint="Empty = uncapped."
          {...field("mint_cap")}
        />
        <Input
          label="Sprite key"
          hint="'low-top' or 'high-top' — the shipped base maps."
          {...field("sprite_key")}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="sku-palette"
          className="font-mono text-[10px] uppercase tracking-tight text-muted"
        >
          Palette JSON
        </label>
        <textarea
          id="sku-palette"
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
        {parsed.ok && parsed.paletteWarning && (
          <p className="font-mono text-[10px] leading-snug tracking-tight text-[#E8B33A]">
            Palette warning — saving anyway is allowed: {parsed.paletteWarning}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => setConfirming(true)}
          disabled={pending || !parsed.ok}
        >
          {sku ? "Save changes" : "Create SKU"}
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
                RLS filtered the update to nothing. This session is not an
                admin (or lost it since sign-in); nothing was changed.
              </p>
            )}
            {result.code === "NOT_FOUND" && (
              <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
                No SKU with this id exists — it may have been deleted since
                this page loaded. Nothing was changed; go back to the catalog.
              </p>
            )}
            {result.code === "WRONG_STATUS" && (
              <p className="font-mono text-[10px] leading-snug tracking-tight text-muted">
                A SKU with this exact brand, model, colorway and size already
                exists — the catalog key is unique.
              </p>
            )}
          </div>
        )}
      </div>

      <Modal
        open={confirming}
        onClose={() => !pending && setConfirming(false)}
        title={sku ? "Save SKU changes" : "Create SKU"}
        footer={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Confirm save"}
            </Button>
          </>
        }
      >
        <p className="font-mono text-[11px] leading-snug tracking-tight">
          {sku
            ? "The oracle price sets the tier of every future mint of this SKU. Cards already minted keep the tier they were minted with — this cannot re-tier them."
            : "Creates the SKU. It becomes mintable once it has an oracle price and an item clears grading and authentication."}
        </p>
      </Modal>
    </div>
  );
}
