'use client';
import { FormEvent, useState } from 'react';
import { withTimeout } from './invoice-recognition';
import { validateExpenseLines } from './reimbursement-model';
import { PDFDocument } from 'pdf-lib';
import { TRANSPORT_STANDARDS, TripForm, ClaimExpenseLine, claimLayout, claimRasterSize, fitClaimToA4, claimTotals, drawClaim, validateTrip } from './trip-claim';

const DEPARTMENT = '软件系统研发部';
const COMPANIES = [
  '七腾机器人有限公司', '重庆七腾机器人研究有限公司', '七腾科技（北京）有限公司',
  '七腾机器人(上海)有限公司', '七腾人工智能（深圳）有限公司', '七腾（新疆）机器人有限公司',
  '江西七腾机器人有限公司', '重庆七腾机器人服务有限公司', '七腾智能装备（唐山）有限公司',
  '安徽七腾机器人有限公司', '重庆七腾文化创意有限公司', '七腾机器人（山东）有限公司',
];

type Props = { lines: ClaimExpenseLine[]; previews?: string[]; value: TripForm; onChange: (value: TripForm) => void; transport: number; accommodation: number; confirmed: boolean; current: boolean; preview?: string; onGenerated: (file: File, preview: string, previews?: string[]) => void; onDownload: () => void; onBusy?: (busy: boolean) => void; };
export default function TripClaimForm({ lines, previews, value, onChange, transport, accommodation, confirmed, current, preview, onGenerated, onDownload, onBusy }: Props) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [customDepartment, setCustomDepartment] = useState(!!value.department && value.department !== DEPARTMENT);
  const totals = claimTotals(value, transport, accommodation);
  const update = (key: keyof TripForm, text: string) => { setError(''); onChange({ ...value, [key]: text }); };
  async function generate(e: FormEvent) {
    e.preventDefault(); const validation = validateTrip(value); if (validation) { setError(validation); return; }
    const lineError = validateExpenseLines(lines); if (lineError) { setError(lineError); return; }
    if (!confirmed) { setError('请先返回第一步确认票据金额'); return; }
    setBusy(true); onBusy?.(true); setError('');
    try {
      const base = ((import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL || '/').replace(/\/?$/, '/');
      if (!Array.from(document.fonts).some(font => font.family === 'ClaimSerif' && font.status === 'loaded')) { const font = new FontFace('ClaimSerif', `url(${base}fonts/claim-serif.woff)`); await withTimeout(font.load(), 30000); document.fonts.add(font); }
      await document.fonts.ready;
      const pdf = await PDFDocument.create();
      const canvas = document.createElement('canvas');
      let image = '';
      try {
        const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('无法生成清单图片，请重试');
        const layout = claimLayout(ctx,value,transport,accommodation,lines);
        const raster = claimRasterSize(layout.width,layout.height);
        canvas.width = raster.width; canvas.height = raster.height;
        ctx.setTransform(raster.scale,0,0,raster.scale,0,0);
        drawClaim(ctx,value,transport,accommodation,lines);
        image = canvas.toDataURL('image/png');
        const embedded = await pdf.embedPng(image);
        const placement = fitClaimToA4(canvas.width,canvas.height);
        const page = pdf.addPage(placement.pageSize);
        page.drawImage(embedded,{x:placement.x,y:placement.y,width:placement.width,height:placement.height});
      } finally {canvas.width = 0;canvas.height = 0;}
      pdf.setTitle('差旅费报销清单');
      const file = new File([new Uint8Array(await pdf.save())], '2_差旅费报销清单.pdf', { type: 'application/pdf' });
      onGenerated(file, image, [image]);
    } catch (err) { setError(err instanceof Error ? err.message : '清单生成失败，请重试'); }
    finally { setBusy(false); onBusy?.(false); }
  }
  const field = (key: keyof TripForm, label: string, options: { required?: boolean; type?: string; placeholder?: string; maxLength?: number; } = {}) => <label key={key}>{label}{options.required && <span className="required-mark"> *</span>}<input type={options.type || 'text'} value={value[key]} required={options.required} maxLength={options.maxLength ?? 50} min={options.type === 'number' ? 0 : undefined} step={options.type === 'number' ? '0.01' : undefined} placeholder={options.placeholder} onChange={e => update(key, e.target.value)} /></label>;
  return <form className="trip-form" onSubmit={generate}>
    <fieldset disabled={busy}><legend>出差信息</legend><div className="trip-form-grid">
      {field('traveler','出差人',{required:true,maxLength:30})}
      <div><label>部门<span className="required-mark"> *</span><select required value={customDepartment ? 'custom' : value.department} onChange={e => { const custom = e.target.value === 'custom'; setCustomDepartment(custom); update('department', custom ? '' : e.target.value); }}><option value="" disabled>请选择部门</option><option value={DEPARTMENT}>{DEPARTMENT}</option><option value="custom">手动填写</option></select></label>{customDepartment && <label className="department-custom">手动填写部门<input value={value.department} required maxLength={50} placeholder="请输入部门名称" onChange={e => update('department',e.target.value)} /></label>}</div>
      {field('rank','职级',{required:true,maxLength:20})}
      {field('purpose','出差事由',{required:true,maxLength:140})}<label>项目 / 公司名称<span className="required-mark"> *</span><select value={value.company} required onChange={e => update('company',e.target.value)}><option value="" disabled>请选择项目 / 公司名称</option>{value.company && !COMPANIES.includes(value.company) && <option value={value.company}>{value.company}</option>}{COMPANIES.map(company => <option key={company} value={company}>{company}</option>)}</select></label>{field('product','产品名称（选填）')}
    </div><div className="trip-form-grid trip-route-row">
      {field('startDate','出差开始日期',{required:true,type:'date'})}{field('endDate','出差结束日期',{required:true,type:'date'})}
      {field('origin','出发地点',{required:true,maxLength:35})}{field('destination','到达地点',{required:true,maxLength:35})}
    </div><div className="trip-days-note" aria-live="polite">出差天数：<output>{totals.days ? `${totals.days} 天` : '请选择起止日期'}</output><span>含出发日和返程日</span></div></fieldset>
    <fieldset disabled={busy}><legend>出差标准</legend><p className="trip-help">请按所在单位的规定选择或填写标准。</p><div className="trip-form-grid">
      <label>交通工具<select value={value.transport} onChange={e => onChange({...value, transport:e.target.value, transportStandard:TRANSPORT_STANDARDS[e.target.value][0]})}>{Object.keys(TRANSPORT_STANDARDS).map(mode=><option key={mode}>{mode}</option>)}</select></label>
      <label>交通工具标准<select value={value.transportStandard} onChange={e => update('transportStandard',e.target.value)}>{TRANSPORT_STANDARDS[value.transport].map(standard=><option key={standard}>{standard}</option>)}</select></label>
      {field('hotelStandard','住宿标准（元 / 晚）',{required:true,type:'number',placeholder:'请输入每晚标准'})}
      {field('dailyAllowance','出差补助标准（元 / 天）',{required:true,type:'number',placeholder:'无补助请填 0'})}
      {field('otherExpense','其他费用（元）',{required:true,type:'number'})}
    </div></fieldset>
    <section className="claim-calculation" aria-label="实际报销金额"><h2>实际报销金额</h2><div className="claim-detail-wrap"><table className="claim-detail-table"><thead><tr><th>大类分组</th><th>发生日期</th><th>地点 / 路线</th><th>发票合计</th><th>报销金额</th></tr></thead><tbody>{lines.map(line=><tr key={JSON.stringify([line.category,line.name])}><td>{line.name}</td><td>{line.date}{line.endDate && line.endDate !== line.date ? ` 至 ${line.endDate}` : ''}</td><td>{line.location}</td><td>¥{line.originalAmount.toFixed(2)}</td><td>¥{line.amount.toFixed(2)}</td></tr>)}</tbody></table></div><div className="claim-totals-grid">
      <div><span>交通费</span><strong>¥{transport.toFixed(2)}</strong><small>来自第一步</small></div><div><span>住宿费</span><strong>¥{accommodation.toFixed(2)}</strong><small>来自第一步</small></div>
      <div><span>出差补助</span><strong>¥{totals.allowance.toFixed(2)}</strong><small>{totals.days} 天 × ¥{(Number(value.dailyAllowance)||0).toFixed(2)} / 天</small></div>
      <div><span>其他费用</span><strong>¥{totals.other.toFixed(2)}</strong></div><div className="claim-total"><span>报销金额合计</span><strong>¥{totals.total.toFixed(2)}</strong></div>
    </div><p className="trip-help">交通费、住宿费采用第一步中各组调整后的报销金额；补助仅按整次出差天数计算一次。住宿标准仅作说明。</p></section>
    {error && <p role="alert" className="step-alert">{error}</p>}
    {preview && !current && <p role="status" className="step-alert">清单内容或排版已更新，请重新生成完整清单后再进入第三步。</p>}
    <div className="claim-generate-actions"><button type="submit" className="primary" disabled={busy || !confirmed}>{busy ? '正在生成清单…' : preview ? '信息填写完成，重新生成清单' : '信息填写完成，生成清单'}</button><span>按大类逐行生成完整清单，所有明细连续排列，最后统一合计，并按比例缩放为一页 A4。</span></div>
    {current && preview && <section className="claim-preview"><header><div><strong>差旅费报销清单已生成</strong><p>合并时自动排在审核单之后。</p></div><button type="button" className="secondary" onClick={onDownload}>下载清单 PDF</button></header>{(previews?.length ? previews : [preview]).map((image,index)=><img key={index} src={image} alt="完整差旅费报销清单，含全部大类明细和报销总额" />)}</section>}
  </form>;
}
