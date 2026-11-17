import {createClient} from '@supabase/supabase-js';
import {snapshot,generateFindings} from '../server/findings.mjs';
const origins=new Set(['https://fieldtest-two.vercel.app','http://127.0.0.1:5173']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'})}
 if(!origins.has(req.headers.origin))return res.status(403).json({error:'Unrecognized app origin'});
 const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
 if(!token||token.length>8192)return res.status(401).json({error:'Sign in to view campaign findings.'});
 const {SUPABASE_URL:url,SUPABASE_PUBLISHABLE_KEY:publicKey,SUPABASE_SERVICE_ROLE_KEY:secret,OPENAI_API_KEY:key}=process.env;
 if(!url||!publicKey||!secret)return res.status(503).json({error:'Findings service is not configured yet.'});
 let body=req.body;if(typeof body==='string'){try{body=JSON.parse(body)}catch{return res.status(400).json({error:'Invalid request'})}}
 if(!body||!uuid.test(body.campaignId)||!['load','generate'].includes(body.action)||JSON.stringify(body).length>1000)return res.status(400).json({error:'Invalid request'});
 const auth={persistSession:false,autoRefreshToken:false};
 const client=createClient(url,publicKey,{auth,global:{headers:{Authorization:`Bearer ${token}`}}});
 let run=null,admin=null,userId=null;
 try{
  const {data:{user},error:authError}=await client.auth.getUser(token);
  if(authError||!user)return res.status(401).json({error:'Your session expired. Sign in again.'});userId=user.id;
  const {data:campaign,error:campaignError}=await client.from('ft_campaigns').select('id,owner_id,description,tasks,criteria').eq('id',body.campaignId).eq('owner_id',user.id).maybeSingle();
  if(campaignError||!campaign)return res.status(404).json({error:'Campaign owner access required.'});
  async function current(){const {data,error}=await client.from('ft_submissions').select('id,campaign_id,responses,status,updated_at').eq('campaign_id',campaign.id);if(error)throw Error('Feedback could not be loaded.');return snapshot(campaign,data??[])}
  const data=await current();
  const {data:saved,error:reportError}=await client.from('ft_ai_reports').select('*').eq('campaign_id',campaign.id).maybeSingle();
  if(reportError)return res.status(503).json({error:'Findings storage is not ready. Apply the AI findings migration first.'});
  const stale=Boolean(saved&&saved.source_hash!==data.fingerprint);
  if(body.action==='load')return res.status(200).json({saved,stale,enabled:Boolean(key),sourceCount:new Set(data.sources.map(s=>s.submissionId)).size});
  if(body.consent!==true)return res.status(400).json({error:'Confirm permission to send this campaign feedback to OpenAI.'});
  if(saved&&!stale)return res.status(200).json({saved,stale:false,cached:true,enabled:Boolean(key)});
  if(!key)return res.status(503).json({error:'AI generation is not enabled yet. Configure an OpenAI API key on the server.'});
  if(!data.sources.length||JSON.stringify(data.input).length>60000)return res.status(400).json({error:'Provide at least one included submission and keep analysis input within 60,000 characters.'});
  const {data:reserved,error:reserveError}=await client.rpc('ft_reserve_ai_run',{p_campaign:campaign.id,p_hash:data.fingerprint});
  if(reserveError)return res.status(429).json({error:reserveError.message});run=reserved;
  admin=createClient(url,secret,{auth});const model=process.env.OPENAI_FINDINGS_MODEL||'gpt-4.1-mini';
  const report=await generateFindings(data,key,model);
  if((await current()).fingerprint!==data.fingerprint)throw Error('Feedback changed during generation. No new report was saved; retry with the latest feedback.');
  const {error:saveError}=await admin.rpc('ft_finish_ai_run',{p_run:run,p_owner:user.id,p_report:report,p_model:model});
  if(saveError)throw Error('Report could not be saved. Reload before retrying.');run=null;
  // Read back through owner RLS; never return fabricated storage timestamps.
  const {data:stored,error:readError}=await client.from('ft_ai_reports').select('*').eq('campaign_id',campaign.id).single();
  if(readError)throw Error('Report saved but could not be reloaded. Refresh to check it.');
  const staleAfterSave=(await current()).fingerprint!==data.fingerprint;return res.status(200).json({saved:stored,stale:staleAfterSave,enabled:true,cached:false});
 }catch(error){
  if(run&&admin){try{await admin.rpc('ft_finish_ai_run',{p_run:run,p_owner:userId,p_report:null,p_model:''})}catch{}}
  return res.status(400).json({error:error?.name==='TimeoutError'?'AI generation timed out. Please retry later.':error instanceof Error?error.message:'Findings request failed.'});
 }
}
