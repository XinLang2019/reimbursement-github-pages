'use client';
import { useEffect, useRef, useState } from 'react';
import { DocItem, downloadBlob } from './reimbursement-model';
import { pdfEngine, pdfOptions, withTimeout } from './invoice-recognition';

type Viewport = { width: number; height: number };
type RenderTask = { promise: Promise<unknown>; cancel: () => void };
type PdfPage = { getViewport: (options: {scale:number}) => Viewport; render: (options: {canvas:HTMLCanvasElement;canvasContext:CanvasRenderingContext2D;viewport:Viewport;background:string}) => RenderTask; cleanup: () => void };
type PdfDocument = { numPages:number; getPage: (page:number) => Promise<PdfPage> };
type LoadingTask = { promise:Promise<PdfDocument>; destroy:()=>Promise<void> };
type Props = { item:DocItem; position:number; count:number; onClose:()=>void; onPrevious?:()=>void; onNext?:()=>void };

export default function MaterialPreview({item,position,count,onClose,onPrevious,onNext}:Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const isPdf = item.file.type === 'application/pdf' || /\.pdf$/i.test(item.file.name);
  const [imageUrl,setImageUrl] = useState('');
  const [pdf,setPdf] = useState<PdfDocument | null>(null);
  const [page,setPage] = useState(1);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [zoom,setZoom] = useState(100);

  useEffect(()=>{
    const element=dialog.current;
    element?.showModal();
    return ()=>element?.close();
  },[]);
  useEffect(()=>{
    let stopped=false;
    let task:LoadingTask | undefined;
    let url='';
    if(!isPdf) {
      url=URL.createObjectURL(item.file);
      setImageUrl(url);
    } else {
      void (async()=>{
        try {
          const engine=await withTimeout(pdfEngine(),30000);
          if(stopped)return;
          const bytes=await item.file.arrayBuffer();
          if(stopped)return;
          task=engine.getDocument({data:new Uint8Array(bytes),...pdfOptions()});
          const document=await withTimeout(task!.promise,45000);
          if(!stopped)setPdf(document);
        } catch {
          if(!stopped) { setError('这份 PDF 暂时无法预览，可能有密码、文件已损坏或预览资源未加载。可下载原文件检查。'); setLoading(false); }
        }
      })();
    }
    return ()=>{
      stopped=true;
      if(url)URL.revokeObjectURL(url);
      if(task)void task.destroy().catch(()=>undefined);
    };
  },[item.file,isPdf]);

  useEffect(()=>{
    if(!pdf || !canvas.current)return;
    let stopped=false;
    let render:RenderTask | undefined;
    const element=canvas.current;
    setLoading(true);setError('');
    void (async()=>{
      let pdfPage:PdfPage | undefined;
      try {
        pdfPage=await pdf.getPage(page);
        if(stopped)return;
        const original=pdfPage.getViewport({scale:1});
        const viewport=pdfPage.getViewport({scale:Math.min(2.5,1800/Math.max(original.width,original.height))});
        element.width=Math.ceil(viewport.width);element.height=Math.ceil(viewport.height);
        const context=element.getContext('2d');
        if(!context)throw new Error('无法创建预览画布');
        render=pdfPage.render({canvas:element,canvasContext:context,viewport,background:'rgb(255,255,255)'});
        await withTimeout(render.promise,45000);
        if(!stopped)setLoading(false);
      } catch {
        render?.cancel();
        if(!stopped) {setError('这一页无法显示，可切换其他页面或下载原文件检查。');setLoading(false);}
      } finally {pdfPage?.cleanup();}
    })();
    return ()=>{stopped=true;render?.cancel();};
  },[pdf,page]);

  return <dialog ref={dialog} className="material-preview-modal" onDragEnter={event=>event.stopPropagation()} onDragLeave={event=>event.stopPropagation()} onDragOver={event=>{event.preventDefault();event.stopPropagation();}} onDrop={event=>{event.preventDefault();event.stopPropagation();}} aria-labelledby="material-preview-title" onCancel={event=>{event.preventDefault();onClose();}}>
    <div className="material-preview-card">
      <header><div><h2 id="material-preview-title">资料预览</h2><p>{item.file.name}</p><small>{item.journey || item.category} · {item.title || '未选择材料类型'} · 第 {position+1} / {count} 份</small></div><button type="button" autoFocus className="material-preview-close" aria-label="关闭资料预览" onClick={onClose}>×</button></header>
      <div className="material-preview-tools">
        <div><button type="button" disabled={!onPrevious} onClick={onPrevious}>上一份资料</button><button type="button" disabled={!onNext} onClick={onNext}>下一份资料</button></div>
        {isPdf && pdf && <div><button type="button" disabled={page<=1 || loading} onClick={()=>setPage(n=>n-1)}>上一页</button><span aria-live="polite">第 {page} / {pdf.numPages} 页</span><button type="button" disabled={page>=pdf.numPages || loading} onClick={()=>setPage(n=>n+1)}>下一页</button></div>}
        <div><button type="button" aria-label="缩小预览" disabled={zoom<=50} onClick={()=>setZoom(n=>n-25)}>−</button><button type="button" onClick={()=>setZoom(100)} title="恢复适合宽度">{zoom}%</button><button type="button" aria-label="放大预览" disabled={zoom>=250} onClick={()=>setZoom(n=>n+25)}>＋</button></div>
      </div>
      <div className="material-preview-viewer" aria-busy={loading}>
        {loading && <p className="material-preview-status" role="status">正在读取原始资料…</p>}
        {error && <p className="material-preview-status error" role="alert">{error}</p>}
        <div className="material-preview-sheet" style={{width:`${zoom}%`}} hidden={loading || !!error}>
          {isPdf ? <canvas ref={canvas} role="img" aria-label={`${item.file.name} 第 ${page} 页`} /> : imageUrl && <img src={imageUrl} draggable={false} alt={item.file.name} onLoad={()=>setLoading(false)} onError={()=>{setError('图片无法显示，请下载原文件检查是否完整。');setLoading(false);}} />}
        </div>
      </div>
      <footer><span>预览原文件，核对文字、金额和清晰度。</span><div><button type="button" onClick={()=>downloadBlob(item.file,item.file.name)}>下载原文件</button><button type="button" className="primary" onClick={onClose}>关闭预览</button></div></footer>
    </div>
  </dialog>;
}
