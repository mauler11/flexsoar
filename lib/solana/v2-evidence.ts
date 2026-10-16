/** Finalized transaction acquisition with an explicitly supplied archival source.
 * This module has no endpoint discovery, signing, sending, or database access. */
import { createHash } from 'node:crypto';
import { VersionedTransaction } from '@solana/web3.js';
import { localRpc, type V2Transaction } from './v2-observer';

export interface FinalizedRpcResult {
  slot: number; blockTime: number; transaction: [string, 'base64'];
  meta: Record<string, unknown>; version?: number | string;
}
export type ParsedFinalizedRpcResult = V2Transaction & { blockTime: number };
export interface FinalizedTransactionSource {
  readonly label: string;
  getGenesisHash(): Promise<string>;
  getTransaction(signature: string): Promise<FinalizedRpcResult | null>;
  getParsedTransaction(signature: string): Promise<ParsedFinalizedRpcResult | null>;
  getBlock?(slot:number):Promise<unknown>;
}
export interface VerifiedTransactionEvidence {
  formatVersion: 1; subjectKind: 'payment_event' | 'attestation' | 'lifecycle' | 'operation_failure';
  subjectId: string; subjectAction: string; networkId: string; genesis: string; program: string;
  signature: string; slot: number; blockTime: number; finality: 'finalized'; sourceKind: 'primary' | 'archive'; sourceLabel: string;
  transactionBase64: string; transactionDigest: string; messageDigest: string; rpcResult: FinalizedRpcResult;
  parsedRpcResult: ParsedFinalizedRpcResult;
}
export type FinalityCheck = (transaction: V2Transaction, signature: string) => Promise<void> | void;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(k => `${JSON.stringify(k)}:${canonical(object[k])}`).join(',')}}`;
}
// Encoding-specific RPC metadata may omit/resolve innerInstructions and
// loadedAddresses. The parsed form is inspected for inner transfers; wire and
// parsed responses must still agree on the financial outcome fields.
function executionMeta(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid finalized execution metadata');
  const source=value as Record<string,unknown>,keys=['err','fee','preBalances','postBalances','preTokenBalances','postTokenBalances','computeUnitsConsumed','costUnits','status'];
  return Object.fromEntries(keys.filter(k=>Object.hasOwn(source,k)).map(k=>[k,source[k]]));
}
/** JSON.parse rounds u64 lamport balances before application code sees them.
 * Preserve every large integer token as a decimal string in retained evidence. */
export function parseFinalizedRpcJson(text:string):unknown{
  let rewritten='',i=0;
  while(i<text.length){
    if(text[i]==='"'){
      const start=i++;let escaped=false;
      while(i<text.length){const c=text[i++];if(escaped){escaped=false;continue;}if(c==='\\'){escaped=true;continue;}if(c==='"')break;}
      rewritten+=text.slice(start,i);continue;
    }
    if(text[i]==='-'||text[i]>='0'&&text[i]<='9'){
      const match=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i));
      if(match){const token=match[0];if(!token.includes('.')&&!/[eE]/.test(token)&& (BigInt(token)>BigInt(Number.MAX_SAFE_INTEGER)||BigInt(token)<BigInt(Number.MIN_SAFE_INTEGER)))rewritten+=JSON.stringify(token);else rewritten+=token;i+=token.length;continue;}
    }
    rewritten+=text[i++];
  }
  return JSON.parse(rewritten);
}
function validateShape(value: unknown, signature: string): { result: FinalizedRpcResult; transaction: VersionedTransaction } {
  if (!value || typeof value !== 'object') throw new Error('finalized transaction unavailable');
  const result = value as FinalizedRpcResult;
  if (!Number.isSafeInteger(result.slot) || result.slot < 0 || !Number.isSafeInteger(result.blockTime) || result.blockTime < 0 ||
      !Array.isArray(result.transaction) || result.transaction[1] !== 'base64' || typeof result.transaction[0] !== 'string' ||
      !result.meta || typeof result.meta !== 'object' || result.meta.err !== null) throw new Error('invalid finalized transaction response');
  const bytes = Buffer.from(result.transaction[0], 'base64');
  if (bytes.toString('base64') !== result.transaction[0]) throw new Error('noncanonical finalized transaction bytes');
  const transaction = VersionedTransaction.deserialize(bytes);
  if (!Buffer.from(transaction.serialize()).equals(bytes) || !transaction.signatures.length ||
      Buffer.from(transaction.signatures[0]).toString('base64') === '' || transaction.signatures[0].length !== 64) throw new Error('invalid finalized signature bytes');
  const first = transaction.signatures[0];
  // The transaction signature is the base58 encoding of the first Ed25519 signature.
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(`0x${Buffer.from(first).toString('hex')}`), encoded = '';
  while (n > BigInt(0)) { const r = Number(n % BigInt(58)); encoded = alphabet[r] + encoded; n /= BigInt(58); }
  let zeros = 0; while (zeros < first.length && first[zeros] === 0) zeros++;
  if ('1'.repeat(zeros) + encoded !== signature) throw new Error('finalized transaction signature mismatch');
  return { result, transaction };
}

/**
 * Checks primary and archival observations independently. An absent/unavailable
 * primary may fall back to archive; a returned but conflicting or invalid record
 * is a hard failure. When both answer, their finalized transaction and execution
 * metadata must be byte-for-byte consistent. The caller supplies the production
 * instruction/account verifier, so archival data passes the same checks.
 */
export async function acquireFinalizedEvidence(
  primary: FinalizedTransactionSource,
  archive: FinalizedTransactionSource | null,
  expected: { networkId: string; genesis: string; program: string; signature: string; subjectKind: VerifiedTransactionEvidence['subjectKind']; subjectId: string; subjectAction: string },
  inspect: FinalityCheck,
): Promise<VerifiedTransactionEvidence> {
  const candidates: Array<{ source: FinalizedTransactionSource; kind: 'primary' | 'archive' }> = [{ source: primary, kind: 'primary' }];
  if (archive && archive !== primary) candidates.push({ source: archive, kind: 'archive' });
  const found: Array<{ source: FinalizedTransactionSource; kind: 'primary' | 'archive'; result: FinalizedRpcResult; parsed: ParsedFinalizedRpcResult; transaction: VersionedTransaction }> = [];
  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      if (await candidate.source.getGenesisHash() !== expected.genesis) throw new Error('evidence source genesis mismatch');
      const result = await candidate.source.getTransaction(expected.signature);
      if (!result) { failures.push(`${candidate.kind}: transaction absent`); continue; }
      const parsed = await candidate.source.getParsedTransaction(expected.signature);
      if (!parsed || parsed.slot !== result.slot || parsed.blockTime !== result.blockTime) throw new Error('parsed and wire transaction observations conflict');
      if(canonical(executionMeta(parsed.meta))!==canonical(executionMeta(result.meta)))throw new Error('parsed and wire financial execution metadata conflict');
      const valid = validateShape(result, expected.signature);
      await inspect(parsed, expected.signature);
      found.push({ ...candidate, result, parsed, transaction: valid.transaction });
    } catch (error) {
      if (found.length) throw error;
      failures.push(`${candidate.kind}: ${error instanceof Error ? error.message : 'observation failed'}`);
    }
  }
  if (!found.length) throw new Error(`finalized history unavailable or invalid (${failures.join('; ')})`);
  if (found.length > 1) {
    const a = found[0], b = found[1];
    if (Buffer.compare(a.transaction.serialize(), b.transaction.serialize()) !== 0 || canonical(a.result) !== canonical(b.result)) throw new Error('primary/archive finalized evidence conflict');
  }
  const chosen = found.find(x => x.kind === 'primary') ?? found[0];
  const bytes = chosen.transaction.serialize();
  return {
    formatVersion: 1, subjectKind: expected.subjectKind, subjectId: expected.subjectId, subjectAction: expected.subjectAction,
    networkId: expected.networkId, genesis: expected.genesis, program: expected.program, signature: expected.signature,
    slot: chosen.result.slot, blockTime: chosen.result.blockTime, finality: 'finalized', sourceKind: chosen.kind,
    sourceLabel: chosen.source.label, transactionBase64: Buffer.from(bytes).toString('base64'),
    transactionDigest: hash(bytes), messageDigest: hash(chosen.transaction.message.serialize()), rpcResult: chosen.result, parsedRpcResult: chosen.parsed,
  };
}

/** Revalidates durable category-B evidence without consulting fresh history. */
export async function validateRetainedFinalizedEvidence(
  value: unknown,
  expected: { networkId:string;genesis:string;program:string;signature:string;subjectKind:VerifiedTransactionEvidence['subjectKind'];subjectId:string;subjectAction:string },
  inspect: FinalityCheck,
): Promise<VerifiedTransactionEvidence> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid retained evidence');
  const r = value as Record<string, unknown>;
  const string = (k:string) => { if(typeof r[k]!=='string')throw new Error('invalid retained evidence '+k);return r[k] as string; };
  const parsed = r.parsedRpcResult as ParsedFinalizedRpcResult;
  const wire = r.rpcResult as FinalizedRpcResult;
  const encoded=string('transactionBase64'),lines=encoded.split('\n');
  // PostgreSQL encode(bytea,'base64') wraps at 76 columns. Accept only that
  // documented transport wrapping, then validate the canonical bytes against
  // the unwrapped RPC transaction retained alongside them.
  if(lines.some((line,index)=>line.length===0||(lines.length>1&&(line.length>76||(index<lines.length-1&&line.length!==76)))))throw new Error('invalid retained base64 wrapping');
  const transactionBase64=lines.join(''),bytes = Buffer.from(transactionBase64,'base64');
  const tx = VersionedTransaction.deserialize(bytes), slot=Number(r.slot), blockTime=Number(r.blockTime);
  if (r.formatVersion!==1 || r.subjectKind!==expected.subjectKind || r.subjectId!==expected.subjectId || r.subjectAction!==expected.subjectAction || r.networkId!==expected.networkId || r.genesis!==expected.genesis || r.program!==expected.program || r.signature!==expected.signature || r.finality!=='finalized' || !['primary','archive'].includes(String(r.sourceKind)) || !Number.isSafeInteger(slot) || !Number.isSafeInteger(blockTime) || !/^[0-9a-f]{64}$/.test(string('transactionDigest')) || hash(bytes)!==r.transactionDigest || hash(tx.message.serialize())!==r.messageDigest ||
      bytes.toString('base64')!==transactionBase64 || wire.transaction?.[0]!==transactionBase64 || wire.transaction?.[1]!=='base64' || wire.slot!==slot || wire.blockTime!==blockTime || wire.slot!==parsed?.slot || wire.blockTime!==parsed?.blockTime || canonical(executionMeta(wire.meta))!==canonical(executionMeta(parsed?.meta)) || parsed?.transaction?.signatures?.[0]!==expected.signature || parsed?.meta?.err!==null || wire?.meta?.err!==null) throw new Error('retained evidence identity or integrity mismatch');
  const checked=validateShape(wire,expected.signature);
  if(!Buffer.from(checked.transaction.serialize()).equals(bytes))throw new Error('retained transaction bytes mismatch');
  await inspect(parsed,expected.signature);
  // The database adapter serializes bigint metadata as decimal strings. Return
  // the validated numeric values, rather than leaking that transport shape into
  // downstream lifecycle proofs.
  return {...r,transactionBase64,slot:wire.slot,blockTime:wire.blockTime} as unknown as VerifiedTransactionEvidence;
}

/** RPC adapter for explicitly configured local primary/archive services. */
export class LocalFinalizedRpcSource implements FinalizedTransactionSource {
  readonly url: string;
  constructor(url: string, readonly label: string, private readonly request: typeof fetch = fetch) {
    if (!/^[A-Za-z0-9._:-]{1,96}$/.test(label)) throw new Error('explicit evidence source label required');
    this.url = localRpc(url);
  }
  private async call(method: string, params: unknown[]): Promise<unknown> {
    const response = await this.request(this.url, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: `evidence-${method}`, method, params }) });
    if (!response.ok) throw new Error('evidence source unavailable');
    const body = parseFinalizedRpcJson(await response.text()) as Record<string,unknown>;
    if (body.error) throw new Error('evidence source RPC error');
    return body.result;
  }
  async getGenesisHash(): Promise<string> { const value = await this.call('getGenesisHash', []); if (typeof value !== 'string') throw new Error('invalid evidence source genesis'); return value; }
  async getTransaction(signature: string): Promise<FinalizedRpcResult | null> {
    const value = await this.call('getTransaction', [signature, { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
    return value === null ? null : value as FinalizedRpcResult;
  }
  async getParsedTransaction(signature: string): Promise<ParsedFinalizedRpcResult | null> {
    const value = await this.call('getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
    return value === null ? null : value as ParsedFinalizedRpcResult;
  }
  async getBlock(slot:number):Promise<unknown>{return this.call('getBlock',[slot,{encoding:'jsonParsed',commitment:'finalized',transactionDetails:'full',rewards:false,maxSupportedTransactionVersion:0}]);}
}

/** Archive adapter for an explicitly supplied local snapshot reader. Production
 * callers must supply a separately operated source; this class discovers none. */
export class SnapshotFinalizedArchiveSource implements FinalizedTransactionSource {
  constructor(readonly label:string,private readonly genesis:string,private readonly read:(signature:string)=>Promise<{wire:FinalizedRpcResult;parsed:ParsedFinalizedRpcResult}|null>,private readonly readBlock?:(slot:number)=>Promise<unknown>){
    if(!/^archive:[A-Za-z0-9._:-]{1,88}$/.test(label))throw new Error('explicit archive source label required');
  }
  async getGenesisHash():Promise<string>{return this.genesis;}
  async getTransaction(signature:string):Promise<FinalizedRpcResult|null>{return (await this.read(signature))?.wire??null;}
  async getParsedTransaction(signature:string):Promise<ParsedFinalizedRpcResult|null>{return (await this.read(signature))?.parsed??null;}
  async getBlock(slot:number):Promise<unknown>{if(!this.readBlock)return null;return this.readBlock(slot);}
}
