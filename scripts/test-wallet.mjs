import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Secp256k1Keypair } from '@mysten/sui/keypairs/secp256k1';
import { Secp256r1Keypair } from '@mysten/sui/keypairs/secp256r1';
import { verifyWalletProof } from '../server/wallet-proof.mjs';
import handler from '../api/wallet.mjs';

let passed=0;
async function check(name, fn){await fn();console.log(`PASS ${name}`);passed++}
for (const Key of [Ed25519Keypair,Secp256k1Keypair,Secp256r1Keypair]) {
  const key=Key.generate(),other=Key.generate();
  const challenge={address:key.toSuiAddress(),message:'Fieldtest wallet ownership verification v1\nNonce: test-only\nPurpose: No payment.',expiresAt:new Date(Date.now()+60000).toISOString()};
  const {signature}=await key.signPersonalMessage(new TextEncoder().encode(challenge.message));
  await check(`${Key.name} valid signature`,()=>verifyWalletProof(challenge,signature));
  await check(`${Key.name} wrong address rejected`,()=>assert.rejects(()=>verifyWalletProof({...challenge,address:other.toSuiAddress()},signature)));
  await check(`${Key.name} altered message rejected`,()=>assert.rejects(()=>verifyWalletProof({...challenge,message:challenge.message+'changed'},signature)));
  await check(`${Key.name} expiry rejected`,()=>assert.rejects(()=>verifyWalletProof({...challenge,expiresAt:new Date(0).toISOString()},signature)));
}
await check('unsupported signature rejected',()=>assert.rejects(()=>verifyWalletProof({address:'0x'+'1'.repeat(64),message:'test',expiresAt:new Date(Date.now()+60000).toISOString()},Buffer.from([5,1,2]).toString('base64'))));
async function http(req){const result={headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.code=code;return this},json(body){this.body=body;return this}};await handler(req,result);return result}
await check('API rejects cross-origin requests',async()=>assert.equal((await http({method:'POST',headers:{origin:'https://evil.example'}})).code,403));
await check('API rejects GET',async()=>assert.equal((await http({method:'GET',headers:{}})).code,405));

const db=new PGlite();
const user='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const address='0x'+'1'.repeat(64), secondAddress='0x'+'2'.repeat(64);
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema fieldtest_private;create table auth.users(id uuid primary key);insert into auth.users values('${user}'),('${other}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
await db.exec(await readFile(new URL('../supabase/migrations/002_wallet_links.sql',import.meta.url),'utf8'));
async function as(role,id,fn){await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${id??''}',false);`);try{return await fn()}finally{await db.exec('reset role')}}
const begin=()=>db.query('select public.ft_begin_wallet_link($1,$2) as result',[address,'https://fieldtest-two.vercel.app']);
await check('anon cannot issue challenges',()=>as('anon',null,()=>assert.rejects(begin)));
let challenge;
await check('authenticated user receives account-bound challenge',()=>as('authenticated',user,async()=>{challenge=(await begin()).rows[0].result;assert.ok(challenge.message.includes(user));assert.ok(challenge.message.includes(address));assert.ok(challenge.message.includes(challenge.nonce))}));
await check('challenge rate limit enforced',()=>as('authenticated',user,()=>assert.rejects(begin)));
await check('browser cannot complete verification',()=>as('authenticated',user,()=>assert.rejects(()=>db.query('select public.ft_complete_wallet_link($1,$2,$3)',[user,challenge.nonce,address]))));
await check('browser cannot read private challenges',()=>as('authenticated',user,()=>assert.rejects(()=>db.query('select * from fieldtest_private.wallet_challenges'))));
await check('wrong user cannot consume challenge',()=>as('service_role',null,()=>assert.rejects(()=>db.query('select public.ft_complete_wallet_link($1,$2,$3)',[other,challenge.nonce,address]))));
await check('wrong address cannot consume challenge',()=>as('service_role',null,()=>assert.rejects(()=>db.query('select public.ft_complete_wallet_link($1,$2,$3)',[user,challenge.nonce,secondAddress]))));
await check('server completion links wallet',()=>as('service_role',null,()=>db.query('select public.ft_complete_wallet_link($1,$2,$3)',[user,challenge.nonce,address])));
await check('replay rejected atomically',()=>as('service_role',null,()=>assert.rejects(()=>db.query('select public.ft_complete_wallet_link($1,$2,$3)',[user,challenge.nonce,address]))));
await check('owner sees verified link',()=>as('authenticated',user,async()=>assert.equal((await db.query('select address from public.ft_wallet_links')).rows[0].address,address)));
await check('outsider cannot read link',()=>as('authenticated',other,async()=>assert.equal((await db.query('select * from public.ft_wallet_links')).rows.length,0)));
await check('browser cannot overwrite verified address',()=>as('authenticated',user,()=>assert.rejects(()=>db.query('update public.ft_wallet_links set address=$1',[secondAddress]))));
await check('linked account cannot replace wallet',()=>as('authenticated',user,()=>assert.rejects(begin)));
let secondChallenge=(await as('authenticated',other,begin)).rows[0].result;
await check('same wallet cannot link to two accounts',()=>as('service_role',null,()=>assert.rejects(()=>db.query('select public.ft_complete_wallet_link($1,$2,$3)',[other,secondChallenge.nonce,address]))));
await db.exec(`update fieldtest_private.wallet_challenges set expires_at=now()-interval '1 second' where user_id='${other}'`);
await check('expired challenge rejected by database',()=>as('service_role',null,()=>assert.rejects(()=>db.query('select public.ft_complete_wallet_link($1,$2,$3)',[other,secondChallenge.nonce,address]))));
await check('wrong origin rejected by database',()=>as('authenticated',other,()=>assert.rejects(()=>db.query('select public.ft_begin_wallet_link($1,$2)',[secondAddress,'https://evil.example']))));
await db.close();
console.log(`${passed} wallet checks passed`);
