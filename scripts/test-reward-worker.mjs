import assert from 'node:assert/strict';
import {toBase58} from '@mysten/sui/utils';
import {fixture} from './test-reward-verifier.mjs';
import {processRewardCheckpoint,rewardPolicyHash} from '../server/reward-worker.mjs';
const digest=n=>toBase58(new Uint8Array(32).fill(n));
let checks=0;
async function setup(){
 const f=await fixture();
 const cursor={next_checkpoint:'10',previous_digest:digest(10),policy_hash:await rewardPolicyHash(f.input.policy)};
 const cp={sequenceNumber:10n,digest:digest(11),summary:{previousDigest:cursor.previous_digest,timestamp:f.tx.timestamp},contents:{transactions:[{transaction:f.tx.digest}]},transactions:[f.tx]};
 let writes=0;
 const input={reader:{...f.input.reader,checkpoint:async()=>cp},policy:f.input.policy,workerId:'fixture',contextForTransaction:async()=>({plan:f.input.plan}),store:{cursor:async()=>structuredClone(cursor),commit:async batch=>{writes++;assert.equal(batch.checkpoint,cursor.next_checkpoint);cursor.next_checkpoint=String(BigInt(batch.checkpoint)+1n);cursor.previous_digest=batch.checkpointDigest}}};
 return {f,input,cursor,cp,writes:()=>writes};
}
const s=await setup();let batch;
s.input.store.commit=async value=>{batch=value;s.cursor.next_checkpoint='11';s.cursor.previous_digest=value.checkpointDigest};
assert.equal((await processRewardCheckpoint(s.input)).receiptCount,1);assert.equal(batch.receipts[0].kind,'Funded');assert.equal(batch.receipts[0].transactionIndex,0);checks++;
for(const [name,mutate] of [
 ['policy changed',s=>s.cursor.policy_hash='bad'],
 ['wrong chain',s=>s.input.reader.serviceInfo=async()=>({chain:'testnet'})],
 ['missing checkpoint',s=>s.cp.sequenceNumber=11n],
 ['broken checkpoint continuity',s=>s.cp.summary.previousDigest=digest(12)],
 ['partial checkpoint',s=>s.cp.contents.transactions=[]],
 ['wrong transaction order',s=>s.cp.contents.transactions[0].transaction=digest(12)],
 ['duplicate transaction',s=>{s.cp.transactions.push(s.f.tx);s.cp.contents.transactions.push(s.cp.contents.transactions[0])}],
 ['malformed events',s=>s.f.tx.events={events:null}],
 ['unmapped event',s=>s.input.contextForTransaction=async()=>null],
 ['verification failure',s=>s.f.tx.effects.status.success=false],
 ['missing historical object',s=>s.input.reader.object=async()=>null],
 ['missing timestamp',s=>delete s.cp.summary.timestamp],
]){const s=await setup();mutate(s);await assert.rejects(processRewardCheckpoint(s.input),undefined,name);assert.equal(s.writes(),0);checks++}
const caught=await setup();caught.cursor.next_checkpoint='12';assert.equal((await processRewardCheckpoint(caught.input)).status,'caught-up');assert.equal(caught.writes(),0);checks++;
const empty=await setup();empty.cp.transactions=[];empty.cp.contents.transactions=[];assert.equal((await processRewardCheckpoint(empty.input)).receiptCount,0);assert.equal(empty.cursor.next_checkpoint,'11');checks++;
const noEvents=await setup();delete noEvents.f.tx.events;assert.equal((await processRewardCheckpoint(noEvents.input)).receiptCount,0);checks++;
const retry=await setup();retry.input.store.commit=async()=>{throw Error('database unavailable')};await assert.rejects(processRewardCheckpoint(retry.input));assert.equal(retry.cursor.next_checkpoint,'10');checks++;
// A payout in the same checkpoint must see the funding event's staged balance.
const ordered=await setup(),paid=await fixture('Paid');
paid.tx.digest=digest(20);paid.tx.effects.transactionDigest=paid.tx.digest;
Object.assign(paid.change,{inputVersion:3n,inputDigest:digest(21),outputVersion:4n,outputDigest:digest(22)});
Object.assign(paid.objects[0],{version:3n,digest:digest(21)});
Object.assign(paid.objects[1],{version:4n,digest:digest(22),previousTransaction:paid.tx.digest});
ordered.cp.transactions.push(paid.tx);ordered.cp.contents.transactions.push({transaction:paid.tx.digest});
const originalObject=ordered.input.reader.object;
ordered.input.reader.object=async(id,version)=>version===3n?paid.objects[0]:version===4n?paid.objects[1]:originalObject(id,version);
ordered.input.contextForTransaction=async tx=>({plan:ordered.f.input.plan,payment:tx.digest===paid.tx.digest?paid.input.payment:undefined});
assert.equal((await processRewardCheckpoint(ordered.input)).receiptCount,2);assert.equal(ordered.f.input.plan.state,'Frozen');checks++;
// A response lost after successful atomic commit is recovered by reloading cursor.
const lost=await setup();const commit=lost.input.store.commit;
lost.input.store.commit=async batch=>{await commit(batch);throw Error('response lost')};
await assert.rejects(processRewardCheckpoint(lost.input));assert.equal(lost.cursor.next_checkpoint,'11');
lost.input.reader.serviceInfo=async()=>({...await lost.f.input.reader.serviceInfo(),checkpointHeight:10n});
assert.equal((await processRewardCheckpoint(lost.input)).status,'caught-up');assert.equal(lost.writes(),1);checks++;
console.log(`${checks} reward worker checks passed; no live network calls.`);
