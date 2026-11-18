import { PDFDocument, PDFDict, PDFName, type PDFImage, type PDFPage } from "pdf-lib";
import { TripForm, ClaimExpenseLine, claimTotals, tripDays } from "./trip-claim";
export type DocItem = { claimKey?: string; id: string; file: File; title: string; category: string; journey: string; amount: string; preview?: string; claimPreviews?: string[]; recognition?: string };
export type ManualGroup = { id: string; category: string; name: string; occurredOn?: string; endDate?: string; location?: string; reimbursableAmount?: string };
const CATEGORY_PREFIX: Record<string, number> = { 差旅报销审核单: 1, 差旅费报销清单: 2, 出差申请单: 3, 出差审批单: 3, 酒店: 4, 飞机: 5, 高铁: 6, 打车: 7, 其他: 9 };
const TRANSPORT = ["飞机", "高铁", "打车"];
const REPEATABLE_GROUPS = ["酒店", ...TRANSPORT];
export function isInvoice(item: DocItem) { return /发票/.test(item.title) && !/支付|截图|水单|行程单/.test(item.title); }
export const APPLICATION = "出差申请单";
const frontForms = ["差旅报销审核单", "差旅费报销清单", APPLICATION];
export function materialGroups(items: DocItem[], groups: ManualGroup[] = []) {
  const ordered: {category:string;journey:string;docs:DocItem[]}[] = [];
  const byGroup = new Map<string, (typeof ordered)[number]>();
  const getGroup = (category:string, journey:string) => {
    const key = JSON.stringify([category,journey]);
    let group = byGroup.get(key);
    if (!group) {group={category,journey,docs:[]};byGroup.set(key,group);ordered.push(group);}
    return group;
  };
  groups.forEach(group=>getGroup(group.category,group.name || group.category));
  items.forEach(item=>getGroup(item.category,item.journey || item.category).docs.push(item));
  return ordered;
}
export function exportOrder(items: DocItem[], groups: ManualGroup[] = []) {
  const documents = materialGroups(items,groups).filter(group=>!frontForms.includes(group.category)).flatMap(group=>group.docs);
  return [...frontForms.flatMap(category=>items.filter(item=>item.category===category)),...documents];
}
export function moveMaterialToGroup(items: DocItem[], fromId: string, category: string, journey: string, beforeId?: string) {
  const picked = items.find(item => item.id === fromId);
  if (!picked || frontForms.includes(picked.category) || frontForms.includes(category) || fromId === beforeId) return items;
  const next = items.filter(item => item.id !== fromId);
  const destination = beforeId ? next.findIndex(item => item.id === beforeId && item.category === category && (item.journey || item.category) === journey) : -1;
  const last = next.reduce((last,item,index) => item.category === category && (item.journey || item.category) === journey ? index : last, -1);
  const index = destination >= 0 ? destination : last >= 0 ? last+1 : next.length;
  next.splice(index, 0, {...picked, category, journey});
  return next;
}
export function totalAmount(docs: DocItem[]) { return docs.filter(isInvoice).reduce((sum, item) => sum + Math.round((Number(item.amount) || 0) * 100), 0) / 100; }

export function expenseLines(items: DocItem[], groups: ManualGroup[] = []): ClaimExpenseLine[] {
  const result: ClaimExpenseLine[] = [];
  for (const item of items.filter(item => REPEATABLE_GROUPS.includes(item.category))) {
    const name = item.journey || item.category;
    if (result.some(row => row.category === item.category && row.name === name)) continue;
    const group = groups.find(group => group.category === item.category && group.name === name);
    const originalAmount = totalAmount(items.filter(doc => doc.category === item.category && (doc.journey || doc.category) === name));
    result.push({ category: item.category, name, date: group?.occurredOn || '', endDate: group?.endDate || '', location: group?.location || '', originalAmount,
      amount: group?.reimbursableAmount?.trim() ? Number(group.reimbursableAmount) : originalAmount });
  }
  // Keep the order displayed in the upload workspace, including repeated categories.
  return result.sort((a,b) => {
    const index = (line: ClaimExpenseLine) => { const i = groups.findIndex(g => g.category === line.category && g.name === line.name); return i < 0 ? groups.length : i; };
    return index(a)-index(b);
  });
}
export function expenseTotals(lines: ClaimExpenseLine[]) {
  const sum = (hotel: boolean) => lines.filter(row => (row.category === '酒店') === hotel).reduce((sum,row) => sum + Math.round((Number.isFinite(row.amount) ? row.amount : 0)*100),0)/100;
  return { accommodation: sum(true), transport: sum(false) };
}
export function validateExpenseLines(lines: ClaimExpenseLine[]) {
  if (!lines.length) return '请先上传住宿或交通票据';
  for (const row of lines) {
    if (!tripDays(row.date, row.endDate || row.date)) return `请填写「${row.name}」的有效发生日期，结束日期不能早于开始日期`;
    if (!row.location.trim()) return `请填写「${row.name}」的地点或路线`;
    if (!Number.isFinite(row.amount) || row.amount < 0 || Math.round(row.amount*100) > Math.round(row.originalAmount*100)) return `「${row.name}」的报销金额应在 0 至发票总额之间`;
  }
  return '';
}
export function reimbursementClaimKey(form: TripForm, lines: ClaimExpenseLine[]) {
  return JSON.stringify(['continuous-claim-v1', form, lines]);
}

function extOf(file: File) { const ext = file.name.split(".").pop()?.toLowerCase(); return ext === "jpeg" ? "jpg" : ext || "pdf"; }
export function formatFilename(item: DocItem, index: number, items: DocItem[], groups: ManualGroup[] = []) {
  const ordered = exportOrder(items,groups);
  const orderedIndex = ordered.findIndex(doc=>doc.id===item.id);
  const prefix = CATEGORY_PREFIX[item.category] ?? 9;
  const categoryItems = ordered.filter((x) => x.category === item.category);
  const groupNames = [...new Set(categoryItems.map((x) => x.journey || x.category))];
  const groupNo = groupNames.indexOf(item.journey || item.category) + 1;
  const groupItems = categoryItems.filter((x) => (x.journey || x.category) === (item.journey || item.category));
  const materialNo = groupItems.findIndex((x) => x.id === item.id) + 1;
  const amount = item.amount.trim() ? `_${item.amount.trim()}` : "";
  if (prefix <= 3) return `${prefix}_${item.title}.${extOf(item.file)}`;
  if (REPEATABLE_GROUPS.includes(item.category)) return `${prefix}_${groupNo}_${materialNo}_${item.category}_${item.title}${amount}.${extOf(item.file)}`;
  return `${prefix}_${(orderedIndex < 0 ? index : orderedIndex) + 1}_${item.title}${amount}.${extOf(item.file)}`;
}


export type Reimbursement = {
  id: string; name: string; createdAt: number; updatedAt: number;
  items: DocItem[]; manualGroups: ManualGroup[]; tripForm: TripForm;
  activeStep: number; activeGroupId: string; newGroupCategory: string; ticketsComplete: boolean;
};
export function reimbursementStatus(record: Reimbursement) {
  const lines = expenseLines(record.items, record.manualGroups);
  const {accommodation, transport} = expenseTotals(lines);
  const key = reimbursementClaimKey(record.tripForm, lines);
  const ready = record.ticketsComplete && !validateExpenseLines(lines) && !record.items.some(x => isInvoice(x) && !x.amount) && record.items.some(x => x.category === '差旅费报销清单' && x.claimKey === key) && record.items.some(x => x.category === '差旅报销审核单') && record.items.some(x => x.category === APPLICATION);
  return { ready, total: claimTotals(record.tripForm, transport, accommodation).total };
}
export async function mergeMaterials(items: DocItem[], requireComplete = true, groups: ManualGroup[] = []) {
  const out = await PDFDocument.create();
  const skipped: string[] = [];
  const payment = (item: DocItem) => item.title.trim() === "支付截图" && !frontForms.includes(item.category);
  const groupKey = (item: DocItem) => JSON.stringify([item.category, item.journey || item.category]);
  const counts = new Map<string, number>();
  items.filter(payment).forEach(item => counts.set(groupKey(item), (counts.get(groupKey(item)) || 0) + 1));
  const a4: [number, number] = [595.28, 841.89];
  const margin = 20, gap = 12;
  const cellW = (a4[0] - 2 * margin - gap) / 2, cellH = (a4[1] - 2 * margin - gap) / 2;
  let sheet: PDFPage | undefined, slots = 0, previousGroup = "";
  function addScreenshot(image: PDFImage) {
    if (!sheet || slots === 4) { sheet = out.addPage(a4); slots = 0; }
    // PDF coordinates start at bottom left; fill cells in reading order.
    const x = margin + (slots % 2) * (cellW + gap);
    const y = margin + (1 - Math.floor(slots / 2)) * (cellH + gap);
    const { width, height } = image.scaleToFit(cellW, cellH);
    sheet.drawImage(image, { x: x + (cellW-width)/2, y: y + (cellH-height)/2, width, height });
    slots++;
  }
  for (const item of exportOrder(items,groups)) {
    try {
      const bytes = await item.file.arrayBuffer();
      const key = groupKey(item);
      const grid = payment(item) && (counts.get(key) || 0) > 2;
      // A sheet may only contain consecutive screenshots from the same user-created group.
      // Flush at every intervening invoice/document so the original order never changes.
      if (!grid || previousGroup !== key) { sheet = undefined; slots = 0; }
      previousGroup = grid ? key : "";
      if (item.file.type === 'application/pdf' || /\.pdf$/i.test(item.file.name)) {
        if (grid) {
          // Rendering a PDF screenshot respects its crop, rotation and annotations.
          const { pdfEngine, pdfOptions } = await import('./invoice-recognition');
          const engine = await pdfEngine();
          const task = engine.getDocument({ data: new Uint8Array(bytes), ...pdfOptions() });
          try {
            const source = await task.promise;
            for (let i = 1; i <= source.numPages; i++) {
              const page = await source.getPage(i);
              const size = page.getViewport({ scale: 1 });
              const viewport = page.getViewport({ scale: 3 * Math.min(cellW / size.width, cellH / size.height) });
              const canvas = document.createElement('canvas');
              try {
                canvas.width = Math.max(1, Math.ceil(viewport.width)); canvas.height = Math.max(1, Math.ceil(viewport.height));
                await page.render({ canvas, viewport }).promise;
                addScreenshot(await out.embedPng(canvas.toDataURL('image/png')));
              } finally { page.cleanup(); canvas.width = canvas.height = 0; }
            }
          } finally { await task.destroy(); }
        } else {
          const source = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
          // Preserve filled fields when copying audit/application forms into another document.
          const form = source.getForm();
          if (form.getFields().length) {
            const widgets = new Set<string>();
            source.getPages().forEach(page => {
              const annots = page.node.Annots();
              for (let i = 0; annots && i < annots.size(); i++) {
                const ref = annots.get(i), annot = source.context.lookup(ref);
                if (annot instanceof PDFDict && annot.get(PDFName.of("Subtype")) === PDFName.of("Widget")) widgets.add(ref.toString());
              }
            });
            form.flatten({ updateFieldAppearances: false });
            // pdf-lib can leave references to deleted widget children after flattening.
            source.getPages().forEach(page => {
              const annots = page.node.Annots();
              for (let i = (annots?.size() || 0) - 1; i >= 0; i--) if (widgets.has(annots!.get(i).toString())) annots!.remove(i);
            });
          }
          const pages = await out.copyPages(source, source.getPageIndices()); pages.forEach(page => out.addPage(page));
        }
      } else {
        const image = item.file.type === 'image/png' || /\.png$/i.test(item.file.name) ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        if (grid) addScreenshot(image);
        else {
          const page = out.addPage(a4);
          const { width, height } = image.scaleToFit(a4[0]-56, a4[1]-56);
          page.drawImage(image, { x: (a4[0]-width)/2, y: (a4[1]-height)/2, width, height });
        }
      }
    } catch { skipped.push(item.file.name); sheet = undefined; previousGroup = ""; }
  }
  const pageCount = out.getPageCount();
  if (skipped.length && (requireComplete || items.some(item => frontForms.includes(item.category) && skipped.includes(item.file.name)))) throw new Error(`有 ${skipped.length} 份材料无法合并，请进入编辑检查：${skipped.slice(0,2).join('、')}`);
  if (!pageCount) throw new Error('没有可合并的页面，请检查材料是否损坏或加密');
  return { blob: new Blob([new Uint8Array(await out.save())], {type:'application/pdf'}), pageCount, skipped };
}
export function reimbursementBasename(record: Pick<Reimbursement, 'name' | 'tripForm'>) {
  const safe = (value: string, fallback: string) => value.trim().replace(/[\x00-\x1f\x7f\\/:*?"<>|]/g, '_').replace(/^[. ]+|[. ]+$/g, '') || fallback;
  return `${safe(record.tripForm.traveler, '未填写报销人')}_${safe(record.name, '未命名报销')}`;
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = name.replace(/[\\/:*?"<>|]/g,'_'); a.style.display='none';
  document.body.appendChild(a); a.click(); setTimeout(()=>{a.remove();URL.revokeObjectURL(url);},60000);
}
export async function downloadRecord(record: Reimbursement, kind: 'zip' | 'pdf') {
  if (!reimbursementStatus(record).ready) throw new Error('请先进入编辑，完成三个步骤后再下载');
  const { blob: merged } = await mergeMaterials(record.items, true, record.manualGroups);
  const basename = reimbursementBasename(record);
  if (kind === 'pdf') { downloadBlob(merged, `${basename}.pdf`); return; }
  const { createMaterialsArchive } = await import('./materials-archive');
  const ordered = exportOrder(record.items,record.manualGroups);
  const entries = [...ordered.map((item,index)=>({file:item.file as Blob,name:formatFilename(item,index,ordered,record.manualGroups)})),{file:merged,name:`${basename}.pdf`,numbered:false}];
  downloadBlob(await createMaterialsArchive(entries, undefined, basename), `${basename}.zip`);
}
