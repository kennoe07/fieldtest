// Explicit opt-in read-only probe. Never executes, signs, connects a wallet,
// requests faucet funds, or publishes. Usage: node ... PUBLIC_ADDRESS GENESIS_DIGEST
import {Transaction} from '@mysten/sui/transactions';
import {isValidTransactionDigest,normalizeStructTag} from '@mysten/sui/utils';
import {createTestnetRewardReader} from '../server/reward-grpc-reader.mjs';
import {setAddressBalanceGas} from '../server/reward-testnet.mjs';
const [owner,genesisDigest]=process.argv.slice(2);
if(!/^0x[0-9a-f]{64}$/.test(owner??'')||!isValidTransactionDigest(genesisDigest??''))throw Error('Supply a public address and separately reviewed testnet genesis digest');
const reader=createTestnetRewardReader(),info=await reader.serviceInfo();
if(info.chain!=='testnet'||info.chainId!==genesisDigest)throw Error('Unexpected network');
const before=await reader.addressBalance(owner,'0x2::sui::SUI');
if(!before||BigInt(before.addressBalance)<10000000n)throw Error('Insufficient address-balance SUI for the simulation budget');
const tx=new Transaction();tx.setSender(owner);tx.setGasOwner(owner);tx.setGasBudget(10000000n);tx.setGasPrice(await reader.referenceGasPrice());
setAddressBalanceGas(tx,{genesisDigest,epoch:info.epoch});
const clock=await reader.object('0x0000000000000000000000000000000000000000000000000000000000000006');
if(clock?.owner?.kind!==3||normalizeStructTag(clock.objectType)!==normalizeStructTag('0x2::clock::Clock'))throw Error('Invalid clock object');
tx.moveCall({target:'0x2::clock::timestamp_ms',arguments:[tx.sharedObjectRef({objectId:clock.objectId,initialSharedVersion:String(clock.owner.version),mutable:false})]});
const bytes=await tx.build(),digest=await tx.getDigest(),result=await reader.simulate(bytes);
if(result?.effects?.transactionDigest!==digest||(result.digest!==undefined&&result.digest!==digest)||result.effects.status?.success!==true||result.effects.status.error)throw Error('Simulation did not succeed with exact bytes');
const after=await reader.addressBalance(owner,'0x2::sui::SUI');
console.log(JSON.stringify({checkedAt:new Date().toISOString(),chain:info.chain,genesisDigest,epoch:info.epoch,address:owner,addressSuiBefore:before.addressBalance,addressSuiAfter:after.addressBalance,transactionDigest:digest,status:result.effects.status,gasUsed:result.effects.gasUsed,gasPaymentCount:tx.getData().gasData.payment.length,submitted:false},(_,v)=>typeof v==='bigint'?String(v):v,null,2));
