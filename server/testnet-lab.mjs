import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createTestnetRewardReader} from './reward-grpc-reader.mjs';
import {verifyRewardTransaction,CampaignBcs} from './reward-verifier.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const outputs=resolve(root,'../outputs');
const read=async name=>JSON.parse(await readFile(resolve(outputs,name),'utf8'));
const run=promisify(execFile);
export function allowLabRequest(req){
 const host=req.headers.host;
 return host==='127.0.0.1:5190'&&!['cross-site','same-site'].includes(req.headers['sec-fetch-site'])&&(!req.headers.origin||req.headers.origin===`http://${host}`)&&(req.method!=='POST'||req.headers.origin===`http://${host}`);
}
export async function confirmedLabSummary(reader=createTestnetRewardReader()){
 const funded=await read('fieldtest-funded-testnet-campaign.json');
 const paid=await read('fieldtest-testnet-payout-confirmed.json');
 const refunded=await read('fieldtest-testnet-refund-confirmed.json');
 if(funded.policy.network!=='sui:testnet'||[paid,refunded].some(x=>JSON.stringify(x.policy)!==JSON.stringify(funded.policy)||x.plan.chain_campaign_id!==funded.plan.chain_campaign_id))throw Error('Inconsistent testnet trial records');
 const policy=funded.policy;
 const funding=await verifyRewardTransaction({reader,policy,plan:{...funded.plan,state:'Frozen',chain_campaign_id:null},transactionDigest:funded.fundingReceipt.transactionDigest});
 const payout=await verifyRewardTransaction({reader,policy,plan:funded.plan,transactionDigest:paid.payoutReceipt.transactionDigest,payment:{tester:paid.tester.address,submissionHash:paid.submissionHash}});
 const refund=await verifyRewardTransaction({reader,policy,plan:paid.plan,transactionDigest:refunded.refundReceipt.transactionDigest});
 if(funding.kind!=='Funded'||payout.kind!=='Paid'||refund.kind!=='Refunded')throw Error('Unexpected trial events');
 const object=await reader.object(funded.plan.chain_campaign_id),state=CampaignBcs.parse(object.contents.value);
 if(!state.closed||state.funds!=='0')throw Error('Campaign closure has not been verified');
 return {network:'Sui testnet',owner:funded.plan.owner_address,tester:paid.tester.address,campaignId:funded.plan.chain_campaign_id,closed:true,remainingUsdc:'0',receipts:[funding,payout,refund].map(p=>({kind:p.kind,amountUsdc:String(Number(p.amountBaseUnits)/1e6),digest:p.transactionDigest,checkpoint:p.checkpoint})),checkedAt:new Date().toISOString()};
}
export function testnetLabPlugin(){
 let preparing=false;
 return {name:'fieldtest-local-testnet-lab',configureServer(server){server.middlewares.use('/__testnet-lab',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.setHeader('X-Content-Type-Options','nosniff');
  const send=(status,value)=>{res.statusCode=status;res.end(JSON.stringify(value))};
  if(!allowLabRequest(req))return send(403,{error:'Open this lab directly at http://127.0.0.1:5190.'});
  try{
   if(req.method==='GET'&&req.url==='/status')return send(200,await confirmedLabSummary());
   if(req.method==='POST'&&req.url==='/prepare'){
    if(preparing)return send(409,{error:'A funding review is already being prepared.'});
    preparing=true;
    try{
     const filename=`fieldtest-ui-funding-${crypto.randomUUID()}.json`,path=resolve(outputs,filename);
     await run(process.execPath,[resolve(root,'scripts/prepare-testnet-campaign.mjs'),path],{cwd:root,timeout:120000,maxBuffer:65536,windowsHide:true});
     const review=await read(filename);
     return send(200,{path,owner:review.intent.payload.sender,fundingUsdc:review.fundingUsdc,rewardUsdc:review.rewardUsdc,slots:review.slots,submitUntil:review.submitUntil,refundAvailableAt:review.refundAvailableAt,gasBudgetMist:review.transaction.gasBudgetMist,digest:review.transaction.transactionDigest,preparedAt:review.preparedAt,expiresAt:review.intent.expires_at,submitted:false});
    }finally{preparing=false}
   }
   send(404,{error:'Unknown lab operation.'});
  }catch(error){console.error('Testnet lab:',error.message);send(503,{error:'The testnet check could not finish. Check the local terminal for details; no transaction was submitted.'})}
 })}};
}
