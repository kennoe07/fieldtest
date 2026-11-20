import {SuiGrpcClient} from '@mysten/sui/grpc';
import {rewardNetwork} from '../lib/reward-networks.mjs';
// Fixed server endpoint; never accept an RPC URL from a browser request.
export function createMainnetRewardReader(){
 return createReader('sui:mainnet');
}
export function createTestnetRewardReader(){return createReader('sui:testnet')}
function createReader(network){
 const config=rewardNetwork(network);
 const client=new SuiGrpcClient({network:config.chain,baseUrl:config.rpc});
 return rewardReaderFromClient(client);
}
// Exported for transport-fixture tests. Only fixed-endpoint factories are used
// for actual network access; no browser supplies a client or URL.
export function rewardReaderFromClient(client){
 return {
   async referenceGasPrice(){return (await client.ledgerService.getEpoch({readMask:{paths:['reference_gas_price']}},{timeout:15000}).response).epoch?.referenceGasPrice},
   async simulate(bytes){return (await client.transactionExecutionService.simulateTransaction({transaction:{bcs:{value:bytes}},checks:0,doGasSelection:false,readMask:{paths:['transaction.digest','transaction.effects']}},{timeout:15000}).response).transaction},
   async checkpoint(sequenceNumber){return (await client.ledgerService.getCheckpoint({checkpointId:{oneofKind:'sequenceNumber',sequenceNumber:BigInt(sequenceNumber)},readMask:{paths:['sequence_number','digest','summary','contents','transactions.digest','transactions.effects','transactions.events']}},{timeout:15000}).response).checkpoint},
   async serviceInfo(){return (await client.ledgerService.getServiceInfo({},{timeout:15000}).response)},
   async transaction(digest){return (await client.ledgerService.getTransaction({digest,readMask:{paths:['digest','effects','events','checkpoint','timestamp']}},{timeout:15000}).response).transaction},
   async object(objectId,version){return (await client.ledgerService.getObject({objectId,...(version===undefined?{}:{version:BigInt(version)}),readMask:{paths:['object_id','version','digest','owner','object_type','contents','previous_transaction']}},{timeout:15000}).response).object},
 };
}
