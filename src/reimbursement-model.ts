import { PDFDocument, type PDFImage, type PDFPage } from "pdf-lib";
import { TripForm, claimTotals } from "./trip-claim";
export type DocItem = { claimKey?: string; id: string; file: File; title: string; category: string; journey: string; amount: string; preview?: string; recognition?: string };
export type ManualGroup = { id: string; category: string; name: string };
const CATEGORY_PREFIX: Record<string, number> = { 差旅报销审核单: 1, 差旅费报销清单: 2, 出差申请单: 3, 出差审批单: 3, 酒店: 4, 飞机: 5, 高铁: 6, 打车: 7, 其他: 9 };
const TRANSPORT = ["飞机", "高铁", "打车"];
const REPEATABLE_GROUPS = ["酒店", ...TRANSPORT];
export function isInvoice(item: DocItem) { return /发票/.test(item.title) && !/支付|截图|水单|行程单/.test(item.title); }
export const APPLICATION = "出差申请单";
const frontForms = ["差旅报销审核单", "差旅费报销清单", APPLICATION];
export function exportOrder(items: DocItem[]) {
  return [...frontForms.flatMap(category => items.filter(item => item.category === category)), ...items.filter(item => !frontForms.includes(item.category))];
}
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
  const out = await PDFDocument.create();
  const skipped: string[] = [];
  const payment = (item: DocItem) => item.title.trim() === "支付截图" && !frontForms.includes(item.category);
  const useGrid = items.filter(payment).length > 2;
  const a4: [number, number] = [595.28, 841.89];
  const margin = 20, gap = 12;
  const cellW = (a4[0] - 2 * margin - gap) / 2, cellH = (a4[1] - 2 * margin - gap) / 2;
  let sheet: PDFPage | undefined, slots = 0;
  function addScreenshot(image: PDFImage) {
    if (!sheet || slots === 4) { sheet = out.addPage(a4); slots = 0; }
    // PDF coordinates start at bottom left; fill cells in reading order.
    const x = margin + (slots % 2) * (cellW + gap);
    const y = margin + (1 - Math.floor(slots / 2)) * (cellH + gap);
    const { width, height } = image.scaleToFit(cellW, cellH);
    sheet.drawImage(image, { x: x + (cellW-width)/2, y: y + (cellH-height)/2, width, height });
    slots++;
  }
  for (const item of exportOrder(items)) {
    try {
      const bytes = await item.file.arrayBuffer();
      const grid = useGrid && payment(item);
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
    } catch { skipped.push(item.file.name); }
  }
  const pageCount = out.getPageCount();
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
