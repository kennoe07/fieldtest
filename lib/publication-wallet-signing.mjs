import {Transaction} from '@mysten/sui/transactions';

/** Signature only. Glass's legacy extension bridge forwards its argument via
 * postMessage, so it must receive serialized data rather than class methods.
 * Never fall back to sign-and-execute or change gas/expiry for compatibility.
 */
export async function signReviewedPublication(wallet,account,{transactionJSON,digest,sender,network}){
 if(network!=='sui:testnet'||account?.address!==sender||!account.chains.includes(network))throw Error('Reviewed testnet account required');
 const transaction=Transaction.from(transactionJSON);
 if(await transaction.getDigest()!==digest)throw Error('Reviewed transaction changed before wallet handoff');
 let result;
 if(wallet.features['sui:signTransaction']){
   // The modern standard takes a minimal serializer, not the SDK class graph.
   result=await wallet.features['sui:signTransaction'].signTransaction({transaction:{toJSON:async()=>transactionJSON},account,chain:network});
 }else if(wallet.features['sui:signTransactionBlock']){
   let transactionBlock=transaction;
   if(/glass/i.test(wallet.name)){
     transactionBlock=transaction.serialize();
     if(await Transaction.from(transactionBlock).getDigest()!==digest)throw Error('Legacy serialization changed reviewed bytes');
   }
   const signed=await wallet.features['sui:signTransactionBlock'].signTransactionBlock({transactionBlock,account,chain:network});
   result={bytes:signed.transactionBlockBytes,signature:signed.signature};
 }else throw Error('Wallet does not support signing this transaction without execution');
 return result;
}
