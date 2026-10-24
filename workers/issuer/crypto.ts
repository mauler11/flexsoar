import { createHash, createHmac, timingSafeEqual, verify as verifySignature, createPublicKey } from 'node:crypto';
import type { IssuerJwk } from './types';

export function decodeB64Url(text: string, expected?: number): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('malformed base64url');
  const bytes = Buffer.from(text, 'base64url');
  if (bytes.toString('base64url') !== text || (expected !== undefined && bytes.length !== expected)) throw new Error('malformed base64url');
  return new Uint8Array(bytes);
}

export function sha256(bytes: Uint8Array): Uint8Array { return createHash('sha256').update(bytes).digest(); }

export interface HmacRequest { method: string; path: string; timestamp: string; nonce: Uint8Array; userId: string; body: Uint8Array; kid: string; signature: string }
export function verifyHmac(request: HmacRequest, keys: ReadonlyMap<string, Uint8Array>, activeKid: string, now: number): void {
  const key = keys.get(request.kid);
  if (!key || request.kid !== activeKid || !/^(0|[1-9][0-9]*)$/.test(request.timestamp) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(request.userId) || !/^[0-9a-f]{64}$/.test(request.signature)) throw new Error('ISSUER_AUTH_INVALID');
  const stamp = Number(request.timestamp);
  if (!Number.isSafeInteger(stamp) || Math.abs(stamp - now) > 60) throw new Error('ISSUER_AUTH_EXPIRED');
  const canonical = `flexsoar-issuer-v1\n${request.method.toUpperCase()}\n${request.path}\n${request.timestamp}\n${Buffer.from(request.nonce).toString('base64url')}\n${request.userId.toLowerCase()}\n${Buffer.from(sha256(request.body)).toString('hex')}`;
  const expected = createHmac('sha256', key).update(canonical, 'utf8').digest();
  const supplied = Buffer.from(request.signature, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('ISSUER_AUTH_INVALID');
}

// Detect duplicate object keys before JSON.parse; JWT header and payload are security-sensitive.
export function assertNoDuplicateJsonKeys(source: string): void {
  let pos = 0;
  const ws = () => { while (/\s/.test(source[pos] ?? '')) pos++; };
  const string = (): string => {
    const start = pos++; let escaped = false;
    while (pos < source.length) { const c = source[pos++]!; if (!escaped && c === '"') return JSON.parse(source.slice(start, pos)) as string; if (!escaped && c === '\\') escaped = true; else escaped = false; }
    throw new Error('invalid JSON');
  };
  const value = (): void => {
    ws(); const c = source[pos];
    if (c === '{') { pos++; ws(); const keys = new Set<string>(); if (source[pos] === '}') { pos++; return; }
      for (;;) { ws(); if (source[pos] !== '"') throw new Error('invalid JSON'); const key = string(); if (keys.has(key)) throw new Error('duplicate JSON key'); keys.add(key); ws(); if (source[pos++] !== ':') throw new Error('invalid JSON'); value(); ws(); const next = source[pos++]; if (next === '}') return; if (next !== ',') throw new Error('invalid JSON'); }
    }
    if (c === '[') { pos++; ws(); if (source[pos] === ']') { pos++; return; } for (;;) { value(); ws(); const next = source[pos++]; if (next === ']') return; if (next !== ',') throw new Error('invalid JSON'); } }
    if (c === '"') { string(); return; }
    const rest = source.slice(pos); const m = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(rest); if (!m) throw new Error('invalid JSON'); pos += m[0].length;
  };
  value(); ws(); if (pos !== source.length) throw new Error('invalid JSON');
}

export interface JwtPins { issuer: string; audience: string; kid: string; now: number }
export async function verifySupabaseJwt(token: string, keys: readonly IssuerJwk[], pins: JwtPins): Promise<string> {
  try {
    const parts = token.split('.'); if (parts.length !== 3) throw new Error();
    const headText = new TextDecoder('utf-8',{fatal:true}).decode(decodeB64Url(parts[0]!));
    const bodyText = new TextDecoder('utf-8',{fatal:true}).decode(decodeB64Url(parts[1]!));
    assertNoDuplicateJsonKeys(headText); assertNoDuplicateJsonKeys(bodyText);
    const header = JSON.parse(headText) as Record<string, unknown>; const claims = JSON.parse(bodyText) as Record<string, unknown>;
    if (header.alg !== 'ES256' || header.kid !== pins.kid || header.crit !== undefined || header.b64 !== undefined || Object.keys(header).some(k => !['alg','kid','typ'].includes(k))) throw new Error();
    const kids=keys.map(k=>k.kid).filter((k):k is string=>typeof k==='string');
    if(new Set(kids).size!==kids.length)throw new Error();
    const jwk = keys.find(k => k.kid === pins.kid);
    if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || jwk.use !== 'sig' || jwk.alg !== 'ES256' || !Array.isArray(jwk.key_ops) || jwk.key_ops.length !== 1 || jwk.key_ops[0] !== 'verify' || !jwk.x || !jwk.y || decodeB64Url(jwk.x, 32).length !== 32 || decodeB64Url(jwk.y, 32).length !== 32) throw new Error();
    const signature = decodeB64Url(parts[2]!, 64);
    const der = joseEcdsaToDer(signature);
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true }, format: 'jwk' });
    if (!verifySignature('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), { key, dsaEncoding: 'der' }, der)) throw new Error();
    const now = pins.now;
    if (claims.iss !== pins.issuer || !(claims.aud === pins.audience || Array.isArray(claims.aud) && claims.aud.includes(pins.audience)) || claims.role !== 'authenticated' || typeof claims.sub !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(claims.sub) || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || (claims.iat as number) > now + 30 || (claims.exp as number) <= (claims.iat as number) || (claims.exp as number) - (claims.iat as number) > 3600) throw new Error();
    if((claims.exp as number)<=now)throw new Error('ISSUER_AUTH_EXPIRED');
    if (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || (claims.nbf as number) > now + 30 || (claims.nbf as number) > now)) throw new Error();
    return claims.sub;
  } catch(e) { if((e as Error).message==='ISSUER_AUTH_EXPIRED')throw e;throw new Error('ISSUER_AUTH_INVALID'); }
}

function joseEcdsaToDer(sig: Uint8Array): Buffer {
  const integer = (b: Uint8Array) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; let v = Buffer.from(b.subarray(i)); if ((v[0]! & 0x80) !== 0) v = Buffer.concat([Buffer.from([0]), v]); return Buffer.concat([Buffer.from([2, v.length]), v]); };
  const r = integer(sig.subarray(0, 32)), s = integer(sig.subarray(32)); const body = Buffer.concat([r,s]); return Buffer.concat([Buffer.from([0x30, body.length]),body]);
}
