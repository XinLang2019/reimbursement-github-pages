import { DocItem, Reimbursement, reimbursementStatus } from './reimbursement-model';

export type RecordSummary = { id: string; name: string; createdAt: number; updatedAt: number; fileCount: number; total: number; ready: boolean; activeStep: number; completionVersion?: number };
type StoredItem = Omit<DocItem, 'file'> & { file: Blob; fileName: string; fileModified: number };
type StoredRecord = Omit<Reimbursement, 'items'> & { items: StoredItem[] };
const DB_NAME = 'reimbursement-organizer-local';
let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  if (database) return database;
  database = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('当前浏览器无法使用本地存储，请换用正常浏览模式')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', {keyPath:'id'}); if (!db.objectStoreNames.contains('summaries')) db.createObjectStore('summaries', {keyPath:'id'}); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('本地数据暂时被其他窗口占用，请关闭其他本站窗口后重试'));
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); database = undefined; }; resolve(db); };
  }).catch(error => { database = undefined; throw error; });
  return database;
}
function finished(tx: IDBTransaction) { return new Promise<void>((resolve,reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('本地保存已中断')); }); }
let writes: Promise<unknown> = Promise.resolve();
export function saveReimbursement(record: Reimbursement): Promise<void> {
  const saved: StoredRecord = { ...record, items: record.items.map(({file,preview,recognition,...item}) => ({...item, file:new Blob([file], {type:file.type}), fileName:file.name, fileModified:file.lastModified, preview:preview?.startsWith('data:') ? preview : undefined, recognition: /等待|正在|图片识别中|首次识别/.test(recognition || '') ? '识别未完成，请重新识别' : recognition })) };
  const summary: RecordSummary = {id:record.id,name:record.name,createdAt:record.createdAt,updatedAt:record.updatedAt,fileCount:record.items.length,completionVersion:2,activeStep:record.activeStep,...reimbursementStatus(record)};
  const next = writes.catch(() => undefined).then(async () => {
    const db = await openDatabase(); const tx = db.transaction(['records','summaries'],'readwrite'); const done = finished(tx);
    tx.objectStore('records').put(saved); tx.objectStore('summaries').put(summary); await done;
  });
  writes = next; return next;
}
export function deleteReimbursement(id: string): Promise<void> {
  const next = writes.catch(() => undefined).then(async () => {
    const db = await openDatabase();
    const tx = db.transaction(['records', 'summaries'], 'readwrite');
    const done = finished(tx);
    tx.objectStore('records').delete(id);
    tx.objectStore('summaries').delete(id);
    await done;
  });
  writes = next;
  return next;
}
export async function listReimbursements(): Promise<RecordSummary[]> {
  await writes.catch(() => undefined); const db = await openDatabase();
  const summaries = await new Promise<RecordSummary[]>((resolve,reject) => { const request = db.transaction('summaries','readonly').objectStore('summaries').getAll(); request.onerror=()=>reject(request.error); request.onsuccess=()=>resolve(request.result); });
  // Older summaries considered the application optional. Recheck them without changing saved files.
  const updated = await Promise.all(summaries.map(async summary => {
    if (summary.completionVersion === 2) return summary;
    const record = await new Promise<StoredRecord | undefined>((resolve,reject) => {
      const request = db.transaction('records','readonly').objectStore('records').get(summary.id);
      request.onerror=()=>reject(request.error); request.onsuccess=()=>resolve(request.result);
    });
    return record ? {...summary, ...reimbursementStatus(record as unknown as Reimbursement)} : {...summary,ready:false};
  }));
  return updated.sort((a,b)=>b.updatedAt-a.updatedAt);
}
export async function loadReimbursement(id: string): Promise<Reimbursement> {
  await writes.catch(() => undefined); const db = await openDatabase();
  const stored = await new Promise<StoredRecord>((resolve,reject) => { const request=db.transaction('records','readonly').objectStore('records').get(id); request.onerror=()=>reject(request.error); request.onsuccess=()=>request.result ? resolve(request.result) : reject(new Error('找不到这份本地报销记录，请刷新列表')); });
  return {...stored, items:stored.items.map(({file,fileName,fileModified,preview,...item})=> {
    const restored = new File([file],fileName,{type:file.type,lastModified:fileModified});
    return {...item,file:restored,preview:preview || (/^image\//.test(file.type) || /\.(png|jpe?g)$/i.test(fileName) ? URL.createObjectURL(restored) : undefined)};
  })};
}
export function releaseRecord(record: Reimbursement) { record.items.forEach(item => { if(item.preview?.startsWith('blob:')) URL.revokeObjectURL(item.preview); }); }
export function storageMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') return '本地空间不足，尚未保存。请先下载备份，再释放电脑或浏览器空间并重试。';
  return error instanceof Error ? `本地保存或读取失败：${error.message}` : '本地存储暂不可用，请保持此页面并重试。';
}
