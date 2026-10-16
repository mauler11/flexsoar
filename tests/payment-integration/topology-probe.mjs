// Actual LOCAL validator + dedicated verifier/database connection. NOT a payment scenario.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,openSync,mkdtempSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {join} from 'node:path';
import {Connection,Keypair,PublicKey} from '@solana/web3.js';
import {LocalV2Observer} from '../../lib/solana/v2-observer.ts';
import {reconcilePayments} from '../../lib/db/payment-reconciliation.ts';
import {createPaymentPostgresTransport} from '../../lib/db/payment-postgres.ts';
if(process.argv.slice(2).join(' ')!=='--run-isolated-probe')throw new Error('Explicit isolated probe required');
const interfaces=readFileSync('/proc/net/dev','utf8').split('\n').slice(2).filter(s=>s.includes(':')).map(s=>s.split(':')[0].trim());
assert.deepEqual(interfaces,['lo']);assert.equal(readFileSync('/proc/net/route','utf8').trim().split('\n').length,1);
assert.equal(createHash('sha256').update(readFileSync('/tools/program.so')).digest('hex'),'99aa6bec4e949de3484bc7fef0b70a83b040bdf92a1060871fe4de8d4c64743c');
const runRoot=mkdtempSync('/state/probe-');const state=name=>join(runRoot,name);
if(existsSync(state('validator-ledger')))throw new Error('Never reset/reuse a prior ledger');
for(const port of [18899,18900,18901])await new Promise((ok,bad)=>{const s=net.createServer();s.once('error',bad);s.listen(port,'127.0.0.1',()=>s.close(ok));});
const rpc='http://127.0.0.1:18899',program='CgvCAabXMe1axVCK81yAtRyNFnLM5oExtvh5K16TDcSF';
const bootstrap=Keypair.generate(); // Ephemeral, never saved; no operational key files.
writeFileSync(state('validator-config.json'),JSON.stringify({json_rpc_url:rpc,websocket_url:'ws://127.0.0.1:18900',keypair_path:state('unused-wallet-does-not-exist.json'),commitment:'finalized'}),{flag:'wx'});
const log=openSync(state('validator-process.log'),'wx');
const child=spawn('/tools/runtime/ld-linux-x86-64.so.2',['--library-path','/tools/runtime','/tools/agave/solana-test-validator','--config',state('validator-config.json'),'--url',rpc,'--mint',bootstrap.publicKey.toBase58(),'--bind-address','127.0.0.1','--rpc-port','18899','--faucet-port','18901','--gossip-port','18902','--dynamic-port-range','19000-19020','--ledger',state('validator-ledger'),'--upgradeable-program',program,'/tools/program.so',bootstrap.publicKey.toBase58()],{stdio:['ignore',log,log],env:{...process.env,RAYON_NUM_THREADS:'2'}});
const pause=ms=>new Promise(r=>setTimeout(r,ms));const connection=new Connection(rpc,'finalized');
try{
 let genesis;
 for(let i=0;i<120;i++){
  if(child.exitCode!==null)throw new Error('Owned validator exited: inspect validator-process.log');
  try{genesis=await connection.getGenesisHash();break;}catch{await pause(500);}
 }
 assert.ok(genesis,'validator startup timed out');
 const listeners=()=>['tcp','tcp6'].flatMap(kind=>readFileSync('/proc/net/'+kind,'utf8').trim().split('\n').slice(1).map(line=>line.trim().split(/\s+/)).filter(row=>row[3]==='0A').map(row=>({address:row[1].split(':')[0],port:parseInt(row[1].split(':')[1],16)})));
 let bound=[];for(let i=0;i<30;i++){bound=listeners();if([5432,18899,18900,18901].every(port=>bound.some(r=>r.port===port)))break;await pause(100);}
 assert.ok([5432,18899,18900,18901].every(port=>bound.some(r=>r.port===port)),'required DB/RPC/pubsub/faucet bindings absent');
 // Agave2.1 wildcard sockets are reachable ONLY via lo in this network-none namespace.
 assert.ok(bound.every(r=>['0100007F','00000000','00000000000000000000000000000000','00000000000000000000000001000000'].includes(r.address)),'unexpected nonlocal binding');
 writeFileSync(state('live-bindings.json'),JSON.stringify({interfaces,route:readFileSync('/proc/net/route','utf8'),listeners:bound},null,2),{flag:'wx'});

 const signature=await connection.requestAirdrop(bootstrap.publicKey,1000000000);
 let finalized=false;
 for(let i=0;i<240;i++){const status=(await connection.getSignatureStatuses([signature],{searchTransactionHistory:true})).value[0];if(status?.confirmationStatus==='finalized'){assert.equal(status.err,null);finalized=true;break;}await pause(500);}
 assert.ok(finalized,'local finality timeout');
 const account=await connection.getAccountInfo(new PublicKey(program),'finalized');assert.ok(account?.executable,'actual reviewed program is deployed locally');
 const observer=new LocalV2Observer(rpc,program,genesis);assert.deepEqual(await observer.scan(),[]);
 const transport=label=>createPaymentPostgresTransport({role:'payment_v2_'+label,login:'payment_integration_'+label,host:'127.0.0.1',port:5432,database:'flexsoar_payment_v2_test',sslMode:'disable'});
 // No configured network/authority may be invented to make this succeed.
 await assert.rejects(()=>reconcilePayments(transport('verifier'),observer,1,transport('settler')),/PAYMENT_V2_NETWORK_UNKNOWN/);
 const result={classification:'topology-and-explicit-fail-closed-only',genesis,program,signature,finality:'finalized',interfaces,rpc,programExecutable:true,financialScenarios:'BLOCKED: accepted global staff cannot be replaced; separate integration DB required'};
 writeFileSync(state('topology-result.json'),JSON.stringify(result,null,2),{flag:'wx'});
 console.log('Evidence:',runRoot);
 console.log('ACTUAL LOOPBACK VALIDATOR FINALITY + PROGRAM + OBSERVER PASS');
 console.log('ACTUAL CHAIN OBSERVATION -> DEDICATED RPC FAILS CLOSED ON UNCONFIGURED NETWORK (expected)');
}finally{
 child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),pause(10000)]);
 if(child.exitCode===null)child.kill('SIGKILL'); // Only this exact owned child, never another service.
}
