import {createServer} from 'vite';
import {testnetLabPlugin} from '../server/testnet-lab.mjs';
const server=await createServer({plugins:[testnetLabPlugin()],server:{host:'127.0.0.1',port:5190,strictPort:true,open:'/#testnet'}});
await server.listen();
console.log('Fieldtest testnet lab: http://127.0.0.1:5190/#testnet');
console.log('Local testnet reviews only. Signing stays in your CLI. No production records are written.');
