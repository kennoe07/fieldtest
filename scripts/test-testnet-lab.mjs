import assert from 'node:assert/strict';
import {allowLabRequest,testnetLabPlugin} from '../server/testnet-lab.mjs';
const request=(method,headers={})=>({method,headers:{host:'127.0.0.1:5190',...headers}});
assert.equal(allowLabRequest(request('GET')),true);
assert.equal(allowLabRequest(request('POST',{origin:'http://127.0.0.1:5190','sec-fetch-site':'same-origin'})),true);
for(const headers of [{host:'evil.example:5190'},{origin:'https://evil.example'},{'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'}])assert.equal(allowLabRequest(request('GET',headers)),false);
assert.equal(allowLabRequest(request('POST')),false);
let handler;
testnetLabPlugin().configureServer({middlewares:{use(path,fn){assert.equal(path,'/__testnet-lab');handler=fn}}});
async function call(req){let result;const res={setHeader(){},end(body){result={status:this.statusCode,body:JSON.parse(body)}}};await handler(req,res);return result}
assert.equal((await call({...request('GET',{host:'evil.example:5190'}),url:'/status'})).status,403);
for(const url of ['/execute','/sign','/submit','/../private','/status?file=secret'])assert.equal((await call({...request('GET'),url})).status,404);
assert.equal((await call({...request('POST',{origin:'http://127.0.0.1:5190'}),url:'/submit'})).status,404);
console.log('Testnet lab: origin/host guards and absent execution/signing/file endpoints passed.');
