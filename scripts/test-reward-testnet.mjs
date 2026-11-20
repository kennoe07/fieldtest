import assert from 'node:assert/strict';
import {Transaction} from '@mysten/sui/transactions';
import {toBase58,normalizeSuiAddress,fromHex} from '@mysten/sui/utils';
import {simulateTestnetReward,CoinBcs,testnetTermsDocument} from '../server/reward-testnet.mjs';
import {TESTNET_USDC,MAINNET_USDC,rewardNetwork} from '../lib/reward-networks.mjs';
import {CampaignBcs,verifyRewardTransaction} from '../server/reward-verifier.mjs';
import {documentDigest} from '../src/rewardDocuments.ts';
import {fixture as receiptFixture} from './test-reward-verifier.mjs';
import {rewardReaderFromClient} from '../server/reward-grpc-reader.mjs';
const id=n=>normalizeSuiAddress('0x'+n.toString(16)),digest=n=>toBase58(new Uint8Array(32).fill(n));
let checks=0;
function fixture(action='create'){
 const policy={network:'sui:testnet',coinType:TESTNET_USDC,packageId:id(10),packageVersion:'1',packageDigest:digest(1),publishDigest:digest(2),genesisDigest:digest(3)};
 const payload={network:policy.network,packageId:policy.packageId,asset:'USDC',action,sender:id(4),rewardBaseUnits:'5000000',slots:'2',submitUntilMs:'2000000000000',reviewUntilMs:'2000600000000',termsHash:'ab'.repeat(32),campaignId:id(11),tester:id(5),submissionHash:'cd'.repeat(32)};
 const intent={state:'Prepared',expires_at:'2099-01-01T00:00:00Z',payload};
 const object=(objectId,objectType,owner,value)=>({objectId,objectType,owner,version:2n,digest:digest(4),contents:{value}});
 const coins=new Map([
  [id(7),object(id(7),'0x2::coin::Coin<0x2::sui::SUI>',{kind:1,address:id(4)},CoinBcs.serialize({id:id(7),balance:'50000000'}).toBytes())],
  [id(8),object(id(8),`0x2::coin::Coin<${TESTNET_USDC}>`,{kind:1,address:id(4)},CoinBcs.serialize({id:id(8),balance:'10000000'}).toBytes())],
  [id(6),object(id(6),'0x2::clock::Clock',{kind:3,version:1n},new Uint8Array())],
  [id(11),object(id(11),`${policy.packageId}::rewards::Campaign<${TESTNET_USDC}>`,{kind:3,version:1n},CampaignBcs.serialize({id:id(11),owner:id(4),terms_hash:Array.from(fromHex(payload.termsHash)),reward:'5000000',slots:'2',submit_until_ms:payload.submitUntilMs,review_until_ms:payload.reviewUntilMs,funds:'10000000',seats:[],closed:false}).toBytes())],
 ]);
 const pkg={objectId:policy.packageId,objectType:'package',version:1n,digest:policy.packageDigest,previousTransaction:policy.publishDigest};
 const info={chain:'testnet',chainId:policy.genesisDigest,epoch:5n};
 let simulations=0;
 const reader={object:async key=>key===policy.packageId?pkg:coins.get(key),serviceInfo:async()=>info,referenceGasPrice:async()=>1000n,simulate:async bytes=>{simulations++;const d=await Transaction.from(bytes).getDigest();return {digest:d,effects:{transactionDigest:d,status:{success:true},gasUsed:{computationCost:100n,storageCost:200n}}}}};
 return {input:{reader,policy,intent,gasCoinId:id(7),fundingCoinIds:[id(8)],now:1000},coins,pkg,info,simulations:()=>simulations};
}
for(const action of ['create','enroll','submit','approve','refund']){
 const f=fixture(action),result=await simulateTestnetReward(f.input),data=Transaction.from(Buffer.from(result.unsignedBytes,'base64')).getData();
 assert.equal(data.commands.at(-1).MoveCall.typeArguments[0],TESTNET_USDC);assert.equal(data.sender,id(4));assert.equal(result.submitted,false);assert.equal(result.simulated,true);assert.equal(String(data.expiration.Epoch),'5');assert.equal(data.gasData.payment[0].objectId,id(7));checks++;
 assert.equal(data.commands.at(-1).MoveCall.function,action);assert.equal(data.commands.at(-1).MoveCall.package,f.input.policy.packageId);assert.equal(data.gasData.owner,id(4));assert.equal(String(data.gasData.budget),'10000000');assert.ok(data.inputs.every(input=>!input.UnresolvedObject));assert.equal(await Transaction.from(Buffer.from(result.unsignedBytes,'base64')).getDigest(),result.transactionDigest);
}
for(const [name,mutate] of [
 ['mainnet policy',f=>f.input.policy.network='sui:mainnet'],
 ['mainnet USDC',f=>f.input.policy.coinType=MAINNET_USDC],
 ['intent network mismatch',f=>f.input.intent.payload.network='sui:mainnet'],
 ['armed intent',f=>f.input.intent.state='AwaitingWallet'],
 ['expired intent',f=>f.input.intent.expires_at='1970-01-01'],
 ['wrong RPC chain',f=>f.info.chain='mainnet'],
 ['wrong genesis',f=>f.info.chainId=digest(9)],
 ['unapproved package',f=>f.pkg.digest=digest(9)],
 ['insufficient gas',f=>f.coins.get(id(7)).contents.value=CoinBcs.serialize({id:id(7),balance:'1'}).toBytes()],
 ['wrong coin owner',f=>f.coins.get(id(8)).owner.address=id(9)],
 ['wrong USDC asset',f=>f.coins.get(id(8)).objectType=`0x2::coin::Coin<${MAINNET_USDC}>`],
 ['insufficient USDC',f=>f.coins.get(id(8)).contents.value=CoinBcs.serialize({id:id(8),balance:'1'}).toBytes()],
 ['duplicate coin selection',f=>f.input.fundingCoinIds=[id(8),id(8)]],
 ['gas used for funding',f=>f.input.fundingCoinIds=[id(7)]],
 ['gas cap exceeded',f=>f.input.gasBudgetMist='100000001'],
 ['invalid clock',f=>f.coins.get(id(6)).owner.kind=1],
]){const f=fixture();mutate(f);await assert.rejects(simulateTestnetReward(f.input),undefined,name);assert.equal(f.simulations(),0);checks++}
for(const response of [undefined,{digest:'wrong'}, {effects:{status:{success:false}}}]){const f=fixture();f.input.reader.simulate=async()=>response;await assert.rejects(simulateTestnetReward(f.input));checks++}
const timeout=fixture();timeout.input.reader.simulate=async()=>{throw Error('timeout')};await assert.rejects(simulateTestnetReward(timeout.input));checks++;
for(const mutate of [result=>result.effects.gasUsed.storageCost=10000001n,result=>delete result.effects.gasUsed,result=>result.effects.status.error={description:'failure'},result=>result.effects.transactionDigest=digest(9)]){
 const f=fixture(),simulate=f.input.reader.simulate;f.input.reader.simulate=async bytes=>{const result=await simulate(bytes);mutate(result);return result};await assert.rejects(simulateTestnetReward(f.input));checks++;
}
assert.notEqual(rewardNetwork('sui:mainnet').rpc,rewardNetwork('sui:testnet').rpc);assert.throws(()=>rewardNetwork('sui:devnet'));checks++;
assert.throws(()=>rewardNetwork('toString'));assert.throws(()=>rewardNetwork('__proto__'));checks++;
const document=testnetTermsDocument({id:'lab',reward:5,slots:2,deadline:'2099-01-01',url:'https://example.com',criteria:'Useful feedback',tasks:['Open product'],name:'Lab',project:'Fieldtest',description:'Find friction'},id(4),id(10),'ab'.repeat(32));assert.equal(document.network,'sui:testnet');assert.equal(document.asset.coinType,TESTNET_USDC);checks++;
for(const kind of ['Funded','Paid','Refunded']){
 const f=await receiptFixture(kind),{plan,policy}=f.input;
 policy.network='sui:testnet';policy.coinType=TESTNET_USDC;plan.network='sui:testnet';plan.document.network='sui:testnet';plan.document.asset.coinType=TESTNET_USDC;plan.terms_hash=await documentDigest(plan.document);f.info.chain='testnet';
 for(const obj of f.objects){const state=CampaignBcs.parse(obj.contents.value);state.terms_hash=Array.from(fromHex(plan.terms_hash));obj.contents.value=CampaignBcs.serialize(state).toBytes();obj.objectType=`${policy.packageId}::rewards::Campaign<${TESTNET_USDC}>`}
 assert.equal((await verifyRewardTransaction(f.input)).network,'sui:testnet');checks++;
 f.info.chain='mainnet';await assert.rejects(verifyRewardTransaction(f.input));checks++;
}
let request;
const reader=rewardReaderFromClient({transactionExecutionService:{simulateTransaction(args,options){request=args;assert.equal(options.timeout,15000);return {response:Promise.resolve({transaction:{digest:'fixture'}})}}}});
await reader.simulate(new Uint8Array([1,2,3]));assert.equal(request.checks,0);assert.equal(request.doGasSelection,false);assert.ok(request.readMask.paths.includes('transaction.effects'));checks++;
console.log(`${checks} isolated testnet construction, simulation and receipt checks passed. No live RPC calls.`);

