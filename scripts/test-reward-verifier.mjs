import assert from 'node:assert/strict';
import {toBase58,fromHex} from '@mysten/sui/utils';
import {CampaignBcs,EventBcs,verifyRewardTransaction,verifyAndRecordRewardEvent} from '../server/reward-verifier.mjs';
import {documentDigest} from '../src/rewardDocuments.ts';
import {MAINNET_USDC} from '../lib/reward-transactions.mjs';
const address=n=>'0x'+n.toString(16).padStart(64,'0'),digest=n=>toBase58(new Uint8Array(32).fill(n));
const owner=address(1),pkg=address(2),objectId=address(3),tester=address(4),hash='ab'.repeat(32);
let checks=0;
async function fixture(kind='Funded'){
 const document={schema:'fieldtest-reward-terms-v1',network:'sui:mainnet',packageId:pkg,owner,asset:{coinType:MAINNET_USDC,decimals:6},rewardBaseUnits:'5000000',slots:2,submitUntilMs:'100000',reviewUntilMs:'200000'};
 const terms_hash=await documentDigest(document);
 const plan={id:'plan',network:'sui:mainnet',package_id:pkg,owner_address:owner,document,terms_hash,total_base_units:'10000000',reward_base_units:'5000000',state:kind==='Funded'?'Frozen':'Funded',chain_campaign_id:kind==='Funded'?null:objectId,remaining_base_units:'10000000'};
 const policy={network:'sui:mainnet',coinType:MAINNET_USDC,packageId:pkg,packageDigest:digest(1),publishDigest:digest(2),genesisDigest:digest(3),packageVersion:'1'};
 const seat={tester,submission_hash:Array.from(fromHex(hash)),paid:false};
 const before={id:objectId,owner,terms_hash:Array.from(fromHex(terms_hash)),reward:'5000000',slots:'2',submit_until_ms:'100000',review_until_ms:'200000',funds:'10000000',seats:[seat],closed:false};
 const after=structuredClone(before);
 if(kind==='Funded')after.seats=[];
 if(kind==='Paid'){after.funds='5000000';after.seats[0].paid=true}
 if(kind==='Refunded'){after.funds='0';after.closed=true}
 const amount=kind==='Paid'?'5000000':'10000000';
 const change={objectId,inputState:kind==='Funded'?1:2,inputVersion:1n,inputDigest:digest(4),outputState:2,outputVersion:2n,outputDigest:digest(5),idOperation:kind==='Funded'?2:1};
 const event={packageId:pkg,module:'rewards',sender:owner,eventIndex:0,eventType:`${pkg}::rewards::${kind}`,contents:{value:EventBcs[kind].serialize({campaign:objectId,owner,tester,amount}).toBytes()}};
 const tx={digest:digest(6),checkpoint:10n,timestamp:{seconds:kind==='Refunded'?200n:50n,nanos:0},effects:{transactionDigest:digest(6),status:{success:true},changedObjects:[change]},events:{events:[event]}};
 const info={chain:'mainnet',chainId:policy.genesisDigest,checkpointHeight:11n};
 const packageObject={objectId:pkg,objectType:'package',digest:policy.packageDigest,version:1n,previousTransaction:policy.publishDigest};
 const objects=[before,after].map((v,i)=>({objectId,version:BigInt(i+1),digest:digest(i+4),objectType:`${pkg}::rewards::Campaign<${MAINNET_USDC}>`,owner:{kind:3},previousTransaction:tx.digest,contents:{value:CampaignBcs.serialize(v).toBytes()}}));
 const reader={serviceInfo:async()=>info,transaction:async()=>tx,object:async(id,version)=>id===pkg?packageObject:objects[Number(version)-1]};
 return {input:{reader,policy,plan,transactionDigest:tx.digest,payment:{tester,submissionHash:hash}},tx,info,objects,packageObject,event,change};
}
for(const kind of ['Funded','Paid','Refunded']){const f=await fixture(kind);assert.equal((await verifyRewardTransaction(f.input)).kind,kind);checks++}
const mutations=[
 ['wrong chain',f=>f.info.chainId=digest(9)],
 ['wrong package',f=>f.packageObject.digest=digest(9)],
 ['failed transaction',f=>f.tx.effects.status.success=false],
 ['wrong effects digest',f=>f.tx.effects.transactionDigest=digest(9)],
 ['uncheckpointed',f=>f.tx.checkpoint=0n],
 ['future checkpoint',f=>f.tx.checkpoint=12n],
 ['wrong sender',f=>f.event.sender=tester],
 ['wrong module',f=>f.event.module='other'],
 ['wrong sequence',f=>f.event.eventIndex=1],
 ['multiple financial events',f=>f.tx.events.events.push(f.event)],
 ['missing object effect',f=>f.tx.effects.changedObjects=[]],
 ['wrong output version',f=>f.objects[1].version=3n],
 ['wrong object type',f=>f.objects[1].objectType='other'],
 ['wrong ownership',f=>f.objects[1].owner.kind=1],
 ['wrong previous transaction',f=>f.objects[1].previousTransaction=digest(9)],
 ['trailing event bytes',f=>f.event.contents.value=Uint8Array.from([...f.event.contents.value,0])],
 ['tampered terms',f=>f.input.plan.document.slots=3],
 ['wrong budget',f=>f.input.plan.total_base_units='9'],
 ['wrong funding state',f=>f.input.plan.state='Funded'],
];
for(const [name,mutate] of mutations){const f=await fixture();mutate(f);let writes=0;await assert.rejects(verifyAndRecordRewardEvent({admin:{rpc:async()=>{writes++;return {data:true}}},...f.input}),undefined,name);assert.equal(writes,0,name);checks++}
for(const [kind,mutate] of [
 ['Paid',f=>f.input.payment.submissionHash='cd'.repeat(32)],
 ['Paid',f=>f.input.payment=undefined],
 ['Paid',f=>f.input.plan.remaining_base_units='5000000'],
 ['Paid',f=>f.tx.timestamp.seconds=200n],
 ['Refunded',f=>f.tx.timestamp.seconds=199n],
]){const f=await fixture(kind);mutate(f);await assert.rejects(verifyRewardTransaction(f.input));checks++}
const f=await fixture('Paid');let params;
const result=await verifyAndRecordRewardEvent({...f.input,admin:{rpc:async(name,args)=>{assert.equal(name,'ft_record_reward_event');params=args;return {data:true}}}});
assert.equal(result.inserted,true);assert.equal(params.p_amount,'5000000');assert.equal(params.p_recipient,tester);assert.equal(params.p_seq,0);checks++;
await assert.rejects(verifyAndRecordRewardEvent({...f.input,admin:{rpc:async()=>({error:{message:'failure'}})}}));checks++;
console.log(`${checks} reward verifier checks passed. Fixtures only; no network, signatures or transactions.`);
