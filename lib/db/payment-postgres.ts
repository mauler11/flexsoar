/** Dedicated libpq/psql transport. Explicit configuration only: no Supabase/admin fallback.
 * Each RPC has a real authenticated session_user and one transaction. This uses the
 * official psql client, avoiding a project dependency change. Never invoke from clients. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PaymentRpc } from './payment-v2';
const execute = promisify(execFile);
export type PaymentWorkerRole = 'payment_v2_issuer'|'payment_v2_verifier'|'payment_v2_settler'|'payment_v2_executor'|'payment_v2_notifier';
export interface PaymentPostgresConfig { role:PaymentWorkerRole; host:string; port:number; database:string; login:string; password?:string; sslMode:'verify-full'|'disable'; psqlPath?:string }
type Parameter = readonly [string,'uuid'|'text'|'integer'|'bigint'|'name'|'boolean'|'jsonb'|'bytea'];
const routes:Record<string,{role:PaymentWorkerRole;params:readonly Parameter[]}>={
 fn_payment_v2_prepare_sale:{role:'payment_v2_issuer',params:[['p_listing_id','uuid'],['p_network_id','uuid'],['p_terms','jsonb']]},
 fn_payment_v2_issuer_context:{role:'payment_v2_issuer',params:[['p_sale_id','uuid'],['p_action','text']]},
 fn_payment_v2_authorize_attempt:{role:'payment_v2_issuer',params:[['p_attempt_id','uuid']]},
 fn_payment_v2_issuer_subject_context:{role:'payment_v2_issuer',params:[['p_kind','text'],['p_subject_id','uuid'],['p_network_id','uuid']]},
 fn_payment_v2_issuer_enroll_wallet_checked:{role:'payment_v2_issuer',params:[['p_user','uuid'],['p_network','uuid'],['p_wallet','bytea'],['p_token_account','bytea'],['p_proof_digest','bytea']]},
 fn_payment_v2_consume_issuer_nonce:{role:'payment_v2_issuer',params:[['p_kid','text'],['p_nonce','bytea']]},
 fn_payment_v2_record_listing:{role:'payment_v2_issuer',params:[['p_sale','uuid'],['p_message','bytea'],['p_signature','bytea']]},
 fn_payment_v2_listing_for_open:{role:'payment_v2_issuer',params:[['p_sale','uuid']]},
 fn_payment_v2_open_sale_queue:{role:'payment_v2_issuer',params:[['p_limit','integer']]},
 fn_payment_v2_claim_open_sale:{role:'payment_v2_issuer',params:[['p_limit','integer']]},
 fn_payment_v2_renew_open_sale_lease:{role:'payment_v2_issuer',params:[['p_operation_id','uuid'],['p_lease_id','uuid'],['p_fencing_token','bigint']]},
 fn_payment_v2_finish_open_sale:{role:'payment_v2_issuer',params:[['p_operation_id','uuid'],['p_lease_id','uuid'],['p_fencing_token','bigint'],['p_outcome','text'],['p_signature','text']]},
 fn_payment_v2_begin_scan:{role:'payment_v2_verifier',params:[['p_genesis','text'],['p_program','text'],['p_limit','integer']]},
 fn_payment_v2_finish_scan:{role:'payment_v2_verifier',params:[['p_lease_id','uuid'],['p_last_address','text'],['p_failures','jsonb']]},
 fn_payment_v2_recovery_binding:{role:'payment_v2_verifier',params:[['p_attempt','text'],['p_genesis','text'],['p_program','text']]},
 fn_payment_v2_verifier_context:{role:'payment_v2_verifier',params:[['p_kind','text'],['p_subject_id','uuid']]},
 fn_payment_v2_attempt_context:{role:'payment_v2_verifier',params:[['p_attempt','text'],['p_genesis','text'],['p_program','text']]},
 fn_payment_v2_store_chain_evidence:{role:'payment_v2_verifier',params:[['p_evidence','jsonb']]},
 fn_payment_v2_read_chain_evidence:{role:'payment_v2_verifier',params:[['p_subject_kind','text'],['p_subject_id','uuid'],['p_subject_action','text']]},
 fn_payment_v2_record_verified_event:{role:'payment_v2_verifier',params:[['p_event','jsonb']]},
 fn_payment_v2_record_attestation:{role:'payment_v2_verifier',params:[['p_proof','jsonb']]},
 fn_payment_v2_record_lifecycle:{role:'payment_v2_verifier',params:[['p_proof','jsonb']]},
 fn_payment_v2_record_operation_failure:{role:'payment_v2_verifier',params:[['p_operation_id','uuid'],['p_proof','jsonb']]},
 fn_payment_v2_reconcile_event:{role:'payment_v2_settler',params:[['p_event_id','uuid']]},
 fn_payment_v2_ack_context:{role:'payment_v2_settler',params:[['p_event_id','uuid']]},
 fn_payment_v2_claim_operations:{role:'payment_v2_executor',params:[['p_worker_id','uuid'],['p_limit','integer']]},
 fn_payment_v2_finish_operation:{role:'payment_v2_executor',params:[['p_operation_id','uuid'],['p_lease_id','uuid'],['p_outcome','text'],['p_signature','text'],['p_error','text']]},
 fn_payment_v2_operation_context:{role:'payment_v2_executor',params:[['p_operation_id','uuid'],['p_lease_id','uuid']]},
 fn_payment_v2_signed_operation:{role:'payment_v2_executor',params:[['p_operation_id','uuid'],['p_lease_id','uuid']]},
 fn_payment_v2_stage_signed_operation:{role:'payment_v2_executor',params:[['p_operation_id','uuid'],['p_lease_id','uuid'],['p_envelope','jsonb']]},
 fn_payment_v2_claim_outbox:{role:'payment_v2_notifier',params:[['p_limit','integer']]},
 fn_payment_v2_finish_outbox:{role:'payment_v2_notifier',params:[['p_id','uuid'],['p_lease_id','uuid'],['p_delivered','boolean'],['p_error','text']]},
};
function parse(text:string):unknown { return JSON.parse(text,(_key,value:unknown)=>{if(typeof value==='number'&&Number.isInteger(value)&&!Number.isSafeInteger(value))throw new Error('unsafe database integer: RPC must return decimal strings');return value;}); }
/** No credential discovery or inherited libpq connection settings. Caller provisions
 * five different LOGINs; database role checks reject shared/privileged memberships. */
export function createPaymentPostgresTransport(c:PaymentPostgresConfig):PaymentRpc {
 if(!Object.values(routes).some(r=>r.role===c.role)||!/^[-a-zA-Z0-9.:]+$/.test(c.host)||!Number.isInteger(c.port)||c.port<1||c.port>65535||![c.database,c.login].every(s=>/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)))throw new Error('explicit payment database configuration required');
 if(['postgres','supabase_admin','service_role','authenticator','authenticated','anon','payment_v2_owner'].includes(c.login)||c.login.startsWith('payment_v2_'))throw new Error('dedicated nonprivileged LOGIN required');
 if(c.sslMode!=='verify-full'&&!(c.sslMode==='disable'&&['127.0.0.1','::1'].includes(c.host)))throw new Error('verified TLS required outside literal loopback');
 const env:NodeJS.ProcessEnv={NODE_ENV:process.env.NODE_ENV,PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,PGHOST:c.host,PGPORT:String(c.port),PGDATABASE:c.database,PGUSER:c.login,PGSSLMODE:c.sslMode,PGGSSENCMODE:'disable',PGCONNECT_TIMEOUT:'5',PGPASSFILE:process.platform==='win32'?'NUL':'/dev/null',PGAPPNAME:'flexsoar-'+c.role};
 if(c.password!==undefined)env.PGPASSWORD=c.password;
 return {async rpc(name,args){
  const identity=name==='fn_payment_v2_worker_identity';
  const route=identity?{role:c.role,params:[['p_required_role','name']] as const}:routes[name];
  if(!route||route.role!==c.role||Object.keys(args).sort().join(',')!==route.params.map(p=>p[0]).sort().join(',')||(identity&&args.p_required_role!==c.role))throw new Error('RPC is not allowed for this payment worker');
  const expressions=route.params.map(([key,type])=>`(:'payload'::jsonb ${type==='jsonb'?'->':'->>'} '${key}')::${type}`);
  const sql=`BEGIN;\nSET LOCAL ROLE ${c.role};\nSELECT session_user=:'expected_login'::name AS correct_login \\gset\n\\if :correct_login\nSELECT public.fn_payment_v2_worker_identity('${c.role}');\nSELECT jsonb_build_object('value',public.${name}(${expressions.join(',')}));\nCOMMIT;\n\\else\n\\quit 3\n\\endif\n`;
  try {
   const payload=JSON.stringify(args,(_key,value:unknown)=>{if(typeof value==='number'&&(!Number.isFinite(value)||(Number.isInteger(value)&&!Number.isSafeInteger(value))))throw new Error('unsafe input number: use decimal strings');return value;});
   const argv=['-X','-q','-At','-v','ON_ERROR_STOP=1','-v','expected_login='+c.login,'-v','payload='+payload];
   // stdin avoids a shell and psql quotes payload as a literal. No SQL from callers.
   const child=execute(c.psqlPath??'psql',argv,{env,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024,windowsHide:true});
   child.child.stdin?.end(sql);
   const {stdout}=await child;const lines=stdout.trim().split(/\r?\n/).filter(Boolean);
   if(lines.length!==2)throw new Error('unexpected worker response');
   const who=parse(lines[0]);if(!who||typeof who!=='object'||!('login'in who)||who.login!==c.login||!('role'in who)||who.role!==c.role||!('superuser'in who)||who.superuser!==false)throw new Error('worker identity mismatch');
   const result=parse(lines[1]);if(!result||typeof result!=='object'||!('value'in result))throw new Error('invalid RPC result');
   return {data:result.value,error:null};
  } catch (error) {
   const detail=error&&typeof error==='object'&&'stderr'in error&&typeof error.stderr==='string'&&error.stderr?error.stderr:error instanceof Error&&!('cmd'in error)?error.message:'psql did not return a validated commit';
   // A timeout/disconnect may follow COMMIT. Never classify this as unpaid/unsent.
   return {data:null,error:{code:'PAYMENT_DB_OUTCOME_UNKNOWN',message:detail+'\nDedicated database RPC failed; it may have committed. Recover using the original durable identity; do not pay or sign again.'}};
  }
 }};
}
