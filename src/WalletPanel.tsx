import { createDAppKit, DAppKitProvider, useCurrentAccount } from '@mysten/dapp-kit-react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { useEffect, useRef, useState } from 'react';
import { requireCloud } from './cloudClient';

const kit = createDAppKit({
  networks: ['mainnet'],
  slushWalletConfig: null,
  autoConnect: false,
  createClient: network => new SuiGrpcClient({ network, baseUrl: 'https://fullnode.mainnet.sui.io:443' }),
});

function Connection() {
  const account = useCurrentAccount();
  const currentAddress = useRef(account?.address);
  currentAddress.current = account?.address;
  const [linked,setLinked]=useState<string|null>(null);
  const [challenge,setChallenge]=useState<{nonce:string;address:string;message:string;expiresAt:string}|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{let active=true;void requireCloud().from('ft_wallet_links').select('address').maybeSingle().then(({data,error})=>{if(active){if(data)setLinked(data.address);if(error)setError('Verified wallet storage is not configured yet.')}});return()=>{active=false}},[]);
  useEffect(()=>{setChallenge(null)},[account?.address]);
  async function request(body:object){
    const {data:{session}}=await requireCloud().auth.getSession();
    if(!session)throw Error('Sign in again before verifying your wallet.');
    const response=await fetch('/api/wallet',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(body)});
    if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Wallet verification needs the configured Vercel deployment.');
    const data=await response.json();if(!response.ok)throw Error(data.error||'Verification failed');return data;
  }
  async function prepare(){if(!account)return;setBusy(true);setError('');const address=account.address;try{const data=await request({action:'begin',address});if(currentAddress.current===address)setChallenge(data)}catch(e){setError(e instanceof Error?e.message:'Could not prepare verification')}finally{setBusy(false)}}
  async function verify(){if(!challenge||!account||account.address!==challenge.address)return;setBusy(true);setError('');try{
    if(Date.parse(challenge.expiresAt)<=Date.now())throw Error('Challenge expired. Request a new one.');
    const {signature}=await kit.signPersonalMessage({message:new TextEncoder().encode(challenge.message),account,network:'mainnet'});
    if(currentAddress.current!==challenge.address)throw Error('Wallet changed. Request a new challenge.');
    const result=await request({action:'complete',nonce:challenge.nonce,signature});setLinked(result.address);setChallenge(null);
  }catch(e){setError(e instanceof Error?e.message:'Wallet verification was cancelled or failed')}finally{setBusy(false)}}
  return <section className="research-panel" aria-label="Sui wallet">
    <p className="eyebrow">SUI / MAINNET</p>
    <h2>Your reward wallet.</h2>
    <p>Connect a Sui wallet to preview your reward address. Connecting does not move funds or request a signature.</p>
    <ConnectButton />
    <p className="account-footnote">Choose an installed Sui wallet extension from the wallet selector. Unlock the extension first. The separate Slush web-wallet sign-in option is disabled in this version.</p>
    {account && <p role="status" style={{ overflowWrap: 'anywhere' }}>Connected address: {account.address}</p>}
    {error&&<p role="alert" className="research-error">{error}</p>}
    {linked?<p role="status" style={{overflowWrap:'anywhere'}}>Verified reward address: {linked}{account&&account.address!==linked?' — your connected wallet is different. Connect the verified wallet for future reward actions.':''}</p>:account&&<>
      <p>Verify ownership to link this address to your signed-in Fieldtest account. This version fixes one wallet per account; changing it is not available yet.</p>
      <button className="button" disabled={busy} onClick={()=>void prepare()}>{busy?'Working…':'Prepare verification message'}</button>
      {challenge&&<><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:14}}>{challenge.message}</pre><p>Review this message. The next step requests a wallet signature, not a transaction.</p><button className="button" disabled={busy} onClick={()=>void verify()}>{busy?'Verifying…':'Sign message and link wallet'}</button></>}
    </>}
    <p className="account-footnote">Campaign funding and payouts are not available. Your linked address is stored with your account. Wallet signatures prove control of an address, not a unique person. Standard Ed25519, secp256k1, and secp256r1 signatures are supported; other signature types are not supported yet.</p>
  </section>;
}

export default function WalletPanel() {
  return <DAppKitProvider dAppKit={kit}><Connection /></DAppKitProvider>;
}
