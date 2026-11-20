// Local one-transaction review tool, never part of Vercel or the production app.
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {build} from 'vite';
import {SuiGrpcClient} from '@mysten/sui/grpc';
import {fromBase64} from '@mysten/sui/utils';
import {createTestnetRewardReader} from '../server/reward-grpc-reader.mjs';
import {validatePublicationReview,createPublicationSession} from '../server/publication-session.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const artifact=resolve(process.argv[2]??resolve(root,'../outputs/fieldtest-testnet-publication-review.json'));
const review=JSON.parse(await readFile(artifact,'utf8'));
const validated=await validatePublicationReview(review,{sourceBytes:await readFile(resolve(root,'contracts/fieldtest/sources/rewards.move')),compiled:JSON.parse(await readFile(resolve(root,'../outputs/fieldtest-testnet-deployment/compiled-package.json'),'utf8'))});
const temp=resolve(root,'../work/publication-wallet');await mkdir(temp,{recursive:true});
await build({configFile:false,root,logLevel:'silent',build:{outDir:temp,emptyOutDir:false,minify:false,rollupOptions:{input:resolve(root,'scripts/publication-wallet-client.mjs'),output:{entryFileNames:'app.js',inlineDynamicImports:true}}}});
const app=await readFile(resolve(temp,'app.js'));
const reader=createTestnetRewardReader(),client=new SuiGrpcClient({network:'testnet',baseUrl:'https://fullnode.testnet.sui.io:443'});
const session=createPublicationSession({review,validated,reader,execute:async(bytes,signature)=>{
 const result=await client.transactionExecutionService.executeTransaction({transaction:{bcs:{value:bytes}},signatures:[{bcs:{value:fromBase64(signature)},signature:{oneofKind:undefined}}],readMask:{paths:['digest','effects','checkpoint']}},{timeout:30000}).response;
 return result.transaction;
},onConfirmed:async receipt=>{
 const path=resolve(root,'../outputs/fieldtest-testnet-publication-receipt.json');
 try{await writeFile(path,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'})}catch(error){if(error.code!=='EEXIST')throw error;const prior=JSON.parse(await readFile(path,'utf8'));if(prior.transactionDigest!==receipt.transactionDigest)throw Error('A different publication receipt already exists')}
}});
const port=5188,origin=`http://127.0.0.1:${port}`,token=randomBytes(32).toString('hex');
const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fieldtest · Testnet publication review</title><link rel="stylesheet" href="/style.css"><main><p class="tag">LOCAL REVIEW TOOL · SUI TESTNET ONLY</p><h1>Publish the reward contract.</h1><p>This exact transaction publishes one package and keeps the upgrade capability in your wallet. It does not fund a campaign or transfer USDC.</p><p class="notice">The deployed Fieldtest site's wallet warning is unresolved. This separate local tool does not clear it. If Glass shows a security warning here, stop and report it.</p><dl><dt>Sender and upgrade-capability recipient</dt><dd id="sender"></dd><dt>Reviewed transaction digest</dt><dd id="digest"></dd><dt>Gas review</dt><dd id="cost"></dd><dt>Status</dt><dd id="state">Loading…</dd></dl><h2>1. Connect your testnet wallet</h2><p id="walletNote"></p><select id="wallets" aria-label="Detected Glass wallet"></select><button id="connect" disabled>Connect Glass</button><p id="account"></p><h2>2. Review and sign in Glass</h2><p>Glass will show the exact publication request. Signing alone does not submit it. No recovery phrase or private key is requested.</p><button id="sign" disabled>Review in Glass and sign</button><h2>3. Publish on testnet</h2><p>After signing, this separate button sends the reviewed transaction. It may spend up to 0.1 test SUI in gas. Do not submit again after a timeout; use Check status.</p><button id="submit" disabled>Submit reviewed publication · testnet</button><button id="refresh">Check status</button><p id="error" role="alert"></p><pre id="receipt"></pre></main><script type="module" src="/app.js"></script></html>`;
const css=`:root{font-family:system-ui,sans-serif;color:#eee9df;background:#101112;font-size:17px;line-height:1.6}main{max-width:850px;margin:50px auto;padding:0 24px 80px}h1{font-size:40px;line-height:1.15}h2{margin-top:35px;font-size:25px}.tag{color:#d9b08f;font-weight:700}.notice{padding:18px;border:1px solid #a77c52;background:#30251b}dt{color:#aaa;margin-top:18px}dd{margin:4px 0;overflow-wrap:anywhere}button,select{font:inherit;padding:12px 18px;margin:8px 8px 8px 0;border:1px solid #777;border-radius:5px;background:#e8e1d5;color:#141414}button{cursor:pointer}button:disabled{opacity:.4;cursor:not-allowed}#error{color:#ffb7aa;white-space:pre-wrap}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px}`;
const server=createServer(async(req,res)=>{
 const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
 try{
   if(req.headers.host!==`127.0.0.1:${port}`||req.headers['sec-fetch-site']==='cross-site')return json(403,{error:'Local same-origin access only'});
   if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(html)}
   if(req.method==='GET'&&req.url==='/app.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(app)}
   if(req.method==='GET'&&req.url==='/style.css'){res.writeHead(200,{'Content-Type':'text/css'});return res.end(css)}
   if(req.method==='GET'&&req.url==='/review')return json(200,{token,session:session.summary()});
   if(req.method!=='POST'||req.headers.origin!==origin||req.headers['x-publication-session']!==token)return json(403,{error:'Invalid local session'});
   let bytes=0,body='';for await(const chunk of req){bytes+=chunk.length;if(bytes>65536)throw Error('Request too large');body+=chunk}const data=JSON.parse(body||'{}');
   if(req.url==='/signing-data')return json(200,await session.signingData());
   if(req.url==='/signature')return json(200,await session.acceptSignature(data));
   if(req.url==='/submit')return json(200,await session.submit(data.confirmedDigest));
   if(req.url==='/status')return json(200,await session.refresh());
   return json(404,{error:'Unknown action'});
 }catch(error){return json(400,{error:error.message})}
});
server.listen(port,'127.0.0.1',()=>console.log(`Local publication review ready: ${origin}\nNothing is signed or submitted automatically. Use the Chrome profile containing Glass.`));
