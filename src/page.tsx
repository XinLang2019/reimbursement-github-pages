'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import ReimbursementEditor from './reimbursement-editor';
import { EMPTY_TRIP } from './trip-claim';
import { Reimbursement, downloadRecord } from './reimbursement-model';
import { RecordSummary, deleteReimbursement, listReimbursements, loadReimbursement, releaseRecord, saveReimbursement, storageMessage } from './reimbursement-storage';

export default function Home() {
  const [records,setRecords] = useState<RecordSummary[]>([]);
  const [current,setCurrent] = useState<Reimbursement | null>(null);
  const [loading,setLoading] = useState(true);
  const [loadError,setLoadError] = useState('');
  const [notice,setNotice] = useState('');
  const [creating,setCreating] = useState(false);
  const [name,setName] = useState('');
  const [busy,setBusy] = useState('');
  const busyRef = useRef(false);
  const [deleteTarget,setDeleteTarget] = useState<RecordSummary | null>(null);
  const [deleteError,setDeleteError] = useState('');
  const deleteDialog = useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    if(deleteTarget) deleteDialog.current?.showModal();
    else deleteDialog.current?.close();
  },[deleteTarget]);
  async function confirmDelete(e: FormEvent) {
    e.preventDefault();
    if(!deleteTarget || busyRef.current)return;
    busyRef.current=true;setBusy('delete');setDeleteError('');
    try {
      await deleteReimbursement(deleteTarget.id);
      setRecords(previous=>previous.filter(record=>record.id!==deleteTarget.id));
      setNotice(`已删除“${deleteTarget.name}”及其本地材料`);
      setDeleteTarget(null);
    } catch(error) {
      setDeleteError(`删除失败，记录未删除。${error instanceof Error ? error.message : '请重试。'}`);
    } finally {busyRef.current=false;setBusy('');}
  }
  async function refresh() {
    setLoading(true); setLoadError('');
    try { setRecords(await listReimbursements()); } catch(error) { setLoadError(storageMessage(error)); }
    finally { setLoading(false); }
  }
  useEffect(()=>{void refresh();},[]);
  async function create(e: FormEvent) {
    e.preventDefault(); if (busyRef.current) return;
    const title=name.trim(); if (!title) {setNotice('请先填写报销名称');return;}
    busyRef.current=true;setBusy('create');setNotice('');
    try {
      const now=Date.now(); const record:Reimbursement={id:crypto.randomUUID(),name:title,createdAt:now,updatedAt:now,items:[],manualGroups:[],tripForm:{...EMPTY_TRIP},activeStep:0,activeGroupId:'',newGroupCategory:'打车',ticketsComplete:false};
      await saveReimbursement(record);
      void navigator.storage?.persist?.().catch(()=>false);
      setCreating(false);setName('');setCurrent(record);
    } catch(error){setNotice(storageMessage(error));}
    finally{busyRef.current=false;setBusy('');}
  }
  async function edit(id:string) {
    if(busyRef.current)return;busyRef.current=true;setBusy(id);setNotice('');
    try{setCurrent(await loadReimbursement(id));}catch(error){setNotice(storageMessage(error));}finally{busyRef.current=false;setBusy('');}
  }
  async function download(id:string,kind:'zip'|'pdf') {
    if(busyRef.current)return;busyRef.current=true;setBusy(id);setNotice(kind==='zip'?'正在生成合并 PDF 并打包备份…':'正在生成合并 PDF…');
    let record:Reimbursement|undefined;
    try{record=await loadReimbursement(id);await downloadRecord(record,kind);setNotice(kind==='zip'?'已发起材料 ZIP 下载，包含全部材料和合并 PDF':'已发起合并 PDF 下载');}catch(error){setNotice(error instanceof Error?error.message:'下载失败，请重试');}finally{if(record)releaseRecord(record);busyRef.current=false;setBusy('');}
  }
  function back() {if(current)releaseRecord(current);setCurrent(null);setNotice('');void refresh();}
  if(current)return <ReimbursementEditor key={current.id} initial={current} onBack={back} />;
  return <main>
    <header className="topbar"><div className="brand"><span className="brandmark">票</span><span>报销材料整理助手</span></div><div className="privacy"><span>●</span> 数据仅保存在本机浏览器</div></header>
    <section className="history-workspace" aria-labelledby="history-title">
      <header className="history-header"><div><span className="history-eyebrow">我的报销</span><h1 id="history-title">报销记录</h1><p>从这里新建报销，或继续整理已保存的材料。</p></div><button className="primary" type="button" disabled={loading||!!loadError||!!busy} onClick={()=>{setCreating(true);setNotice('');}}>新建报销</button></header>
      <p className="local-storage-note">材料与填写信息自动保存在当前电脑的当前浏览器中。清除本站数据、使用无痕模式或更换浏览器可能无法找回记录，请定期下载 ZIP 备份。</p>
      {notice&&<p className="notice" role="status">{notice}</p>}
      {loadError?<div className="history-state" role="alert"><p>{loadError}</p><button className="secondary" onClick={()=>void refresh()}>重新读取</button></div>:loading?<div className="history-state" role="status">正在读取本地报销记录…</div>:records.length?<div className="history-table-wrap"><table className="history-table"><thead><tr><th>报销名称</th><th>材料 / 金额</th><th>状态</th><th>最近保存</th><th className="history-actions-heading">操作</th></tr></thead><tbody>{records.map(record=><tr key={record.id}><td><strong>{record.name}</strong></td><td><span>{record.fileCount} 份材料</span><small>¥{record.total.toFixed(2)}</small></td><td><span className={`record-status ${record.ready?'ready':''}`}>{record.ready?'可下载':`草稿 · 第 ${record.activeStep+1} 步`}</span></td><td><time dateTime={new Date(record.updatedAt).toISOString()}>{new Intl.DateTimeFormat('zh-CN',{dateStyle:'short',timeStyle:'short'}).format(record.updatedAt)}</time></td><td><div className="history-actions"><button type="button" disabled={!!busy||!record.ready} title={record.ready?'包含材料及合并 PDF':'请先编辑并完成报销材料'} onClick={()=>void download(record.id,'zip')}>下载材料 ZIP</button><button type="button" disabled={!!busy||!record.ready} title={record.ready?'下载合并 PDF':'请先编辑并完成报销材料'} onClick={()=>void download(record.id,'pdf')}>下载合并 PDF</button><button type="button" className="history-edit" disabled={!!busy} onClick={()=>void edit(record.id)}>{busy===record.id?'处理中…':'编辑'}</button><button type="button" className="history-delete" disabled={!!busy} aria-label={`删除报销记录：${record.name}`} onClick={()=>{setDeleteTarget(record);setDeleteError('');setNotice('');}}>删除</button></div></td></tr>)}</tbody></table></div>:<div className="history-state"><span className="history-empty-icon" aria-hidden="true">票</span><h2>还没有报销记录</h2><p>点击“新建报销”，命名后即可开始上传材料。</p></div>}
    </section>
    {creating&&<div className="new-record-modal" role="dialog" aria-modal="true" aria-labelledby="new-record-title"><form onSubmit={create}><h2 id="new-record-title">新建报销</h2><label>报销名称<input autoFocus required maxLength={80} value={name} placeholder="例如：上海出差报销 2026年10月" onChange={e=>setName(e.target.value)} disabled={!!busy}/></label>{notice&&<p role="alert">{notice}</p>}<div><button type="button" className="secondary" disabled={!!busy} onClick={()=>{setCreating(false);setName('');}}>取消</button><button type="submit" className="primary" disabled={!!busy||!name.trim()}>{busy?'正在创建…':'创建并整理材料'}</button></div></form></div>}
    <dialog ref={deleteDialog} className="delete-record-modal" role="alertdialog" aria-labelledby="delete-record-title" aria-describedby="delete-record-description" onCancel={e=>{e.preventDefault();if(!busyRef.current)setDeleteTarget(null);}}>
      <form onSubmit={confirmDelete}>
        <h2 id="delete-record-title">删除报销记录？</h2>
        <p id="delete-record-description">确定删除“<strong>{deleteTarget?.name}</strong>”吗？该记录的填写信息及 {deleteTarget?.fileCount ?? 0} 份本地材料将一并删除，删除后无法恢复。</p>
        {deleteError&&<p className="delete-record-error" role="alert">{deleteError}</p>}
        <div className="delete-record-actions"><button autoFocus type="button" className="secondary" disabled={!!busy} onClick={()=>setDeleteTarget(null)}>取消</button><button type="submit" className="delete-record-confirm" disabled={!!busy}>{busy==='delete'?'正在删除…':'确认删除'}</button></div>
      </form>
    </dialog>
    <footer>报销材料整理助手 · 文件在本地保存与处理</footer>
  </main>;
}
