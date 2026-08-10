/**
 * app/styleguide/interactions.tsx
 *
 * Client-side demos for the interactive primitives (Modal, Toast, controlled
 * Input/Select). Lives under the styleguide route only; the page itself stays
 * a server component.
 */
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";

const TIER_OPTIONS = [
  { value: "1", label: "Common" },
  { value: "2", label: "Uncommon" },
  { value: "3", label: "Rare" },
  { value: "4", label: "Epic" },
  { value: "5", label: "Legendary" },
];

export function InteractionsDemo() {
  const [modalOpen, setModalOpen] = useState(false);
  const [handle, setHandle] = useState("");
  const [tier, setTier] = useState("3");
  const toast = useToast();

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <div className="flex flex-col gap-3">
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-tight text-muted">
          Modal
        </h3>
        <p className="font-mono text-[11px] leading-snug tracking-tight text-muted">
          Overlay, Escape to close, scroll locked while open. Footer takes the
          confirm action.
        </p>
        <div>
          <Button onClick={() => setModalOpen(true)}>Open modal</Button>
        </div>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Confirm delist"
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setModalOpen(false);
                  toast.push("Card #05 returned to active", "info");
                }}
              >
                Delist card
              </Button>
            </>
          }
        >
          <p className="font-mono text-[11px] leading-snug tracking-tight text-muted">
            Returning this card to <span className="text-foreground">active</span>{" "}
            removes its public listing. The listing is deleted — this is not
            reversible from the card page.
          </p>
        </Modal>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-tight text-muted">
          Toast
        </h3>
        <p className="font-mono text-[11px] leading-snug tracking-tight text-muted">
          Pushed from anywhere under <span className="text-foreground">ToastProvider</span>.
          Auto-dismisses after ~4.5s.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => toast.push("Consignment-2 authenticated — 4 pairs", "info")}>
            Info
          </Button>
          <Button variant="secondary" onClick={() => toast.push("Card #04 listed for 115.00 FSC", "success")}>
            Success
          </Button>
          <Button variant="secondary" onClick={() => toast.push("Price is 15% under oracle — check both sides", "warn")}>
            Warn
          </Button>
          <Button variant="secondary" onClick={() => toast.push("Vault unreachable — payout retry pending", "danger")}>
            Danger
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 md:col-span-2">
        <h3 className="font-mono text-[11px] font-bold uppercase tracking-tight text-muted">
          Controlled input &amp; select
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            label="Handle"
            placeholder="aiman_kl"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            hint="Public handle, unique across the platform."
          />
          <Select
            label="Tier"
            value={tier}
            onChange={(event) => setTier(event.target.value)}
            options={TIER_OPTIONS}
          />
        </div>
      </div>
    </div>
  );
}
