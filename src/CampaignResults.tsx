import { useState } from 'react';
import { campaignResults, resultsMarkdown } from './resultsModel';
import type { Campaign, Submission } from './researchStore';
import './results.css';
import AiFindings from './AiFindings';

export default function CampaignResults({campaign,items}:{campaign:Campaign;items:Submission[]}){
  const r=campaignResults(campaign,items);const [expanded,setExpanded]=useState<number|null>(null);
  function source(id:string){const element=document.getElementById('feedback-'+id);element?.scrollIntoView({block:'start'});element?.focus({preventScroll:true})}
  function download(){const url=URL.createObjectURL(new Blob([resultsMarkdown(campaign,items)],{type:'text/markdown;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`fieldtest-results-${campaign.id}.md`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  return <section className="campaign-results research-panel" aria-labelledby="results-title">
    <div className="results-heading"><div><p className="eyebrow">FROM FEEDBACK TO YOUR NEXT ITERATION</p><h2 id="results-title">What your testers reported.</h2></div><button className="button secondary" disabled={!r.total} onClick={download}>Export results</button></div>
    <div className="results-metrics"><div><strong>{r.included}</strong><span>Included submissions</span></div><div><strong>{r.approved}</strong><span>Approved</span></div><div><strong>{r.awaitingReview}</strong><span>Awaiting review</span></div><div><strong>{r.revisions}</strong><span>Awaiting revision</span></div></div>
    <p>Self-reported outcomes from this campaign. Unreviewed feedback is included; {r.rejected} rejected submission{r.rejected===1?' is':'s are'} excluded. These counts describe this sample. No AI interpretation is used.</p>
    {!r.included?<p>No included responses yet. Results will appear after a tester submits feedback.</p>:<>
      <div className="results-focus"><h3>{r.friction.length?'Start your review here.':'No blocked or partly completed tasks reported.'}</h3><p>{r.friction.length?`Task ${r.friction[0].index+1} has the most blocked or partly completed reports (${r.friction[0].blocked+r.friction[0].partial} of ${r.friction[0].total}). Review the evidence before deciding what to change.`:'Read the original feedback for issues that may not be reflected in the selected task outcomes.'}</p></div>
      <h3>Task outcomes and evidence</h3>
      {r.tasks.map(t=><article className="result-task" key={t.index}><h4>{t.index+1}. {t.task}</h4><div className="result-counts"><span>{t.completed} completed</span><span>{t.partial} partly completed</span><span>{t.blocked} blocked</span><span>{t.total} total responses</span></div><button className="text-button" aria-expanded={expanded===t.index} onClick={()=>setExpanded(expanded===t.index?null:t.index)}>{expanded===t.index?'Hide':'Read'} original responses</button>{expanded===t.index&&<div>{t.evidence.map(e=><blockquote key={e.submissionId}><p>{e.actual}</p><footer>{e.tester} · {e.outcome} · {e.status} · {e.evidence.length} screenshot{e.evidence.length===1?'':'s'}</footer><button className="text-button" onClick={()=>source(e.submissionId)}>View full feedback and screenshots</button></blockquote>)}</div>}</article>)}
    </>}
    <AiFindings key={campaign.id} campaignId={campaign.id} revision={items.map(s=>s.id+':'+s.updatedAt+':'+s.status).sort().join('|')}/>
  </section>;
}
