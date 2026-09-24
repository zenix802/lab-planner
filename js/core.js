// 实验日程 · 核心逻辑
// 浏览器（应用本身）和 GitHub Action（定时提醒脚本）共用这一份代码，不依赖任何第三方库。
// 所有日期都用 'YYYY-MM-DD' 字符串表示，按设置里的时区（默认 Asia/Shanghai）计算“今天”。

export const APP_VERSION = '1.0.1';
export const ENGINE_VERSION = '1';
export const SCHEMA = 1;
export const DATA_PATH = 'data/planner.json';
export const COLLECTIONS = ['species', 'batches', 'tasks', 'logs', 'away'];

// ───────────────────────── 类型与模板 ─────────────────────────

export const TYPES = {
  seedling: { label: '实生苗', color: '#2E9E55', startLabel: '播种日期', startVerb: '播种', ageLabel: '播种后', units: ['盆', '穴盘', '株', '盘'] },
  callus: { label: '愈伤扩繁', color: '#D9822B', startLabel: '最近一次继代日期', startVerb: '继代', ageLabel: '本代', units: ['皿', '瓶', '块', '个事件'] },
  shoot: { label: '组培苗扩繁', color: '#2F7FD8', startLabel: '最近一次继代日期', startVerb: '接种', ageLabel: '本代', units: ['瓶', '皿', '株'] },
  rooting: { label: '组培苗生根', color: '#8E5BD6', startLabel: '转入生根培养基日期', startVerb: '转入生根培养基', ageLabel: '生根培养', units: ['瓶', '株'] },
  other: { label: '其他', color: '#7C8591', startLabel: '开始日期', startVerb: '开始', ageLabel: '开始后', units: ['个', '份', '盆', '瓶'] },
};
export const TYPE_ORDER = ['seedling', 'callus', 'shoot', 'rooting', 'other'];

// 预置物种：固定 id + updatedAt 0，保证多台设备首次打开时不会生成重复物种；用户任何修改都会覆盖它们。
export const DEFAULT_SPECIES = [
  { id: 'sp-nben', name: '本生烟', latin: 'Nicotiana benthamiana', water: 2, feed: 7, updatedAt: 0 },
  { id: 'sp-msat', name: '苜蓿', latin: 'Medicago sativa', water: 3, feed: 7, updatedAt: 0 },
  { id: 'sp-cmol', name: '板栗', latin: 'Castanea mollissima', water: 3, feed: 14, updatedAt: 0 },
  { id: 'sp-cseg', name: '茅栗', latin: 'Castanea seguinii', water: 3, feed: 14, updatedAt: 0 },
];

export const DEFAULT_SETTINGS = {
  tz: 'Asia/Shanghai',
  morning: true,
  morningAt: '07:45',
  evening: true,
  eveningAt: '20:45',
  issue: false,
  updatedAt: 0,
};

/** 新建批次时按类型预填的任务（全部可在表单里改）。 */
export function templateTasks(type, species) {
  switch (type) {
    case 'seedling':
      return [
        { name: '浇水', kind: 'repeat', every: (species && species.water) || 3, mode: 'float', lead: 0 },
        { name: '浇营养液', kind: 'repeat', every: (species && species.feed) || 7, mode: 'float', lead: 0 },
      ];
    case 'callus':
      return [{ name: '继代', kind: 'repeat', every: 30, mode: 'float', lead: 2, prep: '配制并灭菌继代培养基', countGen: true, gen0: 0 }];
    case 'shoot':
      return [{ name: '继代', kind: 'repeat', every: 30, mode: 'float', lead: 2, prep: '配制并灭菌扩繁培养基', countGen: true, gen0: 0 }];
    case 'rooting':
      return [
        { name: '生根观察', kind: 'once', offset: 14, lead: 0 },
        { name: '出瓶炼苗', kind: 'once', offset: 28, lead: 1, prep: '准备炼苗基质和穴盘' },
        { name: '移栽', kind: 'once', offset: 35, lead: 1, prep: '准备营养土和花盆' },
      ];
    default:
      return [];
  }
}

// ───────────────────────── 通用工具 ─────────────────────────

export function uid() {
  const r = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return Date.now().toString(36) + r;
}

const DAY = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (s) => typeof s === 'string' && DATE_RE.test(s);

export function toDayNum(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
}
export function fromDayNum(n) {
  return new Date(n * DAY).toISOString().slice(0, 10);
}
export const addDays = (s, n) => fromDayNum(toDayNum(s) + n);
/** b 比 a 晚几天 */
export const diffDays = (a, b) => toDayNum(b) - toDayNum(a);
export const weekday = (s) => new Date(toDayNum(s) * DAY).getUTCDay(); // 0 = 周日
export const maxDate = (a, b) => (a > b ? a : b);

const WK = ['日', '一', '二', '三', '四', '五', '六'];
export const weekCN = (s) => '周' + WK[weekday(s)];
export function fmtMD(s) {
  const [, m, d] = s.split('-');
  return `${+m}/${+d}`;
}
export function fmtCN(s) {
  const [, m, d] = s.split('-');
  return `${+m}月${+d}日`;
}
export function fmtCNY(s) {
  const [y, m, d] = s.split('-');
  return `${y}年${+m}月${+d}日`;
}
/** 相对今天的中文描述 */
export function relText(s, today) {
  const d = diffDays(today, s);
  if (d === 0) return '今天';
  if (d === 1) return '明天';
  if (d === 2) return '后天';
  if (d === -1) return '昨天';
  if (d < 0) return `逾期 ${-d} 天`;
  return `${d} 天后`;
}

/** 某时区下的日期与时刻 */
export function partsIn(tz, date = new Date()) {
  let f;
  try {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  } catch {
    f = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  }
  const p = {};
  for (const x of f.formatToParts(date)) p[x.type] = x.value;
  const hour = +p.hour % 24;
  return { date: `${p.year}-${p.month}-${p.day}`, hour, minute: +p.minute };
}
export const todayIn = (tz, date) => partsIn(tz, date).date;

/** 时区相对 UTC 的分钟偏移（上海 = +480） */
export function tzOffsetMin(tz, date = new Date()) {
  const p = partsIn(tz, date);
  const [y, m, d] = p.date.split('-').map(Number);
  const local = Date.UTC(y, m - 1, d, p.hour, p.minute);
  const utc = Math.floor(date.getTime() / 60000) * 60000;
  return Math.round((local - utc) / 60000);
}
/** 把本地 'HH:MM' 转成 GitHub Actions 用的 UTC cron */
export function cronFor(hhmm, tz, date = new Date()) {
  const [h, m] = String(hhmm || '08:00').split(':').map(Number);
  const utc = (((h * 60 + m - tzOffsetMin(tz, date)) % 1440) + 1440) % 1440;
  return `${utc % 60} ${Math.floor(utc / 60)} * * *`;
}
/** 数据仓库里提醒脚本/定时配置的“版本戳”，不一致时应用会自动更新脚本 */
export function engineStamp(settings) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  return `engine=${ENGINE_VERSION}\ncron=${cronFor(s.morningAt, s.tz)}|${cronFor(s.eveningAt, s.tz)}\n`;
}
/** 定时任务运行时判断是早间还是晚间（取离得最近的那个时间点，容忍 GitHub 的排队延迟） */
export function pickMode(settings, now = new Date()) {
  const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const { hour, minute } = partsIn(s.tz, now);
  const cur = hour * 60 + minute;
  const dist = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    const x = Math.abs(cur - (h * 60 + m));
    return Math.min(x, 1440 - x);
  };
  return dist(s.morningAt) <= dist(s.eveningAt) ? 'morning' : 'evening';
}

// ───────────────────────── 数据：规范化 / 合并 / 序列化 ─────────────────────────

export function emptyData() {
  return normalizeData({});
}

export function normalizeData(d) {
  d = d && typeof d === 'object' ? d : {};
  const out = { schema: SCHEMA, settings: { ...DEFAULT_SETTINGS, ...(d.settings || {}) } };
  for (const c of COLLECTIONS) out[c] = Array.isArray(d[c]) ? d[c].filter((x) => x && typeof x === 'object' && x.id) : [];
  if (!Array.isArray(d.species)) out.species = DEFAULT_SPECIES.map((s) => ({ ...s }));
  return out;
}

function stable(o) {
  const out = {};
  for (const k of Object.keys(o).sort()) {
    const v = o[k];
    if (v === undefined || v === null || v === '' || typeof v === 'function') continue;
    out[k] = v;
  }
  return out;
}
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function canonical(d) {
  const n = normalizeData(d);
  n.settings = stable(n.settings);
  for (const c of COLLECTIONS) n[c] = n[c].map(stable).sort(byId);
  return n;
}

/** 固定格式：每个条目一行，git 历史里一眼能看出每次改了什么 */
export function serialize(d) {
  const c = canonical(d);
  const lines = ['{', ` "schema": ${c.schema},`, ` "settings": ${JSON.stringify(c.settings)},`];
  COLLECTIONS.forEach((k, i) => {
    const arr = c[k];
    const body = arr.length ? '\n' + arr.map((x) => '  ' + JSON.stringify(x)).join(',\n') + '\n ' : '';
    lines.push(` "${k}": [${body}]${i === COLLECTIONS.length - 1 ? '' : ','}`);
  });
  lines.push('}');
  return lines.join('\n') + '\n';
}

export function parseData(text) {
  return normalizeData(JSON.parse(text));
}

function newer(x, y) {
  if (!x) return y;
  if (!y) return x;
  const dx = x.updatedAt || 0;
  const dy = y.updatedAt || 0;
  if (dx !== dy) return dx > dy ? x : y;
  // 时间戳相同：按内容排序取一个，保证每台设备合并结果一致
  return JSON.stringify(stable(x)) >= JSON.stringify(stable(y)) ? x : y;
}

/** 多设备合并：每个条目按 updatedAt 取较新的一份；删除用 deleted 标记（墓碑），不会“复活”。 */
export function mergeData(a, b) {
  if (!a) return canonical(b);
  if (!b) return canonical(a);
  const A = normalizeData(a);
  const B = normalizeData(b);
  const out = { schema: SCHEMA, settings: newer(A.settings, B.settings) };
  for (const c of COLLECTIONS) {
    const m = new Map();
    for (const x of A[c]) m.set(x.id, x);
    for (const y of B[c]) m.set(y.id, newer(m.get(y.id), y));
    out[c] = [...m.values()];
  }
  return canonical(out);
}

// ───────────────────────── 排程 ─────────────────────────

function push(map, k, v) {
  const a = map.get(k);
  if (a) a.push(v);
  else map.set(k, [v]);
}
const logOrder = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0));

export function buildIndex(data) {
  const batches = new Map();
  const species = new Map();
  const tasks = new Map();
  const tasksByBatch = new Map();
  const logsByTask = new Map();
  const logsByBatch = new Map();
  for (const s of data.species) if (!s.deleted) species.set(s.id, s);
  for (const b of data.batches) if (!b.deleted) batches.set(b.id, b);
  for (const t of data.tasks) {
    if (t.deleted || !batches.has(t.batchId)) continue;
    tasks.set(t.id, t);
    push(tasksByBatch, t.batchId, t);
  }
  for (const l of data.logs) {
    if (l.deleted || !batches.has(l.batchId)) continue;
    if (l.taskId) push(logsByTask, l.taskId, l);
    push(logsByBatch, l.batchId, l);
  }
  for (const arr of logsByTask.values()) arr.sort(logOrder);
  for (const arr of logsByBatch.values()) arr.sort(logOrder);
  for (const arr of tasksByBatch.values()) arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt || 0) - (b.createdAt || 0));
  return { batches, species, tasks, tasksByBatch, logsByTask, logsByBatch };
}

const every = (t) => Math.max(1, Math.round(+t.every) || 1);
const isAct = (l) => l.kind === 'done' || l.kind === 'skip';

/** 周期任务的“锚点”（第一次的日期） */
export function anchorOf(task, batch) {
  const off = task.firstOffset ?? task.every ?? 0;
  return addDays(batch.start, Math.round(+off) || 0);
}
/** 最近一次完成/跳过的记录 */
export function lastAct(logs) {
  let best = null;
  for (const l of logs || []) {
    if (!isAct(l)) continue;
    if (!best || l.date > best.date || (l.date === best.date && (l.createdAt || 0) >= (best.createdAt || 0))) best = l;
  }
  return best;
}
export function lastDone(logs) {
  let best = null;
  for (const l of logs || []) if (l.kind === 'done' && (!best || l.date >= best.date)) best = l;
  return best;
}
/** 固定周期：离 date 最近的一次计划日期 */
export function nearestOcc(anchor, n, date) {
  const k = Math.max(0, Math.round(diffDays(anchor, date) / n));
  return addDays(anchor, k * n);
}
/** 固定周期：不晚于 date 的最后一次计划日期 */
export function latestOccOnOrBefore(anchor, n, date) {
  const k = Math.max(0, Math.floor(diffDays(anchor, date) / n));
  return addDays(anchor, k * n);
}

/**
 * 下一次应做的日期；单次任务做完后返回 null。
 * - float（默认）：从上次实际完成日期顺延 N 天 —— 晚浇一天，下次也往后推一天。
 * - fixed：固定节奏（如每周一），迟做不影响后面的计划日。
 * - override：用户手动推迟/调整的日期，只影响“这一次”，完成后自动清除。
 */
export function nextDue(task, batch, logs = []) {
  if (!task || !batch) return null;
  if (task.kind === 'once') {
    if ((logs || []).some(isAct)) return null;
    return task.override || addDays(batch.start, Math.round(+task.offset) || 0);
  }
  if (task.override) return task.override;
  const n = every(task);
  const anchor = anchorOf(task, batch);
  const last = lastAct(logs);
  if (!last) return anchor;
  if (task.mode === 'fixed') {
    const cov = isDate(last.due) ? last.due : nearestOcc(anchor, n, last.date);
    return addDays(cov, n);
  }
  return addDays(last.date, n);
}

export function currentGen(task, logs) {
  if (!task.countGen) return null;
  return (Math.round(+task.gen0) || 0) + (logs || []).filter((l) => l.kind === 'done').length;
}

/** 生成一条完成/跳过记录（调用方负责写入并清掉 task.override） */
export function makeCompletion(task, batch, logs, { date, kind = 'done', note = '', now = Date.now(), device } = {}) {
  const due = nextDue(task, batch, logs);
  let covered = due;
  if (task.kind === 'repeat' && task.mode === 'fixed' && due) {
    const anchor = anchorOf(task, batch);
    const n = every(task);
    covered = nearestOcc(anchor, n, due);
    if (date > covered) {
      const late = latestOccOnOrBefore(anchor, n, date);
      if (late > covered) covered = late;
    }
  }
  const log = { id: uid(), batchId: batch.id, taskId: task.id, kind, date, title: task.name, createdAt: now, updatedAt: now };
  if (covered) log.due = covered;
  if (note) log.note = note;
  if (device) log.device = device;
  if (task.countGen && kind === 'done') log.gen = currentGen(task, logs) + 1;
  return log;
}

/** 在 [from, to] 区间内推算某任务的所有日期（按时完成的假设下），用于日历规划 */
export function projectTask(task, batch, logs, from, to, today) {
  const due = nextDue(task, batch, logs);
  if (!due) return [];
  const out = [];
  const add = (date, extra) => {
    if (date >= from && date <= to) out.push({ date, due: extra || date });
  };
  if (task.kind === 'once') {
    add(due < today ? today : due, due);
    return out;
  }
  const n = every(task);
  let cur;
  if (due < today) {
    add(today, due); // 逾期的放在今天
    cur = task.mode === 'fixed' ? addDays(latestOccOnOrBefore(anchorOf(task, batch), n, today), n) : addDays(today, n);
  } else {
    add(due);
    cur = task.mode === 'fixed' ? addDays(nearestOcc(anchorOf(task, batch), n, due), n) : addDays(due, n);
    if (cur <= due) cur = addDays(due, n);
  }
  if (cur < from) cur = addDays(cur, Math.ceil(diffDays(cur, from) / n) * n);
  for (let guard = 0; cur <= to && guard < 2000; guard++) {
    add(cur);
    cur = addDays(cur, n);
  }
  return out;
}

const liveBatch = (b) => b && !b.deleted && b.status !== 'done';

/** 区间内所有（推算的）待办，含计划中的“开始”事件 */
export function agenda(data, from, to, today, idx = buildIndex(data)) {
  const items = [];
  for (const b of idx.batches.values()) {
    if (!liveBatch(b)) continue;
    if (b.planned) {
      const d = b.start < today ? today : b.start;
      if (d >= from && d <= to) items.push({ date: d, due: b.start, virtual: 'start', batch: b, task: null });
    }
    for (const t of idx.tasksByBatch.get(b.id) || []) {
      if (t.paused) continue;
      const logs = idx.logsByTask.get(t.id) || [];
      const g = currentGen(t, logs);
      projectTask(t, b, logs, from, to, today).forEach((o, i) => {
        items.push({ ...o, task: t, batch: b, gen: g == null ? null : g + 1 + i });
      });
    }
  }
  return items.sort(itemOrder);
}

function itemOrder(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ta = TYPE_ORDER.indexOf(a.batch.type);
  const tb = TYPE_ORDER.indexOf(b.batch.type);
  if (ta !== tb) return ta - tb;
  const na = a.batch.name + (a.task ? a.task.name : '');
  const nb = b.batch.name + (b.task ? b.task.name : '');
  return na < nb ? -1 : na > nb ? 1 : 0;
}

/** “今天”页：每个任务的下一次（含逾期），horizon 天以内 */
export function dueItems(data, today, horizon = 7, idx = buildIndex(data)) {
  const out = [];
  for (const b of idx.batches.values()) {
    if (!liveBatch(b)) continue;
    if (b.planned) {
      const rel = diffDays(today, b.start);
      if (rel <= horizon) out.push({ key: 'start:' + b.id, virtual: 'start', batch: b, task: null, due: b.start, date: b.start, rel });
    }
    for (const t of idx.tasksByBatch.get(b.id) || []) {
      if (t.paused) continue;
      const logs = idx.logsByTask.get(t.id) || [];
      const due = nextDue(t, b, logs);
      if (!due) continue;
      const rel = diffDays(today, due);
      if (rel > horizon) continue;
      const g = currentGen(t, logs);
      const last = lastAct(logs);
      out.push({ key: t.id, task: t, batch: b, due, date: due, rel, gen: g == null ? null : g + 1, last: last ? last.date : null });
    }
  }
  return out.sort((a, b) => a.rel - b.rel || itemOrder(a, b));
}

/** 需要提前准备的（提前 N 天提醒） */
export function prepItems(data, today, idx = buildIndex(data)) {
  const out = [];
  for (const b of idx.batches.values()) {
    if (!liveBatch(b)) continue;
    for (const t of idx.tasksByBatch.get(b.id) || []) {
      const lead = Math.round(+t.lead) || 0;
      if (t.paused || lead <= 0) continue;
      const logs = idx.logsByTask.get(t.id) || [];
      const due = nextDue(t, b, logs);
      if (!due) continue;
      const rel = diffDays(today, due);
      if (rel > 0 && rel <= lead) {
        const g = currentGen(t, logs);
        out.push({ key: 'prep:' + t.id, task: t, batch: b, due, date: due, rel, gen: g == null ? null : g + 1 });
      }
    }
  }
  return out.sort((a, b) => a.rel - b.rel || itemOrder(a, b));
}

/** 即将开始的外出/休息日，以及期间会到期的任务数 */
export function awayNotices(data, today, withinDays = 14, idx = buildIndex(data)) {
  const out = [];
  for (const a of data.away) {
    if (a.deleted || !isDate(a.from) || !isDate(a.to) || a.to < today) continue;
    const lead = diffDays(today, a.from);
    if (lead > withinDays) continue;
    const from = maxDate(a.from, today);
    const items = agenda(data, from, a.to, today, idx);
    out.push({ away: a, lead, ongoing: lead <= 0, items, count: items.length });
  }
  return out.sort((x, y) => (x.away.from < y.away.from ? -1 : 1));
}

export function itemLabel(i) {
  if (i.virtual === 'start') return `${i.batch.name} · ${TYPES[i.batch.type]?.startVerb || '开始'}（计划）`;
  return `${i.batch.name} · ${i.task.name}${i.gen ? `→第${i.gen}代` : ''}`;
}

/** 通知正文：最多 max 行、maxChars 字，超出部分折叠成“…还有 N 项” */
export function clip(lines, max = 8, maxChars = 700) {
  const build = (k) => (k >= lines.length ? lines.join('\n') : [...lines.slice(0, k), `…还有 ${lines.length - k} 项`].join('\n'));
  let k = lines.length > max ? max - 1 : lines.length;
  let s = build(k);
  while (s.length > maxChars && k > 1) s = build(--k);
  return s;
}

/**
 * 推送内容。mode: 'morning'（今日待办 + 逾期 + 提前准备）| 'evening'（明日预告 + 今天未完成）
 * 没有需要提醒的内容时返回 null（不推送，免打扰）。
 */
export function buildDigest(data, mode, today) {
  data = normalizeData(data);
  const idx = buildIndex(data);
  const items = dueItems(data, today, 2, idx);
  const overdue = items.filter((i) => i.rel < 0);
  const todays = items.filter((i) => i.rel === 0);
  const tomorrow = items.filter((i) => i.rel === 1);
  const badge = overdue.length + todays.length;
  const lines = [];
  let title;
  if (mode === 'evening') {
    for (const i of tomorrow) lines.push(`• ${itemLabel(i)}`);
    if (badge) lines.push(`⏳ 今天还有 ${badge} 项没记完成`);
    for (const a of awayNotices(data, today, 1, idx)) {
      if (a.lead === 1) lines.push(`✈️ 明天起不在实验室（到 ${fmtMD(a.away.to)}），期间到期 ${a.count} 项`);
    }
    if (!lines.length) return null;
    title = tomorrow.length ? `明日待办 ${tomorrow.length} 项` : '今天还有未完成事项';
  } else {
    for (const i of overdue) lines.push(`⚠️ ${itemLabel(i)}（逾期 ${-i.rel} 天）`);
    for (const i of todays) lines.push(`• ${itemLabel(i)}`);
    for (const p of prepItems(data, today, idx)) lines.push(`📦 ${fmtMD(p.due)} ${itemLabel(p)}${p.task.prep ? '：' + p.task.prep : ''}`);
    for (const a of awayNotices(data, today, 3, idx)) {
      if (a.lead >= 1) lines.push(`✈️ ${fmtMD(a.away.from)}–${fmtMD(a.away.to)} 不在实验室，期间到期 ${a.count} 项，记得提前安排`);
    }
    if (!lines.length) return null;
    title = badge ? `今日待办 ${badge} 项${overdue.length ? `（逾期 ${overdue.length}）` : ''}` : '今日准备提醒';
  }
  return { title, body: clip(lines), lines, badge, mode, tag: 'digest-' + mode, url: './#/today' };
}
