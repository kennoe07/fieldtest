import type { Campaign, Submission, TaskResponse } from './researchStore';

export type TesterDraft = {key:string;tasks:string[];baseVersion:string;name:string;summary:string;responses:TaskResponse[];step:number;savedAt:string};
let database:Promise<IDBDatabase>|undefined;
function db(){
  if(!database)database=new Promise((resolve,reject)=>{
    const request=indexedDB.open('fieldtest-tester-drafts-v1',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('drafts',{keyPath:'key'});
    request.onsuccess=()=>{const result=request.result;result.onversionchange=()=>{result.close();database=undefined};resolve(result)};
    request.onerror=()=>{database=undefined;reject(Error('Draft storage is unavailable. Keep this tab open.'))};
    request.onblocked=()=>{database=undefined;reject(Error('Close other Fieldtest tabs to enable draft storage.'))};
  });return database;
}
export function draftKey(scope:string,campaign:string){return JSON.stringify([scope,campaign])}
export function compatibleDraft(draft:TesterDraft,campaign:Campaign,submission?:Submission){
  return (!submission||submission.status==='Revision requested')&&draft.baseVersion===(submission?.updatedAt??'new')&&
    JSON.stringify(draft.tasks)===JSON.stringify(campaign.tasks)&&draft.responses.length===campaign.tasks.length&&
    draft.responses.every((r,i)=>r.task===campaign.tasks[i]&&Array.isArray(r.evidence))&&
    Number.isInteger(draft.step)&&draft.step>=0&&draft.step<=campaign.tasks.length;
}
// Serialize all writes, including cleanup, so an in-flight save cannot recreate
// a draft after submission. Transactions resolve only once committed.
let queue:Promise<unknown>=Promise.resolve();
const versions=new Map<string,number>();
function write(key:string,value?:TesterDraft){
  const version=(versions.get(key)??0)+1;versions.set(key,version);
  const operation=queue.catch(()=>{}).then(async()=>{if(versions.get(key)!==version)return;const database=await db();await new Promise<void>((resolve,reject)=>{
    const tx=database.transaction('drafts','readwrite');const store=tx.objectStore('drafts');
    if(value)store.put(value);else store.delete(key);
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(Error('Draft could not be saved. Keep this tab open.'));tx.onabort=()=>reject(Error('Draft save was interrupted. Keep this tab open.'));
  })});queue=operation;return operation;
}
export async function loadDraft(key:string):Promise<TesterDraft|undefined>{await queue.catch(()=>{});const database=await db();return new Promise((resolve,reject)=>{const request=database.transaction('drafts').objectStore('drafts').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(Error('Saved draft could not be read.'))})}
export function saveDraft(value:TesterDraft){return write(value.key,value)}
export function deleteDraft(key:string){return write(key)}
