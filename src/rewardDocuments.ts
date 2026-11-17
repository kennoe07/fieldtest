import type {Campaign,Submission,Evidence} from './researchStore';
export const USDC_TYPE='0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
function hex32(value:string){if(!/^[0-9a-f]{64}$/.test(value))throw Error('Expected a 32-byte lowercase hex value');return value}
function address(value:string){if(!/^0x[0-9a-f]{64}$/.test(value)||/^0x0+$/.test(value))throw Error('A verified wallet or deployed package identifier is required');return value}
export function canonicalJson(value:unknown):string{
  function sort(v:unknown):unknown{
    if(v===null||typeof v==='string'||typeof v==='boolean')return v;
    if(typeof v==='number'){if(!Number.isSafeInteger(v))throw Error('Canonical documents require safe integers');return v}
    if(Array.isArray(v))return v.map(sort);
    if(typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype)return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort((v as Record<string,unknown>)[k])]));
    throw Error('Unsupported canonical document value');
  }
  return JSON.stringify(sort(value));
}
export async function sha256(bytes:Uint8Array){const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')}
export function newDocumentSalt(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')}
export async function documentDigest(document:unknown){return sha256(new TextEncoder().encode(canonicalJson(document)))}
export function rewardBudget(c:Campaign,reviewDays=7){
 if(!Number.isInteger(c.reward)||c.reward<1||c.reward>1000||!Number.isInteger(c.slots)||c.slots<1||c.slots>50)throw Error('Invalid campaign reward or capacity');
 if(!Number.isInteger(reviewDays)||reviewDays<1||reviewDays>30)throw Error('Choose 1–30 review days');
 const submit=Date.parse(c.deadline??'');if(!Number.isSafeInteger(submit))throw Error('Campaign needs a valid submission deadline');
 const reward=BigInt(c.reward)*1000000n;
 return {rewardBaseUnits:reward.toString(),totalBaseUnits:(reward*BigInt(c.slots)).toString(),totalUsdc:(BigInt(c.reward)*BigInt(c.slots)).toString(),submitUntilMs:String(submit),reviewUntilMs:String(submit+reviewDays*86400000),reviewDays};
}
export function termsDocument(c:Campaign,owner:string,packageId:string,salt:string,reviewDays=7,now=Date.now()){
 const budget=rewardBudget(c,reviewDays);
 if(Number(budget.submitUntilMs)<=now)throw Error('Funding requires a future submission deadline');
 if(!c.url||!c.criteria||!c.tasks.length)throw Error('Campaign terms are incomplete');
 return {schema:'fieldtest-reward-terms-v1',network:'sui:mainnet',packageId:address(packageId),campaignId:c.id,owner:address(owner),salt:hex32(salt),
   asset:{symbol:'USDC',coinType:USDC_TYPE,decimals:6},rewardBaseUnits:budget.rewardBaseUnits,slots:c.slots,submitUntilMs:budget.submitUntilMs,reviewUntilMs:budget.reviewUntilMs,
   research:{name:c.name,project:c.project,goal:c.description,productUrl:c.url,tasks:[...c.tasks],acceptanceCriteria:c.criteria}};
}
export async function submissionDocument(terms:ReturnType<typeof termsDocument>,submission:Submission,tester:string,salt:string,loadEvidence?:(file:Evidence)=>Promise<Blob>){
 if(submission.campaignId!==terms.campaignId||submission.responses.length!==terms.research.tasks.length||submission.responses.some((r,i)=>r.task!==terms.research.tasks[i]))throw Error("Submission does not match the frozen campaign terms");
 const termsHash=await documentDigest(terms);
 const responses=[];
 for(const r of submission.responses){const evidence=[];
   for(const file of r.evidence){
     const blob=file.path?await loadEvidence?.(file):file.blob;
     if(!blob||!blob.size)throw Error('Evidence bytes must be loaded through authorized private storage before hashing');
     evidence.push({name:file.name,contentHash:await sha256(new Uint8Array(await blob.arrayBuffer())),size:blob.size,mime:blob.type});
   }
   responses.push({task:r.task,outcome:r.outcome,expected:r.expected,actual:r.actual,evidence});
 }
 // Review status, review note and updatedAt are intentionally excluded: reviewing
 // unchanged feedback must not change its content commitment.
 return {schema:'fieldtest-reward-submission-v1',termsHash:hex32(termsHash),campaignId:submission.campaignId,submissionId:submission.id,tester:address(tester),salt:hex32(salt),responses,summary:submission.summary};
}
