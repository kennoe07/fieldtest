import assert from 'node:assert/strict';
import {Ed25519Keypair} from '@mysten/sui/keypairs/ed25519';
import {normalizeSuiAddress,toBase58} from '@mysten/sui/utils';
import {sha256} from '../src/rewardDocuments.ts';
import {prepareTestnetPublication} from '../server/reward-publication.mjs';
import {validatePublicationReview,createPublicationSession} from '../server/publication-session.mjs';
const id=n=>normalizeSuiAddress('0x'+n.toString(16)),digest=n=>toBase58(new Uint8Array(32).fill(n));
let count=0;
async function fixture(){
 const key=Ed25519Keypair.generate(),sender=key.toSuiAddress(),sourceBytes=new Uint8Array([1]),testBytes=new Uint8Array([2]),module=new Uint8Array([3,4]);
 const compiled={modules:[Buffer.from(module).toString('base64')],dependencies:[id(1),id(2)],digest:Array(32).fill(7)};
 const manifest={network:'sui:testnet',published:false,sourceSha256:await sha256(sourceBytes),testSourceSha256:await sha256(testBytes),moduleCount:1,moduleSha256:await sha256(module),dependencies:compiled.dependencies,compilerBuildDigestHex:'07'.repeat(32)};
 const info={chain:'testnet',chainId:digest(3),epoch:5n,checkpointHeight:10n};
 let found=false,executions=0,receipt;
 const reader={serviceInfo:async()=>info,addressBalance:async()=>({coinType:'0x2::sui::SUI',addressBalance:2000000000n}),referenceGasPrice:async()=>1000n,simulate:async()=>({effects:{transactionDigest:review?.transactionDigest,status:{success:true},gasUsed:{computationCost:1n,storageCost:1n},changedObjects:[{outputState:3,idOperation:2,objectId:id(9),outputDigest:digest(9)}]}})};
 // Simulated byte identity is calculated with the actual SDK, not fabricated.
 const {Transaction}=await import('@mysten/sui/transactions');reader.simulate=async bytes=>({effects:{transactionDigest:await Transaction.from(bytes).getDigest(),status:{success:true},gasUsed:{computationCost:1n,storageCost:1n},changedObjects:[{outputState:3,idOperation:2,objectId:id(9),outputDigest:digest(9)}]}});
 const review=await prepareTestnetPublication({reader,compiled,review:manifest,sourceBytes,testBytes,sender,genesisDigest:digest(3)});
 const validated=await validatePublicationReview(review,{sourceBytes,compiled});
 const tx={digest:review.transactionDigest,checkpoint:6n,effects:{transactionDigest:review.transactionDigest,status:{success:true},changedObjects:[{outputState:3,idOperation:2,objectId:id(9)},{outputState:2,idOperation:2,objectId:id(10)}]}};
 const pkg={objectId:id(9),objectType:'package',version:1n,digest:digest(9),previousTransaction:review.transactionDigest};
 const cap={objectId:id(10),objectType:'0x2::package::UpgradeCap',owner:{kind:1,address:sender},previousTransaction:review.transactionDigest};
 reader.transaction=async()=>{if(!found)throw Object.assign(Error('not found'),{code:'NOT_FOUND'});return tx};reader.object=async objectId=>objectId===id(9)?pkg:cap;
 const input={review,validated,reader,execute:async()=>{executions++;found=true},onConfirmed:async value=>receipt=value};
 const session=createPublicationSession(input);
 return {key,review,validated,sourceBytes,compiled,info,tx,pkg,cap,reader,input,session,executions:()=>executions,receipt:()=>receipt,setFound:value=>found=value};
}
const f=await fixture();assert.equal((await f.session.signingData()).digest,f.review.transactionDigest);assert.equal(f.executions(),0);count++;
const signed=await f.key.signTransaction(f.validated.bytes);await f.session.acceptSignature(signed);assert.equal(f.session.summary().state,'Signed');assert.equal(f.executions(),0);count++;
await assert.rejects(f.session.submit('wrong digest'));assert.equal(f.executions(),0);count++;
assert.equal((await f.session.submit(f.review.transactionDigest)).state,'Confirmed');assert.equal(f.executions(),1);assert.equal(f.receipt().upgradeCapOwner,f.review.sender);count++;
await assert.rejects(f.session.submit(f.review.transactionDigest));assert.equal(f.executions(),1);count++;
for(const mutate of [r=>r.sender=id(12),r=>r.gasBudgetMist='1',r=>r.sourceSha256='bad',r=>r.expiration.ValidDuring.chain=digest(9),r=>r.upgradeCapRecipient=id(12)]){const f=await fixture(),review=structuredClone(f.review);mutate(review);await assert.rejects(validatePublicationReview(review,{sourceBytes:f.sourceBytes,compiled:f.compiled}));count++}
const wrong=await fixture();await assert.rejects(wrong.session.acceptSignature(await Ed25519Keypair.generate().signTransaction(wrong.validated.bytes)));assert.equal(wrong.executions(),0);count++;
await assert.rejects(wrong.session.acceptSignature({...await wrong.key.signTransaction(wrong.validated.bytes),bytes:'AQID'}));count++;
for(const mutate of [f=>f.info.chain='mainnet',f=>f.info.epoch=7n,f=>f.reader.simulate=async()=>({effects:{status:{success:false}}})]){const f=await fixture();mutate(f);await assert.rejects(f.session.signingData());assert.equal(f.executions(),0);count++}
const uncertain=await fixture();uncertain.input.execute=async()=>{throw Error('timeout')};const session=createPublicationSession(uncertain.input);await session.acceptSignature(await uncertain.key.signTransaction(uncertain.validated.bytes));await assert.rejects(session.submit(uncertain.review.transactionDigest));assert.equal(session.summary().state,'Submission uncertain');await assert.rejects(session.submit(uncertain.review.transactionDigest));count++;
const changedCap=await fixture();changedCap.setFound(true);changedCap.cap.owner.address=id(12);await assert.rejects(changedCap.session.refresh());count++;
console.log(`${count} signing-session checks passed with generated unfunded fixture keys; no wallet or live chain used.`);
