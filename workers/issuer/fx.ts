import type { FxQuote } from './types';

const MAX = (BigInt('1') << BigInt('256')) - BigInt('1');
const U64 = (BigInt('1') << BigInt('64')) - BigInt('1');
function checked(a: bigint, b: bigint): bigint { const zero=BigInt('0');if(a<zero||b<zero||a!==zero&&b>MAX/a)throw new Error('ISSUER_FX_OVERFLOW');return a*b; }
function add(a: bigint, b: bigint): bigint { const zero=BigInt('0');if(a<zero||b<zero||b>MAX-a)throw new Error('ISSUER_FX_OVERFLOW');return a+b; }
function positiveDecimal(value: string): bigint { if (!/^[1-9][0-9]*$/.test(value)) throw new Error('ISSUER_FX_INVALID'); const n = BigInt(value); if (n > MAX) throw new Error('ISSUER_FX_OVERFLOW'); return n; }
export function calculateFx(quotes: readonly [FxQuote, FxQuote], priceCents: string, nowSeconds: number): { total: bigint; snapshot: Record<string, unknown> } {
  if (quotes[0].providerId === quotes[1].providerId) throw new Error('ISSUER_FX_INVALID');
  const parsed = quotes.map(q => {
    if(typeof q.providerId!=='string'||!q.providerId.trim()||typeof q.quoteId!=='string'||!q.quoteId.trim()||typeof q.observedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(q.observedAt))throw new Error('ISSUER_FX_INVALID');
    const n = positiveDecimal(q.numerator), d = positiveDecimal(q.denominator), observed = Date.parse(q.observedAt);
    if (!Number.isFinite(observed)) throw new Error('ISSUER_FX_INVALID');
    const age = nowSeconds - Math.floor(observed / 1000); if (age > 3600 || age < -30) throw new Error('ISSUER_FX_STALE');
    return { q, n, d };
  });
  const a = checked(parsed[0]!.n, parsed[1]!.d), b = checked(parsed[1]!.n, parsed[0]!.d);
  const diff = a > b ? a - b : b - a;
  const sum = add(a, b); if (checked(BigInt('200'), diff) > sum) throw new Error('ISSUER_FX_DISAGREEMENT');
  const price = positiveDecimal(priceCents); const numerator = checked(price, sum); const denominator = checked(BigInt('2'), checked(parsed[0]!.d, parsed[1]!.d));
  const total = add(numerator, denominator - BigInt('1')) / denominator;
  if (total <= BigInt('0') || total > U64) throw new Error('ISSUER_FX_OVERFLOW');
  const rateNum = sum, rateDen = denominator;
  const iso = (ms: number) => new Date(ms).toISOString();
  return { total, snapshot: { schemaVersion: 1, baseCurrency: 'MYR', quoteAsset: 'USDC', quoteDecimals: 6, unit: 'micro-USDC-per-MYR-sen', method: 'symmetric-midpoint', maxDisagreementBps: 50, rounding: 'ceil-seller-favour', rateNumerator: rateNum.toString(), rateDenominator: rateDen.toString(), totalMicroUsdc: total.toString(), sources: parsed.map(({q}) => ({ providerId:q.providerId, quoteId:q.quoteId, rateNumerator:q.numerator, rateDenominator:q.denominator, observedAt:iso(Date.parse(q.observedAt)) })) } };
}
