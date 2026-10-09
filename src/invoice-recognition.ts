type Progress = (message: string) => void;
type TextPart = { str: string; transform?: number[]; hasEOL?: boolean };
const base = () => ((import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL || "/").replace(/\/?$/, "/");

/** Read the explicit tax-inclusive total. Ambiguous unlabelled amounts need review. */
export function readInvoiceAmount(text: string): string {
  const normalized = text.normalize("NFKC").replace(/[,，]/g, "").replace(/[。．]/g, ".")
    .replace(/(?<=[\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])/g, "")
    .replace(/(?<=\d)[ \t]+(?=\.)|(?<=\.)[ \t]+(?=\d)/g, "");
  const money = "(\\d{1,9}(?:\\.\\d{1,2})?)(?![\\d.])";
  const currency = "(?:CNY|RMB|[¥￥])";
  for (const label of ["小写", "价税合计", "合计金额|金额合计|应付金额|实付金额|价税总计", "总计|合计"]) {
    const match = normalized.match(new RegExp(`(?:${label})[^\\d\\n]{0,80}[¥￥]?[ \\t]*${money}`));
    if (match) return Number(match[1]).toFixed(2);
  }
  const lines = normalized.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length - 1; i++) {
    // Airline invoices put all column headings above one row of CNY values.
    // The final amount belongs to 合计; the first is only the base fare.
    if (/票价.*(?:燃油附加费|民航发展基金).*(?:合计|总计)\s*$/.test(lines[i])) {
      const amounts = [...lines[i + 1].matchAll(new RegExp(`${currency}\\s*${money}`, "gi"))];
      const columns = lines[i].match(/票价|燃油附加费|增值税税额|民航发展基金|其他税费|合计|总计/g) || [];
      if (columns.length >= 3 && amounts.length === columns.length) return Number(amounts[amounts.length - 1][1]).toFixed(2);
    }
    // A standalone total heading may also have its value on the next line.
    if (/^(?:价税合计|合计金额|金额合计|总计|合计|[（(]?小写[）)]?)[:：]?$/.test(lines[i])) {
      const match = lines[i + 1].match(new RegExp(`^${currency}?\\s*${money}\\s*(?:元)?$`, "i"));
      if (match) return Number(match[1]).toFixed(2);
    }
  }
  // Never substitute a fare or tax component for an unresolved airline total.
  if (/燃油附加费|民航发展基金/.test(normalized)) return "";
  const fare = normalized.match(new RegExp(`(?:票价|票款)[^\\d\\n]{0,80}${money}`));
  if (fare) return Number(fare[1]).toFixed(2);
  const candidates = [...normalized.matchAll(new RegExp(`${currency}\\s*${money}`, "gi"))].map(m => Number(m[1]).toFixed(2));
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : "";
}

export function textFromPdfParts(parts: TextPart[]) {
  const rows: { y: number; parts: TextPart[] }[] = [];
  for (const part of parts) {
    if (!part.str) continue;
    const y = part.transform?.[5] ?? 0;
    let row = rows.find(row => Math.abs(row.y - y) < 3);
    if (!row) { row = { y, parts: [] }; rows.push(row); }
    row.parts.push(part);
  }
  return rows.sort((a, b) => b.y - a.y).map(row => row.parts.sort((a, b) => (a.transform?.[4] ?? 0) - (b.transform?.[4] ?? 0)).map(part => part.str).join("")).join("\n");
}

export async function pdfEngine() {
  // New resource URLs avoid a cached modern worker being paired with the legacy build.
  const engine = await import(/* @vite-ignore */ `${base()}vendor/pdf.min.mjs?compat=5.6.205-1`);
  engine.GlobalWorkerOptions.workerSrc = `${base()}vendor/pdf.worker.min.mjs?compat=5.6.205-1`;
  return engine;
}
export function pdfOptions() {
  return { useSystemFonts: true, cMapUrl: `${base()}vendor/cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${base()}vendor/standard_fonts/`, wasmUrl: `${base()}vendor/wasm/`, isEvalSupported: false };
}
export function recognitionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/password|密码/i.test(message)) return "PDF 有密码保护，请上传解密版本或手动填写金额";
  if (/InvalidPDF|Invalid PDF|损坏/i.test(message)) return "PDF 无法读取，请重新下载发票后上传";
  if (/timeout|超时/i.test(message)) return "识别超时，请重新识别或手动填写金额";
  if (/fetch|network|load|import|worker|加载|资源/i.test(message)) return "识别资源加载失败，请检查网络后重试或手动填写金额";
  return "文件识别失败，请上传清晰的 PDF、JPG 或 PNG，或手动填写金额";
}
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("识别超时")), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
let queue: Promise<unknown> = Promise.resolve();
export function extractInvoiceAmount(file: File, progress: Progress = () => {}) {
  progress("等待识别…");
  const result = queue.then(() => recognizeFile(file, progress));
  queue = result.catch(() => undefined);
  return result;
}
async function recognizeFile(file: File, progress: Progress) {
  let worker: Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>> | undefined;
  const recognizeImage = async (image: File | HTMLCanvasElement) => {
    if (!worker) {
      progress("首次识别，正在加载文字识别资源…");
      const { createWorker } = await import("tesseract.js");
      let fail!: (error: unknown) => void;
      const failure = new Promise<never>((_, reject) => { fail = reject; });
      let expired = false;
      const loading = createWorker("chi_sim+eng", 1, {
        workerPath: `${base()}vendor/ocr/worker.min.js`, corePath: `${base()}vendor/ocr`, langPath: `${base()}vendor/ocr`,
        workerBlobURL: true, errorHandler: fail,
        logger: m => { if (m.status === "recognizing text") progress(`图片识别中 ${Math.round(m.progress * 100)}%`); },
      }).then(async ready => { if (expired) { await ready.terminate(); throw new Error("识别超时"); } return ready; });
      try { worker = await withTimeout(Promise.race([loading, failure]), 120000); }
      catch (error) { expired = true; throw error; }
    }
    const result = await withTimeout(worker.recognize(image), 90000);
    return readInvoiceAmount(result.data.text);
  };
  try {
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      progress("正在读取 PDF 发票…");
      const engine = await pdfEngine();
      const task = engine.getDocument({ data: new Uint8Array(await file.arrayBuffer()), ...pdfOptions() });
      let doc: Awaited<typeof task.promise>;
      try { doc = await withTimeout<Awaited<typeof task.promise>>(task.promise, 45000); }
      catch (error) { await task.destroy(); throw error; }
      try {
        for (let i = 1; i <= doc.numPages; i++) {
          progress(`正在读取第 ${i} / ${doc.numPages} 页…`);
          const page = await doc.getPage(i);
          let amount = "";
          try {
            const content = await page.getTextContent();
            const parts = content.items.filter((p: { str?: string }) => typeof p.str === "string") as TextPart[];
            amount = readInvoiceAmount(textFromPdfParts(parts));
          } catch { /* Text decoding can fail for scanned pages or unusual embedded fonts. */ }
          if (!amount) {
            const natural = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: Math.min(2.5, 2600 / Math.max(natural.width, natural.height)) });
            const canvas = document.createElement("canvas");
            canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
            const context = canvas.getContext("2d");
            if (!context) throw new Error("无法读取发票图片");
            try {
              await withTimeout(page.render({ canvas, canvasContext: context, viewport, background: "rgb(255,255,255)" }).promise, 45000);
              amount = await recognizeImage(canvas);
            } finally { canvas.width = 0; canvas.height = 0; }
          }
          page.cleanup();
          if (amount) return amount;
        }
        return "";
      } finally { await doc.destroy(); }
    }
    return await recognizeImage(file);
  } finally { if (worker) await worker.terminate(); }
}
