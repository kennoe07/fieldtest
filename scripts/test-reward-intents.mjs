import assert from 'node:assert/strict';
import {toBase58} from '@mysten/sui/utils';
import {prepareRewardIntent,reconcileFailedRewardIntent,loadRewardIntent} from '../server/reward-intents.mjs';
const digest=toBase58(new Uint8Array(32).fill(1));
let count=0;
const base={id:'intent',actor_id:'actor',tx_digest:digest,payload:{network:'sui:mainnet',packageId:'package'},state:'AwaitingWallet'};
function fixture(){
 const intent=structuredClone(base),info={chain:'mainnet',chainId:'genesis',checkpointHeight:10n},tx={digest,checkpoint:5n,effects:{transactionDigest:digest,status:{success:false,error:{description:'Move abort'}}}};
 let calls=0;
 const admin={from(){return {select(){return this},eq(key,value){if(intent[key]!==value)this.missing=true;return this},async maybeSingle(){return {data:this.missing?null:intent}}}},async rpc(name,args){calls++;assert.equal(name,'ft_transition_reward_intent');assert.equal(args.p_digest,digest);return {data:{...intent,state:'Failed'}}}};
 return {intent,info,tx,admin,calls:()=>calls,input:{admin,intentId:'intent',authenticatedActorId:'actor',policy:{network:'sui:mainnet',packageId:'package',genesisDigest:'genesis'},reader:{serviceInfo:async()=>info,transaction:async()=>tx}}};
}
const valid=fixture();assert.equal((await reconcileFailedRewardIntent(valid.input)).state,'Failed');assert.equal(valid.calls(),1);count++;
for(const mutate of [s=>s.tx.effects.status.success=true,s=>delete s.tx.effects.status.error,s=>s.tx.checkpoint=0n,s=>s.tx.checkpoint=11n,s=>s.tx.effects.transactionDigest='wrong',s=>s.info.chainId='wrong',s=>s.intent.payload.packageId='wrong',s=>s.input.authenticatedActorId='other',s=>s.intent.tx_digest=null,s=>s.input.reader.transaction=async()=>{throw Error('timeout')}]){
 const s=fixture();mutate(s);await assert.rejects(reconcileFailedRewardIntent(s.input));assert.equal(s.calls(),0);count++;
}
const s=fixture();assert.equal((await loadRewardIntent(s.input)).id,'intent');count++;
let params;
const result=await prepareRewardIntent({admin:{rpc:async(name,args)=>{assert.equal(name,'ft_prepare_reward_intent');params=args;return {data:{id:'saved',state:'Prepared',payload:{sender:'from database'}}}}},planId:'plan',authenticatedActorId:'actor',requestKey:'request',action:'enroll',targetTesterId:'tester'});
assert.equal(result.payload.sender,'from database');assert.equal(params.p_actor,'actor');assert.equal(params.p_target,'tester');assert.equal(params.p_canonical,null);count++;
await assert.rejects(prepareRewardIntent({action:'unknown'}));count++;
console.log(`${count} intent helper and failure reconciliation checks passed; fixtures only.`);
