import {Transaction} from '@mysten/sui/transactions';

/** Signature only. Never fall back to sign-and-execute or remove expiry bounds
 * to accommodate an older wallet protocol.
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
   if(/glass/i.test(wallet.name)&&(transaction.getData().expiration?.ValidDuring||transaction.getData().expiration?.Validity))throw Error('This Glass legacy signing interface cannot handle the reviewed address-balance transaction format. Use a current signer or the verified Sui CLI. Nothing was submitted.');
   const signed=await wallet.features['sui:signTransactionBlock'].signTransactionBlock({transactionBlock:transaction,account,chain:network});
   result={bytes:signed.transactionBlockBytes,signature:signed.signature};
 }else throw Error('Wallet does not support signing this transaction without execution');
 return result;
}
