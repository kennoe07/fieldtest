import {toHex} from '@mysten/sui/utils';
import {CampaignBcs,EventBcs} from './reward-verifier.mjs';
import {canonicalJson,documentDigest,newDocumentSalt,submissionDocument} from '../src/rewardDocuments.ts';
import {processRewardCheckpoint,createRewardWorkerStore} from './reward-worker.mjs';

const ensure=(ok,message)=>{if(!ok)throw Error(message)};
async function one(query,message){const {data,error}=await query.maybeSingle();ensure(!error&&data,message);return data}

// Composition only: there is no scheduled job, public route or configured policy.
export function processMappedRewardCheckpoint({admin,reader,policy,workerId}){
 return processRewardCheckpoint({reader,policy,workerId,store:createRewardWorkerStore(admin),contextForTransaction:createRewardContextResolver({admin,reader,policy})});
}

/** All lookups use a privileged server client; never accept a browser plan,
 * tester address, submission document or evidence URL as authoritative input. */
export function createRewardContextResolver({admin,reader,policy}){
 return async (tx,event)=>{
   const kind=Object.keys(EventBcs).find(kind=>event.eventType===`${policy.packageId}::rewards::${kind}`);
   ensure(kind&&event.packageId===policy.packageId&&event.module==='rewards','Unrecognized reward event');
   const data=EventBcs[kind].parse(event.contents?.value);
   const change=tx.effects?.changedObjects?.filter(o=>o.objectId===data.campaign);
   ensure(change?.length===1&&change[0].outputVersion!==undefined,'Missing campaign output for context');
   const object=await reader.object(data.campaign,change[0].outputVersion);
   ensure(object?.objectId===data.campaign&&object.version===change[0].outputVersion&&object.digest===change[0].outputDigest,'Context historical output mismatch');
   const state=CampaignBcs.parse(object.contents?.value),termsHash=toHex(Uint8Array.from(state.terms_hash));
   const plan=await one(admin.from('ft_reward_plans').select('*').eq('network',policy.network).eq('package_id',policy.packageId).eq('terms_hash',termsHash),'No unique authoritative plan for reward event');
   ensure(await documentDigest(plan.document)===termsHash,'Stored plan commitment mismatch');
   if(kind!=='Paid')return {plan};
   const participant=await one(admin.from('ft_reward_participants').select('*').eq('plan_id',plan.id).eq('address',data.tester),'Tester has not accepted frozen reward terms');
   ensure(participant.terms_hash===termsHash,'Tester accepted different reward terms');
   const seat=state.seats.find(s=>s.tester===data.tester);
   ensure(seat?.paid,'No paid tester seat');
   const submissionHash=toHex(Uint8Array.from(seat.submission_hash));
   const commitment=await one(admin.from('ft_reward_commitments').select('*').eq('plan_id',plan.id).eq('tester_id',participant.tester_id).eq('submission_hash',submissionHash),'No saved submission commitment for payout');
   const doc=commitment.document;
   ensure(await documentDigest(doc)===submissionHash&&doc.schema==='fieldtest-reward-submission-v1'&&doc.termsHash===termsHash&&doc.campaignId===plan.campaign_id&&doc.submissionId===commitment.submission_id&&doc.tester===participant.address,'Saved payout commitment is inconsistent');
   return {plan,payment:{tester:participant.address,submissionHash}};
 };
}

/** Inactive preparation helper. authenticatedTesterId must come from server
 * authentication, not a request's user ID field. The SQL RPC checks the snapshot
 * again under lock so a concurrent revision cannot commit stale feedback. */
export async function prepareRewardSubmission({admin,planId,authenticatedTesterId}){
 const plan=await one(admin.from('ft_reward_plans').select('*').eq('id',planId),'Reward plan unavailable');
 ensure(plan.state==='Funded'&&await documentDigest(plan.document)===plan.terms_hash,'Reward plan is not funded or its terms changed');
 const participant=await one(admin.from('ft_reward_participants').select('*').eq('plan_id',planId).eq('tester_id',authenticatedTesterId),'Accept the frozen reward terms first');
 ensure(participant.terms_hash===plan.terms_hash,'Accepted terms do not match');
 const row=await one(admin.from('ft_submissions').select('*').eq('campaign_id',plan.campaign_id).eq('tester_id',authenticatedTesterId),'Saved tester feedback required');
 const snapshot={id:row.id,campaign_id:row.campaign_id,tester_id:row.tester_id,responses:row.responses,summary:row.summary};
 const submission={id:row.id,campaignId:row.campaign_id,summary:row.summary,responses:row.responses.map(r=>({...r,evidence:r.evidence.map(e=>({...e,id:e.path}))}))};
 const document=await submissionDocument(plan.document,submission,participant.address,newDocumentSalt(),async file=>{
   // Only paths from the authoritative submission row are used, never external URLs.
   ensure(file.path.startsWith(`${authenticatedTesterId}/${plan.campaign_id}/`),'Evidence path does not belong to this submission');
   const {data,error}=await admin.storage.from('fieldtest-evidence').download(file.path);
   ensure(!error&&data instanceof Blob&&data.size<=2097152&&['image/png','image/jpeg','image/webp'].includes(data.type),'Private evidence could not be loaded');return data;
 });
 const submissionHash=await documentDigest(document);
 const {data,error}=await admin.rpc('ft_save_reward_commitment',{p_plan:planId,p_tester:authenticatedTesterId,p_snapshot:snapshot,p_canonical:canonicalJson(document)});
 ensure(!error&&data===submissionHash,'Feedback changed or commitment could not be saved; reload before retrying');
 return {submissionHash,document};
}
