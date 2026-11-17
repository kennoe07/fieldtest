export type Campaign = {
  id: string; name: string; project: string; description: string; reward: number; slots: number;
  status: 'Active' | 'Review' | 'Draft'; responses: number; tasks: string[]; sample?: boolean;
  url?: string; criteria?: string; deadline?: string;
};
export type Evidence = { id: string; name: string; blob: Blob; path?: string };
export type TaskResponse = { task: string; outcome: string; expected: string; actual: string; evidence: Evidence[] };
export type Submission = {
  id: string; campaignId: string; testerName: string; responses: TaskResponse[];
  summary: string; submittedAt: string; updatedAt: string;
  status: 'Submitted' | 'Approved' | 'Revision requested' | 'Rejected'; reviewNote: string;
};
const DATABASE = 'fieldtest-research-v1';
let database: Promise<IDBDatabase> | undefined;
function db() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('submissions', { keyPath: 'id' });
      store.createIndex('campaignId', 'campaignId');
    };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
    request.onerror = () => { database = undefined; reject(new Error('Local storage is unavailable. Your feedback has not been saved.')); };
    request.onblocked = () => { database = undefined; reject(new Error('Close other Fieldtest tabs and try again.')); };
  });
  return database;
}
export async function listSubmissions(): Promise<Submission[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('submissions').objectStore('submissions').getAll();
    request.onsuccess = () => resolve(request.result.sort((a: Submission, b: Submission) => b.submittedAt.localeCompare(a.submittedAt)));
    request.onerror = () => reject(new Error('Could not read local submissions. Please reload and try again.'));
  });
}
function changed() {
  window.dispatchEvent(new Event('fieldtest-research-change'));
  if ('BroadcastChannel' in window) { const channel = new BroadcastChannel('fieldtest-research'); channel.postMessage('changed'); channel.close(); }
}
export async function submitFeedback(campaign: Campaign, input: Pick<Submission, 'testerName' | 'responses' | 'summary'>): Promise<Submission> {
  if (!input.testerName.trim() || input.responses.length !== campaign.tasks.length || input.responses.some((r, i) => r.task !== campaign.tasks[i] || !['Completed', 'Blocked', 'Partly completed'].includes(r.outcome) || r.expected.trim().length < 10 || r.actual.trim().length < 10)) throw new Error('Complete the required fields for every task.');
  const evidence = input.responses.flatMap(r => r.evidence);
  if (input.responses.some(r => r.evidence.length > 3) || evidence.some(e => !['image/png','image/jpeg','image/webp'].includes(e.blob.type) || e.blob.size > 2 * 1024 * 1024) || evidence.reduce((n,e) => n + e.blob.size, 0) > 6 * 1024 * 1024) throw new Error('Screenshots must be JPG, PNG, or WebP, up to 2 MB each and 6 MB total.');
  if (campaign.deadline && Date.now() > new Date(campaign.deadline).getTime()) throw new Error('The submission deadline has passed.');
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('submissions', 'readwrite');
    const store = tx.objectStore('submissions');
    // One local tester session per campaign. This is duplicate prevention, not identity verification.
    const id = `local:${campaign.id}`;
    let result: Submission;
    let message = 'Could not save your feedback. Keep this page open and try again.';
    const request = store.get(id);
    request.onsuccess = () => {
      const previous = request.result as Submission | undefined;
      if (previous && previous.status !== 'Revision requested') { message = 'A submission already exists for this local tester session.'; tx.abort(); return; }
      const count = store.index('campaignId').count(campaign.id);
      count.onsuccess = () => {
        if (!previous && count.result >= campaign.slots) { message = 'This local campaign has no remaining slots.'; tx.abort(); return; }
        const now = new Date().toISOString();
        result = { ...input, testerName: input.testerName.trim(), id, campaignId: campaign.id, status: 'Submitted', reviewNote: '', submittedAt: previous?.submittedAt ?? now, updatedAt: now };
        store.put(result);
      };
    };
    tx.oncomplete = () => { changed(); resolve(result); };
    tx.onerror = () => reject(new Error(message));
    tx.onabort = () => reject(new Error(message));
  });
}
export async function reviewSubmission(id: string, status: Exclude<Submission['status'], 'Submitted'>, note: string) {
  if (status !== 'Approved' && note.trim().length < 10) throw new Error('Explain the decision in at least 10 characters.');
  const database = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction('submissions', 'readwrite');
    const store = tx.objectStore('submissions');
    const request = store.get(id);
    request.onsuccess = () => {
      const item = request.result as Submission | undefined;
      if (!item || item.status !== 'Submitted') { tx.abort(); return; }
      store.put({ ...item, status, reviewNote: note.trim(), updatedAt: new Date().toISOString() });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(new Error('This review could not be saved. It may already have been reviewed; refresh and try again.'));
  });
  changed();
}
export const acceptanceRules = 'For each task, select an outcome and explain what you expected and what happened (at least 10 characters each). A blocked task is a valid outcome. Screenshots are optional. Do not include passwords, seed phrases, account balances, or personal information in evidence.';
export function safeProjectUrl(value: string | undefined) {
  try { const url = new URL(value || ''); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
