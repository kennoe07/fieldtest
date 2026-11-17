import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import {compatibleDraft,deleteDraft,draftKey,loadDraft,saveDraft} from '../src/testerDrafts.ts';

let passed=0;
async function check(name,fn){await fn();passed++;console.log(`PASS ${name}`)}
const campaign={id:'campaign-1',tasks:['Explore the product']};
const key=draftKey('account:tester-1',campaign.id);
const draft={key,tasks:campaign.tasks,baseVersion:'new',name:'Tester',summary:'A useful note',step:1,savedAt:new Date().toISOString(),responses:[{task:campaign.tasks[0],outcome:'Blocked',expected:'The product should open',actual:'The link opened localhost',evidence:[{id:'image-1',name:'evidence.png',blob:new Blob(['test-image'],{type:'image/png'})}]}]};
await check('answers, name, summary and review step survive storage',async()=>{await saveDraft(draft);const restored=await loadDraft(key);assert.equal(restored.name,draft.name);assert.equal(restored.summary,draft.summary);assert.equal(restored.step,1);assert.equal(restored.responses[0].actual,draft.responses[0].actual)});
await check('screenshot Blob survives structured cloning',async()=>{const restored=await loadDraft(key);assert.equal(await restored.responses[0].evidence[0].blob.text(),'test-image');assert.equal(restored.responses[0].evidence[0].blob.type,'image/png')});
await check('different account gets no draft',async()=>assert.equal(await loadDraft(draftKey('account:tester-2',campaign.id)),undefined));
await check('different campaign gets no draft',async()=>assert.equal(await loadDraft(draftKey('account:tester-1','campaign-2')),undefined));
await check('local mode is separate from signed-in drafts',async()=>assert.equal(await loadDraft(draftKey('local',campaign.id)),undefined));
await check('same account can resume matching campaign',()=>assert.ok(compatibleDraft(draft,campaign)));
await check('changed tasks invalidate stored responses',()=>assert.equal(compatibleDraft(draft,{...campaign,tasks:['Different task']}),false));
await check('submitted work is not replaced by old draft',()=>assert.equal(compatibleDraft(draft,campaign,{status:'Submitted',updatedAt:'v1'}),false));
await check('approved work is not replaced by draft',()=>assert.equal(compatibleDraft({...draft,baseVersion:'v1'},campaign,{status:'Approved',updatedAt:'v1'}),false));
await check('matching revision draft can resume',()=>assert.ok(compatibleDraft({...draft,baseVersion:'v1'},campaign,{status:'Revision requested',updatedAt:'v1'})));
await check('new server revision invalidates stale draft',()=>assert.equal(compatibleDraft({...draft,baseVersion:'v1'},campaign,{status:'Revision requested',updatedAt:'v2'}),false));
await check('invalid step is rejected',()=>assert.equal(compatibleDraft({...draft,step:99},campaign),false));
await check('latest queued edit wins',async()=>{await Promise.all([saveDraft({...draft,summary:'earlier'}),saveDraft({...draft,summary:'latest'})]);assert.equal((await loadDraft(key)).summary,'latest')});
await check('submission cleanup wins over queued saves',async()=>{await Promise.all([saveDraft(draft),saveDraft({...draft,name:'Last edit'}),deleteDraft(key)]);assert.equal(await loadDraft(key),undefined)});
await check('fresh revision can save after cleanup',async()=>{await saveDraft({...draft,baseVersion:'revision-v2'});assert.equal((await loadDraft(key)).baseVersion,'revision-v2')});
await deleteDraft(key);
console.log(`${passed} draft persistence checks passed`);
