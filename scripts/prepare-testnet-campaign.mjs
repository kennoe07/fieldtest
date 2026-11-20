// Isolated lab preparation, not production plan storage or transaction execution.
import {readFile,writeFile,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SuiGrpcClient} from '@mysten/sui/grpc';
import {testnetTermsDocument,simulateTestnetReward} from '../server/reward-testnet.mjs';
import {createTestnetRewardReader} from '../server/reward-grpc-reader.mjs';
import {documentDigest,newDocumentSalt} from '../src/rewardDocuments.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(process.argv[2]??resolve(root,'../outputs/fieldtest-testnet-campaign-review.json'));
try{await access(output);throw Error('Review already exists; use a new filename for a newly reviewed attempt')}catch(error){if(error.code!=='ENOENT')throw error}
const deployment=JSON.parse(await readFile(resolve(root,'../outputs/fieldtest-verified-testnet-deployment.json'),'utf8'));
const owner=deployment.upgradeCapOwner,policy=deployment.policy;
if(policy.network!=='sui:testnet'||deployment.productionActivated!==false)throw Error('Isolated verified testnet deployment required');
const client=new SuiGrpcClient({network:'testnet',baseUrl:'https://fullnode.testnet.sui.io:443'});
const ids=[];let balance=0n,cursor;
for(let page=0;page<5&&balance<10000000n;page++){
 const coins=await client.core.listCoins({owner,coinType:policy.coinType,limit:50,cursor});
 for(const coin of coins.objects){if(ids.length>=50)break;ids.push(coin.objectId);balance+=BigInt(coin.balance);if(balance>=10000000n)break}
 if(!coins.hasNextPage)break;cursor=coins.cursor;
}
if(balance<10000000n)throw Error('Need 10 test USDC in owned coin objects');
const now=Date.now(),submitUntil=now+45*60000,reviewUntil=submitUntil+15*60000;
const campaign={id:crypto.randomUUID(),name:'Isolated testnet escrow trial',project:'Fieldtest testnet lab',description:'Verify escrow funding, one tester commitment and payout, and refund the unused seat.',reward:5,slots:2,deadline:new Date(submitUntil).toISOString(),url:'https://fieldtest-two.vercel.app/',tasks:['Report an observed issue in the testnet lab flow.'],criteria:'Commit a synthetic test response; no personal information or production data.'};
const initial=testnetTermsDocument(campaign,owner,policy.packageId,newDocumentSalt(),1,now);
// Explicit short lab window only. Production retains its saved day-based rules.
const terms={...initial,reviewUntilMs:String(reviewUntil)};
const termsHash=await documentDigest(terms);
const plan={id:campaign.id,campaign_id:campaign.id,owner_address:owner,network:policy.network,package_id:policy.packageId,document:terms,terms_hash:termsHash,reward_base_units:'5000000',total_base_units:'10000000',remaining_base_units:'0',chain_campaign_id:null,state:'Frozen'};
const intent={state:'Prepared',expires_at:new Date(now+15*60000).toISOString(),payload:{action:'create',network:policy.network,packageId:policy.packageId,asset:'USDC',sender:owner,termsHash,rewardBaseUnits:'5000000',slots:'2',submitUntilMs:String(submitUntil),reviewUntilMs:String(reviewUntil)}};
const base=createTestnetRewardReader();let simulated;
const reader={...base,simulate:async bytes=>(simulated=await base.simulate(bytes))};
const transaction=await simulateTestnetReward({reader,policy,intent,fundingCoinIds:ids,gasMode:'addressBalance',gasBudgetMist:'10000000',now});
const shared=simulated.effects.changedObjects?.filter(x=>x.outputState===2&&x.idOperation===2&&x.outputOwner?.kind===3);
if(shared?.length!==1)throw Error('Expected one simulated shared campaign creation');
const costs=simulated.effects.gasUsed;
const review={schema:'fieldtest-testnet-campaign-review-v1',preparedAt:new Date(now).toISOString(),policy,plan,intent,transaction,fundingCoinIds:ids,fundingUsdc:'10',rewardUsdc:'5',slots:2,submitUntil:new Date(submitUntil).toISOString(),refundAvailableAt:new Date(reviewUntil).toISOString(),simulatedGas:{computationCost:String(costs.computationCost),storageCost:String(costs.storageCost),storageRebate:String(costs.storageRebate??0n)},predictedCampaignId:shared[0].objectId,productionStored:false,submitted:false};
await writeFile(output,JSON.stringify(review,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({reviewFile:output,owner,fundingUsdc:review.fundingUsdc,slots:2,rewardUsdc:'5',submitUntil:review.submitUntil,refundAvailableAt:review.refundAvailableAt,simulatedGas:review.simulatedGas,gasBudgetMist:transaction.gasBudgetMist,transactionDigest:transaction.transactionDigest,predictedCampaignId:review.predictedCampaignId,submitted:false},null,2));
