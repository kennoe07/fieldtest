import assert from 'node:assert/strict';
import {Transaction} from '@mysten/sui/transactions';
import {normalizeSuiAddress,toBase58} from '@mysten/sui/utils';
import {sha256} from '../src/rewardDocuments.ts';
import {prepareTestnetPublication} from '../server/reward-publication.mjs';
const id=n=>normalizeSuiAddress('0x'+n.toString(16)),digest=n=>toBase58(new Uint8Array(32).fill(n));
let count=0;
async function fixture(){
 const sourceBytes=new Uint8Array([1]),testBytes=new Uint8Array([2]),moduleBytes=new Uint8Array([3,4]);
 const compiled={modules:[Buffer.from(moduleBytes).toString('base64')],dependencies:[id(1),id(2)],digest:Array(32).fill(7)};
 const review={network:'sui:testnet',published:false,sourceSha256:await sha256(sourceBytes),testSourceSha256:await sha256(testBytes),moduleCount:1,moduleSha256:await sha256(moduleBytes),dependencies:[...compiled.dependencies],compilerBuildDigestHex:'07'.repeat(32)};
 const info={chain:'testnet',chainId:digest(3),epoch:5n},balance={coinType:'0x2::sui::SUI',addressBalance:2000000000n};
 let simulations=0,data;
 const reader={serviceInfo:async()=>info,addressBalance:async()=>balance,referenceGasPrice:async()=>1000n,simulate:async bytes=>{simulations++;const tx=Transaction.from(bytes);data=tx.getData();return {effects:{transactionDigest:await tx.getDigest(),status:{success:true},gasUsed:{computationCost:1000000n,storageCost:20000000n},changedObjects:[{outputState:3,idOperation:2,objectId:id(9),outputDigest:digest(9)}]}}}};
 return {input:{reader,compiled,review,sourceBytes,testBytes,sender:id(4),genesisDigest:digest(3)},info,balance,simulations:()=>simulations,data:()=>data};
}
const valid=await fixture(),result=await prepareTestnetPublication(valid.input),tx=valid.data();
assert.equal(result.submitted,false);assert.equal(result.upgradeCapRecipient,id(4));assert.deepEqual(tx.commands.map(c=>c.$kind),['Publish','TransferObjects']);assert.deepEqual(tx.commands[0].Publish.dependencies,[id(1),id(2)]);assert.deepEqual(tx.gasData.payment,[]);assert.equal(tx.gasData.owner,id(4));assert.equal(tx.expiration.ValidDuring.chain,digest(3));assert.equal(await Transaction.from(Buffer.from(result.unsignedBytes,'base64')).getDigest(),result.transactionDigest);count++;
for(const [name,mutate] of [
 ['mainnet review',f=>f.input.review.network='sui:mainnet'],
 ['published review',f=>f.input.review.published=true],
 ['changed source',f=>f.input.sourceBytes=new Uint8Array([8])],
 ['changed test source',f=>f.input.testBytes=new Uint8Array([8])],
 ['changed module',f=>f.input.compiled.modules[0]='BAUG'],
 ['changed dependency',f=>f.input.compiled.dependencies[1]=id(8)],
 ['changed build digest',f=>f.input.compiled.digest[0]=8],
 ['wrong RPC chain',f=>f.info.chain='mainnet'],
 ['wrong genesis',f=>f.info.chainId=digest(8)],
 ['insufficient address balance',f=>f.balance.addressBalance=1n],
 ['wrong balance asset',f=>f.balance.coinType='0x2::example::COIN'],
 ['unsafe numeric balance',f=>f.balance.addressBalance=2000000000],
 ['gas cap exceeded',f=>f.input.gasBudgetMist='100000001'],
 ['zero sender',f=>f.input.sender=id(0)],
]){const f=await fixture();mutate(f);await assert.rejects(prepareTestnetPublication(f.input),undefined,name);assert.equal(f.simulations(),0);count++}
for(const mutate of [r=>r.effects.status.success=false,r=>r.effects.transactionDigest=digest(8),r=>r.effects.gasUsed.storageCost=100000001n,r=>r.effects.changedObjects=[],r=>r.effects.changedObjects.push(r.effects.changedObjects[0])]){
 const f=await fixture(),simulate=f.input.reader.simulate;f.input.reader.simulate=async bytes=>{const result=await simulate(bytes);mutate(result);return result};await assert.rejects(prepareTestnetPublication(f.input));count++;
}
console.log(`${count} unsigned publication review checks passed. No live calls or transactions.`);
