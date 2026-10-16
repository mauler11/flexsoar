import {describe,it,expect,vi,beforeEach} from 'vitest';
const mock=vi.hoisted(()=>({stdout:'',stderr:'',fail:false,sql:'',argv:[] as string[],env:{} as Record<string,string|undefined>,calls:0}));
vi.mock('node:child_process',()=>{
 const fn=()=>{throw new Error('use Node execFile promisify contract');};
 Object.defineProperty(fn,Symbol.for('nodejs.util.promisify.custom'),{value:(_path:string,argv:string[],options:{env:Record<string,string|undefined>})=>{
  mock.calls++;mock.argv=argv;mock.env=options.env;
  let resolve:(value:{stdout:string;stderr:string})=>void=()=>{};let reject:(error:Error)=>void=()=>{};
  const p=new Promise<{stdout:string;stderr:string}>((ok,bad)=>{resolve=ok;reject=bad;});
  return Object.assign(p,{child:{stdin:{end:(sql:string)=>{mock.sql=sql;queueMicrotask(()=>mock.fail?reject(Object.assign(new Error('failed'),{stderr:mock.stderr})):resolve({stdout:mock.stdout,stderr:mock.stderr}));}}}});
 }});return {execFile:fn};
});
import {createPaymentPostgresTransport,type PaymentPostgresConfig} from '../lib/db/payment-postgres';
const config:PaymentPostgresConfig={role:'payment_v2_verifier',host:'127.0.0.1',port:5432,database:'flexsoar_payment_v2_test',login:'payment_integration_verifier',sslMode:'disable'};
const identity={login:config.login,role:config.role,superuser:false};
beforeEach(()=>{mock.stdout=JSON.stringify(identity)+'\n'+JSON.stringify({value:identity})+'\n';mock.stderr='';mock.fail=false;mock.calls=0;mock.sql='';});
describe('production dedicated psql transport',()=>{
 it('uses explicit login and database, transaction and server identity before RPC',async()=>{const r=await createPaymentPostgresTransport(config).rpc('fn_payment_v2_worker_identity',{p_required_role:config.role});expect(r.data).toEqual(identity);expect(mock.env.PGUSER).toBe(config.login);expect(mock.env.PGDATABASE).toBe(config.database);expect(mock.sql).toContain('BEGIN;\nSET LOCAL ROLE payment_v2_verifier;');expect(mock.sql).toContain('\\gset');expect(mock.sql.indexOf('correct_login')).toBeLessThan(mock.sql.indexOf('jsonb_build_object'));expect(mock.sql).toContain('COMMIT;');});
 it('refuses privileged credentials',()=>{for(const login of ['postgres','supabase_admin','service_role','authenticator','payment_v2_owner'])expect(()=>createPaymentPostgresTransport({...config,login})).toThrow('dedicated');expect(mock.calls).toBe(0);});
 it('refuses plaintext remote connections and invalid endpoints',()=>{expect(()=>createPaymentPostgresTransport({...config,host:'db.example.invalid'})).toThrow('TLS');expect(()=>createPaymentPostgresTransport({...config,port:0})).toThrow('configuration');});
 it('does not discover inherited connection credentials',async()=>{vi.stubEnv('PGSERVICE','production');vi.stubEnv('PGDATABASE','wrong_database');try{await createPaymentPostgresTransport(config).rpc('fn_payment_v2_worker_identity',{p_required_role:config.role});expect(mock.env.PGSERVICE).toBeUndefined();expect(mock.env.PGDATABASE).toBe(config.database);}finally{vi.unstubAllEnvs();}});
 it('does not put passwords in argv or SQL',async()=>{await createPaymentPostgresTransport({...config,password:'synthetic-test-only'}).rpc('fn_payment_v2_worker_identity',{p_required_role:config.role});expect(mock.env.PGPASSWORD).toBe('synthetic-test-only');expect(mock.argv.join(' ')+mock.sql).not.toContain('synthetic-test-only');});
 it('rejects cross-role RPCs, unexpected fields and arbitrary function names',async()=>{const c=createPaymentPostgresTransport(config);await expect(c.rpc('fn_payment_v2_reconcile_event',{p_event_id:'x'})).rejects.toThrow('not allowed');await expect(c.rpc('fn_payment_v2_worker_identity',{p_required_role:config.role,extra:true})).rejects.toThrow('not allowed');await expect(c.rpc('pg_sleep',{x:1})).rejects.toThrow('not allowed');expect(mock.calls).toBe(0);});
 it('keeps payload data out of SQL text',async()=>{const evil="x'); SELECT 1; --\n\\q";await createPaymentPostgresTransport(config).rpc('fn_payment_v2_recovery_binding',{p_attempt:evil,p_genesis:evil,p_program:evil});expect(mock.sql).not.toContain(evil);expect(mock.argv).toContain('payload='+JSON.stringify({p_attempt:evil,p_genesis:evil,p_program:evil}));});
 it('never fabricates success after a disconnect or lost COMMIT response',async()=>{mock.fail=true;mock.stderr='server closed the connection unexpectedly';const r=await createPaymentPostgresTransport(config).rpc('fn_payment_v2_worker_identity',{p_required_role:config.role});expect(r.data).toBeNull();expect(r.error?.code).toBe('PAYMENT_DB_OUTCOME_UNKNOWN');expect(r.error?.message).toContain(mock.stderr);expect(r.error?.message).toContain('do not pay or sign again');});
 it('rejects unexpected or privileged identity responses',async()=>{mock.stdout=JSON.stringify({...identity,superuser:true})+'\n'+JSON.stringify({value:identity});const r=await createPaymentPostgresTransport(config).rpc('fn_payment_v2_worker_identity',{p_required_role:config.role});expect(r.error).not.toBeNull();});
 it('refuses unsafe output integer precision instead of rounding money',async()=>{mock.stdout=JSON.stringify(identity)+'\n'+ '{"value":18446744073709551615}';const r=await createPaymentPostgresTransport(config).rpc('fn_payment_v2_worker_identity',{p_required_role:config.role});expect(r.error?.message).toContain('unsafe database integer');});
 it('refuses unsafe input integers',async()=>{const r=await createPaymentPostgresTransport(config).rpc('fn_payment_v2_record_verified_event',{p_event:{amount:Number.MAX_SAFE_INTEGER+1}});expect(r.error?.message).toContain('unsafe input');expect(mock.calls).toBe(0);});
});
