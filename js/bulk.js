// 批量导入：读取 Excel（.xlsx）或 CSV，按「批次名称」把行合并成批次 + 任务，先预览再写入。
// 零依赖：.xlsx 用浏览器自带的 DecompressionStream 解压，CSV 自动识别 UTF-8 / GBK（Excel 中文版默认存 GBK）。
import { TYPES, TYPE_ORDER, addDays, diffDays, isDate, maxDate, templateTasks } from './core.js';

export const TEMPLATE_XLSX = 'templates/lab-planner-import-template.xlsx';
export const TEMPLATE_CSV = 'templates/lab-planner-import-template.csv';

// 列名 → 字段。表头里的 *、括号说明、空格都会被忽略，只看开头的列名
const COLS = [
  ['name', '批次名称'],
  ['type', '类型'],
  ['species', '物种'],
  ['start', '开始日期'],
  ['qty', '数量'],
  ['unit', '单位'],
  ['location', '位置'],
  ['medium', '培养基'],
  ['note', '备注'],
  ['task', '任务名称'],
  ['every', '间隔天数'],
  ['next', '下次日期'],
  ['lead', '提前提醒天数'],
  ['prep', '提前准备内容'],
  ['mode', '排法'],
  ['countGen', '记录代数'],
  ['gen0', '当前代数'],
];
const BATCH_FIELDS = ['type', 'species', 'start', 'qty', 'unit', 'location', 'medium', 'note'];
const SKIP_SHEETS = /^(示例|说明|填写说明|example|readme)$/i;

const TYPE_ALIAS = {
  实生苗: 'seedling', 播种: 'seedling', 幼苗: 'seedling',
  愈伤扩繁: 'callus', 愈伤: 'callus', 愈伤组织: 'callus',
  组培苗扩繁: 'shoot', 扩繁: 'shoot', 组培苗: 'shoot', 丛生芽: 'shoot',
  组培苗生根: 'rooting', 生根: 'rooting',
  其他: 'other', 其它: 'other',
};
for (const k of TYPE_ORDER) TYPE_ALIAS[k] = k;

// ───────────── 读取文件 → 二维数组 ─────────────

export async function readTable(file) {
  const buf = await file.arrayBuffer();
  const u8 = new Uint8Array(buf);
  const isZip = u8[0] === 0x50 && u8[1] === 0x4b;
  if (isZip) return readXlsx(buf);
  if (/\.xls$/i.test(file.name)) throw new Error('这是旧版 .xls 格式：请在 Excel 里「另存为」.xlsx 或 CSV 再导入');
  return parseCsv(decodeText(u8));
}

function decodeText(u8) {
  let s;
  try {
    s = new TextDecoder('utf-8', { fatal: true }).decode(u8);
  } catch {
    s = new TextDecoder('gbk').decode(u8); // Windows 版 Excel「CSV（逗号分隔）」是 GBK 编码
  }
  return s.replace(/^﻿/, '');
}

export function parseCsv(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [',', '\t', ';', '，'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** 极简 zip 读取：只解析中央目录，按需解压单个文件 */
function unzip(buf) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('文件已损坏，或不是 Excel 文件');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const files = {};
  for (let k = 0; k < count && dv.getUint32(p, true) === 0x02014b50; k++) {
    const nlen = dv.getUint16(p + 28, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    files[name] = { method: dv.getUint16(p + 10, true), size: dv.getUint32(p + 20, true), off: dv.getUint32(p + 42, true) };
    p += 46 + nlen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return async (name) => {
    const f = files[name.replace(/^\//, '')];
    if (!f) return null;
    const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
    const data = u8.subarray(start, start + f.size);
    if (f.method === 0) return dec.decode(data);
    if (f.method !== 8) throw new Error('Excel 文件的压缩格式不支持：请另存为 CSV 再导入');
    if (typeof DecompressionStream === 'undefined') throw new Error('这个浏览器版本太旧，读不了 Excel：请另存为 CSV（UTF-8）再导入，或更新浏览器');
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  };
}

const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
const tags = (node, name) => [...node.getElementsByTagNameNS('*', name)];
const colIndex = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

async function readXlsx(buf) {
  const read = unzip(buf);
  const shared = [];
  const ss = await read('xl/sharedStrings.xml');
  if (ss) {
    for (const si of tags(xml(ss), 'si')) shared.push(tags(si, 't').filter((t) => t.parentNode.localName !== 'rPh').map((t) => t.textContent).join(''));
  }
  const wb = xml((await read('xl/workbook.xml')) || '');
  const rels = xml((await read('xl/_rels/workbook.xml.rels')) || '');
  const target = {};
  for (const r of tags(rels, 'Relationship')) target[r.getAttribute('Id')] = r.getAttribute('Target');
  let fallback = null;
  for (const sh of tags(wb, 'sheet')) {
    if (SKIP_SHEETS.test((sh.getAttribute('name') || '').trim())) continue;
    const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const t = target[rid];
    if (!t) continue;
    const path = t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '');
    const src = await read(path);
    if (!src) continue;
    const rows = [];
    for (const r of tags(xml(src), 'row')) {
      const ri = (parseInt(r.getAttribute('r'), 10) || rows.length + 1) - 1;
      const row = (rows[ri] = []);
      for (const c of tags(r, 'c')) {
        const ref = c.getAttribute('r');
        const ci = ref ? colIndex(ref) : row.length;
        const type = c.getAttribute('t');
        const v = tags(c, 'v')[0];
        let val = '';
        if (type === 's') val = shared[parseInt(v && v.textContent, 10)] ?? '';
        else if (type === 'inlineStr') val = tags(c, 't').map((t) => t.textContent).join('');
        else if (type === 'b') val = v && v.textContent === '1' ? '是' : '否';
        else val = v ? v.textContent : '';
        row[ci] = val;
      }
    }
    for (let i = 0; i < rows.length; i++) rows[i] = Array.from(rows[i] || [], (x) => x ?? '');
    if (findHeader(rows) >= 0) return rows;
    fallback = fallback || rows;
  }
  return fallback || [];
}

// ───────────── 二维数组 → 导入计划 ─────────────

const norm = (s) => String(s ?? '').replace(/[\s*＊]/g, '').replace(/[（(【[].*$/, '');

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) if ((rows[i] || []).some((c) => norm(c) === '批次名称')) return i;
  return -1;
}

/** 日期：2026-10-06、2026/10/6、2026.10.6、2026年10月6日，或 Excel 的日期序号 */
export function parseDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Math.floor(+s);
    if (n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }
  const m = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?:\s.*)?$/.exec(s);
  if (!m) return null;
  const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return isDate(d) && new Date(d + 'T00:00:00Z').toISOString().startsWith(d) ? d : null;
}
const yes = (v) => /^(是|y|yes|true|1|√|✓|✔|记录)$/i.test(String(v ?? '').trim());
function int(v, min, max) {
  const s = String(v ?? '').trim();
  if (!s) return { empty: true };
  const n = Number(s);
  if (!Number.isInteger(n) || n < min || (max != null && n > max)) return { bad: true };
  return { n };
}

/**
 * @param rows 二维数组（含表头）
 * @param ctx { today, species: 现有物种, batches: 现有批次 }
 * @returns { items: [{ batch, tasks, speciesName, newSpecies }], errors: [], warnings: [] }
 */
export function planImport(rows, { today, species = [], batches = [] }) {
  const errors = [];
  const warnings = [];
  const h = findHeader(rows);
  if (h < 0) return { items: [], errors: ['没找到表头：第一行要有「批次名称」「类型」「开始日期」等列，请用模板填写'], warnings };
  const idx = {};
  rows[h].forEach((c, i) => {
    const n = norm(c);
    const hit = COLS.find(([, label]) => n === label || (n && n.startsWith(label)));
    if (hit && idx[hit[0]] == null) idx[hit[0]] = i;
  });
  for (const need of ['name', 'type', 'start']) if (idx[need] == null) errors.push(`表头缺少「${COLS.find(([k]) => k === need)[1]}」列`);
  if (errors.length) return { items: [], errors, warnings };

  // 按批次名称分组（保持表格里的先后顺序）
  const groups = new Map();
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const get = (k) => (idx[k] == null ? '' : String(r[idx[k]] ?? '').trim());
    const rec = Object.fromEntries(COLS.map(([k]) => [k, get(k)]));
    if (!Object.values(rec).some(Boolean)) continue;
    if (!rec.name) {
      errors.push(`第 ${i + 1} 行：缺少批次名称`);
      continue;
    }
    if (!groups.has(rec.name)) groups.set(rec.name, []);
    groups.get(rec.name).push({ ...rec, line: i + 1 });
  }
  if (!groups.size && !errors.length) errors.push('表格里没有数据：请在表头下面逐行填写');

  const liveSpecies = species.filter((s) => !s.deleted);
  const existing = new Set(batches.filter((b) => !b.deleted).map((b) => b.name));
  const items = [];
  for (const [name, recs] of groups) {
    const pick = (k) => (recs.find((r) => r[k]) || {})[k] || '';
    const at = `「${name}」（第 ${recs[0].line} 行）`;
    if (existing.has(name)) {
      warnings.push(`${at}：已经有同名批次，跳过`);
      continue;
    }
    const fields = Object.fromEntries(BATCH_FIELDS.map((k) => [k, pick(k)]));
    const type = TYPE_ALIAS[fields.type.replace(/\s/g, '')];
    if (!type) {
      errors.push(`${at}：类型「${fields.type || '空'}」不对，只能填 ${TYPE_ORDER.map((k) => TYPES[k].label).join(' / ')}`);
      continue;
    }
    const start = parseDate(fields.start);
    if (!start) {
      errors.push(`${at}：开始日期「${fields.start || '空'}」不对，请写成 2026-10-06`);
      continue;
    }
    const sp = fields.species ? liveSpecies.find((s) => s.name.trim().toLowerCase() === fields.species.toLowerCase()) : null;
    const qty = int(fields.qty, 0);
    if (qty.bad) warnings.push(`${at}：数量「${fields.qty}」不是整数，已忽略`);
    const batch = {
      type,
      name,
      speciesId: sp ? sp.id : undefined,
      start,
      qty: qty.n,
      unit: fields.unit || TYPES[type].units[0],
      location: fields.location,
      medium: fields.medium,
      note: fields.note,
      planned: start > today,
    };

    const taskRecs = recs.filter((r) => r.task);
    const tasks = [];
    let bad = false;
    if (!taskRecs.length) {
      // 没写任务：和在应用里新建批次一样，按类型自动生成
      for (const t of templateTasks(type, sp || { water: 3, feed: 7 })) {
        if (t.kind === 'once') tasks.push({ name: t.name, kind: 'once', lead: t.lead || 0, prep: t.prep || '', offset: t.offset || 0 });
        else {
          const next = maxDate(addDays(start, t.every), today);
          const out = { name: t.name, kind: 'repeat', every: t.every, mode: t.mode || 'float', lead: t.lead || 0, prep: t.lead ? t.prep || '' : '', firstOffset: diffDays(start, next) };
          if (t.countGen) Object.assign(out, { countGen: true, gen0: 0 });
          tasks.push(out);
        }
      }
    }
    for (const r of taskRecs) {
      const tat = `第 ${r.line} 行「${r.task}」`;
      const every = int(r.every, 1, 3650);
      const lead = int(r.lead, 0, 30);
      const next = r.next ? parseDate(r.next) : '';
      if (every.bad) errors.push(`${tat}：间隔天数要填正整数`);
      if (lead.bad) errors.push(`${tat}：提前提醒天数要填 0–30 的整数`);
      if (next === null) errors.push(`${tat}：下次日期「${r.next}」不对，请写成 2026-10-06`);
      if (every.empty && !next && next !== null) errors.push(`${tat}：单次任务（不填间隔）需要填「下次日期」`);
      if (every.bad || lead.bad || next === null || (every.empty && !next)) {
        bad = true;
        continue;
      }
      const ld = lead.n || 0;
      const base = { name: r.task, kind: every.empty ? 'once' : 'repeat', lead: ld, prep: ld > 0 ? r.prep : '' };
      if (every.empty) {
        tasks.push({ ...base, offset: diffDays(start, next) });
        continue;
      }
      const due = next || maxDate(addDays(start, every.n), today);
      const out = { ...base, every: every.n, mode: /固定|fixed/i.test(r.mode) ? 'fixed' : 'float', firstOffset: diffDays(start, due) };
      if (yes(r.countGen)) {
        const g = int(r.gen0, 0);
        if (g.bad) warnings.push(`${tat}：当前代数「${r.gen0}」不是整数，按 0 计`);
        Object.assign(out, { countGen: true, gen0: g.n || 0 });
      }
      tasks.push(out);
    }
    if (bad) continue;
    if (fields.species && !sp) warnings.push(`${at}：物种「${fields.species}」还没有，会自动新建（默认每 3 天浇水、7 天营养液，可在设置里改）`);
    items.push({ batch, tasks, speciesName: fields.species, newSpecies: !!(fields.species && !sp), auto: !taskRecs.length });
  }
  return { items, errors, warnings };
}
