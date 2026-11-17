import type { Campaign, Submission } from './researchStore';

export function publicProductUrl(value:string){
  let url:URL;try{url=new URL(value)}catch{throw Error('Enter a complete product URL, starting with https://.')}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('Use an http(s) product URL without embedded credentials.');
  const host=url.hostname.toLowerCase().replace(/\.$/,'');
  const local=host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||!host.includes('.')||host.startsWith('[');
  const octets=host.split('.').map(Number);
  const privateIp=octets.length===4&&octets.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&(
    [0,10,127].includes(octets[0])||octets[0]>=224||octets[0]===169&&octets[1]===254||
    octets[0]===172&&octets[1]>=16&&octets[1]<=31||octets[0]===192&&octets[1]===168||
    octets[0]===100&&octets[1]>=64&&octets[1]<=127);
  if(local||privateIp)throw Error('Use a public website address. Localhost and private-network links will not work for external testers.');
  return url.href;
}

export function campaignResults(campaign:Campaign,submissions:Submission[]){
  const all=submissions.filter(s=>s.campaignId===campaign.id);
  const included=all.filter(s=>s.status!=='Rejected');
  const tasks=campaign.tasks.map((task,index)=>{
    const evidence=included.flatMap(s=>{const r=s.responses[index];return r?.task===task?[{submissionId:s.id,tester:s.testerName,status:s.status,...r}]:[]});
    const count=(outcome:string)=>evidence.filter(r=>r.outcome===outcome).length;
    return {task,index,total:evidence.length,completed:count('Completed'),partial:count('Partly completed'),blocked:count('Blocked'),evidence};
  });
  return {total:all.length,included:included.length,rejected:all.length-included.length,approved:all.filter(s=>s.status==='Approved').length,
    awaitingReview:all.filter(s=>s.status==='Submitted').length,revisions:all.filter(s=>s.status==='Revision requested').length,tasks,
    friction:[...tasks].filter(t=>t.blocked+t.partial>0).sort((a,b)=>(b.blocked+b.partial)-(a.blocked+a.partial)||a.index-b.index)};
}

export function resultsMarkdown(campaign:Campaign,submissions:Submission[]){
  const r=campaignResults(campaign,submissions);
  return [`# ${campaign.name} — research results`,'',`Research goal: ${campaign.description}`,'',
    `${r.included} included submissions; ${r.rejected} rejected submissions excluded.`,
    `${r.approved} approved; ${r.awaitingReview} awaiting review; ${r.revisions} awaiting revision.`,
    'Outcomes are self-reported. Unreviewed feedback is included. Counts describe this sample, not population estimates. No AI interpretation is used.','',
    ...r.tasks.flatMap(t=>[`## Task ${t.index+1}: ${t.task}`,`${t.completed} completed / ${t.partial} partly completed / ${t.blocked} blocked; ${t.total} responses.`,'',
      ...t.evidence.flatMap(e=>[`### ${e.tester} — ${e.status}`,`Submission: ${e.submissionId}`,`Outcome: ${e.outcome}`,`Expected: ${e.expected}`,`Actual: ${e.actual}`,`Screenshots: ${e.evidence.length}`,''])])].join('\n');
}
