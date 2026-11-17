import { createClient } from '@supabase/supabase-js';
import { verifyWalletProof } from '../server/wallet-proof.mjs';

const origins = new Set(['https://fieldtest-two.vercel.app', 'http://127.0.0.1:5173']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({error:'Method not allowed'}); }
  const origin = req.headers.origin;
  if (!origins.has(origin)) return res.status(403).json({error:'Unrecognized app origin'});
  const url=process.env.SUPABASE_URL, publicKey=process.env.SUPABASE_PUBLISHABLE_KEY, secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !publicKey || !secret) return res.status(503).json({error:'Wallet verification is not configured yet.'});
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token || token.length>8192) return res.status(401).json({error:'Sign in to verify your wallet.'});
  const authOptions = {persistSession:false,autoRefreshToken:false};
  const userClient=createClient(url,publicKey,{auth:authOptions,global:{headers:{Authorization:`Bearer ${token}`}}});
  const {data:{user},error:authError}=await userClient.auth.getUser(token);
  if(authError || !user) return res.status(401).json({error:'Your session expired. Sign in again.'});
  let body=req.body;
  if (typeof body==='string') { try { body=JSON.parse(body); } catch { return res.status(400).json({error:'Invalid request'}); } }
  if (!body || JSON.stringify(body).length>4096) return res.status(400).json({error:'Invalid request'});
  try {
    if(body.action==='begin') {
      if(typeof body.address!=='string'||!/^0x[0-9a-f]{64}$/.test(body.address)) return res.status(400).json({error:'Invalid address'});
      const {data,error}=await userClient.rpc('ft_begin_wallet_link',{p_address:body.address,p_origin:origin});
      if(error) throw Error(error.message);
      return res.status(200).json(data);
    }
    if(body.action!=='complete'||!uuid.test(body.nonce)||typeof body.signature!=='string') return res.status(400).json({error:'Invalid request'});
    const admin=createClient(url,secret,{auth:authOptions});
    const {data:challenge,error}=await admin.rpc('ft_get_wallet_challenge',{p_user:user.id,p_nonce:body.nonce});
    if(error) throw Error('Wallet verification database is not ready.');
    if(!challenge || challenge.origin!==origin) throw Error('Challenge expired or already used. Request a new one.');
    await verifyWalletProof(challenge,body.signature);
    const {error:completeError}=await admin.rpc('ft_complete_wallet_link',{p_user:user.id,p_nonce:body.nonce,p_address:challenge.address});
    if(completeError) throw Error('Wallet linking could not complete. It may already be linked or the challenge expired.');
    return res.status(200).json({address:challenge.address});
  } catch(error) {
    return res.status(400).json({error:error instanceof Error?error.message:'Wallet verification failed'});
  }
}
