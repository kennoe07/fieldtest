import {bcs} from '@mysten/sui/bcs';
import {isValidTransactionDigest,toHex} from '@mysten/sui/utils';
import {MAINNET_USDC} from '../lib/reward-transactions.mjs';
import {documentDigest} from '../src/rewardDocuments.ts';

const Seat=bcs.struct('Seat',{tester:bcs.Address,submission_hash:bcs.vector(bcs.u8()),paid:bcs.bool()});
export const CampaignBcs=bcs.struct('Campaign',{id:bcs.Address,owner:bcs.Address,terms_hash:bcs.vector(bcs.u8()),reward:bcs.u64(),slots:bcs.u64(),submit_until_ms:bcs.u64(),review_until_ms:bcs.u64(),funds:bcs.u64(),seats:bcs.vector(Seat),closed:bcs.bool()});
export const EventBcs={
 Funded:bcs.struct('Funded',{campaign:bcs.Address,owner:bcs.Address,amount:bcs.u64()}),
 Paid:bcs.struct('Paid',{campaign:bcs.Address,tester:bcs.Address,amount:bcs.u64()}),
 Refunded:bcs.struct('Refunded',{campaign:bcs.Address,amount:bcs.u64()}),
};
function requireThat(condition,message){if(!condition)throw Error(message)}
function address(value){requireThat(typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)&&!/^0x0+$/.test(value),'Invalid full Sui identifier');return value}
function digest(value){requireThat(typeof value==='string'&&isValidTransactionDigest(value),'Invalid Sui digest');return value}
function uint(value){requireThat(typeof value==='bigint'||typeof value==='string'&&/^\d+$/.test(value),'Missing exact integer');const n=BigInt(value);requireThat(n>=0n&&n<=(1n<<64n)-1n,'Invalid u64');return n}
function decode(schema,bytes){requireThat(bytes instanceof Uint8Array&&bytes.length<=65536,'Missing or oversized BCS bytes');const parsed=schema.parse(bytes);requireThat(toHex(schema.serialize(parsed).toBytes())===toHex(bytes),'Noncanonical or trailing BCS bytes');return parsed}
function timestampMs(tx){requireThat(tx.timestamp&&typeof tx.timestamp.seconds==='bigint'&&Number.isInteger(tx.timestamp.nanos??0),'Missing checkpoint timestamp');const nanos=tx.timestamp.nanos??0;requireThat(nanos>=0&&nanos<1e9,'Invalid checkpoint timestamp');return tx.timestamp.seconds*1000n+BigInt(Math.floor(nanos/1e6))}

/** Server-only, read-only proof validation. The reader is a trusted RPC adapter,
 * not user-posted JSON. Policy must come from a separately reviewed deployment.
 * Initial scope: one direct financial event from this package per transaction.
 */
export async function verifyRewardTransaction({reader,policy,plan,transactionDigest,payment}){
 digest(transactionDigest);address(policy.packageId);digest(policy.packageDigest);digest(policy.publishDigest);digest(policy.genesisDigest);
 requireThat(policy.network==='sui:mainnet'&&policy.coinType===MAINNET_USDC,'Unsupported deployment policy');
 requireThat(plan.network===policy.network&&plan.package_id===policy.packageId,'Plan does not match deployment policy');
 const document=plan.document;
 requireThat(document?.schema==='fieldtest-reward-terms-v1'&&document.network===policy.network&&document.packageId===policy.packageId&&document.owner===plan.owner_address&&document.asset?.coinType===MAINNET_USDC&&document.asset.decimals===6,'Invalid frozen plan document');
 requireThat(await documentDigest(document)===plan.terms_hash,'Frozen document digest mismatch');
 const reward=uint(document.rewardBaseUnits),slots=uint(String(document.slots)),total=reward*slots;
 requireThat(reward>0n&&slots>0n&&slots<=50n&&total<=((1n<<64n)-1n)&&total===uint(String(plan.total_base_units))&&reward===uint(String(plan.reward_base_units)),'Frozen budget mismatch');
 const info=await reader.serviceInfo();
 requireThat(info.chain==='mainnet'&&info.chainId===policy.genesisDigest,'RPC chain identity mismatch');
 const packageObject=await reader.object(policy.packageId);
 requireThat(packageObject?.objectId===policy.packageId&&packageObject.objectType==='package'&&packageObject.digest===policy.packageDigest&&uint(packageObject.version)===uint(policy.packageVersion)&&packageObject.previousTransaction===policy.publishDigest,'Unapproved package deployment');
 const tx=await reader.transaction(transactionDigest);
 requireThat(tx?.digest===transactionDigest&&tx.effects?.transactionDigest===transactionDigest&&tx.effects.status?.success===true&&!tx.effects.status.error,'Transaction failed or effects identity mismatch');
 requireThat(uint(tx.checkpoint)>0n&&uint(info.checkpointHeight)>=uint(tx.checkpoint),'Transaction is not in an available checkpoint');
 const time=timestampMs(tx);
 const raw=tx.events?.events;requireThat(Array.isArray(raw)&&raw.length<=256,'Missing or oversized transaction events');
 const financial=[];
 raw.forEach((event,index)=>{for(const kind of Object.keys(EventBcs))if(event.eventType===`${policy.packageId}::rewards::${kind}`){
   requireThat(event.packageId===policy.packageId&&event.module==='rewards'&&event.sender===plan.owner_address,'Event provenance mismatch');
   if(event.eventIndex!==undefined)requireThat(Number.isSafeInteger(event.eventIndex)&&event.eventIndex===index,'Event sequence mismatch');
   financial.push({kind,index,event,data:decode(EventBcs[kind],event.contents?.value)});
 }});
 requireThat(financial.length===1,'Expected exactly one direct reward financial event; batching is not supported yet');
 const {kind,index,data}=financial[0],objectId=address(data.campaign);
 if(plan.chain_campaign_id)requireThat(plan.chain_campaign_id===objectId,'Wrong chain campaign object');
 const changes=tx.effects.changedObjects?.filter(o=>o.objectId===objectId);
 requireThat(changes?.length===1,'Campaign object is absent or ambiguous in effects');const change=changes[0];
 requireThat(change.outputState===2&&change.outputDigest&&change.outputVersion!==undefined,'Campaign output is not an object write');
 const type=`${policy.packageId}::rewards::Campaign<${MAINNET_USDC}>`;
 async function state(version,expectedDigest,output){
   const object=await reader.object(objectId,version);
   requireThat(object?.objectId===objectId&&uint(object.version)===uint(version)&&object.digest===expectedDigest&&object.objectType===type&&object.owner?.kind===3,'Historical campaign object identity, version, type or ownership mismatch');
   if(output)requireThat(object.previousTransaction===transactionDigest,'Output object belongs to a different transaction');
   const value=decode(CampaignBcs,object.contents?.value);
   requireThat(value.id===objectId&&value.owner===plan.owner_address&&toHex(Uint8Array.from(value.terms_hash))===plan.terms_hash&&uint(value.reward)===reward&&uint(value.slots)===slots&&value.submit_until_ms===document.submitUntilMs&&value.review_until_ms===document.reviewUntilMs,'Campaign state does not match frozen terms');
   requireThat(value.seats.length<=Number(slots)&&new Set(value.seats.map(s=>s.tester)).size===value.seats.length,'Invalid campaign seats');
   return value;
 }
 const after=await state(change.outputVersion,change.outputDigest,true);
 let recipient=plan.owner_address;
 requireThat(uint(data.amount)<=total,'Event amount exceeds budget');
 if(kind==='Funded'){
   requireThat(!plan.chain_campaign_id&&plan.state==='Frozen'&&change.inputState===1&&change.idOperation===2,'Funding must create an unbound campaign');
   requireThat(data.owner===plan.owner_address&&uint(data.amount)===total&&uint(after.funds)===total&&!after.closed&&after.seats.every(s=>!s.paid)&&time<uint(document.submitUntilMs),'Invalid initial funding state');
 }else{
   requireThat(plan.state==='Funded'&&plan.chain_campaign_id===objectId&&change.inputState===2&&change.inputVersion!==undefined&&change.inputDigest,'Missing funded campaign input');
   const before=await state(change.inputVersion,change.inputDigest,false);
   requireThat(!before.closed&&uint(before.funds)===uint(String(plan.remaining_base_units)),'Ledger is out of order or campaign is closed');
   requireThat(uint(before.funds)===uint(after.funds)+uint(data.amount),'Escrow balance transition does not match event');
   if(kind==='Paid'){
     recipient=address(data.tester);
     requireThat(payment&&payment.tester===recipient&&/^[0-9a-f]{64}$/.test(payment.submissionHash),'Trusted submission commitment mapping is required');
     const priorSeat=before.seats.find(s=>s.tester===recipient),paidSeat=after.seats.find(s=>s.tester===recipient);
     requireThat(recipient!==plan.owner_address&&uint(data.amount)===reward&&!after.closed&&time<uint(document.reviewUntilMs)&&priorSeat&&!priorSeat.paid&&paidSeat?.paid&&toHex(Uint8Array.from(priorSeat.submission_hash))===payment.submissionHash&&toHex(Uint8Array.from(paidSeat.submission_hash))===payment.submissionHash,'Payout does not match enrolled tester and committed submission');
   }else requireThat(after.closed&&uint(after.funds)===0n&&uint(data.amount)===uint(before.funds)&&time>=uint(document.reviewUntilMs),'Invalid refund transition or cutoff');
 }
 return Object.freeze({planId:plan.id,network:policy.network,transactionDigest,eventSeq:index,kind,chainCampaignId:objectId,recipient,amountBaseUnits:String(data.amount),checkpoint:String(tx.checkpoint),objectVersion:String(change.outputVersion)});
}

// No public API route calls this. The caller must load authoritative server plan,
// policy and paid-submission mapping, process events in order, and handle retries.
export async function verifyAndRecordRewardEvent({admin,...input}){
 const verified=await verifyRewardTransaction(input);
 const {data,error}=await admin.rpc('ft_record_reward_event',{p_plan:verified.planId,p_digest:verified.transactionDigest,p_seq:verified.eventSeq,p_kind:verified.kind,p_object:verified.chainCampaignId,p_recipient:verified.recipient,p_amount:verified.amountBaseUnits});
 if(error)throw Error('Verified event could not be recorded. Reconcile ledger order before retrying.');
 return {verified,inserted:data};
}
