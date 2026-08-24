/**
 * components/market/RedeemForm.tsx
 *
 * The owner's request to receive the physical card: fn_redeem_card burns the
 * claim and puts the item on the redemption hold. The handling fee is the
 * server-side constant, displayed here, never typed in or sent by the client —
 * only the shipping address is in the FormData.
 */
"use client";

import { useState, useTransition } from "react";
import { redeemCardAction } from "@/app/(market)/actions";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Banner } from "@/components/market/Banner";
import { formatUsd } from "@/components/card/format";

export interface RedeemFormProps {
  cardId: string;
  feeCents: number;
}

const COUNTRIES = [
  { value: "US", label: "United States" },
  { value: "MY", label: "Malaysia" },
  { value: "GB", label: "United Kingdom" },
  { value: "JP", label: "Japan" },
  { value: "SG", label: "Singapore" },
  { value: "AU", label: "Australia" },
];

export function RedeemForm({ cardId, feeCents }: RedeemFormProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [recipientName, setRecipientName] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("US");
  const [phone, setPhone] = useState("");

  function submit() {
    if (!recipientName.trim() || !line1.trim() || !city.trim() || !postalCode.trim()) {
      setError("Recipient name, address line 1, city and postal code are required.");
      return;
    }
    setError(null);
    const data = new FormData();
    data.set("card_id", cardId);
    data.set("recipient_name", recipientName);
    data.set("line1", line1);
    data.set("line2", line2);
    data.set("city", city);
    data.set("state", stateName);
    data.set("postal_code", postalCode);
    data.set("country_code", country);
    data.set("phone", phone);
    startTransition(() => redeemCardAction(data));
  }

  return (
    <div className="flex flex-col gap-2 border border-line bg-overlay p-3">
      <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-tight text-muted">
        <span>Ship to</span>
        <span className="text-foreground">
          Handling fee {formatUsd(feeCents)}
        </span>
      </div>

      <Input
        label="Recipient name"
        value={recipientName}
        onChange={(e) => setRecipientName(e.target.value)}
        disabled={pending}
      />
      <Input
        label="Address line 1"
        value={line1}
        onChange={(e) => setLine1(e.target.value)}
        disabled={pending}
      />
      <Input
        label="Address line 2"
        value={line2}
        onChange={(e) => setLine2(e.target.value)}
        disabled={pending}
        aria-required={false}
      />
      <div className="grid gap-2 sm:grid-cols-3">
        <Input
          label="City"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          disabled={pending}
        />
        <Input
          label="State / region"
          value={stateName}
          onChange={(e) => setStateName(e.target.value)}
          disabled={pending}
        />
        <Input
          label="Postal code"
          value={postalCode}
          onChange={(e) => setPostalCode(e.target.value)}
          disabled={pending}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label
          htmlFor="redeem-country"
          className="flex flex-col gap-1 font-mono text-[10px] uppercase tracking-tight text-muted"
        >
          Country
          <select
            id="redeem-country"
            className="border border-line-strong bg-overlay px-2 py-1.5 font-mono text-[13px] tracking-tight text-foreground pixel-shadow-sm"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            disabled={pending}
          >
            {COUNTRIES.map((c) => (
              <option key={c.value} value={c.value} className="bg-raised">
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <Input
          label="Phone (optional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={pending}
        />
      </div>

      {error && <Banner tone="error" title={error} />}

      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="font-mono text-[9px] uppercase tracking-tight text-muted">
          Burns the card claim; the physical item ships after authentication
        </p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={submit}
        >
          {pending ? "Submitting…" : "Redeem card"}
        </Button>
      </div>
    </div>
  );
}