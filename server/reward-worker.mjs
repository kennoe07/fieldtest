import {isValidTransactionDigest} from '@mysten/sui/utils';
import {documentDigest} from '../src/rewardDocuments.ts';
import {verifyRewardTransaction,EventBcs} from './reward-verifier.mjs';

const ensure=(ok,message)=>{if(!ok)throw Error(message)};
const integer=value=>{ensure(typeof value==='string'&&/^\d+$/.test(value),'Invalid worker checkpoint');return BigInt(value)};
export const rewardPolicyHash=policy=>documentDigest({schema:'fieldtest-reward-worker-policy-v1',...policy});

/** One bounded checkpoint per call; no scheduler or public endpoint.
 * contextForTransaction must load authoritative plans/submission commitments.
 * commit must atomically record ALL receipts/proofs and advance the cursor by CAS.
 */
export async function processRewardCheckpoint({reader,store,policy,workerId,contextForTransaction}){
 const policyHash=await rewardPolicyHash(policy);
 const cursor=await store.cursor(workerId);
 ensure(cursor&&cursor.policy_hash===policyHash,'Missing worker cursor or changed deployment policy');
 const next=integer(cursor.next_checkpoint);
 const info=await reader.serviceInfo();
 ensure(info.chain==='mainnet'&&info.chainId===policy.genesisDigest,'Worker RPC identity mismatch');
 ensure(typeof info.checkpointHeight==='bigint','Missing checkpoint height');
 if(next>info.checkpointHeight)return {status:'caught-up',nextCheckpoint:String(next)};
 const checkpoint=await reader.checkpoint(next);
 ensure(checkpoint?.sequenceNumber===next&&isValidTransactionDigest(checkpoint.digest),'Checkpoint identity mismatch');
 ensure(checkpoint.summary?.previousDigest===cursor.previous_digest,'Checkpoint continuity mismatch');
 const txs=checkpoint.transactions,contents=checkpoint.contents?.transactions;
 ensure(Array.isArray(txs)&&Array.isArray(contents)&&txs.length===contents.length&&txs.length<=10000,'Incomplete or oversized checkpoint');
 ensure(new Set(txs.map(tx=>tx.digest)).size===txs.length,'Duplicate checkpoint transaction');
 const plans=new Map(),receipts=[];
 for(let index=0;index<txs.length;index++){
   const tx=txs[index];
   ensure(isValidTransactionDigest(tx.digest)&&contents[index].transaction===tx.digest,'Checkpoint transaction order mismatch');
   // Protobuf omits this optional message for transactions with no events.
   // The trusted adapter must explicitly request events in its field mask.
   const events=tx.events===undefined?[]:tx.events.events;
   ensure(Array.isArray(events),'Malformed checkpoint transaction events');
   const matches=events.filter(event=>Object.keys(EventBcs).some(kind=>event.eventType===`${policy.packageId}::rewards::${kind}`));
   if(!matches.length)continue;
   ensure(matches.length===1,'Unsupported batched financial events');
   const context=await contextForTransaction(tx,matches[0]);
   ensure(context?.plan?.id,'Unmapped reward event; checkpoint must be reconciled');
   const {plan,payment}=context;
   if(!plans.has(plan.id))plans.set(plan.id,structuredClone(plan));
   const current=plans.get(plan.id);
   // Use the exact checkpoint transaction, not another fetch with a different position.
   const verified=await verifyRewardTransaction({reader:{...reader,transaction:async digest=>{
     ensure(digest===tx.digest,'Unexpected transaction request');
     return {...tx,checkpoint:next,timestamp:checkpoint.summary.timestamp};
   }},policy,plan:current,transactionDigest:tx.digest,payment});
   receipts.push({...verified,transactionIndex:index});
   if(verified.kind==='Funded')Object.assign(current,{state:'Funded',chain_campaign_id:verified.chainCampaignId,remaining_base_units:verified.amountBaseUnits});
   else if(verified.kind==='Paid')current.remaining_base_units=String(BigInt(current.remaining_base_units)-BigInt(verified.amountBaseUnits));
   else Object.assign(current,{state:'Closed',remaining_base_units:'0'});
 }
 await store.commit({workerId,policyHash,checkpoint:String(next),previousDigest:cursor.previous_digest,checkpointDigest:checkpoint.digest,receipts});
 return {status:'processed',checkpoint:String(next),receiptCount:receipts.length,nextCheckpoint:String(next+1n)};
}

/** Privileged server client only. No anonymous/browser client may use this. */
export function createRewardWorkerStore(admin){
 return {
   async cursor(id){const {data,error}=await admin.from('ft_reward_worker_cursors').select('*').eq('id',id).maybeSingle();if(error)throw Error('Could not load reward worker cursor');return data},
   async commit(batch){const {error}=await admin.rpc('ft_commit_reward_checkpoint',{p_worker:batch.workerId,p_policy:batch.policyHash,p_checkpoint:batch.checkpoint,p_previous:batch.previousDigest,p_digest:batch.checkpointDigest,p_receipts:batch.receipts});if(error)throw Error('Reward checkpoint commit failed; reload cursor before retrying')},
 };
}
