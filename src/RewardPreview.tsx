import {useEffect,useState} from 'react';
import type {Campaign} from './researchStore';
import {rewardBudget} from './rewardDocuments';
import {requireCloud} from './cloudClient';
export default function RewardPreview({campaign}:{campaign:Campaign}){
 const [days,setDays]=useState(7),[wallet,setWallet]=useState<string|null>(null),[walletStatus,setWalletStatus]=useState('Checking wallet verification…');
 useEffect(()=>{let active=true;void requireCloud().from('ft_wallet_links').select('address').maybeSingle().then(({data,error})=>{if(active){setWallet(data?.address??null);setWalletStatus(error?'Wallet verification storage is unavailable.':data?'Verified reward wallet available.':'Wallet ownership verification is still pending.')}});return()=>{active=false}},[]);
 let budget;let issue='';try{budget=rewardBudget(campaign,days)}catch(e){issue=e instanceof Error?e.message:'Invalid reward plan'}
 const expired=budget?Number(budget.submitUntilMs)<=Date.now():false;
 return <section className="research-panel campaign-results"><p className="eyebrow">USDC / FUNDING PREVIEW</p><h2>Review the reward plan.</h2><p>This is a read-only preview. No deposit, wallet prompt, transaction fee, or reward reservation is created.</p>
 {issue&&<p className="research-error">{issue}</p>}{budget&&<><div className="results-metrics"><div><strong>{campaign.reward}</strong><span>USDC per approved tester</span></div><div><strong>{campaign.slots}</strong><span>Maximum paid testers</span></div><div><strong>{budget.totalUsdc}</strong><span>Total USDC funding required</span></div><div><strong>SUI</strong><span>Network fees, separately</span></div></div>
 <label className="research-field">Proposed review window<select value={days} onChange={e=>setDays(Number(e.target.value))} style={{display:'block',fontSize:16,padding:12,marginTop:8}}>{[1,3,7,14,30].map(day=><option key={day} value={day}>{day} day{day===1?'':'s'} after submissions close</option>)}</select></label>
 <p>Submissions close: {new Date(Number(budget.submitUntilMs)).toLocaleString()}<br/>Proposed final review cutoff: {new Date(Number(budget.reviewUntilMs)).toLocaleString()}</p>
 <p>The builder would deposit the full {budget.totalUsdc} USDC upfront. Approving a submitted version would pay {campaign.reward} USDC once to its enrolled tester address. Unpaid funds become refundable after the review cutoff. Submission alone does not guarantee approval or payment.</p>
 <p>Changing this selector only changes this preview. A future funded campaign must freeze the review window before testers join.</p></>}
 <p role="status">{walletStatus}</p>{wallet&&<p style={{overflowWrap:'anywhere'}}>Verified address: {wallet}</p>}{expired&&<p className="campaign-url-warning">This campaign’s submission deadline has passed. Create a future campaign before preparing funding.</p>}
 <p>Funding is unavailable while the contract is unpublished and wallet testing is paused for the Slush review. No gas estimate or balance check has been performed.</p>
 </section>;
}
