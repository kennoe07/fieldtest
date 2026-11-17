import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const db = new PGlite();
const owner='11111111-1111-4111-8111-111111111111';
const tester='22222222-2222-4222-8222-222222222222';
const outsider='33333333-3333-4333-8333-333333333333';
// Stub only the Supabase-owned auth/storage tables. The application migration and
// policies run unchanged in PostgreSQL. This does not test email or Storage HTTP APIs.
await db.exec(`
 create role anon; create role authenticated;
 create schema auth; create schema storage;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,storage,public to authenticated,anon;
 grant execute on function auth.uid() to authenticated,anon;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text unique,owner_id text,metadata jsonb);
 alter table storage.objects enable row level security;
 grant select,insert,delete on storage.objects to authenticated;
 insert into auth.users values('${owner}'),('${tester}'),('${outsider}');
`);
await db.exec(await readFile(new URL('../supabase/migrations/001_research.sql',import.meta.url),'utf8'));
if(process.argv.includes('--reward-records')){
 await db.exec('create role service_role');
 for(const file of ['002_wallet_links.sql','004_reward_records.sql'])await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
}
let checks=0;
async function as(user,fn){
 await db.exec('begin; set local role authenticated;');
 await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
 try {const value=await fn();await db.exec('commit');return value}catch(error){await db.exec('rollback');throw error}
}
async function check(name,fn){await fn();checks++;process.stdout.write(`PASS ${name}\n`)}
const campaign={name:'Onboarding check',project:'Fieldtest',description:'Understand wallet onboarding friction.',tasks:['Find the connection button'],criteria:'Explain the expected and actual task outcome.',url:'https://example.com',reward:5,slots:1,deadline:'2099-01-01T00:00:00Z'};
let id,token,submission;
await check('unauthenticated creation fails',async()=>assert.rejects(as('',()=>db.query('select public.ft_create_campaign($1::jsonb)',[campaign])),/Sign in/));
await check('owner creates a validated campaign',async()=>{id=await as(owner,async()=>(await db.query('select public.ft_create_campaign($1::jsonb) as id',[campaign])).rows[0].id);assert.ok(id)});
await check('invalid empty tasks fail',async()=>assert.rejects(as(owner,()=>db.query('select public.ft_create_campaign($1::jsonb)',[{...campaign,tasks:[]}])),/check constraint/));
await check('owner sees invitation token',async()=>{token=await as(owner,async()=>(await db.query('select token from public.ft_invitations where campaign_id=$1',[id])).rows[0].token);assert.ok(token)});
await check('uninvited tester cannot read campaign',async()=>assert.equal((await as(tester,()=>db.query('select * from public.ft_campaigns'))).rows.length,0));
await check('unrelated account cannot read invite token',async()=>assert.equal((await as(outsider,()=>db.query('select * from public.ft_invitations'))).rows.length,0));
await check('owner cannot allocate a tester seat to themself',async()=>assert.rejects(as(owner,()=>db.query('select public.ft_join_campaign($1)',[token])),/separate tester/));
await check('tester accepts invitation',async()=>assert.equal((await as(tester,()=>db.query('select public.ft_join_campaign($1) as id',[token]))).rows[0].id,id));
await check('accepting twice does not allocate a second seat',async()=>{await as(tester,()=>db.query('select public.ft_join_campaign($1)',[token]));assert.equal(Number((await as(owner,()=>db.query('select count(*) as n from public.ft_members'))).rows[0].n),1)});
await check('last-seat limit rejects another tester',async()=>assert.rejects(as(outsider,()=>db.query('select public.ft_join_campaign($1)',[token])),/No tester seats/));
await check('member can read the joined campaign',async()=>assert.equal((await as(tester,()=>db.query('select * from public.ft_campaigns'))).rows.length,1));
await check('member still cannot read invitation tokens',async()=>assert.equal((await as(tester,()=>db.query('select * from public.ft_invitations'))).rows.length,0));
await check('accepted unfinished session is discoverable without invitation',async()=>{const rows=(await as(tester,()=>db.query('select c.id from public.ft_members m join public.ft_campaigns c on c.id=m.campaign_id where m.tester_id=$1',[tester]))).rows;assert.deepEqual(rows.map(r=>r.id),[id]);assert.equal((await as(tester,()=>db.query('select * from public.ft_submissions'))).rows.length,0)});
await check('outsider cannot discover another tester session',async()=>assert.equal((await as(outsider,()=>db.query('select c.id from public.ft_members m join public.ft_campaigns c on c.id=m.campaign_id where m.tester_id=$1',[tester]))).rows.length,0));
await check('builder has no tester session for own campaign',async()=>assert.equal((await as(owner,()=>db.query('select c.id from public.ft_members m join public.ft_campaigns c on c.id=m.campaign_id where m.tester_id=$1',[owner]))).rows.length,0));
const path=`${tester}/${id}/test.png`;
await check('uploading into another account folder fails',async()=>assert.rejects(as(tester,()=>db.query("insert into storage.objects(bucket_id,name,metadata) values('fieldtest-evidence',$1,'{\"size\":100}')",[`${owner}/${id}/spoof.png`])),/row-level security/));
await check('joined tester uploads own evidence',async()=>{await as(tester,()=>db.query("insert into storage.objects(bucket_id,name,metadata) values('fieldtest-evidence',$1,'{\"size\":100}')",[path]))});
await check('builder cannot read unfinished evidence',async()=>assert.equal((await as(owner,()=>db.query('select * from storage.objects'))).rows.length,0));
const response={testerName:'Tester',summary:'Useful first-use feedback.',responses:[{task:campaign.tasks[0],outcome:'Blocked',expected:'I expected an obvious connection button.',actual:'The button was hidden below the initial viewport.',evidence:[{name:'test.png',path}]}]};
await check('uninvited account cannot submit',async()=>assert.rejects(as(outsider,()=>db.query('select public.ft_submit_feedback($1,$2::jsonb)',[id,response])),/Join this campaign/));
await check('incomplete response fails',async()=>assert.rejects(as(tester,()=>db.query('select public.ft_submit_feedback($1,$2::jsonb)',[id,{...response,responses:[]}])),/Complete every task/));
await check('foreign evidence path fails',async()=>assert.rejects(as(tester,()=>db.query('select public.ft_submit_feedback($1,$2::jsonb)',[id,{...response,responses:[{...response.responses[0],evidence:[{name:'stolen.png',path:`${owner}/${id}/spoof.png`}]}]}])),/Evidence unavailable/));
await check('tester submits valid feedback',async()=>{submission=(await as(tester,()=>db.query('select public.ft_submit_feedback($1,$2::jsonb) as id',[id,response]))).rows[0].id;assert.ok(submission)});
await check('repeat submission is rejected',async()=>assert.rejects(as(tester,()=>db.query('select public.ft_submit_feedback($1,$2::jsonb)',[id,response])),/already exists/));
await check('campaign owner can read committed evidence',async()=>assert.equal((await as(owner,()=>db.query('select * from storage.objects'))).rows.length,1));
await check('outsider cannot read submission or evidence',async()=>{assert.equal((await as(outsider,()=>db.query('select * from public.ft_submissions'))).rows.length,0);assert.equal((await as(outsider,()=>db.query('select * from storage.objects'))).rows.length,0)});
await check('tester cannot change a review directly',async()=>assert.rejects(as(tester,()=>db.query("update public.ft_submissions set status='Approved'")),/permission denied/));
await check('tester cannot review via RPC',async()=>assert.rejects(as(tester,()=>db.query('select public.ft_review_submission($1,$2,$3)',[submission,'Approved',''])),/Review not allowed/));
await check('unrelated owner cannot review',async()=>assert.rejects(as(outsider,()=>db.query('select public.ft_review_submission($1,$2,$3)',[submission,'Approved',''])),/Review not allowed/));
await check('revision requires a meaningful note',async()=>assert.rejects(as(owner,()=>db.query('select public.ft_review_submission($1,$2,$3)',[submission,'Revision requested','bad'])),/Invalid review/));
await check('owner requests revision',async()=>{await as(owner,()=>db.query('select public.ft_review_submission($1,$2,$3)',[submission,'Revision requested','Please clarify the button location.']))});
await check('tester revision updates the original receipt',async()=>assert.equal((await as(tester,()=>db.query('select public.ft_submit_feedback($1,$2::jsonb) as id',[id,response]))).rows[0].id,submission));
await check('owner approves and tester sees the decision',async()=>{await as(owner,()=>db.query('select public.ft_review_submission($1,$2,$3)',[submission,'Approved','Good detail.']));assert.equal((await as(tester,()=>db.query('select status from public.ft_submissions where id=$1',[submission]))).rows[0].status,'Approved')});
await check('a finalized review cannot be changed',async()=>assert.rejects(as(owner,()=>db.query('select public.ft_review_submission($1,$2,$3)',[submission,'Rejected','Changed my mind.'])),/already reviewed/));
await check('referenced evidence cannot be deleted by uploader',async()=>assert.equal((await as(tester,()=>db.query('delete from storage.objects returning id'))).rows.length,0));
await check('campaign instructions cannot be edited by a direct client write',async()=>assert.rejects(as(owner,()=>db.query("update public.ft_campaigns set criteria='Different criteria' where id=$1",[id])),/permission denied/));
await db.query("update public.ft_campaigns set deadline='2000-01-01' where id=$1",[id]);
await check('closed session remains readable for receipt history',async()=>assert.equal((await as(tester,()=>db.query('select c.id from public.ft_members m join public.ft_campaigns c on c.id=m.campaign_id where m.tester_id=$1',[tester]))).rows[0].id,id));
await check('late submissions fail at database boundary',async()=>assert.rejects(as(tester,()=>db.query('select public.ft_submit_feedback($1,$2::jsonb)',[id,response])),/Campaign closed/));
await db.close();
process.stdout.write(`\n${checks} PostgreSQL access and workflow checks passed.\n`);
