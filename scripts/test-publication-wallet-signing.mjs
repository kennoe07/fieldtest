import assert from 'node:assert/strict';
import {Transaction} from '@mysten/sui/transactions';
import {normalizeSuiAddress} from '@mysten/sui/utils';
import {signReviewedPublication} from '../lib/publication-wallet-signing.mjs';
const sender=normalizeSuiAddress('0x1'),account={address:sender,chains:['sui:testnet'],publicKey:new Uint8Array(32),features:['sui:signTransactionBlock']};
const tx=new Transaction();tx.setSender(sender);tx.setGasOwner(sender);tx.setGasPrice(1000);tx.setGasBudget(100000000);tx.setGasPayment([]);tx.setExpiration({ValidDuring:{chain:'69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD',minEpoch:'1289',maxEpoch:'1290',minTimestamp:null,maxTimestamp:null,nonce:1234}});
const [cap]=tx.publish({modules:['AQID'],dependencies:['0x1','0x2']});tx.transferObjects([cap],sender);
const data={transactionJSON:await tx.toJSON(),digest:await tx.getDigest(),sender,network:'sui:testnet'};
let count=0,calls=0;
const legacy={name:'GlassWallet',features:{'sui:signTransactionBlock':{async signTransactionBlock(){calls++;throw Error('Unsupported wallet must not be called')}}}};
await assert.rejects(signReviewedPublication(legacy,account,data),/Glass legacy signing interface/);assert.equal(calls,0);count++;
const modern={name:'Modern fixture',features:{'sui:signTransaction':{async signTransaction({transaction,chain}){assert.deepEqual(Object.keys(transaction),['toJSON']);assert.equal(chain,'sui:testnet');assert.equal(await Transaction.from(await transaction.toJSON()).getDigest(),data.digest);return {bytes:'fixture',signature:'fixture'}}}}};
await signReviewedPublication(modern,account,data);count++;
for(const changed of [{...data,digest:'changed'},{...data,network:'sui:mainnet'},{...data,sender:normalizeSuiAddress('0x2')}]){await assert.rejects(signReviewedPublication(legacy,account,changed));assert.equal(calls,0);count++}
const rejected={name:'Current legacy wallet fixture',features:{'sui:signTransactionBlock':{signTransactionBlock:async()=>{calls++;throw Error('User rejected')}}}};
await assert.rejects(signReviewedPublication(rejected,account,data),/User rejected/);assert.equal(calls,1);count++;
await assert.rejects(signReviewedPublication({name:'GlassWallet',features:{'sui:signAndExecuteTransactionBlock':{}}},account,data));count++;
console.log(`${count} wallet handoff checks passed. Unsupported Glass format is blocked before a wallet call; no real wallet called.`);
