import {canonicalJson} from '../src/rewardDocuments.ts';
import {buildRewardSubmissionCandidate} from './reward-context.mjs';
const ensure=(ok,message)=>{if(!ok)throw Error(message)};

/** No public route calls this. Actor IDs must come from verified server sessions.
 * SQL derives the unsigned action arguments from the plan and accepted wallet.
 * This helper does not build, sign, simulate, execute or bind transaction bytes.
 */
export async function prepareRewardIntent({admin,planId,authenticatedActorId,requestKey,action,targetTesterId=null,commitmentHash=null}){
 ensure(['create','enroll','submit','approve','refund'].includes(action),'Unknown reward action');
 let candidate;
 if(action==='submit')candidate=await buildRewardSubmissionCandidate({admin,planId,authenticatedTesterId:authenticatedActorId});
 const {data,error}=await admin.rpc('ft_prepare_reward_intent',{
   p_plan:planId,p_actor:authenticatedActorId,p_request:requestKey,p_action:action,p_target:targetTesterId,
   p_snapshot:candidate?.snapshot??null,p_canonical:candidate?canonicalJson(candidate.document):null,p_commitment:commitmentHash,
 });
 ensure(!error&&data?.id,'Reward intent could not be prepared; reload existing intent before retrying');
 // SQL may reuse a previously saved commitment instead of this candidate's salt.
 // The returned persisted payload is always authoritative for the next step.
 return data;
}

export async function loadRewardIntent({admin,intentId,authenticatedActorId}){
 const {data,error}=await admin.from('ft_reward_intents').select('*').eq('id',intentId).eq('actor_id',authenticatedActorId).maybeSingle();
 ensure(!error&&data,'Reward intent unavailable');return data;
}

/** Failure settlement must be called only with the pinned trusted chain reader.
 * An RPC timeout, missing transaction or wallet rejection leaves the intent open.
 */
export async function reconcileFailedRewardIntent({admin,reader,policy,intentId,authenticatedActorId}){
 const intent=await loadRewardIntent({admin,intentId,authenticatedActorId});
 ensure(intent.payload.network===policy.network&&intent.payload.packageId===policy.packageId&&intent.tx_digest,'Intent deployment mismatch or no bound transaction');
 const info=await reader.serviceInfo();
 ensure(policy.network==='sui:mainnet'&&info.chain==='mainnet'&&info.chainId===policy.genesisDigest,'RPC identity mismatch');
 const tx=await reader.transaction(intent.tx_digest);
 ensure(tx?.digest===intent.tx_digest&&tx.effects?.transactionDigest===intent.tx_digest&&tx.effects.status?.success===false&&tx.effects.status.error&&typeof tx.checkpoint==='bigint'&&tx.checkpoint>0n&&typeof info.checkpointHeight==='bigint'&&tx.checkpoint<=info.checkpointHeight,'Transaction failure is not checkpoint-confirmed');
 const {data,error}=await admin.rpc('ft_transition_reward_intent',{p_intent:intent.id,p_actor:authenticatedActorId,p_state:'Failed',p_digest:intent.tx_digest});
 ensure(!error&&data?.state==='Failed','Failed transaction could not be reconciled');return data;
}
