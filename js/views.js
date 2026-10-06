// 四个主页面 + 批次详情
import { html } from './html.js';
import {
  APP_VERSION, TYPES, TYPE_ORDER, addDays, agenda, awayNotices, buildIndex, currentGen, diffDays, dueItems, fmtCN, fmtCNY, fmtMD,
  lastAct, lastDone, maxDate, nextDue, prepItems, relText, weekCN, weekday,
} from './core.js';
import { state, today, isConnected } from './store.js';
import { ui, icon, TYPE_ICON, pageHead, section, navRow, seg, fmtTime } from './ui.js';
import { pushEnv } from './push.js';

export const T = (type) => TYPES[type] || TYPES.other;
export const ruleText = (t) => (t.kind === 'once' ? '单次' : `每 ${t.every} 天${t.mode === 'fixed' ? '（固定节奏）' : ''}`);
export const speciesName = (idx, b) => {
  const s = b.speciesId && idx.species.get(b.speciesId);
  return s ? s.name : '';
};
const groupBy = (arr, f) => {
  const m = new Map();
  for (const x of arr) {
    const k = f(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
};
const isWeekend = (ds) => [0, 6].includes(weekday(ds));

export function batchAge(b, idx, td) {
  const ty = T(b.type);
  if (b.status === 'done') return `已结束${b.endDate ? ' ' + fmtMD(b.endDate) : ''}`;
  if (b.planned && b.start > td) return `计划 ${fmtMD(b.start)} ${ty.startVerb}`;
  const gt = (idx.tasksByBatch.get(b.id) || []).find((t) => t.countGen);
  if (gt) {
    const logs = idx.logsByTask.get(gt.id) || [];
    const ld = lastDone(logs);
    return `第 ${currentGen(gt, logs)} 代 · 本代 ${diffDays(ld ? ld.date : b.start, td)} 天`;
  }
  return `${ty.ageLabel} ${diffDays(b.start, td)} 天`;
}

function syncButton() {
  if (!isConnected()) return html`<button class="icon-btn muted" data-act="open-github" aria-label="连接 GitHub 同步">${icon('cloudOff')}</button>`;
  const s = state.sync.status;
  if (s === 'syncing') return html`<button class="icon-btn spin" data-act="sync" aria-label="同步中">${icon('sync')}</button>`;
  if (s === 'error' || s === 'offline') return html`<button class="icon-btn warn" data-act="sync-error" aria-label="同步出错">${icon('alert')}</button>`;
  return html`<button class="icon-btn ok" data-act="sync" aria-label="已同步，点击立即同步">${icon('cloudOk')}</button>`;
}

const typeBadge = (type) => html`<span class="tbadge" style="--c:${T(type).color}">${icon(TYPE_ICON[type] || 'dot')}${T(type).label}</span>`;
const dueCls = (rel) => (rel < 0 ? 'late' : rel === 0 ? 'now' : '');

/** 待办行（今天页、日历里的今天） */
export function itemRow(i, td, { dateLabel = '', compact = false } = {}) {
  const ty = T(i.batch.type);
  const due = dateLabel || relText(i.due, td);
  if (i.virtual === 'start') {
    return html`<div class="row item" role="button" tabindex="0" data-act="item" data-key="${i.key}" style="--c:${ty.color}">
      <span class="bar"></span>
      <span class="grow"><span class="t1">${ty.startVerb}<span class="pill">计划</span></span><span class="t2">${i.batch.name}</span></span>
      <span class="due ${dueCls(i.rel)}">${due}</span>
      <button class="check" data-act="done" data-key="${i.key}" aria-label="确认已${ty.startVerb}">${icon('check')}</button>
    </div>`;
  }
  const t = i.task;
  const sub = [i.batch.name, ruleText(t)];
  if (i.last) sub.push('上次 ' + fmtMD(i.last));
  return html`<div class="row item" role="button" tabindex="0" data-act="item" data-key="${i.key}" style="--c:${ty.color}">
    <span class="bar"></span>
    <span class="grow">
      <span class="t1">${t.name}${i.gen ? html`<span class="gen">→ 第 ${i.gen} 代</span>` : ''}${t.override ? html`<span class="pill">已调整</span>` : ''}</span>
      <span class="t2">${sub.join(' · ')}</span>
      ${t.note && !compact ? html`<span class="t3">${t.note}</span>` : ''}
    </span>
    <span class="due ${dueCls(i.rel)}">${due}</span>
    <button class="check" data-act="done" data-key="${i.key}" aria-label="完成：${t.name}">${icon('check')}</button>
  </div>`;
}

/** 未来的推算行（日历，没有打勾按钮） */
function planRow(i, td) {
  const ty = T(i.batch.type);
  const title = i.virtual === 'start' ? `${ty.startVerb}（计划）` : `${i.task.name}${i.gen ? ` → 第 ${i.gen} 代` : ''}`;
  return html`<div class="row item plan" role="button" tabindex="0" data-act="item" data-key="${i.key}" style="--c:${ty.color}">
    <span class="bar"></span>
    <span class="grow"><span class="t1">${title}</span><span class="t2">${i.batch.name}${i.task ? ' · ' + ruleText(i.task) : ''}</span></span>
    <span class="due">${relText(i.date, td)}</span>
  </div>`;
}

export function logRow(l, idx, { showBatch = true, showDate = false } = {}) {
  const b = idx.batches.get(l.batchId);
  const ic = l.kind === 'done' ? 'check' : l.kind === 'skip' ? 'skip' : 'note';
  const t2 = [showDate ? `${fmtMD(l.date)} ${weekCN(l.date)}` : '', showBatch && b ? b.name : ''].filter(Boolean).join(' · ');
  return html`<button class="row log ${l.kind}" data-act="edit-log" data-id="${l.id}" style="--c:${T(b && b.type).color}">
    <span class="log-ic">${icon(ic)}</span>
    <span class="grow">
      <span class="t1">${l.title || '记录'}${l.gen ? html`<span class="gen">第 ${l.gen} 代</span>` : ''}${l.kind === 'skip' ? html`<span class="pill">跳过</span>` : ''}</span>
      ${t2 ? html`<span class="t2">${t2}</span>` : ''}
      ${l.note ? html`<span class="t3">${l.note}</span>` : ''}
    </span>
  </button>`;
}

const toItem = (i, td) => ({ ...i, key: i.task ? i.task.id : 'start:' + i.batch.id, rel: diffDays(td, i.due) });

// ───────────── 今天 ─────────────

function installBanner() {
  const env = pushEnv();
  if (env.inApp) {
    return html`<button class="card hint" data-act="install-guide">
    <span class="card-ic">${icon('share')}</span>
    <span class="grow"><span class="t1">请在浏览器里打开</span><span class="t2">微信 / QQ 里打开的页面收不到提醒：点右上角「···」→「在浏览器打开」</span></span>
    ${icon('chevR', 'chev')}
  </button>`;
  }
  if (!env.ios || env.standalone) return '';
  return html`<button class="card hint" data-act="install-guide">
    <span class="card-ic">${icon('share')}</span>
    <span class="grow"><span class="t1">添加到主屏幕，才能收到提醒</span><span class="t2">Safari 底部「分享」→「添加到主屏幕」，之后从主屏幕图标打开</span></span>
    ${icon('chevR', 'chev')}
  </button>`;
}

function pushLostBanner() {
  if (!ui.pushLost || !state.cfg.push) return '';
  return html`<button class="card hint warn" data-act="enable-push">
    <span class="card-ic">${icon('bell')}</span>
    <span class="grow"><span class="t1">本机提醒失效了</span><span class="t2">点这里重新开启（系统更新或重装后偶尔会发生）</span></span>
    ${icon('chevR', 'chev')}
  </button>`;
}

function welcome() {
  return html`<div class="card welcome">
    <div class="welcome-title">🌱 开始使用</div>
    <ol>
      <li><b>新建批次</b>：实生苗、愈伤扩繁、组培苗扩繁、生根，自动排好浇水、营养液、继代、生根观察的日期。</li>
      <li><b>做完点 ◯</b>：自动记一笔，并按实际完成日算出下一次。</li>
      <li><b>连接 GitHub 私有仓库</b>：多台设备同步，每天早晚主动推送提醒。</li>
    </ol>
    <div class="card-btns">
      <button class="btn" data-act="new-batch">${icon('plus')}新建批次</button>
      <button class="btn ghost" data-act="open-github">连接 GitHub</button>
    </div>
  </div>`;
}

function awayCard(a, td) {
  const when = a.ongoing ? '正在外出' : a.lead === 1 ? '明天开始' : `${a.lead} 天后开始`;
  return html`<button class="card away" data-act="go" data-to="calendar" data-sel="${maxDate(a.away.from, td)}">
    <span class="card-ic">${icon('suitcase')}</span>
    <span class="grow"><span class="t1">${a.away.note || '不在实验室'} · ${fmtMD(a.away.from)}–${fmtMD(a.away.to)}</span>
    <span class="t2">${when}，期间有 ${a.count} 项到期${a.count ? '，提前安排或找人代劳' : ''}</span></span>
    ${icon('chevR', 'chev')}
  </button>`;
}

export function viewToday() {
  const td = today();
  const d = state.data;
  const idx = buildIndex(d);
  const items = dueItems(d, td, 7, idx);
  const g = { overdue: [], today: [], tomorrow: [], later: [] };
  for (const i of items) (i.rel < 0 ? g.overdue : i.rel === 0 ? g.today : i.rel === 1 ? g.tomorrow : g.later).push(i);
  const prep = prepItems(d, td, idx);
  const away = awayNotices(d, td, 14, idx);
  const active = [...idx.batches.values()].filter((b) => b.status !== 'done');
  const pending = g.overdue.length + g.today.length;
  const sub = `${fmtCN(td)} ${weekCN(td)}${active.length ? (pending ? ` · 待办 ${pending} 项` : ' · 今天的都做完了') : ''}`;
  const bulk = (kind, arr) => (arr.filter((i) => !i.virtual).length > 1 ? html`<button class="sec-btn" data-act="bulk-done" data-kind="${kind}">全部完成</button>` : '');
  const tmr = addDays(td, 1);
  return html`
    ${pageHead('今天', sub, html`${syncButton()}<button class="icon-btn" data-act="new-batch" aria-label="新建批次">${icon('plus')}</button>`)}
    ${installBanner()}
    ${pushLostBanner()}
    ${!active.length ? welcome() : ''}
    ${away.map((a) => awayCard(a, td))}
    ${g.overdue.length ? section('逾期', g.overdue.map((i) => itemRow(i, td)), bulk('overdue', g.overdue), 'danger') : ''}
    ${active.length ? section('今天', g.today.length ? g.today.map((i) => itemRow(i, td)) : html`<div class="empty-row">${g.overdue.length ? '今天没有新到期的' : '今天没有要做的 🌱'}</div>`, bulk('today', g.today)) : ''}
    ${prep.length ? section('提前准备', prep.map((p) => prepRow(p, td))) : ''}
    ${g.tomorrow.length ? section(`明天 · ${fmtMD(tmr)} ${weekCN(tmr)}`, g.tomorrow.map((i) => itemRow(i, td, { compact: true }))) : ''}
    ${g.later.length ? section('之后 7 天', g.later.map((i) => itemRow(i, td, { dateLabel: `${fmtMD(i.due)} ${weekCN(i.due)}`, compact: true })), html`<button class="sec-btn" data-act="go" data-to="calendar">看日历</button>`) : ''}
    ${active.length && !isConnected() ? html`<button class="card hint" data-act="open-github"><span class="card-ic">${icon('bell')}</span><span class="grow"><span class="t1">想到点自动提醒？</span><span class="t2">连接 GitHub 私有仓库后，每天早晚推送今天/明天的安排</span></span>${icon('chevR', 'chev')}</button>` : ''}
    ${active.length ? html`<button class="btn ghost block add-batch" data-act="new-batch">${icon('plus')}新建批次</button>` : ''}`;
}

function prepRow(p, td) {
  return html`<div class="row item prep" role="button" tabindex="0" data-act="item" data-key="${p.task.id}" style="--c:${T(p.batch.type).color}">
    <span class="row-ic">${icon('box')}</span>
    <span class="grow"><span class="t1">${p.task.prep || '准备：' + p.task.name}</span>
    <span class="t2">${fmtMD(p.due)} ${weekCN(p.due)} ${p.batch.name} · ${p.task.name}${p.gen ? ` → 第 ${p.gen} 代` : ''}</span></span>
    <span class="due">${relText(p.due, td)}</span>
  </div>`;
}

// ───────────── 日历 ─────────────

function awayRanges(d) {
  return d.away.filter((a) => !a.deleted && a.from && a.to);
}
function awayOn(d, ds) {
  return awayRanges(d).find((a) => a.from <= ds && ds <= a.to);
}
export const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

export function viewCalendar() {
  const td = today();
  if (!ui.calMonth) ui.calMonth = td.slice(0, 7);
  if (!ui.calSel) ui.calSel = td;
  const d = state.data;
  const idx = buildIndex(d);
  const head = pageHead('日历', ui.calMode === 'list' ? '按时完成的前提下推算，实际完成后自动顺延' : '', html`<button class="link-btn" data-act="cal-today">今天</button>`);
  const mode = seg('calMode', ui.calMode, [['month', '月历'], ['list', '未来 30 天']], 'cal-mode');
  return html`${head}<div class="toolbar">${mode}</div>${ui.calMode === 'list' ? calList(d, idx, td) : calMonth(d, idx, td)}`;
}

function calMonth(d, idx, td) {
  const month = ui.calMonth;
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${month}-${String(dim).padStart(2, '0')}`;
  const lead = (weekday(first) + 6) % 7;
  const future = last >= td ? agenda(d, maxDate(first, td), last, td, idx) : [];
  const byDate = groupBy(future, (x) => x.date);
  const logs = d.logs.filter((l) => !l.deleted && idx.batches.has(l.batchId) && l.kind !== 'note' && l.date >= first && l.date <= last);
  const logsByDate = groupBy(logs, (l) => l.date);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(html`<span class="day blank"></span>`);
  for (let day = 1; day <= dim; day++) {
    const ds = `${month}-${String(day).padStart(2, '0')}`;
    const past = ds < td;
    const items = byDate.get(ds) || [];
    const done = logsByDate.get(ds) || [];
    const dots = past
      ? done.slice(0, 3).map(() => html`<i class="dot done"></i>`)
      : items.slice(0, 4).map((it) => html`<i class="dot" style="--c:${T(it.batch.type).color}"></i>`);
    const more = !past && items.length > 4 ? html`<i class="more">+${items.length - 4}</i>` : '';
    const cls = ['day', ds === td ? 'today' : '', ds === ui.calSel ? 'sel' : '', past ? 'past' : '', awayOn(d, ds) ? 'away' : '', isWeekend(ds) ? 'we' : ''].join(' ');
    const label = `${m}月${day}日${items.length ? `，${items.length} 项安排` : ''}${done.length ? `，${done.length} 条记录` : ''}`;
    cells.push(html`<button class="${cls}" data-act="cal-day" data-date="${ds}" aria-label="${label}"><span class="num">${day}</span><span class="dots">${dots}${more}</span></button>`);
  }
  return html`<div class="cal card">
      <div class="cal-nav">
        <button class="icon-btn" data-act="cal-prev" aria-label="上个月">${icon('chevL')}</button>
        <div class="cal-title">${y}年${m}月</div>
        <button class="icon-btn" data-act="cal-next" aria-label="下个月">${icon('chevR')}</button>
      </div>
      <div class="cal-week">${['一', '二', '三', '四', '五', '六', '日'].map((w, i) => html`<span class="${i > 4 ? 'we' : ''}">${w}</span>`)}</div>
      <div class="cal-grid">${cells}</div>
      <div class="cal-legend">${TYPE_ORDER.slice(0, 4).map((k) => html`<span><i class="dot" style="--c:${TYPES[k].color}"></i>${TYPES[k].label}</span>`)}<span><i class="dot done"></i>已完成</span><span><i class="sw away"></i>不在实验室</span></div>
    </div>
    ${dayPanel(d, idx, td, ui.calSel)}`;
}

function dayPanel(d, idx, td, ds) {
  const away = awayOn(d, ds);
  let rows = [];
  if (ds === td) rows = dueItems(d, td, 0, idx).map((i) => itemRow(i, td));
  else if (ds > td) rows = agenda(d, ds, ds, td, idx).map((i) => planRow(toItem(i, td), td));
  const logs = d.logs.filter((l) => !l.deleted && l.date === ds && idx.batches.has(l.batchId)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const all = [...rows, ...logs.map((l) => logRow(l, idx))];
  const title = `${fmtCN(ds)} ${weekCN(ds)}${ds === td ? ' · 今天' : ''}${away ? ` · ${away.note || '不在实验室'}` : ''}`;
  const extra = ds >= td ? html`<button class="sec-btn" data-act="new-batch" data-start="${ds}">${icon('plus')}这天开始新批次</button>` : '';
  return section(title, all.length ? all : html`<div class="empty-row">${ds < td ? '这天没有记录' : '这天没有安排'}</div>`, extra);
}

function calList(d, idx, td) {
  const end = addDays(td, 29);
  const byDate = groupBy(agenda(d, td, end, td, idx), (x) => x.date);
  const out = [];
  for (let k = 0; k < 30; k++) {
    const ds = addDays(td, k);
    const list = byDate.get(ds) || [];
    const aw = awayOn(d, ds);
    if (!list.length && !aw) continue;
    out.push(html`<div class="day-head ${aw ? 'away' : ''} ${isWeekend(ds) ? 'we' : ''}">
      <span>${fmtMD(ds)} ${weekCN(ds)}${k === 0 ? ' · 今天' : k === 1 ? ' · 明天' : ''}</span>
      <span>${aw ? html`${icon('suitcase')}${aw.note || '不在实验室'} · ` : ''}${list.length} 项</span>
    </div>`);
    for (const i of list) out.push(k === 0 ? itemRow(toItem(i, td), td) : planRow(toItem(i, td), td));
  }
  if (!out.length) return section('', html`<div class="empty-row">未来 30 天没有安排</div>`);
  return html`<div class="list agenda">${out}</div>`;
}

// ───────────── 批次 ─────────────

function batchNext(b, idx, td) {
  if (b.status === 'done') return null;
  let best = b.planned ? { label: T(b.type).startVerb, date: b.start } : null;
  for (const t of idx.tasksByBatch.get(b.id) || []) {
    if (t.paused) continue;
    const n = nextDue(t, b, idx.logsByTask.get(t.id) || []);
    if (n && (!best || n < best.date)) best = { label: t.name, date: n };
  }
  if (best) best.rel = diffDays(td, best.date);
  return best;
}

function batchRow(b, idx, td) {
  const ty = T(b.type);
  const meta = [speciesName(idx, b), b.qty ? `${b.qty} ${b.unit || ''}`.trim() : '', b.location].filter(Boolean).join(' · ');
  const nx = batchNext(b, idx, td);
  return html`<button class="row batch" data-act="open-batch" data-id="${b.id}" style="--c:${ty.color}">
    <span class="bicon">${icon(TYPE_ICON[b.type] || 'dot')}</span>
    <span class="grow">
      <span class="t1">${b.name}</span>
      ${meta ? html`<span class="t2">${meta}</span>` : ''}
      <span class="t3">${batchAge(b, idx, td)}${nx ? html` · 下次${nx.label} <b class="${dueCls(nx.rel)}">${relText(nx.date, td)}</b>` : ''}</span>
    </span>
    ${icon('chevR', 'chev')}
  </button>`;
}

export function viewBatches() {
  const td = today();
  const idx = buildIndex(state.data);
  const all = [...idx.batches.values()];
  const active = all.filter((b) => b.status !== 'done');
  const done = all.filter((b) => b.status === 'done');
  const list = ui.batchFilter === 'done' ? done : active;
  const groups = TYPE_ORDER.map((t) => [t, list.filter((b) => (TYPES[b.type] ? b.type : 'other') === t).sort((a, b) => (a.start < b.start ? 1 : -1))]).filter(([, a]) => a.length);
  const head = pageHead('批次', '', html`<button class="icon-btn" data-act="new-batch" aria-label="新建批次">${icon('plus')}</button>`);
  const filter = seg('batchFilter', ui.batchFilter, [['active', `进行中 ${active.length}`], ['done', `已结束 ${done.length}`]], 'batch-filter');
  const empty = ui.batchFilter === 'done'
    ? html`<div class="empty-big">还没有结束的批次</div>`
    : html`<div class="empty-big">还没有批次<br><button class="btn" data-act="new-batch">${icon('plus')}新建批次</button></div>`;
  return html`${head}<div class="toolbar">${filter}</div>
    ${groups.length ? groups.map(([t, arr]) => section(`${T(t).label} · ${arr.length}`, arr.map((b) => batchRow(b, idx, td)))) : empty}`;
}

function taskRow(t, b, idx, td) {
  const logs = idx.logsByTask.get(t.id) || [];
  const n = nextDue(t, b, logs);
  const g = currentGen(t, logs);
  const bits = [ruleText(t)];
  if (t.lead > 0) bits.push(`提前 ${t.lead} 天提醒`);
  if (g != null) bits.push(`当前第 ${g} 代`);
  let right;
  if (t.paused) right = html`<span class="due muted">已暂停</span>`;
  else if (!n) {
    const ld = lastAct(logs);
    right = html`<span class="due done">已完成${ld ? ' ' + fmtMD(ld.date) : ''}</span>`;
  } else {
    const rel = diffDays(td, n);
    right = html`<span class="due ${dueCls(rel)}">${fmtMD(n)} · ${relText(n, td)}</span>`;
  }
  return html`<button class="row task" data-act="item" data-key="${t.id}" style="--c:${T(b.type).color}">
    <span class="grow">
      <span class="t1">${t.name}${t.override ? html`<span class="pill">已调整</span>` : ''}</span>
      <span class="t2">${bits.join(' · ')}</span>
      ${t.prep && t.lead > 0 ? html`<span class="t3">准备：${t.prep}</span>` : ''}
      ${t.note ? html`<span class="t3">${t.note}</span>` : ''}
    </span>
    ${right}
  </button>`;
}

export function viewBatch(id) {
  const td = today();
  const d = state.data;
  const idx = buildIndex(d);
  const b = idx.batches.get(id);
  const back = html`<button class="back" data-act="back">${icon('chevL')}<span>返回</span></button>`;
  if (!b) return html`${pageHead('找不到这个批次', '', '', back)}<div class="empty-big">它可能已被删除</div>`;
  const ty = T(b.type);
  const tasks = idx.tasksByBatch.get(b.id) || [];
  const logs = (idx.logsByBatch.get(b.id) || []).slice().reverse();
  const parent = b.parentId && idx.batches.get(b.parentId);
  const children = [...idx.batches.values()].filter((x) => x.parentId === b.id);
  const info = [
    [ty.startLabel, `${fmtCNY(b.start)}（${batchAge(b, idx, td)}）`],
    ['物种', speciesName(idx, b)],
    ['数量', b.qty ? `${b.qty} ${b.unit || ''}` : ''],
    ['位置', b.location],
    ['培养基', b.medium],
    ['备注', b.note],
  ].filter(([, v]) => v);
  const infoRows = [
    ...info.map(([k, v]) => html`<div class="kv"><span class="k">${k}</span><span class="v">${v}</span></div>`),
    ...(parent ? [html`<button class="kv link" data-act="open-batch" data-id="${parent.id}"><span class="k">来源批次</span><span class="v">${parent.name} ›</span></button>`] : []),
    ...children.map((c) => html`<button class="kv link" data-act="open-batch" data-id="${c.id}"><span class="k">派生批次</span><span class="v">${c.name} ›</span></button>`),
  ];
  const shown = ui.showAllLogs ? logs : logs.slice(0, 30);
  const logRows = shown.map((l) => logRow(l, idx, { showBatch: false, showDate: true }));
  if (!ui.showAllLogs && logs.length > 30) logRows.push(html`<button class="row more" data-act="show-all-logs">显示全部 ${logs.length} 条</button>`);
  return html`${pageHead(b.name, '', html`<button class="link-btn" data-act="edit-batch" data-id="${b.id}">编辑</button>`, back)}
    <div class="chips">${typeBadge(b.type)}${b.status === 'done' ? html`<span class="chip">已结束</span>` : ''}${b.planned ? html`<span class="chip">计划中</span>` : ''}</div>
    ${section('', infoRows)}
    ${section('任务', tasks.length ? tasks.map((t) => taskRow(t, b, idx, td)) : html`<div class="empty-row">还没有任务</div>`, html`<button class="sec-btn" data-act="new-task" data-id="${b.id}">${icon('plus')}添加</button>`)}
    ${section(`记录 · ${logs.length}`, logs.length ? logRows : html`<div class="empty-row">还没有记录</div>`, html`<button class="sec-btn" data-act="new-note" data-id="${b.id}">${icon('plus')}记一笔</button>`)}
    <div class="actions">
      <button class="btn ghost" data-act="derive-batch" data-id="${b.id}">${icon('branch')}${b.type === 'shoot' ? '转生根：新建生根批次' : '派生新批次'}</button>
      ${b.status === 'done'
        ? html`<button class="btn ghost" data-act="reopen-batch" data-id="${b.id}">恢复为进行中</button>`
        : html`<button class="btn ghost" data-act="end-batch" data-id="${b.id}">结束这个批次</button>`}
      <button class="btn ghost danger" data-act="delete-batch" data-id="${b.id}">${icon('trash')}删除批次</button>
    </div>`;
}

// ───────────── 设置 ─────────────

export function pushStatus() {
  const env = pushEnv();
  const mailTip = '可以改用下面的「邮件提醒」';
  if (env.inApp) return ['请用浏览器打开', '微信 / QQ 里打开的页面收不到通知：点右上角「···」→「在浏览器打开」'];
  if (!env.sw) return ['不支持', `这个浏览器不支持推送，${mailTip}`];
  if (env.ios && !env.standalone) return ['先添加到主屏幕', 'iPhone/iPad 只有从主屏幕打开的网页应用才能收通知'];
  if (!env.push) return ['不支持', env.android ? `请用 Chrome 或 Edge 打开，或${mailTip.slice(2)}` : `这个浏览器不支持推送，${mailTip}`];
  if (!isConnected()) return ['先连接 GitHub', '提醒由你仓库里的 GitHub 定时任务发送'];
  if (env.permission === 'denied') return ['已被系统关闭', '在系统设置（或浏览器的网站设置）里允许「实验日程」发通知'];
  if (state.cfg.push && !ui.pushLost && env.permission === 'granted') {
    return ['已开启', env.android ? '到点没收到的话，说明本机连不上推送服务，请填写邮件提醒' : `${state.cfg.deviceName || '本机'}会在每天早晚收到提醒`];
  }
  if (env.android) return ['点此开启', `安卓在国内网络下常收不到网页推送，建议同时填写邮件提醒`];
  if (env.windows && !env.edge) return ['点此开启', '国内网络下 Chrome 收不到推送，请改用 Edge 打开本应用'];
  return ['点此开启', '允许通知后，本机就会收到推送'];
}

// 提醒时间：用「时 / 分」两个下拉框，不用 <input type="time">——Safari 的时间框改完不一定触发 change，存不上
const pad2 = (n) => String(n).padStart(2, '0');
const timePart = (key, part, cur, values, label) => html`<span class="select"><span class="select-val">${cur}</span><select data-time="${key}" data-part="${part}" aria-label="${label}">${values.map(
  (v) => html`<option value="${v}"${v === cur ? html` selected` : ''}>${v}</option>`,
)}</select></span>`;
const timeCtl = (key, value) => {
  const [h = '00', m = '00'] = String(value || '').split(':');
  const mins = Array.from({ length: 12 }, (_, i) => pad2(i * 5));
  if (!mins.includes(m)) mins.push(m), mins.sort();
  return html`<span class="time-ctl">${timePart(key, 'h', h, Array.from({ length: 24 }, (_, i) => pad2(i)), '时')}<span class="time-sep">:</span>${timePart(key, 'm', m, mins, '分')}</span>`;
};

const setToggle = (key, on) => html`<label class="switch"><input type="checkbox" data-set="${key}"${on ? html` checked` : ''}><span class="knob"></span></label>`;

export function viewSettings() {
  const d = state.data;
  const s = d.settings;
  const td = today();
  const connected = isConnected();
  const st = state.sync.status;
  const syncVal = !connected ? '未连接' : st === 'syncing' ? '同步中…' : st === 'error' || st === 'offline' ? '出错' : '已连接';
  const [pushVal, pushSub] = pushStatus();
  const species = d.species.filter((x) => !x.deleted);
  const away = d.away.filter((x) => !x.deleted && x.to >= td);
  return html`${pageHead('设置')}
    ${section('同步与提醒', [
      navRow({ act: 'open-github', ic: 'cloud', title: 'GitHub 同步', sub: connected ? `${state.cfg.owner}/${state.cfg.repo} · 上次同步 ${fmtTime(state.meta.lastSync)}` : '数据存进你的私有仓库，多台设备同步', value: syncVal }),
      connected && state.sync.error ? html`<button class="row err" data-act="sync">${icon('alert')}<span class="grow">${state.sync.error}</span><span class="row-val">重试</span></button>` : '',
      connected && state.meta.engineError ? html`<button class="row err" data-act="open-github">${icon('alert')}<span class="grow">提醒任务没装好：${state.meta.engineError}</span><span class="row-val">处理</span></button>` : '',
      navRow({ act: 'push-row', ic: 'bell', title: '本机通知', sub: pushSub, value: pushVal, cls: pushVal === '已开启' ? 'on' : '' }),
    ])}
    ${section('每天提醒', [
      html`<div class="field"><span class="field-label">早间：今日待办</span><span class="field-ctl">${timeCtl('morningAt', s.morningAt)}${setToggle('morning', s.morning)}</span></div>`,
      html`<div class="field"><span class="field-label">晚间：明日预告</span><span class="field-ctl">${timeCtl('eveningAt', s.eveningAt)}${setToggle('evening', s.evening)}</span></div>`,
      navRow({ act: 'test-push', ic: 'bell', title: '发送测试通知' }),
      navRow({ act: 'devices', ic: 'phone', title: '已登记的设备', sub: '哪些设备会收到推送' }),
      html`<label class="field"><span class="field-label">邮件提醒<small>收不到推送时用，多个邮箱用逗号隔开</small></span><span class="field-ctl"><input type="email" multiple data-set="email" value="${s.email || ''}" placeholder="填写收件邮箱" inputmode="email" autocapitalize="off" autocorrect="off" spellcheck="false"></span></label>`,
      html`<label class="field"><span class="field-label">其他提醒<small>微信 / 群机器人，粘贴 Key 或机器人地址</small></span><span class="field-ctl"><input data-set="hooks" value="${s.hooks || ''}" placeholder="SCT… / sctp… / 机器人地址" autocapitalize="off" autocorrect="off" spellcheck="false"></span></label>`,
      navRow({ act: 'hooks-guide', ic: 'bell', title: '怎么获取 Key / 机器人地址', sub: 'Server酱、PushPlus、企业微信、钉钉、飞书' }),
      html`<div class="field"><span class="field-label">同时建 GitHub Issue<small>装了 GitHub App 也会收到</small></span><span class="field-ctl">${setToggle('issue', s.issue)}</span></div>`,
    ])}
    <p class="foot-note">北京时间，由数据仓库里的 GitHub 定时任务发送；GitHub 高峰期可能晚几分钟到半小时。没有事项的时段不打扰。</p>
    ${section('规划', [
      navRow({ act: 'species', ic: 'sprout', title: '物种与默认间隔', value: `${species.length} 个` }),
      navRow({ act: 'away', ic: 'suitcase', title: '不在实验室的日期', sub: '假期、出差：提前提醒期间要到期的事', value: away.length ? `${away.length} 段` : '' }),
    ])}
    ${section('数据', [
      navRow({ act: 'export-md', ic: 'note', title: '导出记录（Markdown）', sub: '按日期整理，适合贴进 Obsidian / 实验记录' }),
      navRow({ act: 'export-csv', ic: 'download', title: '导出记录（CSV）', sub: 'Excel / Numbers 打开' }),
      navRow({ act: 'export-json', ic: 'download', title: '导出完整备份（JSON）' }),
      navRow({ act: 'import', ic: 'upload', title: '从备份导入', sub: '与现有数据合并，不会覆盖' }),
    ])}
    ${section('本机', [
      html`<label class="field"><span class="field-label">设备名称</span><span class="field-ctl"><input data-cfg="deviceName" value="${state.cfg.deviceName || ''}" placeholder="如 我的 iPhone"></span></label>`,
      navRow({ act: 'install-guide', ic: 'phone', title: '安装到主屏幕 / 桌面', sub: 'iPhone、安卓、Mac、Windows 的安装方法' }),
      html`<div class="field"><span class="field-label">版本</span><span class="field-ctl muted">v${APP_VERSION}</span></div>`,
    ])}
    <input type="file" id="import-file" accept=".json,application/json" hidden>`;
}
