import {Transaction} from '@mysten/sui/transactions';
import {verifyTransactionSignature} from '@mysten/sui/verify';
import {bcs} from '@mysten/sui/bcs';
import {normalizeSuiAddress,normalizeStructTag} from '@mysten/sui/utils';
import {sha256} from '../src/rewardDocuments.ts';
const ensure=(ok,message)=>{if(!ok)throw Error(message)};

export async function validatePublicationReview(review,{sourceBytes,compiled}){
 ensure(review.schema==='fieldtest-testnet-publication-review-v1'&&review.network==='sui:testnet'&&review.submitted===false,'Expected unsigned testnet publication review');
 const bytes=Buffer.from(review.unsignedBytes,'base64'),tx=Transaction.from(bytes),data=tx.getData();
 ensure(await tx.getDigest()===review.transactionDigest&&data.sender===review.sender&&data.gasData.owner===review.sender,'Reviewed transaction identity changed');
 ensure(data.commands.length===2&&data.commands[0].Publish&&data.commands[1].TransferObjects,'Only publication and UpgradeCap transfer are allowed');
 const publish=data.commands[0].Publish,transfer=data.commands[1].TransferObjects;
 ensure(publish.modules.length===1&&JSON.stringify(publish.modules)===JSON.stringify(compiled.modules)&&JSON.stringify(publish.dependencies)===JSON.stringify(['0x1','0x2'].map(id=>normalizeSuiAddress(id))),'Compiled module/dependencies changed');
 ensure(await sha256(sourceBytes)===review.sourceSha256&&await sha256(Buffer.from(publish.modules[0],'base64'))===review.moduleSha256,'Reviewed source/module hash changed');
 ensure(transfer.objects.length===1&&JSON.stringify(transfer.objects[0].NestedResult)==='[0,0]'&&transfer.address.Input!==undefined,'UpgradeCap transfer changed');
 ensure(bcs.Address.parse(Buffer.from(data.inputs[transfer.address.Input].Pure.bytes,'base64'))===review.sender&&review.upgradeCapRecipient===review.sender,'UpgradeCap recipient changed');
 ensure(data.gasData.payment?.length===0&&data.gasData.budget===review.gasBudgetMist&&BigInt(data.gasData.budget)<=100000000n&&BigInt(data.gasData.budget)>0n,'Gas review changed');
 const expiration=data.expiration?.ValidDuring;
 ensure(expiration&&expiration.chain===review.genesisDigest&&JSON.stringify(data.expiration)===JSON.stringify(review.expiration),'Chain/expiration changed');
 return {bytes,transactionJSON:await tx.toJSON(),expiration};
}

/** Local process only; signed authorization stays in memory and is never logged.
 * Submission is a separate explicit user button, never a side effect of signing.
 */
export function createPublicationSession({review,validated,reader,execute,onConfirmed=async()=>{}}){
 let signature=null,state='Unsigned',busy=false,receipt=null;
 const summary=()=>({state,receipt,review:{...review,unsignedBytes:undefined},signed:!!signature});
 async function refresh(){
   const info=await reader.serviceInfo();ensure(info.chain==='testnet'&&info.chainId===review.genesisDigest,'Wrong chain');
   let tx;
   try{tx=await reader.transaction(review.transactionDigest)}catch(error){if(error.code==='NOT_FOUND')return summary();throw error}
   if(!tx)return summary();
   ensure(tx.digest===review.transactionDigest&&tx.effects?.transactionDigest===review.transactionDigest,'Chain receipt identity mismatch');
   if(tx.effects.status?.success===false){state='Failed';signature=null;return summary()}
   if(tx.effects.status?.success!==true||typeof tx.checkpoint!=='bigint'||tx.checkpoint<=0n||typeof info.checkpointHeight!=='bigint'||tx.checkpoint>info.checkpointHeight){state='Submitted';return summary()}
   const packages=tx.effects.changedObjects?.filter(o=>o.outputState===3&&o.idOperation===2);
   ensure(packages?.length===1&&packages[0].objectId===review.predictedPackageId,'Published package differs from review');
   const pkg=await reader.object(packages[0].objectId);
   ensure(pkg?.objectType==='package'&&pkg.previousTransaction===review.transactionDigest&&pkg.digest===review.predictedPackageDigest,'Published package metadata mismatch');
   let cap;
   for(const change of tx.effects.changedObjects.filter(o=>o.outputState===2&&o.idOperation===2)){
     const object=await reader.object(change.objectId);
     if(object?.objectType&&normalizeStructTag(object.objectType)===normalizeStructTag('0x2::package::UpgradeCap'))cap=object;
   }
   ensure(cap?.owner?.kind===1&&cap.owner.address===review.sender&&cap.previousTransaction===review.transactionDigest,'UpgradeCap ownership not confirmed');
   receipt={network:review.network,genesisDigest:review.genesisDigest,transactionDigest:review.transactionDigest,checkpoint:String(tx.checkpoint),packageId:pkg.objectId,packageDigest:pkg.digest,packageVersion:String(pkg.version),upgradeCapId:cap.objectId,upgradeCapOwner:review.sender,confirmedAt:new Date().toISOString()};
   await onConfirmed(receipt);state='Confirmed';signature=null;return summary();
 }
 async function preflight(){
   const info=await reader.serviceInfo();ensure(info.chain==='testnet'&&info.chainId===review.genesisDigest,'Wrong chain');
   ensure(typeof info.epoch==='bigint'&&info.epoch>=BigInt(validated.expiration.minEpoch)&&info.epoch<=BigInt(validated.expiration.maxEpoch),'Reviewed transaction expired; prepare a new review');
   await refresh();ensure(!['Confirmed','Failed','Submitted','Submission uncertain'].includes(state),'Check the existing transaction receipt before continuing');
   const balance=await reader.addressBalance(review.sender,'0x2::sui::SUI');ensure(balance?.addressBalance>=BigInt(review.gasBudgetMist),'Insufficient test SUI address balance');
   const simulated=await reader.simulate(validated.bytes);ensure(simulated?.effects?.transactionDigest===review.transactionDigest&&simulated.effects.status?.success===true&&!simulated.effects.status.error,'Exact reviewed transaction no longer simulates successfully');
   return summary();
 }
 return {summary,refresh,async signingData(){await preflight();return {transactionJSON:validated.transactionJSON,network:review.network,sender:review.sender,digest:review.transactionDigest}},async acceptSignature(signed){
   ensure(!busy&&!['Confirmed','Failed','Submitted','Submission uncertain'].includes(state),'Transaction is already submitted or busy');
   ensure(typeof signed?.bytes==='string'&&Buffer.from(signed.bytes,'base64').equals(validated.bytes),'Wallet changed reviewed transaction bytes; fresh review required');
   ensure(typeof signed.signature==='string'&&signed.signature.length<20000,'Invalid wallet signature');
   await verifyTransactionSignature(validated.bytes,signed.signature,{address:review.sender});
   signature=signed.signature;state='Signed';return summary();
 },async submit(confirmedDigest){
   ensure(!busy&&signature&&state==='Signed'&&confirmedDigest===review.transactionDigest,'Sign and explicitly confirm the reviewed transaction first');busy=true;
   try{await preflight();state='Submission uncertain';await execute(validated.bytes,signature);state='Submitted';return await refresh()}
   finally{busy=false}
 }};
}
