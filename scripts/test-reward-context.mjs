import assert from 'node:assert/strict';
import {fromHex} from '@mysten/sui/utils';
import {fixture} from './test-reward-verifier.mjs';
import {CampaignBcs} from '../server/reward-verifier.mjs';
import {documentDigest,sha256} from '../src/rewardDocuments.ts';
import {createRewardContextResolver,prepareRewardSubmission,processMappedRewardCheckpoint} from '../server/reward-context.mjs';
import {rewardPolicyHash} from '../server/reward-worker.mjs';
let checks=0;
function database(rows){return {from(table){const filters=[];return {select(){return this},eq(key,value){filters.push([key,value]);return this},async maybeSingle(){const matches=(rows[table]??[]).filter(row=>filters.every(([key,value])=>row[key]===value));return {data:matches.length===1?structuredClone(matches[0]):null,error:matches.length>1?Error('ambiguous'):null}}}}}}
async function setup(){
 const f=await fixture('Paid'),plan=f.input.plan;
 plan.campaign_id='campaign';plan.document.campaignId='campaign';plan.document.research={tasks:['Open product']};
 plan.terms_hash=await documentDigest(plan.document);
 const participant={plan_id:plan.id,tester_id:'tester',address:f.input.payment.tester,terms_hash:plan.terms_hash};
 const row={id:'submission',campaign_id:'campaign',tester_id:'tester',summary:'Useful feedback',responses:[{task:'Open product',outcome:'Completed',expected:'The product opens',actual:'The product opened',evidence:[]}]};
 const {submissionDocument}=await import('../src/rewardDocuments.ts');
 const document=await submissionDocument(plan.document,{id:row.id,campaignId:row.campaign_id,summary:row.summary,responses:row.responses},participant.address,'ab'.repeat(32));
 const hash=await documentDigest(document),state=CampaignBcs.parse(f.objects[1].contents.value);
 state.terms_hash=Array.from(fromHex(plan.terms_hash));state.seats[0].submission_hash=Array.from(fromHex(hash));
 f.objects[1].contents.value=CampaignBcs.serialize(state).toBytes();
 const commitment={plan_id:plan.id,tester_id:'tester',submission_id:row.id,submission_hash:hash,document};
 const rows={ft_reward_plans:[plan],ft_reward_participants:[participant],ft_reward_commitments:[commitment],ft_submissions:[row]};
 const admin=database(rows),resolver=createRewardContextResolver({admin,reader:f.input.reader,policy:f.input.policy});
 return {f,plan,participant,commitment,rows,admin,resolver,row,hash};
}
const valid=await setup();assert.equal((await valid.resolver(valid.f.tx,valid.f.event)).payment.submissionHash,valid.hash);checks++;
for(const [name,mutate] of [
 ['missing plan',s=>s.rows.ft_reward_plans=[]],
 ['ambiguous plan',s=>s.rows.ft_reward_plans.push(s.plan)],
 ['changed package policy',s=>s.plan.package_id='wrong'],
 ['tampered terms',s=>s.plan.document.slots=3],
 ['no accepted terms',s=>s.rows.ft_reward_participants=[]],
 ['different accepted terms',s=>s.participant.terms_hash='bad'],
 ['missing commitment',s=>s.rows.ft_reward_commitments=[]],
 ['changed feedback snapshot',s=>s.commitment.document.summary='tampered'],
 ['different submission mapping',s=>s.commitment.submission_id='another'],
 ['historical object mismatch',s=>s.f.objects[1].version=99n],
]){const s=await setup();mutate(s);await assert.rejects(s.resolver(s.f.tx,s.f.event),undefined,name);checks++}
const prepared=await setup();let stored;
prepared.admin.rpc=async(name,args)=>{assert.equal(name,'ft_save_reward_commitment');stored=args;return {data:await documentDigest(JSON.parse(args.p_canonical))}};
const result=await prepareRewardSubmission({admin:prepared.admin,planId:prepared.plan.id,authenticatedTesterId:'tester'});
assert.equal(await documentDigest(JSON.parse(stored.p_canonical)),result.submissionHash);assert.equal(stored.p_snapshot.id,prepared.row.id);checks++;
await assert.rejects(prepareRewardSubmission({admin:prepared.admin,planId:prepared.plan.id,authenticatedTesterId:'other'}));checks++;
prepared.admin.rpc=async()=>({error:Error('snapshot changed')});
await assert.rejects(prepareRewardSubmission({admin:prepared.admin,planId:prepared.plan.id,authenticatedTesterId:'tester'}));checks++;
prepared.admin.rpc=async()=>({data:'wrong-hash'});
await assert.rejects(prepareRewardSubmission({admin:prepared.admin,planId:prepared.plan.id,authenticatedTesterId:'tester'}));checks++;
const image=await setup(),bytes=new Blob(['fixture image bytes'],{type:'image/png'});
image.row.responses[0].evidence=[{path:'tester/campaign/file.png',name:'image.png'}];
let downloads=0,writes=0;
image.admin.storage={from(bucket){assert.equal(bucket,'fieldtest-evidence');return {download:async path=>{downloads++;assert.equal(path,'tester/campaign/file.png');return {data:bytes}}}}};
image.admin.rpc=async(name,args)=>{writes++;return {data:await documentDigest(JSON.parse(args.p_canonical))}};
const imageResult=await prepareRewardSubmission({admin:image.admin,planId:image.plan.id,authenticatedTesterId:'tester'});
assert.equal(imageResult.document.responses[0].evidence[0].contentHash,await sha256(new Uint8Array(await bytes.arrayBuffer())));assert.equal(downloads,1);assert.equal(writes,1);checks++;
image.row.responses[0].evidence[0].path='someone-else/campaign/file.png';
await assert.rejects(prepareRewardSubmission({admin:image.admin,planId:image.plan.id,authenticatedTesterId:'tester'}));assert.equal(downloads,1);assert.equal(writes,1);checks++;
image.row.responses[0].evidence[0].path='tester/campaign/file.png';
for(const data of [new Blob([],{type:'image/png'}),new Blob(['html'],{type:'text/html'}),new Blob([new Uint8Array(2097153)],{type:'image/png'})]){
 image.admin.storage.from=()=>({download:async()=>({data})});await assert.rejects(prepareRewardSubmission({admin:image.admin,planId:image.plan.id,authenticatedTesterId:'tester'}));assert.equal(writes,1);checks++;
}
const integrated=await setup();
const before=CampaignBcs.parse(integrated.f.objects[0].contents.value);
before.terms_hash=Array.from(fromHex(integrated.plan.terms_hash));before.seats[0].submission_hash=Array.from(fromHex(integrated.hash));
integrated.f.objects[0].contents.value=CampaignBcs.serialize(before).toBytes();
integrated.rows.ft_reward_worker_cursors=[{id:'worker',next_checkpoint:'10',previous_digest:integrated.f.input.policy.genesisDigest,policy_hash:await rewardPolicyHash(integrated.f.input.policy)}];
let committed;
integrated.admin.rpc=async(name,args)=>{assert.equal(name,'ft_commit_reward_checkpoint');committed=args;return {data:null}};
const reader={...integrated.f.input.reader,checkpoint:async()=>({sequenceNumber:10n,digest:integrated.f.tx.digest,summary:{previousDigest:integrated.f.input.policy.genesisDigest,timestamp:integrated.f.tx.timestamp},contents:{transactions:[{transaction:integrated.f.tx.digest}]},transactions:[integrated.f.tx]})};
assert.equal((await processMappedRewardCheckpoint({admin:integrated.admin,reader,policy:integrated.f.input.policy,workerId:'worker'})).receiptCount,1);
assert.equal(committed.p_receipts[0].recipient,integrated.participant.address);assert.equal(committed.p_receipts[0].kind,'Paid');checks++;
console.log(`${checks} authoritative reward context checks passed; fixtures only.`);
