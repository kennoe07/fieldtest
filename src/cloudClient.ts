import { createClient } from '@supabase/supabase-js';
import type { Campaign, Evidence, Submission } from './researchStore';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const cloud = url && key ? createClient(url, key, { auth: { flowType: 'pkce', detectSessionInUrl: true } }) : null;
export function requireCloud() { if (!cloud) throw new Error('Cloud accounts are not configured yet.'); return cloud; }
export function campaignFromRow(row: any): Campaign {
  return { id:row.id,name:row.name,project:row.project,description:row.description,tasks:row.tasks,
    criteria:row.criteria,url:row.product_url,reward:row.reward,slots:row.slots,deadline:row.deadline,status:'Active',responses:0 };
}
export async function ownedCampaigns() {
  const client=requireCloud(); const {data:{user},error:authError}=await client.auth.getUser();
  if(authError||!user)throw new Error('Please sign in again.');
  const {data,error}=await client.from('ft_campaigns').select('*').eq('owner_id',user.id).order('created_at',{ascending:false});
  if(error)throw error;return (data??[]).map(campaignFromRow);
}
export async function cloudSubmissions():Promise<Submission[]> {
  const {data,error}=await requireCloud().from('ft_submissions').select('*').order('updated_at',{ascending:false});
  if(error)throw error;
  return (data??[]).map(row=>({id:row.id,campaignId:row.campaign_id,testerName:row.tester_name,summary:row.summary,status:row.status,reviewNote:row.review_note,submittedAt:row.submitted_at,updatedAt:row.updated_at,
    responses:row.responses.map((r:any)=>({...r,evidence:r.evidence.map((e:any)=>({...e,id:e.path,blob:new Blob()}))}))}));
}
export async function joinedCampaigns():Promise<Campaign[]> {
  const client=requireCloud();const {data:{user},error:authError}=await client.auth.getUser();
  if(authError||!user)throw new Error('Please sign in again.');
  const {data:members,error}=await client.from('ft_members').select('campaign_id').eq('tester_id',user.id);
  if(error)throw error;if(!members?.length)return [];
  const {data,error:loadError}=await client.from('ft_campaigns').select('*').in('id',members.map(m=>m.campaign_id)).order('created_at',{ascending:false});
  if(loadError)throw loadError;return (data??[]).map(campaignFromRow);
}
export async function evidenceUrl(path:string) {
  const {data,error}=await requireCloud().storage.from('fieldtest-evidence').createSignedUrl(path,60);
  if(error)throw error;return data.signedUrl;
}
export async function saveCloudSubmission(c:Campaign,input:Pick<Submission,'testerName'|'responses'|'summary'>):Promise<Submission> {
  const client=requireCloud();const {data:{user},error}=await client.auth.getUser();if(error||!user)throw new Error('Please sign in again.');
  const uploaded:string[]=[];let submitted=false;
  try {
    const responses=[];
    for(const r of input.responses){const evidence=[];
      for(const e of r.evidence){let path=e.path;
        if(!path){const extension=e.blob.type==='image/png'?'png':e.blob.type==='image/webp'?'webp':'jpg';path=`${user.id}/${c.id}/${crypto.randomUUID()}.${extension}`;
          const {error}=await client.storage.from('fieldtest-evidence').upload(path,e.blob,{contentType:e.blob.type,upsert:false});if(error)throw error;uploaded.push(path);}
        evidence.push({path,name:e.name});
      }
      responses.push({...r,evidence});
    }
    const {data,error}=await client.rpc('ft_submit_feedback',{campaign:c.id,payload:{...input,responses}});if(error)throw error;
    submitted=true;
    // Return the server row, not a fabricated local status.
    const records=await cloudSubmissions();const result=records.find(s=>s.id===data);if(!result)throw new Error('Saved, but the receipt could not be loaded. Reload to check your submission.');return result;
  }catch(error){
    // Best-effort cleanup of newly uploaded, unreferenced objects only. The database policy
    // blocks deletion of evidence referenced by a committed submission, including ambiguous retries.
    if(!submitted&&uploaded.length)await client.storage.from('fieldtest-evidence').remove(uploaded);
    throw error;
  }
}
export async function saveCloudReview(id:string,status:Exclude<Submission['status'],'Submitted'>,note:string){
  const {error}=await requireCloud().rpc('ft_review_submission',{submission:id,decision:status,note});if(error)throw error;
}
