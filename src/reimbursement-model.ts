import { PDFDocument } from "pdf-lib";
import { TripForm, claimTotals } from "./trip-claim";
export type DocItem = { claimKey?: string; id: string; file: File; title: string; category: string; journey: string; amount: string; preview?: string; recognition?: string };
export type ManualGroup = { id: string; category: string; name: string };
const CATEGORY_PREFIX: Record<string, number> = { 差旅报销审核单: 1, 差旅费报销清单: 2, 出差审批单: 3, 酒店: 4, 飞机: 5, 高铁: 6, 打车: 7, 其他: 9 };
const TRANSPORT = ["飞机", "高铁", "打车"];
const REPEATABLE_GROUPS = ["酒店", ...TRANSPORT];
export function isInvoice(item: DocItem) { return /发票/.test(item.title) && !/支付|截图|水单|行程单/.test(item.title); }
export function exportOrder(items: DocItem[]) { return [...items.filter(x => x.category === "差旅报销审核单"), ...items.filter(x => x.category === "差旅费报销清单"), ...items.filter(x => !["差旅报销审核单", "差旅费报销清单"].includes(x.category))]; }
export function totalAmount(docs: DocItem[]) { return docs.filter(isInvoice).reduce((sum, item) => sum + Math.round((Number(item.amount) || 0) * 100), 0) / 100; }

function extOf(file: File) { const ext = file.name.split(".").pop()?.toLowerCase(); return ext === "jpeg" ? "jpg" : ext || "pdf"; }
export function formatFilename(item: DocItem, index: number, items: DocItem[]) {
  const prefix = CATEGORY_PREFIX[item.category] ?? 9;
  const categoryItems = items.filter((x) => x.category === item.category);
  const groupNames = [...new Set(categoryItems.map((x) => x.journey || x.category))];
  const groupNo = groupNames.indexOf(item.journey || item.category) + 1;
  const groupItems = categoryItems.filter((x) => (x.journey || x.category) === (item.journey || item.category));
  const materialNo = groupItems.findIndex((x) => x.id === item.id) + 1;
  const amount = item.amount.trim() ? `_${item.amount.trim()}` : "";
  if (prefix <= 3) return `${prefix}_${item.title}.${extOf(item.file)}`;
  if (REPEATABLE_GROUPS.includes(item.category)) return `${prefix}_${groupNo}_${materialNo}_${item.category}_${item.title}${amount}.${extOf(item.file)}`;
  return `${prefix}_${index + 1}_${item.title}${amount}.${extOf(item.file)}`;
}


export type Reimbursement = {
  id: string; name: string; createdAt: number; updatedAt: number;
  items: DocItem[]; manualGroups: ManualGroup[]; tripForm: TripForm;
  activeStep: number; activeGroupId: string; newGroupCategory: string; ticketsComplete: boolean;
};
export function reimbursementStatus(record: Reimbursement) {
  const accommodation = totalAmount(record.items.filter(x => x.category === '酒店'));
  const transport = totalAmount(record.items.filter(x => TRANSPORT.includes(x.category)));
  const key = JSON.stringify([record.tripForm, transport, accommodation]);
  const ready = record.ticketsComplete && !record.items.some(x => isInvoice(x) && !x.amount) && record.items.some(x => x.category === '差旅费报销清单' && x.claimKey === key) && record.items.some(x => x.category === '差旅报销审核单');
  return { ready, total: claimTotals(record.tripForm, transport, accommodation).total };
}
export async function mergeMaterials(items: DocItem[], requireComplete = false) {
  const out = await PDFDocument.create(); const skipped: string[] = []; let pageCount = 0;
  for (const item of exportOrder(items)) {
    try {
      const bytes = await item.file.arrayBuffer();
      if (item.file.type === 'application/pdf' || /\.pdf$/i.test(item.file.name)) {
        const source = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
        const pages = await out.copyPages(source, source.getPageIndices()); pages.forEach(page => out.addPage(page)); pageCount += pages.length;
      } else {
        const image = item.file.type === 'image/png' || /\.png$/i.test(item.file.name) ? await out.embedPng(bytes) : await out.embedJpg(bytes);
        const page = out.addPage([595.28, 841.89]); const scale = Math.min((page.getWidth()-56)/image.width, (page.getHeight()-56)/image.height);
        const width = image.width*scale, height = image.height*scale;
        page.drawImage(image, {x:(page.getWidth()-width)/2,y:(page.getHeight()-height)/2,width,height}); pageCount++;
      }
    } catch { skipped.push(item.file.name); }
  }
  if (requireComplete && skipped.length) throw new Error(`有 ${skipped.length} 份材料无法合并，请进入编辑检查：${skipped.slice(0,2).join('、')}`);
  if (!pageCount) throw new Error('没有可合并的页面，请检查材料是否损坏或加密');
  return { blob: new Blob([new Uint8Array(await out.save())], {type:'application/pdf'}), pageCount, skipped };
}
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = name.replace(/[\\/:*?"<>|]/g,'_'); a.style.display='none';
  document.body.appendChild(a); a.click(); setTimeout(()=>{a.remove();URL.revokeObjectURL(url);},60000);
}
export async function downloadRecord(record: Reimbursement, kind: 'zip' | 'pdf') {
  if (!reimbursementStatus(record).ready) throw new Error('请先进入编辑，完成三个步骤后再下载');
  const { blob: merged } = await mergeMaterials(record.items, true);
  if (kind === 'pdf') { downloadBlob(merged, `${record.name}_合并报销材料.pdf`); return; }
  const { createMaterialsArchive } = await import('./materials-archive');
  const ordered = exportOrder(record.items);
  const entries = [...ordered.map((item,index)=>({file:item.file as Blob,name:formatFilename(item,index,ordered)})),{file:merged,name:'合并报销材料.pdf'}];
  downloadBlob(await createMaterialsArchive(entries), `${record.name}_报销材料备份.zip`);
}
