"use client";

/**
 * components/market/SizeChartModal.tsx
 *
 * Generic US men's conversion table (US M → US W / UK / EU / CM),
 * opened from the product page's SIZE CHART link. One static table for all
 * brands to start — brand-specific charts are a content task, not a code one.
 */

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface ChartRow {
  usm: string;
  usw: string;
  uk: string;
  eu: string;
  cm: string;
}

export const SIZE_CHART_ROWS: readonly ChartRow[] = [
  { usm: "3", usw: "4.5", uk: "2.5", eu: "35", cm: "22" },
  { usm: "3.5", usw: "5", uk: "3", eu: "35.5", cm: "22.5" },
  { usm: "4", usw: "5.5", uk: "3.5", eu: "36", cm: "23" },
  { usm: "4.5", usw: "6", uk: "4", eu: "36.5", cm: "23.5" },
  { usm: "5", usw: "6.5", uk: "4.5", eu: "37.5", cm: "23.5" },
  { usm: "5.5", usw: "7", uk: "5", eu: "38", cm: "24" },
  { usm: "6", usw: "7.5", uk: "5.5", eu: "38.5", cm: "24" },
  { usm: "6.5", usw: "8", uk: "6", eu: "39", cm: "24.5" },
  { usm: "7", usw: "8.5", uk: "6", eu: "40", cm: "25" },
  { usm: "7.5", usw: "9", uk: "6.5", eu: "40.5", cm: "25.5" },
  { usm: "8", usw: "9.5", uk: "7", eu: "41", cm: "26" },
  { usm: "8.5", usw: "10", uk: "7.5", eu: "42", cm: "26.5" },
  { usm: "9", usw: "10.5", uk: "8", eu: "42.5", cm: "27" },
  { usm: "9.5", usw: "11", uk: "8.5", eu: "43", cm: "27.5" },
  { usm: "10", usw: "11.5", uk: "9", eu: "44", cm: "28" },
  { usm: "10.5", usw: "12", uk: "9.5", eu: "44.5", cm: "28.5" },
  { usm: "11", usw: "12.5", uk: "10", eu: "45", cm: "29" },
  { usm: "11.5", usw: "13", uk: "10.5", eu: "45.5", cm: "29.5" },
  { usm: "12", usw: "13.5", uk: "11", eu: "46", cm: "30" },
  { usm: "12.5", usw: "14", uk: "11.5", eu: "47", cm: "30.5" },
  { usm: "13", usw: "14.5", uk: "12", eu: "47.5", cm: "31" },
];

export function SizeChartButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[13px] font-bold uppercase tracking-wide text-accent hover:underline"
      >
        Size chart
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="US Men's size chart"
        className="max-w-lg"
        footer={
          <Button variant="secondary" size="md" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      >
          <table className="w-full text-center text-[13px]">
            <thead>
              <tr className="text-muted">
                <th className="py-2 font-semibold">US M</th>
                <th className="py-2 font-semibold">US W</th>
                <th className="py-2 font-semibold">UK</th>
                <th className="py-2 font-semibold">EU</th>
                <th className="py-2 font-semibold">CM</th>
              </tr>
            </thead>
            <tbody>
              {SIZE_CHART_ROWS.map((row) => (
                <tr key={row.usm} className="border-t border-line text-muted">
                  <td className="py-1.5 font-semibold text-foreground">{row.usm}M</td>
                  <td className="py-1.5">{row.usw}W</td>
                  <td className="py-1.5">{row.uk}</td>
                  <td className="py-1.5">{row.eu}</td>
                  <td className="py-1.5">{row.cm}</td>
                </tr>
              ))}
            </tbody>
          </table>
      </Modal>
    </>
  );
}
