export type TripForm = {
  traveler: string; department: string; rank: string; purpose: string; company: string; product: string;
  startDate: string; endDate: string; origin: string; destination: string;
  transport: string; transportStandard: string; hotelStandard: string; dailyAllowance: string; otherExpense: string;
};
export const TRANSPORT_STANDARDS: Record<string, string[]> = {
  飞机: ['经济舱', '超级经济舱', '商务舱', '头等舱'], 高铁: ['二等座', '一等座', '商务座'],
  火车: ['硬座', '硬卧', '软卧'], 打车: ['经济型', '舒适型', '商务型', '据实报销'],
  汽车: ['普通客车', '据实报销'], 其他: ['据实报销'],
};
export const EMPTY_TRIP: TripForm = { traveler: '', department: '', rank: '', purpose: '', company: '', product: '', startDate: '', endDate: '', origin: '', destination: '', transport: '飞机', transportStandard: '经济舱', hotelStandard: '', dailyAllowance: '', otherExpense: '0' };
export function tripDays(start: string, end: string) {
  const parse = (value: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN; const time = Date.parse(`${value}T00:00:00Z`); return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN; };
  const days = (parse(end) - parse(start)) / 86400000 + 1;
  return Number.isFinite(days) && days >= 1 ? days : 0;
}
export function claimTotals(form: TripForm, transport: number, accommodation: number) {
  const days = tripDays(form.startDate, form.endDate);
  const cents = (value: string | number) => Math.round((Number(value) || 0) * 100);
  const allowance = days * cents(form.dailyAllowance);
  const other = cents(form.otherExpense);
  return { days, transport, accommodation, allowance: allowance / 100, other: other / 100, total: (cents(transport) + cents(accommodation) + allowance + other) / 100 };
}
export function validateTrip(form: TripForm) {
  const fields: [keyof TripForm, string][] = [['traveler','出差人'],['department','部门'],['rank','职级'],['purpose','出差事由'],['company','项目 / 公司名称'],['origin','出发地点'],['destination','到达地点']];
  for (const [key, label] of fields) if (!form[key].trim()) return `请填写${label}`;
  if (!tripDays(form.startDate, form.endDate)) return '请填写有效的起止日期，结束日期不能早于开始日期';
  for (const [key, label] of [['hotelStandard','住宿标准'],['dailyAllowance','每日补助标准'],['otherExpense','其他费用']] as const) {
    if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(form[key])) return `请填写有效的${label}（非负金额，最多两位小数）`;
  }
  if (!TRANSPORT_STANDARDS[form.transport]?.includes(form.transportStandard)) return '请选择交通工具和对应标准';
  return '';
}
export type ClaimExpenseLine = { category: string; name: string; date: string; endDate: string; location: string; originalAmount: number; amount: number };
const CLAIM_WIDTH = 2400;
const CLAIM_ROW_START = 550;
const CLAIM_FONT = '"ClaimSerif", "Noto Serif CJK SC", "Songti SC", SimSun, serif';
const CLAIM_COLUMNS = [320,140,290,160,180,185,195,165,165,165,155,200];
function claimRows(form: TripForm, transport: number, accommodation: number, lines?: ClaimExpenseLine[]) {
  const totals = claimTotals(form,transport,accommodation), money = (value:number)=>value.toFixed(2);
  if (!lines) return [[`${form.startDate}\n至 ${form.endDate}`,String(totals.days),`${form.origin}—${form.destination}`,form.transport,form.transportStandard,money(Number(form.hotelStandard)),money(Number(form.dailyAllowance)),money(transport),money(accommodation),money(totals.allowance),money(totals.other),money(totals.total)]];
  const rows = lines.map(line => {
    const hotel = line.category === '酒店';
    return [line.endDate && line.endDate !== line.date ? `${line.date}\n至 ${line.endDate}` : line.date, '—', line.location, line.name,
      hotel ? '—' : line.category === form.transport ? form.transportStandard : '据实报销',
      hotel ? money(Number(form.hotelStandard)) : '—', '—', money(hotel ? 0 : line.amount), money(hotel ? line.amount : 0), '0.00','0.00',money(line.amount)];
  });
  rows.push([`${form.startDate}\n至 ${form.endDate}`,String(totals.days),`${form.origin}—${form.destination}`,'出差补助','—','—',money(Number(form.dailyAllowance)),'0.00','0.00',money(totals.allowance),'0.00',money(totals.allowance)]);
  if (totals.other>0) rows.push(['—','—','—','其他费用','—','—','—','0.00','0.00','0.00',money(totals.other),money(totals.other)]);
  return rows;
}
export function claimLayout(ctx: CanvasRenderingContext2D, form: TripForm, transport:number, accommodation:number, lines?:ClaimExpenseLine[]) {
  ctx.font = `24px ${CLAIM_FONT}`;
  const rows = claimRows(form,transport,accommodation,lines).map(values => {
    const lineCounts = values.map((text,index)=>{
      let count=1, line='';
      for (const character of text) {
        if (character==='\n' || (line && ctx.measureText(line+character).width>CLAIM_COLUMNS[index]-24)) {count++;line=character==='\n' ? '' : character;}
        else line+=character;
      }
      return count;
    });
    return {values,height:Math.max(83,Math.ceil(Math.max(...lineCounts)*24*1.4+20))};
  });
  const totalY = CLAIM_ROW_START + rows.reduce((sum,row)=>sum+row.height,0);
  return {width:CLAIM_WIDTH,height:totalY+200,totalY,rows};
}
export function claimRasterSize(width:number,height:number) {
  // Keep the entire table even when its logical height exceeds a browser canvas limit.
  const scale = Math.min(1,16000/Math.max(width,height),Math.sqrt(24000000/(width*height)));
  return {width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale)),scale};
}
export function fitClaimToA4(width:number,height:number) {
  const sizes: [number,number][] = [[841.89,595.28],[595.28,841.89]];
  const [pageWidth,pageHeight] = sizes.reduce((best,size)=>Math.min((size[0]-24)/width,(size[1]-24)/height)>Math.min((best[0]-24)/width,(best[1]-24)/height)?size:best);
  const scale = Math.min((pageWidth-24)/width,(pageHeight-24)/height);
  const drawnWidth=width*scale, drawnHeight=height*scale;
  return {pageSize:[pageWidth,pageHeight] as [number,number],x:(pageWidth-drawnWidth)/2,y:(pageHeight-drawnHeight)/2,width:drawnWidth,height:drawnHeight};
}
// Shared browser / test renderer. All user strings are drawn as text, never HTML.
export function drawClaim(ctx: CanvasRenderingContext2D, form: TripForm, transport: number, accommodation: number, lines?: ClaimExpenseLine[]) {
  const totals = claimTotals(form, transport, accommodation);
  const layout = claimLayout(ctx,form,transport,accommodation,lines);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, layout.width, layout.height);
  const font = CLAIM_FONT;
  const cell = (x: number, y: number, w: number, h: number, text: string, align: 'left' | 'center' = 'center', bold = false, size = 30) => {
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h);
    const wrap = (fontSize: number) => {
      ctx.font = `${bold ? 'bold ' : ''}${fontSize}px ${font}`;
      const lines: string[] = []; let line = '';
      for (const character of text) { if (character === '\n' || (line && ctx.measureText(line + character).width > w - 24)) { lines.push(line); line = character === '\n' ? '' : character; } else line += character; }
      if (line) lines.push(line); return lines;
    };
    let lines = wrap(size);
    while (lines.length * size * 1.4 > h - 16 && size > 18) { size -= 1; lines = wrap(size); }
    if (lines.length * size * 1.4 > h - 16) throw new Error('部分内容过长，请缩短出差事由或地点后重新生成');
    ctx.fillStyle = '#111'; ctx.textAlign = align; ctx.textBaseline = 'middle';
    lines.forEach((line, i) => ctx.fillText(line, align === 'left' ? x + 12 : x + w / 2, y + h / 2 + (i - (lines.length - 1) / 2) * size * 1.4));
  };
  ctx.fillStyle = '#111'; ctx.font = `bold 44px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('差旅费报销清单', 1200, 90);
  const x = 40, y = 150;
  cell(x,y,850,92,`出差人：${form.traveler}`,'left'); cell(x+850,y,850,92,`部门：${form.department}`,'left'); cell(x+1700,y,620,92,`职级：${form.rank}`,'left');
  cell(x,y+92,850,142,`出差事由：${form.purpose}`,'left'); cell(x+850,y+92,850,142,`项目/公司名称：${form.company}`,'left'); cell(x+1700,y+92,620,142,`产品名称：${form.product || '—'}`,'left');
  const widths = CLAIM_COLUMNS;
  const xs = [x]; widths.forEach(width => xs.push(xs[xs.length-1]+width));
  const headerY = y+234;
  ['起止日期','出差天数','起止地点'].forEach((label,i)=>cell(xs[i],headerY,widths[i],166,label,'center',false,26));
  cell(xs[3],headerY,xs[7]-xs[3],70,'出差标准'); cell(xs[7],headerY,xs[12]-xs[7],70,'实际报销金额','center',true);
  [lines ? '费用类别/\n交通工具' : '交通工具','交通工具\n标准','住宿标准\n（每晚）','出差补助标准\n（每天）','交通费','住宿费','出差补助','其他','合计'].forEach((label,i)=>cell(xs[i+3],headerY+70,widths[i+3],96,label));
  const money = (v: number) => v.toFixed(2);
  let rowY = CLAIM_ROW_START;
  for (const row of layout.rows) {
    row.values.forEach((value,index)=>cell(xs[index],rowY,widths[index],row.height,value,'center',index===11,24));
    rowY += row.height;
  }
  const totalY = layout.totalY;
  cell(x,totalY,xs[7]-x,100,'报销金额合计','center',true,34);
  [transport,accommodation,totals.allowance,totals.other,totals.total].forEach((value,i)=>cell(xs[i+7],totalY,widths[i+7],100,money(value),'center',i===4,30));
  ctx.font = `24px ${font}`; ctx.textAlign = 'left'; ctx.fillText(`金额单位：元；出差补助按整次出差起止日期计算，含出发日和返程日。`,x,totalY+160);
}
