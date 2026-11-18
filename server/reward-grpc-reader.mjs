import {SuiGrpcClient} from '@mysten/sui/grpc';
// Fixed server endpoint; never accept an RPC URL from a browser request.
export function createMainnetRewardReader(){
 const client=new SuiGrpcClient({network:'mainnet',baseUrl:'https://fullnode.mainnet.sui.io:443'});
 return {
   async serviceInfo(){return (await client.ledgerService.getServiceInfo({},{timeout:15000}).response)},
   async transaction(digest){return (await client.ledgerService.getTransaction({digest,readMask:{paths:['digest','effects','events','checkpoint','timestamp']}},{timeout:15000}).response).transaction},
   async object(objectId,version){return (await client.ledgerService.getObject({objectId,...(version===undefined?{}:{version:BigInt(version)}),readMask:{paths:['object_id','version','digest','owner','object_type','contents','previous_transaction']}},{timeout:15000}).response).object},
 };
}
