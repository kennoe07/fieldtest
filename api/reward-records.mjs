import {createClient} from '@supabase/supabase-js';
const origins=new Set(['https://fieldtest-two.vercel.app','http://127.0.0.1:5173']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'})}
 if(!origins.has(req.headers.origin))return res.status(403).json({error:'Unrecognized app origin'});
 const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
 if(!token||token.length>8192)return res.status(401).json({error:'Sign in to view reward records.'});
 let body=req.body;if(typeof body==='string'){try{body=JSON.parse(body)}catch{return res.status(400).json({error:'Invalid request'})}}
 if(!body||JSON.stringify(body).length>1000||!uuid.test(body.campaignId)||!['load','save-draft'].includes(body.action))return res.status(400).json({error:'Invalid request'});
 const {SUPABASE_URL:url,SUPABASE_PUBLISHABLE_KEY:key}=process.env;
 if(!url||!key)return res.status(503).json({error:'Reward records are not configured.'});
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});
 try{
  const {data:{user},error:authError}=await client.auth.getUser(token);
  if(authError||!user)return res.status(401).json({error:'Your session expired. Sign in again.'});
  const {data:campaign,error}=await client.from('ft_campaigns').select('id').eq('id',body.campaignId).eq('owner_id',user.id).maybeSingle();
  if(error||!campaign)return res.status(404).json({error:'Campaign owner access required.'});
  if(body.action==='save-draft'){
    if(![1,3,7,14,30].includes(body.reviewDays))return res.status(400).json({error:'Choose a supported review window.'});
    const {error}=await client.rpc('ft_save_reward_draft',{p_campaign:campaign.id,p_days:body.reviewDays});
    if(error)throw Error(error.code==='PGRST202'?'Apply the reward-records migration first.':error.message);
  }
  const [draftResult,planResult]=await Promise.all([
    client.from('ft_reward_drafts').select('*').eq('campaign_id',campaign.id).maybeSingle(),
    client.from('ft_reward_plans').select('id,state,terms_hash,network,chain_campaign_id,total_base_units,remaining_base_units,document,created_at').eq('campaign_id',campaign.id).maybeSingle()
  ]);
  if(draftResult.error||planResult.error)return res.status(503).json({error:'Reward storage is not ready. Apply the reward-records migration first.'});
  let events=[];
  if(planResult.data){const {data,error}=await client.from('ft_reward_events').select('*').eq('plan_id',planResult.data.id).order('recorded_at',{ascending:true});if(error)throw Error('Reward events could not be loaded.');events=data??[]}
  return res.status(200).json({draft:draftResult.data,plan:planResult.data,events});
 }catch(error){return res.status(400).json({error:error instanceof Error?error.message:'Reward records could not be loaded.'})}
}
