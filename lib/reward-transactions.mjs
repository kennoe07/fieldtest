import { Transaction } from '@mysten/sui/transactions';
const MAX=(1n<<64n)-1n;
function id(value){if(typeof value!=='string'||!/^0x[0-9a-f]{64}$/.test(value)||/^0x0+$/.test(value))throw Error('Expected a full nonzero Sui identifier');return value}
function integer(value){if(typeof value!=='string'||!/^\d+$/.test(value))throw Error('Use an integer base-unit string');const n=BigInt(value);if(n>MAX)throw Error('Amount exceeds u64');return n}
function hash(value){if(typeof value!=='string'||!/^([0-9a-f]{2}){32}$/.test(value))throw Error('Expected a 32-byte lowercase hex digest');return value.match(/../g).map(byte=>parseInt(byte,16))}

export function suiToMist(value){
  if(typeof value!=='string'||!/^\d+(\.\d{1,9})?$/.test(value))throw Error('Use a decimal SUI amount with at most 9 decimal places');
  const [whole,fraction='']=value.split('.');const mist=BigInt(whole)*1000000000n+BigInt(fraction.padEnd(9,'0'));
  if(mist===0n||mist>MAX)throw Error('SUI amount is outside range');return mist.toString();
}

// Prepares a SUI-only PTB. Never signs, submits, or calls a network endpoint.
// The caller must verify package/network identity and reconcile confirmed events.
export function buildRewardTransaction(input){
  const packageId=id(input.packageId), tx=new Transaction();
  const target=name=>`${packageId}::rewards::${name}`;
  let args;
  if(input.action==='create'){
    const reward=integer(input.rewardMist),slots=integer(input.slots),submit=integer(input.submitUntilMs),review=integer(input.reviewUntilMs);
    if(reward===0n||slots===0n||slots>50n||reward*slots>MAX||review<=submit)throw Error('Invalid funded campaign terms');
    const digest=hash(input.termsHash);
    const [funding]=tx.splitCoins(tx.gas,[tx.pure.u64(reward*slots)]);
    args=[funding,tx.pure.vector('u8',digest),tx.pure.u64(reward),tx.pure.u64(slots),tx.pure.u64(submit),tx.pure.u64(review),tx.object('0x6')];
  }else{
    args=[tx.object(id(input.campaignId))];
    if(input.action==='enroll')args.push(tx.pure.address(id(input.tester)));
    else if(input.action==='submit')args.push(tx.pure.vector('u8',hash(input.submissionHash)));
    else if(input.action==='approve')args.push(tx.pure.address(id(input.tester)),tx.pure.vector('u8',hash(input.submissionHash)));
    else if(input.action!=='refund')throw Error('Unknown reward action');
    args.push(tx.object('0x6'));
  }
  tx.moveCall({target:target(input.action),typeArguments:['0x2::sui::SUI'],arguments:args});
  return tx;
}

