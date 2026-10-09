"use client";

import { DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { DocItem, ManualGroup, Reimbursement, isInvoice, exportOrder, totalAmount, formatFilename, mergeMaterials } from "./reimbursement-model";
import { saveReimbursement, storageMessage } from "./reimbursement-storage";
import TripClaimForm from "./trip-claim-form";
import { TripForm } from "./trip-claim";
import { extractInvoiceAmount, pdfEngine, pdfOptions, recognitionError } from "./invoice-recognition";

type DeleteTarget = { category: string; journey: string; count: number };
const CATEGORIES = ["差旅报销审核单", "差旅费报销清单", "出差审批单", "酒店", "飞机", "高铁", "打车", "其他"];
const TRANSPORT = ["飞机", "高铁", "打车"];
const REPEATABLE_GROUPS = ["酒店", ...TRANSPORT];
const MATERIAL_OPTIONS: Record<string, string[]> = {
  酒店: ["发票", "水单", "支付截图"],
  飞机: ["发票", "支付截图"],
  高铁: ["发票", "支付截图"],
  打车: ["发票", "行程单", "支付截图"],
};
function materialTitle(name: string, category: string) {
  const inferred = inferTitle(name, category);
  const normalized = inferred === "酒店水单" ? "水单" : inferred;
  const options = MATERIAL_OPTIONS[category];
  return !options || options.includes(normalized) ? normalized : "";
}
const REQUIRED_MATERIALS: Record<string, string[]> = {
  酒店: ["住宿发票", "酒店水单", "支付截图"],
  飞机: ["机票发票", "支付截图"],
  高铁: ["高铁发票", "支付截图"],
  打车: ["打车发票", "行程单", "支付截图"],
};
const UPLOAD_GUIDE = [
  { category: "", title: "创建类别并上传票据", description: "先创建住宿、飞机、高铁、打车类别，再上传对应材料" },
  { category: "差旅费报销清单", title: "差旅费报销清单", description: "填写出差信息与标准，自动计算补助并生成报销清单" },
  { category: "差旅报销审核单", title: "差旅报销审核单", description: "最后上传审核单；导出时自动放在最前面" },
];
function uploadStepIndex(category: string) { return UPLOAD_GUIDE.findIndex(step => step.category === category); }
function firstMissingUploadStep(category: string, uploadedCategories: Set<string>) {
  if (category === "差旅报销审核单" && !uploadedCategories.has("差旅费报销清单")) return UPLOAD_GUIDE[1];
  return undefined;
}
function inferCategory(name: string) {
  const n = name.toLowerCase();
  if (/出差.{0,4}审批|差旅.{0,4}审批|审批单|出差申请|差旅申请/.test(n)) return "出差审批单";
  if (/审核/.test(n)) return "差旅报销审核单";
  if (n.includes("清单")) return "差旅费报销清单";
  if (/酒店|住宿|水单/.test(n)) return "酒店";
  if (/高铁|火车|铁路|12306|动车/.test(n)) return "高铁";
  if (/机票|飞机|航空|登机|航班|保险|服务费/.test(n)) return "飞机";
  if (/打车|出租|滴滴|网约车|行程单/.test(n)) return "打车";
  return "其他";
}
function inferTitle(name: string, category: string) {
  const n = name.replace(/\.[^.]+$/, "");
  if (/出差.{0,4}审批|差旅.{0,4}审批|审批单|出差申请|差旅申请/.test(n)) return "出差审批单";
  if (/支付|截图/.test(n)) return "支付截图";
  if (/行程/.test(n)) return "行程单";
  if (/水单/.test(n)) return "酒店水单";
  if (/保险/.test(n)) return "保险";
  if (/服务费/.test(n)) return "服务费";
  if (/发票/.test(n)) return "发票";
  return REPEATABLE_GROUPS.includes(category) ? "发票" : category;
}
function hasRequiredMaterial(docs: DocItem[], material: string) {
  return docs.some((doc) => material.endsWith("发票") ? isInvoice(doc) : material === "酒店水单" ? /水单/.test(doc.title) : doc.title === material);
}
export default function ReimbursementEditor({ initial, onBack }: { initial: Reimbursement; onBack: () => void }) {
  const [activeStep, setActiveStep] = useState(initial.activeStep);
  const [items, setItems] = useState<DocItem[]>(initial.items);
  const [dragId, setDragId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [pdfPages, setPdfPages] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [pageDragging, setPageDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const [orderWarning, setOrderWarning] = useState<{ category: string; title: string; message: string } | null>(null);
  const [manualGroups, setManualGroups] = useState<ManualGroup[]>(initial.manualGroups);
  const [activeGroupId, setActiveGroupId] = useState(initial.activeGroupId);
  const [newGroupCategory, setNewGroupCategory] = useState(initial.newGroupCategory);
  const inputRef = useRef<HTMLInputElement>(null);
  const groupCategoryRef = useRef<HTMLSelectElement>(null);
  const guidedCategoryRef = useRef("");
  const dragDepth = useRef(0);
  const activeGroup = manualGroups.find((group) => group.id === activeGroupId);
  const [ticketsComplete, setTicketsComplete] = useState(initial.ticketsComplete);
  const [recognizing, setRecognizing] = useState(0);
  const accommodationTotal = totalAmount(items.filter(x => x.category === "酒店"));
  const transportTotal = totalAmount(items.filter(x => TRANSPORT.includes(x.category)));
  const [tripForm, setTripForm] = useState<TripForm>(initial.tripForm);
  const claimKey = JSON.stringify([tripForm, transportTotal, accommodationTotal]);
  const [saveState, setSaveState] = useState("已保存到本地");
  const [saveError, setSaveError] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [generatingClaim, setGeneratingClaim] = useState(false);
  const saveVersion = useRef(0);
  const firstSave = useRef(true);
  const snapshot: Reimbursement = { ...initial, items, manualGroups, tripForm, activeStep, activeGroupId, newGroupCategory, ticketsComplete, updatedAt: Date.now() };
  const latestSnapshot = useRef(snapshot); latestSnapshot.current = snapshot;
  const imageUrls = useRef(new Set<string>());
  items.forEach(item => { if (item.preview?.startsWith("blob:")) imageUrls.current.add(item.preview); });
  useEffect(() => () => { imageUrls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  const fingerprint = JSON.stringify([items.map(({ recognition, preview, file, ...item }) => [item, file.name, file.size, file.lastModified]), manualGroups, tripForm, activeStep, activeGroupId, newGroupCategory, ticketsComplete]);
  async function persistLatest() {
    const version = ++saveVersion.current; setSaveState("正在保存…"); setSaveError(false);
    try { await saveReimbursement(latestSnapshot.current); if (version === saveVersion.current) setSaveState("已保存到本地"); return true; }
    catch (error) { if (version === saveVersion.current) { setSaveError(true); setSaveState(storageMessage(error)); } return false; }
  }
  useEffect(() => { if (firstSave.current) { firstSave.current = false; return; } void persistLatest(); }, [fingerprint]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (saveState === "正在保存…" || saveError || recognizing > 0 || generatingClaim) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, [saveState, saveError, recognizing, generatingClaim]);
  async function returnToList() {
    if (recognizing || generatingClaim || exporting || archiving || leaving) return;
    setLeaving(true); if (await persistLatest()) onBack(); else setLeaving(false);
  }
  const generatedClaim = items.find(item => item.category === "差旅费报销清单" && item.claimKey);
  const claimCurrent = !!generatedClaim && generatedClaim.claimKey === claimKey && ticketsComplete;
  const guideSteps = UPLOAD_GUIDE.map((step, index) => ({ ...step, complete: index === 0 ? ticketsComplete : index === 1 ? claimCurrent : items.some(item => item.category === step.category) }));
  function saveGeneratedClaim(file: File, preview: string) {
    const claim: DocItem = { id: crypto.randomUUID(), file, preview, claimKey, title: "差旅费报销清单", category: "差旅费报销清单", journey: "差旅费报销清单", amount: "" };
    setItems(current => [...current.filter(item => item.category !== "差旅费报销清单"), claim]);
    setNotice("差旅费报销清单已生成，已自动加入合并材料");
  }

  const pendingInvoices = items.filter(x => isInvoice(x) && !x.amount).length;
  const guideCompleted = guideSteps.filter((step) => step.complete).length;
  const warningNotice = notice.startsWith("请先") || notice.includes("暂未添加");
  const groupedItems = useMemo(() => {
    const result: { category: string; journey: string; docs: DocItem[] }[] = manualGroups.map((group) => ({ category: group.category, journey: group.name, docs: [] }));
    items.forEach((item) => { const journey = item.journey || item.category; const found = result.find((group) => group.category === item.category && group.journey === journey); if (found) found.docs.push(item); else result.push({ category: item.category, journey, docs: [item] }); });

    return result;
  }, [items, manualGroups]);

  const visibleGroups = groupedItems.filter(group => activeStep === 0 ? !UPLOAD_GUIDE.slice(1).some(step => step.category === group.category) : group.category === UPLOAD_GUIDE[activeStep].category);
  const visibleCount = visibleGroups.reduce((count, group) => count + group.docs.length, 0);
  function goToStep(index: number) {
    if (generatingClaim) return;
    setActiveStep(index);
    guidedCategoryRef.current = "";
    setNotice("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function chooseFiles() {
    guidedCategoryRef.current = "";
    if (activeStep > 0) startGuidedUpload(UPLOAD_GUIDE[activeStep].category);
    else inputRef.current?.click();
  }
  function removeItem(item: DocItem) {
    if (!UPLOAD_GUIDE.slice(1).some(step => step.category === item.category)) setTicketsComplete(false);
    setItems(current => current.filter(x => x.id !== item.id));
  }

  function showOrderWarning(step: (typeof UPLOAD_GUIDE)[number], message: string) {
    setNotice(message);
    setOrderWarning({ category: step.category, title: step.title, message });
  }

  async function recognizeInvoice(item: DocItem) {
    if (!isInvoice(item) || !REPEATABLE_GROUPS.includes(item.category)) return;
    setRecognizing(n => n + 1); setItems(current => current.map(x => x.id === item.id && isInvoice(x) ? { ...x, recognition: "正在识别…" } : x));
    try { const amount = await extractInvoiceAmount(item.file, message => setItems(current => current.map(x => x.id === item.id && isInvoice(x) ? { ...x, recognition: message } : x))); setItems(current => current.map(x => x.id === item.id && isInvoice(x) ? { ...x, amount: x.amount || amount, recognition: amount ? "已识别，请核对" : "未识别到金额，请手动填写" } : x)); }
    catch (error) { setItems(current => current.map(x => x.id === item.id && isInvoice(x) ? { ...x, recognition: recognitionError(error) } : x)); }
    finally { setRecognizing(n => n - 1); }
  }
  function addFiles(files: FileList | File[]) {
    if (activeStep === 1) { setNotice("请填写本页信息并生成差旅费报销清单，无需上传文件"); return; }
    if (activeStep === 2 && !claimCurrent) { setNotice("请先在第二步生成最新的差旅费报销清单"); return; }
    const guidedCategory = guidedCategoryRef.current || UPLOAD_GUIDE[activeStep].category;
    guidedCategoryRef.current = "";
    if (!guidedCategory && !activeGroup) { setNotice("请先创建并选中类别，再上传对应材料"); return; }
    if (guidedCategory && !ticketsComplete) { setNotice("请先完成票据上传并确认金额汇总"); return; }
    const accepted = Array.from(files).filter((file) => ["application/pdf", "image/jpeg", "image/png"].includes(file.type) || /\.(pdf|jpe?g|png)$/i.test(file.name));
    const batchTransportTypes = [...new Set(accepted.map((file) => inferCategory(file.name)).filter((category) => TRANSPORT.includes(category)))];
    const batchTransport = batchTransportTypes.length === 1 ? batchTransportTypes[0] : "";
    const recentTransport = [...items].reverse().find((item) => TRANSPORT.includes(item.category));
    const uploadedCategories = new Set(items.map((item) => item.category));
    let firstBlockedStep: (typeof UPLOAD_GUIDE)[number] | undefined;
    let blockedCount = 0;
    const additions = accepted.reduce<DocItem[]>((next, file) => {
      const inferredCategory = inferCategory(file.name);
      const isGenericCompanion = inferredCategory === "其他" && /支付|截图|凭证/.test(file.name);
      const isApproval = inferredCategory === "出差审批单";
      const category = guidedCategory || (isApproval ? inferredCategory : activeGroup?.category ?? (isGenericCompanion ? batchTransport || recentTransport?.category || "其他" : inferredCategory));
      const missingStep = firstMissingUploadStep(category, uploadedCategories);
      if (missingStep) {
        firstBlockedStep ||= missingStep;
        blockedCount += 1;
        return next;
      }
      const matchingGroup = [...manualGroups].reverse().find((group) => group.category === category);
      const journey = guidedCategory || isApproval ? category : activeGroup?.name ?? (isGenericCompanion && recentTransport?.category === category ? recentTransport.journey : matchingGroup?.name || category);
      next.push({ id: crypto.randomUUID(), file, category, journey, title: guidedCategory || materialTitle(file.name, category), amount: "", preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined });
      uploadedCategories.add(category);
      return next;
    }, []);
    if (!additions.length && firstBlockedStep) {
      showOrderWarning(firstBlockedStep, `请先完成第 ${uploadStepIndex(firstBlockedStep.category) + 1} 步：上传「${firstBlockedStep.title}」，后面的材料暂未添加`);
      return;
    }
    setManualGroups((current) => { const next = [...current]; additions.forEach((item) => { const name = item.journey || item.category; if (!next.some((group) => group.category === item.category && group.name === name)) next.push({ id: crypto.randomUUID(), category: item.category, name }); }); return next; });
    setItems((current) => [...current, ...additions]);
    additions.forEach(item => { void recognizeInvoice(item); });
    if (!guidedCategory) setTicketsComplete(false);
    const hasApproval = additions.some((item) => item.category === "出差审批单");
    if (blockedCount && firstBlockedStep) showOrderWarning(firstBlockedStep, `已加入 ${additions.length} 份材料；另有 ${blockedCount} 份暂未添加，请先上传「${firstBlockedStep.title}」`);
    else setNotice(accepted.length ? `已加入 ${additions.length} 份材料${guidedCategory ? `，已归入「${guidedCategory}」` : hasApproval ? "，出差审批单已单独归类" : activeGroup ? `，全部归入「${activeGroup.name}」` : batchTransport ? `，支付截图已跟随${batchTransport}材料归类` : "，同类材料已归入对应大类"}` : "暂不支持该文件格式");
  }
  function startGuidedUpload(category: string) {
    if (category === "差旅费报销清单") { goToStep(1); return; }
    if (category === "差旅报销审核单" && !claimCurrent) { goToStep(1); setNotice("请先填写信息并生成最新的差旅费报销清单"); return; }
    if (category && !ticketsComplete) { setNotice("请先完成票据上传并确认金额汇总"); return; }
    const missingStep = firstMissingUploadStep(category, new Set(items.map((item) => item.category)));
    if (missingStep) {
      showOrderWarning(missingStep, `请先完成第 ${uploadStepIndex(missingStep.category) + 1} 步：上传「${missingStep.title}」，才能进行第 ${uploadStepIndex(category) + 1} 步`);
      return;
    }
    if (!category) {
      setActiveStep(0);
      groupCategoryRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      groupCategoryRef.current?.focus({ preventScroll: true });
      setNotice("请选择住宿、飞机、高铁或打车，点击“确认添加”后，再上传对应的发票、行程单和支付截图");
      return;
    }
    setActiveStep(uploadStepIndex(category));
    guidedCategoryRef.current = category;
    inputRef.current?.click();
  }
  function addManualGroup() {
    const missingStep = firstMissingUploadStep(newGroupCategory, new Set(items.map((item) => item.category)));
    if (missingStep) {
      showOrderWarning(missingStep, `请先完成第 ${uploadStepIndex(missingStep.category) + 1} 步：上传「${missingStep.title}」，才能添加「${newGroupCategory === "酒店" ? "住宿" : newGroupCategory}」大类`);
      return;
    }
    const existingGroups = manualGroups.filter((group) => group.category === newGroupCategory);
    if (!REPEATABLE_GROUPS.includes(newGroupCategory) && existingGroups.length) { setActiveGroupId(existingGroups[0].id); setNotice(`已选中「${existingGroups[0].name}」，接下来上传的材料都会进入此类`); return; }
    const displayCategory = newGroupCategory === "酒店" ? "住宿" : newGroupCategory;
    let nextNumber = existingGroups.length + 1;
    while (existingGroups.some((group) => group.name === `${displayCategory} ${nextNumber}`)) nextNumber += 1;
    const name = REPEATABLE_GROUPS.includes(newGroupCategory) ? `${displayCategory} ${nextNumber}` : newGroupCategory;
    const group = { id: crypto.randomUUID(), category: newGroupCategory, name };
    setManualGroups((current) => [...current, group]); setActiveGroupId(group.id); setNotice(`已新建并选中「${name}」，请按提示上传这一组的材料`);
  }
  function selectDisplayedGroup(category: string, journey: string) {
    if (activeStep !== 0) return;
    const name = journey || category;
    const existing = manualGroups.find((group) => group.category === category && group.name === name);
    if (existing) setActiveGroupId(existing.id);
    else { const group = { id: crypto.randomUUID(), category, name }; setManualGroups((current) => [...current, group]); setActiveGroupId(group.id); }
    setNotice(`已选中「${name}」，接下来上传的材料都会进入此类`);
  }
  function deleteGroup(category: string, journey: string, count: number) {
    setDeleteTarget({ category, journey, count });
  }
  function confirmDeleteGroup() {
    if (!deleteTarget) return;
    const { category, journey } = deleteTarget;
    if (!UPLOAD_GUIDE.slice(1).some(step => step.category === category)) setTicketsComplete(false); const target = manualGroups.find((group) => group.category === category && group.name === journey);
    setManualGroups((current) => current.filter((group) => !(group.category === category && group.name === journey))); setItems((current) => current.filter((item) => !(item.category === category && (item.journey || item.category) === journey))); if (target?.id === activeGroupId) setActiveGroupId(""); setNotice(`已删除「${journey || category}」大类`); setDeleteTarget(null);
  }
  function update(id: string, patch: Partial<DocItem>) { if (items.some(item => item.id === id && !UPLOAD_GUIDE.slice(1).some(step => step.category === item.category))) setTicketsComplete(false); setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item)); }
  function changeMaterial(item: DocItem, title: string) {
    const next = { ...item, title };
    update(item.id, { title, ...(!isInvoice(next) ? { amount: "", recognition: undefined } : {}) });
    if (isInvoice(next) && !next.amount) void recognizeInvoice(next);
  }
  function move(fromId: string, toId: string) {
    setItems((current) => { const from = current.findIndex((x) => x.id === fromId); const to = current.findIndex((x) => x.id === toId); if (from < 0 || to < 0 || from === to) return current; const next = [...current]; const [picked] = next.splice(from, 1); next.splice(to, 0, picked); return next; });
  }
  function isFileDrag(e: DragEvent) { return Array.from(e.dataTransfer.types).includes("Files"); }
  function onPageDragEnter(e: DragEvent<HTMLElement>) { if (!isFileDrag(e)) return; e.preventDefault(); dragDepth.current += 1; setPageDragging(true); }
  function onPageDragOver(e: DragEvent<HTMLElement>) { if (!isFileDrag(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }
  function onPageDragLeave(e: DragEvent<HTMLElement>) { if (!isFileDrag(e)) return; e.preventDefault(); dragDepth.current -= 1; if (dragDepth.current <= 0) { dragDepth.current = 0; setPageDragging(false); } }
  function onPageDrop(e: DragEvent<HTMLElement>) { if (!isFileDrag(e)) return; e.preventDefault(); dragDepth.current = 0; setPageDragging(false); addFiles(e.dataTransfer.files); }
  function downloadRenamed(item: DocItem, index: number) {
    const url = URL.createObjectURL(item.file); const a = document.createElement("a"); a.href = url; a.download = formatFilename(item, index, items); a.click(); URL.revokeObjectURL(url); setNotice(`已下载：${formatFilename(item, index, items)}`);
  }
  function exportProblem() {
    if (!items.length) return "请先上传报销材料";
    if (!ticketsComplete) return "请返回第一步核对票据，并重新确认金额汇总";
    if (recognizing || pendingInvoices) return "请等待金额识别完成，并补齐未识别的发票金额后再导出";
    if (!claimCurrent) return "请返回第二步，根据最新信息和票据金额重新生成清单";
    if (!items.some(x => x.category === "差旅报销审核单")) return "请上传差旅报销审核单后再导出";
    return "";
  }
  async function downloadMaterials() {
    if (archiving || exporting) return;
    const problem = exportProblem(); if (problem) { setNotice(problem); return; }
    const ordered = exportOrder(items);
    setArchiving(true); setNotice("正在整理备份材料…");
    try {
      const mergedPdf = await buildMergedPdf(true);
      if (!mergedPdf) return;
      const { createMaterialsArchive } = await import("./materials-archive");
      const entries = [...ordered.map((item, index) => ({ file: item.file as Blob, name: formatFilename(item, index, ordered) })), { file: mergedPdf, name: "合并报销材料.pdf" }];
      const blob = await createMaterialsArchive(entries, (done, total) => setNotice(done === total ? `正在压缩 ${total} 份材料…` : `正在读取材料 ${done} / ${total}…`));
      const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `报销材料备份_${date}.zip`; anchor.style.display = "none";
      document.body.appendChild(anchor); anchor.click();
      window.setTimeout(() => { anchor.remove(); URL.revokeObjectURL(url); }, 60000);
      setNotice(`已发起备份下载：包含 ${ordered.length} 份按顺序编号的材料和 1 份合并 PDF`);
    } catch { setNotice("材料打包失败，请重试。未生成不完整的备份包。"); }
    finally { setArchiving(false); }
  }
  async function buildMergedPdf(requireComplete = false) {
    const problem = exportProblem(); if (problem) { setNotice(problem); return; }
    setExporting(true); setNotice("正在合并材料，请稍候…");
    try {
      const { blob, pageCount, skipped } = await mergeMaterials(items, requireComplete);
      setNotice(skipped.length ? `PDF 已生成，共 ${pageCount} 页；已跳过 ${skipped.length} 个无法读取的文件：${skipped.slice(0, 2).join("、")}${skipped.length > 2 ? "…" : ""}` : `PDF 已生成，共 ${pageCount} 页`); return blob;
    } catch (error) { setNotice(error instanceof Error ? error.message : "PDF 生成失败，请重试"); return undefined; } finally { setExporting(false); }
  }
  async function showPdfPreview(blob: Blob) {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    const nextUrl = URL.createObjectURL(blob);
    setPdfUrl(nextUrl); setPdfBlob(blob); setPdfPages([]); setPreviewError(""); setPreviewLoading(true);
    try {
      const pdfjs = await pdfEngine();
      const document = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), ...pdfOptions() }).promise;
      for (let index = 1; index <= document.numPages; index += 1) {
        const page = await document.getPage(index);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = window.document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建预览画布");
        await page.render({ canvasContext: context, canvas, viewport }).promise;
        setPdfPages((current) => [...current, canvas.toDataURL("image/jpeg", 0.9)]);
        page.cleanup();
      }
    } catch { setPreviewError("页面预览暂时无法显示，但仍可以直接下载 PDF。"); }
    finally { setPreviewLoading(false); }
  }
  async function previewPdf() { const blob = await buildMergedPdf(); if (blob) await showPdfPreview(blob); }
  function savePdf(blob: Blob | null = pdfBlob) {
    if (!blob) { setNotice("请先生成 PDF"); return false; }
    const filename = `报销材料_${new Date().toISOString().slice(0, 10)}.pdf`;
    try {
      const legacyNavigator = window.navigator as Navigator & { msSaveOrOpenBlob?: (blob: Blob, filename: string) => boolean };
      if (legacyNavigator.msSaveOrOpenBlob) {
        legacyNavigator.msSaveOrOpenBlob(blob, filename);
      } else {
        const downloadFile = new File([blob], filename, { type: "application/octet-stream" });
        const downloadUrl = URL.createObjectURL(downloadFile);
        const anchor = window.document.createElement("a");
        anchor.href = downloadUrl;
        anchor.download = filename;
        anchor.target = "_self";
        anchor.style.display = "none";
        window.document.body.appendChild(anchor);
        anchor.click();
        window.setTimeout(() => { anchor.remove(); URL.revokeObjectURL(downloadUrl); }, 60_000);
      }
      setNotice(`合并 PDF 已下载到本地：${filename}`);
      return true;
    } catch {
      setNotice("PDF 下载失败，请检查浏览器是否限制了文件下载，然后重试");
      return false;
    }
  }
  async function downloadPdf() {
    const blob = await buildMergedPdf();
    if (blob) savePdf(blob);
  }
  function closePreview() { if (pdfUrl) URL.revokeObjectURL(pdfUrl); setPdfUrl(""); setPdfBlob(null); setPdfPages([]); setPreviewError(""); }

  return <main onDragEnter={onPageDragEnter} onDragOver={onPageDragOver} onDragLeave={onPageDragLeave} onDrop={onPageDrop}>
    {orderWarning && <div className="order-warning-modal" role="alertdialog" aria-modal="true" aria-labelledby="order-warning-title" aria-describedby="order-warning-description"><div className="order-warning-card"><div className="order-warning-icon" aria-hidden="true">!</div><span className="order-warning-eyebrow">当前操作无法继续</span><h2 id="order-warning-title">请先上传前面的材料</h2><p id="order-warning-description">报销材料必须按顺序添加，完成前置步骤后才能继续。</p><div className="order-warning-required"><span>必须先完成第 {String(uploadStepIndex(orderWarning.category) + 1).padStart(2, "0")} 步</span><strong>{orderWarning.title}</strong></div><small>{orderWarning.message}</small><footer><button type="button" className="order-warning-cancel" onClick={() => setOrderWarning(null)}>我知道了</button><button type="button" className="order-warning-upload" onClick={() => { const category = orderWarning.category; setOrderWarning(null); startGuidedUpload(category); }}>立即上传{orderWarning.title}</button></footer></div></div>}
    {deleteTarget && <div className="confirm-modal" role="dialog" aria-modal="true"><div><span>删除大类</span><h3>确定删除“{deleteTarget.journey || deleteTarget.category}”吗？</h3><p>{deleteTarget.count ? `其中的 ${deleteTarget.count} 份材料也会同时移除。` : "这是一个空大类，可以直接删除。"}</p><footer><button type="button" onClick={() => setDeleteTarget(null)}>取消</button><button type="button" className="danger" onClick={confirmDeleteGroup}>确认删除</button></footer></div></div>}
    {pdfUrl && <div className="pdf-modal" role="dialog" aria-modal="true"><div className="pdf-modal-card"><header><div><strong>合并 PDF 预览</strong><small>{pdfPages.length ? `已显示 ${pdfPages.length} 页，确认顺序后即可下载` : "正在生成可浏览的页面预览"}</small></div><button type="button" onClick={closePreview}>×</button></header><div className="pdf-pages" aria-live="polite">{pdfPages.map((page, index) => <figure className="pdf-preview-page" key={index}><img src={page} alt={`合并 PDF 第 ${index + 1} 页`} /><figcaption>第 {index + 1} 页</figcaption></figure>)}{previewLoading && <div className="pdf-preview-status"><span className="pdf-spinner" />正在渲染第 {pdfPages.length + 1} 页…</div>}{previewError && <div className="pdf-preview-status error">{previewError}</div>}</div><footer><button type="button" className="secondary" onClick={closePreview}>关闭预览</button><button type="button" className="pdf-download" onClick={() => savePdf()}>下载 PDF</button></footer></div></div>}
    {pageDragging && <div className="page-drop-overlay"><div><span>⇩</span><strong>松开鼠标，添加报销材料</strong><small>整个页面都可以接收 PDF、JPG 和 PNG</small></div></div>}
    <header className="topbar"><div className="brand"><span className="brandmark">票</span><span>报销材料整理助手</span></div><div className="privacy"><span>●</span> 文件仅在本地处理，不会上传服务器</div></header>
    <div className="record-editor-bar"><div><button type="button" className="secondary" disabled={!!recognizing || generatingClaim || exporting || archiving || leaving} onClick={returnToList}>{leaving ? "正在保存…" : "返回报销列表"}</button><strong>{initial.name}</strong></div><div className={saveError ? "local-save-error" : "local-save-status"} role="status">{saveState}{saveError && <button type="button" onClick={() => void persistLatest()}>重试保存</button>}</div></div>
    <div className="step-layout" inert={leaving || undefined}>
      <nav className="step-sidebar" aria-label="报销步骤导航">
        <div className="steps-label">整理进度 <span>{guideCompleted} / 3 已完成</span></div>
        {guideSteps.map((step, index) => <button type="button" key={step.title} className={`step-nav-item ${activeStep === index ? "active" : ""} ${step.complete ? "done" : ""}`} aria-current={activeStep === index ? "step" : undefined} onClick={() => goToStep(index)}><span className="step-nav-number">{step.complete ? "✓" : String(index + 1).padStart(2, "0")}</span><span><strong>{step.title}</strong><small>{activeStep === index ? "当前步骤" : step.complete ? "已完成 · 点击修改" : "待完成"}</small></span></button>)}
        <p>点击步骤可切换界面，返回修改时已上传的材料会保留。</p>
      </nav>
      <div className="step-main">
    <section className="workspace" aria-labelledby="step-page-title">
      <header className="step-page-header"><span>第 {activeStep + 1} 步 / 共 3 步</span><h1 id="step-page-title">{UPLOAD_GUIDE[activeStep].title}</h1><p>{UPLOAD_GUIDE[activeStep].description}</p></header>
      {activeStep > 0 && <div className="step-totals"><span>住宿 <strong>¥{accommodationTotal.toFixed(2)}</strong></span><span>交通 <strong>¥{transportTotal.toFixed(2)}</strong></span><span>合计 <strong>¥{(accommodationTotal + transportTotal).toFixed(2)}</strong></span><button type="button" onClick={() => goToStep(0)}>返回核对金额</button></div>}
      {activeStep > 0 && !ticketsComplete && <p className="step-alert">票据金额尚未确认，请返回第一步确认后再上传。</p>}
      {activeStep === 2 && !guideSteps[1].complete && <p className="step-alert">请先在第二步填写信息并生成最新的差旅费报销清单。</p>}
      {activeStep === 0 && <div className="add-category-bar"><label htmlFor="new-category">添加大类</label><select ref={groupCategoryRef} id="new-category" value={newGroupCategory} onChange={(e) => setNewGroupCategory(e.target.value)}>{CATEGORIES.filter(category => !["差旅报销审核单", "差旅费报销清单"].includes(category)).map((category) => <option key={category} value={category}>{category === "酒店" ? "住宿" : category}</option>)}</select><button type="button" onClick={addManualGroup}>确认添加</button><span>住宿、飞机、高铁、打车都可以重复添加</span></div>}
      <input ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.currentTarget.value = ""; }} />
      {activeStep !== 1 && <div className="toolbar"><div><strong>{activeStep === 0 ? "材料清单" : "已上传文件"}</strong><span>{visibleCount} 份文件{activeStep === 0 ? ` · ${visibleGroups.length} 个类别` : ""}</span></div>{activeStep === 2 && <><button type="button" className="secondary preview-btn" onClick={previewPdf} disabled={!guideSteps[2].complete || !claimCurrent || exporting || archiving}>预览 PDF</button><button type="button" className="primary" onClick={downloadPdf} disabled={!guideSteps[2].complete || !claimCurrent || exporting || archiving}>{exporting ? "正在合并…" : "下载合并 PDF"}</button><button type="button" className="secondary" onClick={downloadMaterials} disabled={!guideSteps[2].complete || !claimCurrent || exporting || archiving}>{archiving ? "正在打包…" : "下载报销材料"}</button></>}</div>}
      {notice && <div className={`notice ${warningNotice ? "warning" : ""}`} role={warningNotice ? "alert" : "status"}>{warningNotice ? "⚠" : "✓"} {notice}</div>}
      {activeStep === 1 ? <TripClaimForm onBusy={setGeneratingClaim} value={tripForm} onChange={setTripForm} transport={transportTotal} accommodation={accommodationTotal} confirmed={ticketsComplete} current={claimCurrent} preview={generatedClaim?.preview} onGenerated={saveGeneratedClaim} onDownload={() => { if (generatedClaim) downloadRenamed(generatedClaim, items.indexOf(generatedClaim)); }} /> : visibleGroups.length ? <div className="list grouped-list">{visibleGroups.map((group, groupIndex) => { const selected = activeGroup?.category === group.category && activeGroup.name === group.journey; const requiredMaterials = REQUIRED_MATERIALS[group.category] || []; const missingMaterials = requiredMaterials.filter((material) => !hasRequiredMaterial(group.docs, material)); return <section className={`material-group ${selected ? "selected-group" : ""}`} key={`${group.category}-${group.journey}`}>
        <div className={`group-heading ${TRANSPORT.includes(group.category) ? "transport" : ""}`} onClick={() => selectDisplayedGroup(group.category, group.journey)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && selectDisplayedGroup(group.category, group.journey)}><span className="group-no">{String(groupIndex + 1).padStart(2, "0")}</span><div><small>{activeStep > 0 ? "本步骤材料" : selected ? "已选中 · 新材料将进入此类" : TRANSPORT.includes(group.category) ? "交通材料 / 点击选中" : group.category === "酒店" ? "住宿材料 / 点击选中" : "报销材料 / 点击选中"}</small><strong>{group.journey && group.journey !== group.category ? group.journey : group.category}</strong></div><em>{group.docs.length} 份{REPEATABLE_GROUPS.includes(group.category) && ` · ¥${totalAmount(group.docs).toFixed(2)}`}</em><button type="button" className="delete-group" aria-label="删除大类" onClick={(e) => { e.stopPropagation(); deleteGroup(group.category, group.journey, group.docs.length); }}>删除</button></div>
        {requiredMaterials.length > 0 && <div className={`material-requirements ${missingMaterials.length ? "incomplete" : "complete"}`}><div className="requirements-header"><strong>{group.category === "酒店" ? "住宿" : group.category}报销需要上传以下 {requiredMaterials.length} 项材料</strong><span>{missingMaterials.length ? `还缺 ${missingMaterials.length} 项：${missingMaterials.join("、")}` : "全部材料已上传 ✓"}</span></div><div className="requirements-list">{requiredMaterials.map((material) => { const uploaded = hasRequiredMaterial(group.docs, material); return <span className={`requirement-item ${uploaded ? "uploaded" : "missing"}`} key={material}><b>{uploaded ? "✓" : "+"}</b>{material}<small>{uploaded ? "已上传" : "待上传"}</small></span>; })}</div></div>}
        <div className="group-docs">{group.docs.map((item) => { const index = items.findIndex((x) => x.id === item.id); return <article className={`file-row ${dragId === item.id ? "dragging" : ""}`} key={item.id} draggable onDragStart={() => setDragId(item.id)} onDragEnd={() => setDragId(null)} onDragOver={(e) => e.preventDefault()} onDrop={() => dragId && move(dragId, item.id)}>
        <div className="handle" title="拖动排序">⋮⋮</div><div className={`thumb ${item.preview ? "image" : "pdf"}`}>{item.preview ? <img src={item.preview} alt="材料预览" /> : <><span>PDF</span><b>{index + 1}</b></>}</div>
        <div className="file-main"><div className="auto-label"><span>自动命名</span><button onClick={(e) => { e.stopPropagation(); downloadRenamed(item, index); }}>下载此文件</button></div><div className="generated-name">{formatFilename(item, index, items)}</div><div className="original-name">原文件：{item.file.name}</div></div>
        <label>材料名称{MATERIAL_OPTIONS[item.category] ? <select aria-label={`${item.file.name}的材料名称`} value={MATERIAL_OPTIONS[item.category].includes(item.title) ? item.title : ""} onChange={(e) => changeMaterial(item, e.target.value)}><option value="" disabled>请选择材料</option>{MATERIAL_OPTIONS[item.category].map(name => <option key={name} value={name}>{name}</option>)}</select> : <input value={item.title} onChange={(e) => update(item.id, { title: e.target.value })} />}</label>
        <label className="amount">金额（元）<input inputMode="decimal" placeholder={isInvoice(item) ? "待识别 / 手动填写" : "不计入汇总"} disabled={!isInvoice(item)} value={item.amount} onChange={(e) => { const value = e.target.value; if (/^\d*(?:\.\d{0,2})?$/.test(value)) update(item.id, { amount: value }); }} />{isInvoice(item) && <small>{item.recognition || "请核对发票金额"}<button type="button" disabled={!!recognizing} onClick={() => void recognizeInvoice(item)}>重新识别</button></small>}</label>
        <button className="remove" aria-label="删除文件" onClick={() => removeItem(item)}>×</button>
      </article>; })}</div><button type="button" className="group-upload-hint" onClick={() => { selectDisplayedGroup(group.category, group.journey); chooseFiles(); }}><span aria-hidden="true">＋</span>{activeStep === 0 ? "拖拽材料到页面，或点击上传到此类别" : "拖拽文件到页面，或点击继续上传"}</button></section>; })}</div> : <div className="empty upload-guide" role="button" tabIndex={0} onClick={() => activeStep === 0 ? startGuidedUpload("") : chooseFiles()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (activeStep === 0) startGuidedUpload(""); else chooseFiles(); } }}>
        <span className="upload-guide-icon" aria-hidden="true">⇧</span>
        <h2>{activeStep === 0 ? "先创建报销类别，再上传票据" : `拖拽${UPLOAD_GUIDE[activeStep].title}到这里，或点击上传`}</h2>
        <p>{activeStep === 0 ? "在上方添加住宿、飞机、高铁或打车类别，再拖拽材料到页面，或在类别内点击上传。" : "上传后可在此查看、删除并重新上传文件。"}</p>
        <small>支持 PDF、JPG、PNG，可一次添加多份</small>
      </div>}
      {activeStep === 0 && <section className="amount-summary" aria-label="报销金额汇总"><div><span>住宿总金额</span><strong>¥{accommodationTotal.toFixed(2)}</strong></div><div><span>交通总金额（飞机、高铁、打车）</span><strong>¥{transportTotal.toFixed(2)}</strong></div><div><span>合计</span><strong>¥{(accommodationTotal + transportTotal).toFixed(2)}</strong></div><p>仅统计发票金额，支付截图不重复计费。每份发票单独填写金额，多张发票自动相加。{recognizing > 0 ? `正在识别 ${recognizing} 份发票…` : pendingInvoices > 0 ? `还有 ${pendingInvoices} 份发票待填写金额。` : "请核对识别结果。"}</p><button type="button" disabled={!!recognizing || !!pendingInvoices || !items.some(x => REPEATABLE_GROUPS.includes(x.category))} onClick={() => { setTicketsComplete(true); goToStep(1); }}>确认金额，进入第二步</button></section>}
      {activeStep > 0 && <div className="step-page-actions"><button type="button" className="secondary" onClick={() => goToStep(activeStep - 1)}>返回上一步</button>{activeStep === 1 && <button type="button" className="primary" disabled={!ticketsComplete || !guideSteps[1].complete} onClick={() => goToStep(2)}>清单已生成，进入第三步</button>}</div>}
      {activeStep === 2 && <p className="export-note">PDF 顺序：差旅报销审核单 → 差旅费报销清单 → 其余材料按上传顺序。备份压缩包包含按相同顺序编号的材料及合并 PDF。</p>}

    </section>
    {activeStep === 0 && <aside className="rule-card"><div><span>各类别材料提示</span><strong>上传后自动核对</strong></div><ol><li><b>住</b> 酒店：发票、酒店水单、支付截图</li><li><b>✈</b> 飞机 / 高铁：发票、支付截图</li><li><b>●</b> 打车：发票、行程单、支付截图</li></ol></aside>}
      </div>
    </div>
    <footer>报销材料整理助手 · 所有处理均在当前浏览器内完成</footer>
  </main>;
}
