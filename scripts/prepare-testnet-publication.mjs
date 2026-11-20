// Explicit read-only preparation. No signer/execute API is imported or invoked.
import {readFile,writeFile,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTestnetRewardReader} from '../server/reward-grpc-reader.mjs';
import {prepareTestnetPublication} from '../server/reward-publication.mjs';
const [artifactDirectory,sender,genesisDigest,outputFile]=process.argv.slice(2);
if(!artifactDirectory||!outputFile)throw Error('Usage: node scripts/prepare-testnet-publication.mjs REVIEW_DIRECTORY PUBLIC_SENDER REVIEWED_GENESIS OUTPUT_FILE');
try{await access(resolve(outputFile));throw Error('Output already exists; preserve the reviewed transaction and choose a new file for a newly reviewed attempt')}catch(error){if(error.code!=='ENOENT')throw error}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const [compiled,review,sourceBytes,testBytes]=await Promise.all([readFile(resolve(artifactDirectory,'compiled-package.json'),'utf8').then(JSON.parse),readFile(resolve(artifactDirectory,'review-manifest.json'),'utf8').then(JSON.parse),readFile(resolve(root,'contracts/fieldtest/sources/rewards.move')),readFile(resolve(root,'contracts/fieldtest/tests/rewards_tests.move'))]);
const prepared=await prepareTestnetPublication({reader:createTestnetRewardReader(),compiled,review,sourceBytes,testBytes,sender,genesisDigest});
// Never overwrite a previously reviewed transaction: changing its nonce changes
// its digest, so a new artifact needs fresh review.
await writeFile(resolve(outputFile),JSON.stringify(prepared,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...prepared,unsignedBytes:'Saved in review artifact; not signed or submitted'},null,2));
