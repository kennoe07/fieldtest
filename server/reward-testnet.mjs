import {bcs} from '@mysten/sui/bcs';
import {Transaction,Inputs} from '@mysten/sui/transactions';
import {normalizeSuiAddress,normalizeStructTag,isValidTransactionDigest,toHex} from '@mysten/sui/utils';
import {buildRewardTransaction} from '../lib/reward-transactions.mjs';
import {TESTNET_USDC} from '../lib/reward-networks.mjs';
import {termsDocument,documentDigest} from '../src/rewardDocuments.ts';
import {CampaignBcs} from './reward-verifier.mjs';
const ensure=(ok,message)=>{if(!ok)throw Error(message)};
const address=value=>{ensure(typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)&&!/^0x0+$/.test(value),'Full nonzero identifier required');return value};
const integer=value=>{ensure((typeof value==='bigint'||typeof value==='string'&&/^\d+$/.test(value))&&BigInt(value)>=0n&&BigInt(value)<2n**64n,'Exact u64 required');return BigInt(value)};
export const CoinBcs=bcs.struct('Coin',{id:bcs.Address,balance:bcs.u64()});
const sui='0x2::sui::SUI',clock=normalizeSuiAddress('0x6');

export function setAddressBalanceGas(tx,{genesisDigest,epoch}){
 ensure(isValidTransactionDigest(genesisDigest)&&typeof epoch==='bigint'&&epoch>=0n&&epoch<2n**64n-1n,'Invalid address-gas chain or epoch');
 tx.setGasPayment([]);
 // Current testnet rejects timestamp bounds. App preparation expiry is not
 // proof that signed bytes have expired on chain; retain pending intents.
 tx.setExpiration({ValidDuring:{minEpoch:String(epoch),maxEpoch:String(epoch+1n),minTimestamp:null,maxTimestamp:null,chain:genesisDigest,nonce:crypto.getRandomValues(new Uint32Array(1))[0]}});
}

// Lab documents never enter the mainnet-only production database.
export function testnetTermsDocument(...args){const doc=termsDocument(...args);return {...doc,network:'sui:testnet',asset:{symbol:'USDC',coinType:TESTNET_USDC,decimals:6}}}

/** Testnet-only unsigned build + simulation. No execution, signing, database
 * binding, publishing or gas selection with mocked coins is performed here. */
export async function simulateTestnetReward({reader,policy,intent,fundingCoinIds=[],gasCoinId,gasMode='coins',gasBudgetMist='10000000',now=Date.now()}){
 ensure(policy.network==='sui:testnet'&&policy.coinType===TESTNET_USDC,'Only explicit testnet USDC policy is allowed');
 address(policy.packageId);
 ensure([policy.genesisDigest,policy.packageDigest,policy.publishDigest].every(isValidTransactionDigest),'Reviewed deployment digests required');
 const p=intent.payload;
 ensure(intent.state==='Prepared'&&Date.parse(intent.expires_at)>now&&p?.network===policy.network&&p.packageId===policy.packageId&&p.asset==='USDC','Intent is expired, armed or on another deployment');
 address(p.sender);
 const info=await reader.serviceInfo();
 ensure(info.chain==='testnet'&&info.chainId===policy.genesisDigest&&typeof info.epoch==='bigint','Testnet identity or epoch mismatch');
 const pkg=await reader.object(policy.packageId);
 ensure(pkg?.objectId===policy.packageId&&pkg.objectType==='package'&&pkg.digest===policy.packageDigest&&integer(pkg.version)===integer(policy.packageVersion)&&pkg.previousTransaction===policy.publishDigest,'Unapproved testnet package');
 const budget=integer(gasBudgetMist),price=integer(await reader.referenceGasPrice());
 ensure(budget>0n&&budget<=100000000n&&price>0n,'Gas budget or price outside test harness limits');
 const objects=new Map();
 async function object(id){id=normalizeSuiAddress(id);if(!objects.has(id)){const obj=await reader.object(id);ensure(obj?.objectId===id&&integer(obj.version)>0n&&isValidTransactionDigest(obj.digest),'Invalid node object reference');objects.set(id,obj)}return objects.get(id)}
 async function coin(id,type){const obj=await object(address(id));ensure(obj.owner?.kind===1&&obj.owner.address===p.sender&&normalizeStructTag(obj.objectType)===normalizeStructTag(`0x2::coin::Coin<${type}>`),'Coin asset or owner mismatch');const coin=CoinBcs.parse(obj.contents?.value);ensure(coin.id===id,'Coin contents identity mismatch');return {obj,balance:integer(coin.balance)}}
 ensure(['coins','addressBalance'].includes(gasMode),'Unsupported gas mode');
 let gas;
 if(gasMode==='addressBalance'){
   ensure(gasCoinId===undefined,'Address-balance gas must not also specify a gas coin');
   const balance=await reader.addressBalance(p.sender,sui);
   ensure(balance&&normalizeStructTag(balance.coinType)===normalizeStructTag(sui)&&integer(balance.addressBalance)>=budget,'Insufficient SUI address balance');
 }else{gas=await coin(gasCoinId,sui);ensure(gas.balance>=budget,'Insufficient SUI gas balance')}
 if(p.action==='create'){
   ensure(Array.isArray(fundingCoinIds)&&fundingCoinIds.length>0&&fundingCoinIds.length<=50&&new Set(fundingCoinIds).size===fundingCoinIds.length&&!fundingCoinIds.includes(gasCoinId),'Invalid funding coin selection');
   let balance=0n;for(const id of fundingCoinIds)balance+=(await coin(id,TESTNET_USDC)).balance;
   ensure(balance>=integer(p.rewardBaseUnits)*integer(p.slots),'Insufficient test USDC balance');
 }else{
   const campaign=await object(address(p.campaignId));
   ensure(campaign.owner?.kind===3&&normalizeStructTag(campaign.objectType)===normalizeStructTag(`${policy.packageId}::rewards::Campaign<${TESTNET_USDC}>`),'Wrong testnet campaign asset or ownership');
   const value=CampaignBcs.parse(campaign.contents?.value);
   ensure(toHex(Uint8Array.from(value.terms_hash))===p.termsHash&&!value.closed,'Campaign terms mismatch or closed');
   if(p.action!=='submit')ensure(value.owner===p.sender,'Builder wallet mismatch');
 }
 const tx=buildRewardTransaction({...p,network:policy.network,fundingCoinIds});
 tx.setSender(p.sender);tx.setGasOwner(p.sender);tx.setGasBudget(budget);tx.setGasPrice(price);
 if(gasMode==='addressBalance'){
   setAddressBalanceGas(tx,{genesisDigest:policy.genesisDigest,epoch:info.epoch});
 }else{
   tx.setGasPayment([{objectId:gas.obj.objectId,version:String(gas.obj.version),digest:gas.obj.digest}]);
   tx.setExpiration({Epoch:String(info.epoch)});
 }
 const data=tx.getData();
 for(let i=0;i<data.inputs.length;i++){
   const input=data.inputs[i];if(!input.UnresolvedObject)continue;
   const id=input.UnresolvedObject.objectId,obj=await object(id);
   if(id===clock)ensure(obj.owner?.kind===3&&normalizeStructTag(obj.objectType)===normalizeStructTag('0x2::clock::Clock'),'Invalid clock object');
   if(obj.owner?.kind===3){ensure(integer(obj.owner.version)>0n,'Missing initial shared version');data.inputs[i]=Inputs.SharedObjectRef({objectId:id,initialSharedVersion:String(obj.owner.version),mutable:id!==clock})}
   else data.inputs[i]=Inputs.ObjectRef({objectId:id,version:String(obj.version),digest:obj.digest});
 }
 const resolved=Transaction.from(JSON.stringify(data)),bytes=await resolved.build(),digest=await resolved.getDigest();
 const result=await reader.simulate(bytes);
 // Live simulation responses can omit the envelope digest. The effects digest
 // must always match; reject an inconsistent envelope if one is present.
 ensure(result&&(result.digest===undefined||result.digest===digest)&&result.effects?.transactionDigest===digest&&result.effects.status?.success===true&&!result.effects.status.error,'Testnet simulation failed or returned a different transaction');
 const costs=result.effects.gasUsed;ensure(costs&&integer(costs.computationCost)+integer(costs.storageCost)<=budget,'Missing or excessive simulated gas cost');
 return {network:policy.network,unsignedBytes:Buffer.from(bytes).toString('base64'),transactionDigest:digest,gasMode,gasBudgetMist:String(budget),simulated:true,submitted:false};
}
