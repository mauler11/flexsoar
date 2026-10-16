/** Finalized transaction acquisition with an explicitly supplied archival source.
 * This module has no endpoint discovery, signing, sending, or database access. */
import { createHash } from 'node:crypto';
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  PublicKey,
  VersionedTransaction,
} from '@solana/web3.js';
import { base58Decode, base58Encode } from './base58';
import { localRpc, type V2Transaction } from './v2-observer';

export interface FinalizedRpcResult {
  slot: number; blockTime: number; transaction: [string, 'base64'];
  meta: Record<string, unknown>; version?: number | string;
}
interface RawCompiledInstruction { programIdIndex: number; accounts: number[]; data: string }
interface RawCompiledMessage {
  header: { numRequiredSignatures: number; numReadonlySignedAccounts: number; numReadonlyUnsignedAccounts: number };
  accountKeys: string[]; recentBlockhash: string; instructions: RawCompiledInstruction[];
  addressTableLookups?: { accountKey: string; writableIndexes: number[]; readonlyIndexes: number[] }[];
}
interface LookupTableEvidence { address: string; owner: string; contextSlot:number; dataBase64: string; dataDigest: string }
export type ParsedFinalizedRpcResult = V2Transaction & {
  blockTime: number;
  /** Independent `encoding: json` transaction response, checked against wire bytes. */
  compiledRpcResult: {
    slot: number; blockTime: number; version?: number | string;
    transaction: { signatures: string[]; message: RawCompiledMessage };
    meta: Record<string, unknown>;
  };
  /** Raw lookup-table account data observed at or after the transaction slot. */
  lookupTableEvidence: LookupTableEvidence[];
};
export interface FinalizedTransactionSource {
  readonly label: string;
  getGenesisHash(): Promise<string>;
  getTransaction(signature: string): Promise<FinalizedRpcResult | null>;
  getParsedTransaction(signature: string): Promise<ParsedFinalizedRpcResult | null>;
  getAddressLookupTableEvidence?(address: string, minContextSlot: number): Promise<Omit<LookupTableEvidence, 'dataDigest'> | null>;
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

/** Only this explicit transport/service class permits trying the next source. */
export class EvidenceSourceUnavailableError extends Error {
  readonly category = 'source_unavailable';
  constructor(readonly source: string, readonly operation: string, options?: ErrorOptions) {
    super(`finalized evidence source unavailable (${source}:${operation})`, options);
    this.name = 'EvidenceSourceUnavailableError';
  }
}
export class EvidenceValidationError extends Error {
  readonly category = 'invalid_evidence';
  constructor(readonly operation:string, options?:ErrorOptions) {
    const detail=options?.cause instanceof Error?`: ${options.cause.message}`:'';
    super(`finalized evidence validation failed (${operation})${detail}`,options);
    this.name='EvidenceValidationError';
  }
}
function validation<T>(operation:string,check:()=>T):T{
  try{return check();}catch(error){if(error instanceof EvidenceValidationError)throw error;throw new EvidenceValidationError(operation,{cause:error});}
}
async function validationAsync<T>(operation:string,check:()=>T|Promise<T>):Promise<T>{
  try{return await check();}catch(error){if(error instanceof EvidenceValidationError)throw error;throw new EvidenceValidationError(operation,{cause:error});}
}

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(k => `${JSON.stringify(k)}:${canonical(object[k])}`).join(',')}}`;
}
// Encoding-specific RPC metadata may omit/resolve innerInstructions and
// loadedAddresses. The parsed form is checked instruction-by-instruction below.
function executionMeta(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid finalized execution metadata');
  const source=value as Record<string,unknown>,keys=['err','fee','preBalances','postBalances','preTokenBalances','postTokenBalances','computeUnitsConsumed','costUnits','status'];
  return Object.fromEntries(keys.filter(k=>Object.hasOwn(source,k)).map(k=>[k,source[k]]));
}
/** JSON.parse rounds u64 lamport balances before application code sees them. */
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
      if(match){const token=match[0];if(!token.includes('.')&&!/[eE]/.test(token)&&(BigInt(token)>BigInt(Number.MAX_SAFE_INTEGER)||BigInt(token)<BigInt(Number.MIN_SAFE_INTEGER)))rewritten+=JSON.stringify(token);else rewritten+=token;i+=token.length;continue;}
    }
    rewritten+=text[i++];
  }
  return JSON.parse(rewritten);
}
function validateShape(value: unknown, signature: string): { result: FinalizedRpcResult; transaction: VersionedTransaction } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid finalized transaction response');
  const result = value as FinalizedRpcResult;
  if (!Number.isSafeInteger(result.slot) || result.slot < 0 || !Number.isSafeInteger(result.blockTime) || result.blockTime < 0 ||
      !Array.isArray(result.transaction) || result.transaction[1] !== 'base64' || typeof result.transaction[0] !== 'string' ||
      !result.meta || typeof result.meta !== 'object' || Array.isArray(result.meta) || result.meta.err !== null) throw new Error('invalid finalized transaction response');
  const bytes = Buffer.from(result.transaction[0], 'base64');
  if (bytes.toString('base64') !== result.transaction[0]) throw new Error('noncanonical finalized transaction bytes');
  const transaction = VersionedTransaction.deserialize(bytes);
  const version=transaction.message.version;
  if(version!=='legacy'&&version!==0)throw new Error('unsupported finalized transaction message version');
  if (!Buffer.from(transaction.serialize()).equals(bytes) || transaction.signatures.length!==transaction.message.header.numRequiredSignatures ||
      !transaction.signatures.length || transaction.signatures.some(sig=>sig.length!==64||sig.every(b=>b===0))) throw new Error('invalid finalized transaction signatures');
  if(base58Encode(transaction.signatures[0])!==signature)throw new Error('finalized transaction signature mismatch');
  if(result.version!==undefined&&result.version!==(version==='legacy'?'legacy':0))throw new Error('finalized message version mismatch');
  return { result, transaction };
}

function messageParts(transaction:VersionedTransaction):{version:'legacy'|0;header:RawCompiledMessage['header'];staticKeys:PublicKey[];recentBlockhash:string;instructions:RawCompiledInstruction[];lookups:NonNullable<RawCompiledMessage['addressTableLookups']>}{
  const message=transaction.message;
  if(message.version==='legacy')return {version:'legacy',header:message.header,staticKeys:message.accountKeys,recentBlockhash:message.recentBlockhash,instructions:message.instructions.map(ix=>({programIdIndex:ix.programIdIndex,accounts:[...ix.accounts],data:ix.data})),lookups:[]};
  if(message.version!==0)throw new Error('unsupported finalized transaction message version');
  return {version:0,header:message.header,staticKeys:message.staticAccountKeys,recentBlockhash:message.recentBlockhash,
    instructions:message.compiledInstructions.map(ix=>({programIdIndex:ix.programIdIndex,accounts:[...ix.accountKeyIndexes],data:base58Encode(ix.data)})),
    lookups:message.addressTableLookups.map(x=>({accountKey:x.accountKey.toBase58(),writableIndexes:[...x.writableIndexes],readonlyIndexes:[...x.readonlyIndexes]}))};
}
function strictBase64(value:string,label:string):Buffer{
  const bytes=Buffer.from(value,'base64');if(!value||bytes.toString('base64')!==value)throw new Error(`invalid ${label} base64`);return bytes;
}
function lookupState(proof:LookupTableEvidence,expectedAddress:string):AddressLookupTableAccount{
  if(proof.address!==expectedAddress||proof.owner!==AddressLookupTableProgram.programId.toBase58())throw new Error('address lookup table identity/owner mismatch');
  const data=strictBase64(proof.dataBase64,'lookup table');if(hash(data)!==proof.dataDigest)throw new Error('address lookup table evidence digest mismatch');
  const state=AddressLookupTableAccount.deserialize(data);return new AddressLookupTableAccount({key:new PublicKey(proof.address),state});
}
function resolveKeys(transaction:VersionedTransaction,proofs:LookupTableEvidence[],parsed:ParsedFinalizedRpcResult):{keys:PublicKey[];signer:boolean[];writable:boolean[]}{
  const parts=messageParts(transaction),staticKeys=parts.staticKeys,header=parts.header;
  let loadedWritable:PublicKey[]=[],loadedReadonly:PublicKey[]=[];
  if(parts.version==='legacy'){
    if(proofs.length)throw new Error('legacy transaction contains unexpected lookup-table evidence');
    if(parts.lookups.length)throw new Error('legacy transaction has lookup-table references');
  }else if(parts.lookups.length){
    if(proofs.length!==new Set(parts.lookups.map(x=>x.accountKey)).size)throw new Error('missing or duplicate address lookup table evidence');
    const proofByAddress=new Map(proofs.map(p=>[p.address,p]));
    if(proofByAddress.size!==proofs.length)throw new Error('duplicate address lookup table evidence');
    for(const lookup of parts.lookups){
      const proof=proofByAddress.get(lookup.accountKey);if(!proof)throw new Error('address lookup table evidence unavailable');
      const state=lookupState(proof,lookup.accountKey).state;
      if(!Number.isSafeInteger(proof.contextSlot)||proof.contextSlot<parsed.slot||state.deactivationSlot!==BigInt('18446744073709551615')||state.lastExtendedSlot>parsed.slot)throw new Error('address lookup table state is not valid for transaction slot');
      for(const index of lookup.writableIndexes){if(index>=state.addresses.length||state.lastExtendedSlot===parsed.slot&&index>=state.lastExtendedSlotStartIndex)throw new Error('address lookup writable index unavailable at transaction slot');loadedWritable.push(state.addresses[index]);}
      for(const index of lookup.readonlyIndexes){if(index>=state.addresses.length||state.lastExtendedSlot===parsed.slot&&index>=state.lastExtendedSlotStartIndex)throw new Error('address lookup readonly index unavailable at transaction slot');loadedReadonly.push(state.addresses[index]);}
    }
    const loaded=(parsed.meta as typeof parsed.meta&{loadedAddresses?:{writable?:string[];readonly?:string[]}})?.loadedAddresses;
    if(!loaded||canonical(loaded.writable)!==canonical(loadedWritable.map(x=>x.toBase58()))||canonical(loaded.readonly)!==canonical(loadedReadonly.map(x=>x.toBase58())))throw new Error('parsed loaded addresses do not match validated lookup tables');
  }else {
    if(proofs.length)throw new Error('unexpected address lookup table evidence');
    const loaded=(parsed.meta as typeof parsed.meta&{loadedAddresses?:{writable?:string[];readonly?:string[]}})?.loadedAddresses;
    if(loaded&&(loaded.writable?.length||loaded.readonly?.length))throw new Error('unexpected parsed loaded addresses');
  }
  const keys=[...staticKeys,...loadedWritable,...loadedReadonly],signer=keys.map((_,index)=>index<header.numRequiredSignatures);
  const writable=keys.map((_,index)=>index<staticKeys.length
    ? index<header.numRequiredSignatures?index<header.numRequiredSignatures-header.numReadonlySignedAccounts:index<staticKeys.length-header.numReadonlyUnsignedAccounts
    : index<staticKeys.length+loadedWritable.length);
  return {keys,signer,writable};
}
function validateParsedBinding(transaction:VersionedTransaction,parsed:ParsedFinalizedRpcResult,wire:FinalizedRpcResult):ParsedFinalizedRpcResult{
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||!parsed.transaction||!parsed.meta)throw new Error('invalid parsed finalized transaction response');
  if(parsed.slot!==wire.slot||parsed.blockTime!==wire.blockTime||parsed.meta.err!==null||canonical(executionMeta(parsed.meta))!==canonical(executionMeta(wire.meta)))throw new Error('parsed and wire execution metadata conflict');
  const signatures=transaction.signatures.map(base58Encode);
  if(canonical(parsed.transaction.signatures)!==canonical(signatures))throw new Error('parsed transaction signature list mismatch');
  const compiled=parsed.compiledRpcResult;
  if(!compiled||compiled.slot!==wire.slot||compiled.blockTime!==wire.blockTime||compiled.meta?.err!==null||canonical(executionMeta(compiled.meta))!==canonical(executionMeta(wire.meta))||canonical(compiled.transaction?.signatures)!==canonical(signatures))throw new Error('compiled RPC transaction identity/metadata mismatch');
  const parts=messageParts(transaction),raw=compiled.transaction.message;
  if(!raw||canonical(raw.header)!==canonical(parts.header)||raw.recentBlockhash!==parts.recentBlockhash||canonical(raw.accountKeys)!==canonical(parts.staticKeys.map(k=>k.toBase58()))||canonical(raw.instructions)!==canonical(parts.instructions)||canonical(raw.addressTableLookups??[])!==canonical(parts.lookups)||compiled.version!==undefined&&compiled.version!==(parts.version==='legacy'?'legacy':0))throw new Error('compiled RPC message does not match serialized transaction bytes');
  const resolved=resolveKeys(transaction,parsed.lookupTableEvidence??[],parsed);
  const parsedKeys=parsed.transaction.message.accountKeys;
  if(parsedKeys.length!==resolved.keys.length||parsedKeys.some((key,index)=>key.pubkey!==resolved.keys[index].toBase58()||key.signer!==resolved.signer[index]||key.writable!==resolved.writable[index]))throw new Error('parsed account keys or derived signer/writable privileges mismatch');
  const canonicalInstructions=parts.instructions.map(ix=>({programId:resolved.keys[ix.programIdIndex]?.toBase58(),accounts:ix.accounts.map(index=>resolved.keys[index]?.toBase58()),data:ix.data}));
  if(canonicalInstructions.some(ix=>!ix.programId||ix.accounts.some(account=>!account)))throw new Error('compiled instruction account index out of range');
  const parsedInstructions=parsed.transaction.message.instructions;
  if(parsedInstructions.length!==canonicalInstructions.length)throw new Error('parsed top-level instruction count mismatch');
  for(let i=0;i<parsedInstructions.length;i++){
    const actual=parsedInstructions[i],expected=canonicalInstructions[i];
    if(actual.programId!==expected.programId)throw new Error('parsed top-level program id mismatch');
    if(actual.accounts!==undefined&&canonical(actual.accounts)!==canonical(expected.accounts))throw new Error('parsed top-level account order mismatch');
    if(actual.data!==undefined&&actual.data!==expected.data)throw new Error('parsed top-level instruction data mismatch');
  }
  validateParsedInnerInstructions(parsed,compiled,canonicalInstructions,resolved.keys);
  return parsed;
}
function validateParsedInnerInstructions(parsed:ParsedFinalizedRpcResult,compiled:ParsedFinalizedRpcResult['compiledRpcResult'],topLevel:{programId:string;accounts:string[];data:string}[],keys:PublicKey[]):void{
  const rawGroups=((compiled.meta.innerInstructions??[]) as {index:number;instructions:RawCompiledInstruction[]}[]),parsedGroups=parsed.meta.innerInstructions??[];
  if(rawGroups.length!==parsedGroups.length)throw new Error('parsed inner-instruction groups mismatch');
  for(let g=0;g<rawGroups.length;g++){
    const raw=rawGroups[g],view=parsedGroups[g];if(raw.index!==view.index||raw.index<0||raw.index>=topLevel.length||raw.instructions.length!==view.instructions.length)throw new Error('parsed inner-instruction order mismatch');
    for(let j=0;j<raw.instructions.length;j++){
      const rawIx=raw.instructions[j],viewIx=view.instructions[j],program=keys[rawIx.programIdIndex]?.toBase58();
      if(!program||viewIx.programId!==program)throw new Error('parsed inner program id mismatch');
      if(program==='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'&&viewIx.parsed?.type==='transfer'){
        const data=base58Decode(rawIx.data),accounts=rawIx.accounts.map(index=>keys[index]?.toBase58());
        if(data.length!==9||data[0]!==3||accounts.length<3||accounts.some(x=>!x))throw new Error('invalid compiled token transfer evidence');
        const amount=new DataView(data.buffer,data.byteOffset,data.byteLength).getBigUint64(1,true).toString(),info=viewIx.parsed.info;
        if(info.source!==accounts[0]||info.destination!==accounts[1]||info.authority!==accounts[2]||info.amount!==amount)throw new Error('parsed token transfer does not match compiled inner instruction');
      }
    }
  }
}
function validateParsedShapeAndBind(transaction:VersionedTransaction,raw:FinalizedRpcResult,parsedValue:unknown):ParsedFinalizedRpcResult{
  if(!parsedValue||typeof parsedValue!=='object'||Array.isArray(parsedValue))throw new Error('invalid parsed finalized transaction response');
  const parsed=parsedValue as ParsedFinalizedRpcResult;
  return validateParsedBinding(transaction,parsed,raw);
}

/** Checks each source independently. Only explicit source unavailability or a
 * null transaction permits fallback; malformed or invalid returned evidence is fatal. */
export async function acquireFinalizedEvidence(
  primary: FinalizedTransactionSource,
  archive: FinalizedTransactionSource | null,
  expected: { networkId: string; genesis: string; program: string; signature: string; subjectKind: VerifiedTransactionEvidence['subjectKind']; subjectId: string; subjectAction: string },
  inspect: FinalityCheck,
): Promise<VerifiedTransactionEvidence> {
  const candidates: Array<{ source: FinalizedTransactionSource; kind: 'primary' | 'archive' }> = [{ source: primary, kind: 'primary' }];
  if (archive && archive !== primary) candidates.push({ source: archive, kind: 'archive' });
  const found: Array<{ source: FinalizedTransactionSource; kind: 'primary' | 'archive'; result: FinalizedRpcResult; parsed: ParsedFinalizedRpcResult; transaction: VersionedTransaction }> = [];
  const observed: Array<{kind:'primary'|'archive';result:FinalizedRpcResult;transaction:VersionedTransaction}> = [];
  const unavailable: string[]=[];
  for (const candidate of candidates) {
    let genesis:string;
    try{genesis=await candidate.source.getGenesisHash();}
    catch(error){if(error instanceof EvidenceSourceUnavailableError){unavailable.push(`${candidate.kind}: ${candidate.source.label} unavailable`);continue;}throw error;}
    if(genesis!==expected.genesis)throw new EvidenceValidationError(`${candidate.kind} source genesis mismatch`);
    let value:FinalizedRpcResult|null;
    try{value=await candidate.source.getTransaction(expected.signature);}
    catch(error){if(error instanceof EvidenceSourceUnavailableError){unavailable.push(`${candidate.kind}: ${candidate.source.label} unavailable`);continue;}throw error;}
    if(value===null)continue;
    const checked=validation(`${candidate.kind} wire transaction`,()=>validateShape(value,expected.signature));observed.push({kind:candidate.kind,result:checked.result,transaction:checked.transaction});
    let parsedValue:ParsedFinalizedRpcResult|null;
    try{parsedValue=await candidate.source.getParsedTransaction(expected.signature);}
    catch(error){if(error instanceof EvidenceSourceUnavailableError){unavailable.push(`${candidate.kind}: ${candidate.source.label} unavailable`);continue;}throw error;}
    if(parsedValue===null)throw new EvidenceValidationError(`${candidate.kind} parsed transaction missing while wire transaction was returned`);
    const parsed=validation(`${candidate.kind} parsed transaction binding`,()=>validateParsedShapeAndBind(checked.transaction,checked.result,parsedValue));
    await validationAsync(`${candidate.kind} instruction/account verification`,()=>inspect(parsed, expected.signature));
    found.push({ ...candidate, result:checked.result, parsed, transaction:checked.transaction });
  }
  if (!found.length) throw new Error(`finalized history unavailable (${unavailable.join('; ')||'transaction absent'})`);
  if (observed.length > 1) {
    const first=observed[0];
    for(const next of observed.slice(1))if(!Buffer.from(first.transaction.serialize()).equals(Buffer.from(next.transaction.serialize()))||first.result.slot!==next.result.slot||first.result.blockTime!==next.result.blockTime||canonical(executionMeta(first.result.meta))!==canonical(executionMeta(next.result.meta)))throw new EvidenceValidationError('primary/archive finalized evidence conflict');
  }
  if(found.length>1&&canonical(found[0].parsed)!==canonical(found[1].parsed))throw new EvidenceValidationError('primary/archive parsed finalized evidence conflict');
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
  return validationAsync('retained transaction evidence',async()=>{
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid retained evidence');
  const r = value as Record<string, unknown>;
  const string = (k:string) => { if(typeof r[k]!=='string')throw new Error('invalid retained evidence '+k);return r[k] as string; };
  const parsed = r.parsedRpcResult as ParsedFinalizedRpcResult;
  const wire = r.rpcResult as FinalizedRpcResult;
  const encoded=string('transactionBase64'),lines=encoded.split('\n');
  if(lines.some((line,index)=>line.length===0||(lines.length>1&&(line.length>76||(index<lines.length-1&&line.length!==76)))))throw new Error('invalid retained base64 wrapping');
  const transactionBase64=lines.join(''),bytes = Buffer.from(transactionBase64,'base64');
  const tx = VersionedTransaction.deserialize(bytes), slot=Number(r.slot), blockTime=Number(r.blockTime);
  if (r.formatVersion!==1 || r.subjectKind!==expected.subjectKind || r.subjectId!==expected.subjectId || r.subjectAction!==expected.subjectAction || r.networkId!==expected.networkId || r.genesis!==expected.genesis || r.program!==expected.program || r.signature!==expected.signature || r.finality!=='finalized' || !['primary','archive'].includes(String(r.sourceKind)) || !Number.isSafeInteger(slot) || !Number.isSafeInteger(blockTime) || !/^[0-9a-f]{64}$/.test(string('transactionDigest')) || hash(bytes)!==r.transactionDigest || hash(tx.message.serialize())!==r.messageDigest ||
      bytes.toString('base64')!==transactionBase64 || wire.transaction?.[0]!==transactionBase64 || wire.transaction?.[1]!=='base64' || wire.slot!==slot || wire.blockTime!==blockTime || parsed?.slot!==slot || parsed?.blockTime!==blockTime || wire.meta?.err!==null) throw new Error('retained evidence identity or integrity mismatch');
  const checked=validateShape(wire,expected.signature);
  if(!Buffer.from(checked.transaction.serialize()).equals(bytes))throw new Error('retained transaction bytes mismatch');
  const bound=validateParsedShapeAndBind(checked.transaction,wire,parsed);
  await inspect(bound,expected.signature);
  return {...r,transactionBase64,slot:wire.slot,blockTime:wire.blockTime,parsedRpcResult:bound} as unknown as VerifiedTransactionEvidence;
  });
}

/** RPC adapter for explicitly configured local primary/archive services. */
export class LocalFinalizedRpcSource implements FinalizedTransactionSource {
  readonly url: string;
  constructor(url: string, readonly label: string, private readonly request: typeof fetch = fetch) {
    if (!/^[A-Za-z0-9._:-]{1,96}$/.test(label)) throw new Error('explicit evidence source label required');
    this.url = localRpc(url);
  }
  private async call(method: string, params: unknown[]): Promise<unknown> {
    let response:Response;
    try{response=await this.request(this.url, { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: `evidence-${method}`, method, params }) });}
    catch(error){throw new EvidenceSourceUnavailableError(this.label,method,{cause:error});}
    if(response.status===429||response.status>=500)throw new EvidenceSourceUnavailableError(this.label,method);
    if(!response.ok)throw new EvidenceValidationError(`invalid source HTTP response (${response.status})`);
    let body:Record<string,unknown>;
    try{body=parseFinalizedRpcJson(await response.text()) as Record<string,unknown>;}catch(error){throw new EvidenceValidationError('malformed source JSON',{cause:error});}
    if(!body||typeof body!=='object'||Array.isArray(body))throw new EvidenceValidationError('invalid source JSON response');
    if(body.error){const rpcError=body.error as {code?:unknown};if(typeof rpcError.code==='number'&&[-32004,-32005,-32007,-32009,-32011,-32014].includes(rpcError.code))throw new EvidenceSourceUnavailableError(this.label,method);throw new EvidenceValidationError('unrecognized RPC error');}
    if(!Object.hasOwn(body,'result'))throw new EvidenceValidationError('source response omitted result');
    return body.result;
  }
  async getGenesisHash(): Promise<string> { const value = await this.call('getGenesisHash', []); if (typeof value !== 'string') throw new Error('invalid evidence source genesis'); return value; }
  async getTransaction(signature: string): Promise<FinalizedRpcResult | null> {
    const value = await this.call('getTransaction', [signature, { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
    return value === null ? null : value as FinalizedRpcResult;
  }
  async getParsedTransaction(signature: string): Promise<ParsedFinalizedRpcResult | null> {
    const parsed=await this.call('getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
    const compiled=await this.call('getTransaction', [signature, { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
    if(parsed===null&&compiled===null)return null;
    if(!parsed||!compiled||typeof parsed!=='object'||typeof compiled!=='object')throw new Error('parsed/compiled RPC transaction response conflict');
    const parsedResult=parsed as ParsedFinalizedRpcResult,compiledResult=compiled as ParsedFinalizedRpcResult['compiledRpcResult'];
    const lookups=compiledResult.transaction?.message?.addressTableLookups??[];
    const proofs:LookupTableEvidence[]=[];
    for(const lookup of lookups){const proof=await this.getAddressLookupTableEvidence(lookup.accountKey,compiledResult.slot);if(!proof)throw new Error('address lookup table evidence unavailable');proofs.push({...proof,dataDigest:hash(strictBase64(proof.dataBase64,'lookup table'))});}
    return {...parsedResult,compiledRpcResult:compiledResult,lookupTableEvidence:proofs};
  }
  async getAddressLookupTableEvidence(address:string,minContextSlot:number):Promise<Omit<LookupTableEvidence,'dataDigest'>|null>{
    const value=await this.call('getAccountInfo',[address,{encoding:'base64',commitment:'finalized',minContextSlot}]);
    if(value===null)return null;
    if(!value||typeof value!=='object')throw new Error('invalid address lookup account response');
    const account=value as {context?:{slot?:unknown};value?:{owner?:unknown;data?:unknown}},item=account.value,contextSlot=account.context?.slot;
    if(!item||typeof item.owner!=='string'||!Array.isArray(item.data)||typeof item.data[0]!=='string'||item.data[1]!=='base64'||!Number.isSafeInteger(contextSlot)||Number(contextSlot)<minContextSlot)throw new Error('invalid address lookup account data/context');
    return {address,owner:item.owner,contextSlot:Number(contextSlot),dataBase64:item.data[0]};
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
