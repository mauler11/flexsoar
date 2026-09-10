/**
 * components/market/size-run.ts
 *
 * Standard US men's run backing the sell product page's size grid, matching
 * the size chart. Whole + half sizes 3–13. Plain module (no server imports)
 * so both the product page and the client SizeGrid can share it.
 */
export const SIZE_RUN: readonly number[] = Array.from(
  { length: 21 },
  (_, i) => 3 + i * 0.5,
);
