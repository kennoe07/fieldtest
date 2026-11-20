import {Transaction} from '@mysten/sui/transactions';
import {normalizeSuiAddress,normalizeStructTag,isValidTransactionDigest} from '@mysten/sui/utils';
import {sha256} from '../src/rewardDocuments.ts';
import {setAddressBalanceGas} from './reward-testnet.mjs';
const ensure=(ok,message)=>{if(!ok)throw Error(message)};
const uint=value=>{ensure(typeof value==='string'&&/^[0-9]+$/.test(value)&&BigInt(value)>0n&&BigInt(value)<2n**64n,'Exact positive base units required');return BigInt(value)};

/** Review-only publication builder. Publishes nothing, signs nothing. The
 * manifest must be independently reviewed; its hashes are not an attestation.
 * Upgrade capability remains owned by the sender, not burned or made immutable.
 */
export async function prepareTestnetPublication({reader,compiled,review,sourceBytes,testBytes,sender,genesisDigest,gasBudgetMist='100000000'}){
 ensure(/^0x[0-9a-f]{64}$/.test(sender)&&!/^0x0+$/.test(sender),'Full sender address required');
 ensure(review.network==='sui:testnet'&&review.published===false&&isValidTransactionDigest(genesisDigest),'Explicit unpublished testnet review required');
 ensure(review.sourceSha256===await sha256(sourceBytes)&&review.testSourceSha256===await sha256(testBytes),'Reviewed source or tests changed');
 ensure(Array.isArray(compiled.modules)&&compiled.modules.length===1&&review.moduleCount===1,'Expected reviewed single rewards module');
 const module=compiled.modules[0];
 ensure(typeof module==='string'&&module.length<180000&&/^[A-Za-z0-9+/]+={0,2}$/.test(module),'Invalid compiled module');
 const bytes=Buffer.from(module,'base64');
 ensure(bytes.toString('base64')===module&&await sha256(bytes)===review.moduleSha256,'Reviewed module bytes changed');
 const dependencies=['0x1','0x2'].map(id=>normalizeSuiAddress(id));
 ensure(JSON.stringify(compiled.dependencies)===JSON.stringify(dependencies)&&JSON.stringify(review.dependencies)===JSON.stringify(dependencies),'Unexpected package dependencies');
 ensure(Array.isArray(compiled.digest)&&compiled.digest.length===32&&compiled.digest.every(b=>Number.isInteger(b)&&b>=0&&b<=255)&&Buffer.from(compiled.digest).toString('hex')===review.compilerBuildDigestHex,'Compiler build digest mismatch');
 const budget=uint(gasBudgetMist);ensure(budget<=100000000n,'Testnet publication budget exceeds review limit');
 const info=await reader.serviceInfo();ensure(info.chain==='testnet'&&info.chainId===genesisDigest&&typeof info.epoch==='bigint','Testnet identity mismatch');
 const balance=await reader.addressBalance(sender,'0x2::sui::SUI');
 ensure(balance&&normalizeStructTag(balance.coinType)===normalizeStructTag('0x2::sui::SUI')&&typeof balance.addressBalance==='bigint'&&balance.addressBalance>=budget,'Insufficient SUI address balance for publication budget');
 const price=await reader.referenceGasPrice();ensure(typeof price==='bigint'&&price>0n,'Reference gas price unavailable');
 const tx=new Transaction();tx.setSender(sender);tx.setGasOwner(sender);tx.setGasPrice(price);tx.setGasBudget(budget);setAddressBalanceGas(tx,{genesisDigest,epoch:info.epoch});
 const [upgradeCap]=tx.publish({modules:compiled.modules,dependencies});
 tx.transferObjects([upgradeCap],sender);
 const unsigned=await tx.build(),digest=await tx.getDigest();
 const result=await reader.simulate(unsigned),effects=result?.effects;
 ensure(result&&(result.digest===undefined||result.digest===digest)&&effects?.transactionDigest===digest&&effects.status?.success===true&&!effects.status.error,'Publication simulation failed or bytes mismatch');
 const gas=effects.gasUsed;ensure(gas&&typeof gas.computationCost==='bigint'&&typeof gas.storageCost==='bigint'&&gas.computationCost>=0n&&gas.storageCost>=0n&&gas.computationCost+gas.storageCost<=budget,'Publication gas cost unavailable or above budget');
 const packages=effects.changedObjects?.filter(o=>o.outputState===3&&o.idOperation===2);
 ensure(packages?.length===1&&/^0x[0-9a-f]{64}$/.test(packages[0].objectId)&&isValidTransactionDigest(packages[0].outputDigest),'Expected exactly one simulated package creation');
 return {schema:'fieldtest-testnet-publication-review-v1',preparedAt:new Date().toISOString(),network:'sui:testnet',genesisDigest,sender,upgradeCapRecipient:sender,upgradePolicy:'Sender retains UpgradeCap; package is not made immutable',sourceSha256:review.sourceSha256,moduleSha256:review.moduleSha256,unsignedBytes:Buffer.from(unsigned).toString('base64'),transactionDigest:digest,gasBudgetMist:String(budget),gasPriceMist:String(price),gasMode:'addressBalance',expiration:tx.getData().expiration,simulatedGas:{computationCost:String(gas.computationCost),storageCost:String(gas.storageCost),storageRebate:String(gas.storageRebate??0n)},predictedPackageId:packages[0].objectId,predictedPackageDigest:packages[0].outputDigest,simulated:true,submitted:false};
}
