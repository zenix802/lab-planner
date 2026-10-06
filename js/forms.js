// 各种弹层表单
import { html, attr } from './html.js';
import {
  TYPES, TYPE_ORDER, addDays, buildIndex, diffDays, fmtCN, fmtMD, isDate, makeCompletion, maxDate, nextDue, relText,
  serialize, templateTasks, weekCN, weekday,
} from './core.js';
import {
  state, actions, today, index, find, isConnected, connect, disconnect, syncNow, ensureEngine, registerDevice, listDevices,
  removeDevice, testRemote, lastRuns, saveCfg, errText, ensureVapid,
} from './store.js';
import { ui, icon, TYPE_ICON, openSheet, closeSheet, refreshSheet, topSheet, sheetHead, field, stepper, seg, toggle, navRow, toast, confirmDialog, fmtTime, selectCtl } from './ui.js';
import { pushEnv, subscribePush } from './push.js';
import { ruleText, T } from './views.js';
import { readTable, planImport, TEMPLATE_XLSX, TEMPLATE_CSV } from './bulk.js';

const activeSpecies = () => state.data.species.filter((s) => !s.deleted).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
const clampInt = (v, min, max = 9999) => Math.min(max, Math.max(min, Math.round(+v) || 0));

// ═════════════ 新建 / 编辑批次 ═════════════

function autoName(st) {
  const sp = st.speciesId && find('species', st.speciesId);
  return `${sp && !sp.deleted ? sp.name : ''}${TYPES[st.type].label} ${fmtMD(st.start)}`.trim();
}
function draftNext(t, start) {
  return t.kind === 'once' ? addDays(start, t.offset || 0) : maxDate(addDays(start, clampInt(t.every, 1)), today());
}
function makeDrafts(st) {
  const sp = st.speciesId && find('species', st.speciesId);
  return templateTasks(st.type, sp).map((t) => ({ include: true, prep: '', gen0: 0, ...t, next: draftNext(t, st.start), nextTouched: false }));
}
function recalc(st) {
  for (const t of st.tasks || []) if (!t.nextTouched) t.next = draftNext(t, st.start);
}

export function openBatchForm({ id, preset = {} } = {}) {
  if (id) {
    const b = find('batches', id);
    if (!b) return;
    return openSheet({
      kind: 'form',
      state: { mode: 'edit', id, type: b.type, name: b.name, nameTouched: true, speciesId: b.speciesId || '', start: b.start, qty: b.qty ?? '', unit: b.unit || TYPES[b.type].units[0], location: b.location || '', medium: b.medium || '', note: b.note || '' },
      render: renderBatchForm,
      onChange: batchFormChange,
    });
  }
  const type = preset.type || 'seedling';
  const sp = activeSpecies();
  const st = {
    mode: 'new', type, speciesId: preset.speciesId ?? (type === 'seedling' && sp[0] ? sp[0].id : ''), start: preset.start || today(),
    qty: '', unit: TYPES[type].units[0], location: preset.location || '', medium: preset.medium || '', note: '', parentId: preset.parentId || '',
    name: preset.name || '', nameTouched: !!preset.name,
  };
  st.tasks = makeDrafts(st);
  if (!st.nameTouched) st.name = autoName(st);
  openSheet({ kind: 'form', state: st, render: renderBatchForm, onChange: batchFormChange });
}

function batchFormChange(st, path, value) {
  if (path === 'name') {
    st.nameTouched = true;
    return false;
  }
  if (path === 'start') {
    if (!isDate(value)) return false;
    recalc(st);
    if (!st.nameTouched) st.name = autoName(st);
    return true;
  }
  if (path === 'speciesId') {
    const sp = find('species', value);
    if (st.mode === 'new' && sp) {
      for (const t of st.tasks) {
        if (t.name === '浇水') t.every = sp.water;
        if (t.name === '浇营养液') t.every = sp.feed;
      }
      recalc(st);
    }
    if (!st.nameTouched) st.name = autoName(st);
    return true;
  }
  const m = /^tasks\.(\d+)\.(\w+)$/.exec(path);
  if (m) {
    const t = st.tasks[+m[1]];
    const k = m[2];
    if (k === 'every') {
      if (!t.nextTouched) t.next = draftNext(t, st.start);
      return true;
    }
    if (k === 'next') {
      t.nextTouched = true;
      if (t.kind === 'once' && isDate(value)) t.offset = diffDays(st.start, value);
      return false;
    }
    return k === 'lead' || k === 'include' || k === 'kind';
  }
  return false;
}

function taskDraftRow(t, i) {
  const p = `tasks.${i}`;
  return html`<div class="draft ${t.include ? '' : 'off'}">
    <label class="draft-chk"><input type="checkbox" data-bind="${p}.include"${attr('checked', t.include)} aria-label="包含这个任务"></label>
    <div class="grow">
      <input class="draft-name" data-bind="${p}.name" value="${t.name}" placeholder="任务名，如 浇水 / 取样" aria-label="任务名">
      ${t.kind === 'once' ? '' : html`<div class="draft-line"><span class="dl">间隔</span><span>每</span>${stepper(p + '.every', t.every, { min: 1 })}<span>天</span></div>`}
      <div class="draft-line"><span class="dl">${t.kind === 'once' ? '日期' : '下次'}</span><input type="date" data-bind="${p}.next" value="${t.next}" aria-label="${t.kind === 'once' ? '日期' : '下次日期'}"></div>
      <div class="draft-line"><span class="dl">提前</span>${stepper(p + '.lead', t.lead, { min: 0, max: 30 })}<span>天提醒准备</span></div>
      ${t.countGen ? html`<div class="draft-line"><span class="dl">代数</span><span>现在第</span>${stepper(p + '.gen0', t.gen0, { min: 0 })}<span>代</span></div>` : ''}
      ${t.lead > 0 ? html`<input class="draft-prep" data-bind="${p}.prep" value="${t.prep || ''}" placeholder="要准备什么，如 配制并灭菌培养基">` : ''}
    </div>
  </div>`;
}

function renderBatchForm(st) {
  const ty = TYPES[st.type];
  const sp = activeSpecies();
  const isTC = ['callus', 'shoot', 'rooting'].includes(st.type);
  const units = [...new Set([...ty.units, st.unit].filter(Boolean))];
  const future = st.start > today();
  return html`${sheetHead(st.mode === 'new' ? '新建批次' : '编辑批次', { right: st.mode === 'new' ? '创建' : '保存', rightAct: 'bf-save' })}
  <div class="sheet-body">
    ${st.mode === 'new'
      ? html`<div class="type-grid">${TYPE_ORDER.map((k) => html`<button type="button" class="type-tile ${k === st.type ? 'on' : ''}" data-act="bf-type" data-v="${k}" style="--c:${TYPES[k].color}">${icon(TYPE_ICON[k])}<span>${TYPES[k].label}</span></button>`)}</div>`
      : ''}
    <div class="list form">
      ${field('名称', html`<input data-bind="name" value="${st.name}" placeholder="如 茅栗实生苗 A" autocomplete="off">`, { tag: 'label' })}
      ${field('物种', selectCtl('speciesId', st.speciesId, [['', '不指定'], ...sp.map((s) => [s.id, s.name])]))}
      ${field(ty.startLabel, html`<input type="date" data-bind="start" value="${st.start}">`, { tag: 'label', hint: future ? `这是未来日期：会作为“计划${ty.startVerb}”出现在待办和日历里` : '' })}
      ${field('数量', html`<input type="number" inputmode="numeric" class="short" data-bind="qty" value="${st.qty}" placeholder="选填">${selectCtl('unit', st.unit, units.map((u) => [u, u]))}`)}
      ${field('位置', html`<input data-bind="location" value="${st.location}" placeholder="如 温室 2 / 组培间 B 架">`, { tag: 'label' })}
      ${isTC || st.medium ? field('培养基', html`<input data-bind="medium" value="${st.medium}" placeholder="如 MS + 2 mg/L 2,4-D">`, { tag: 'label' }) : ''}
      ${field('备注', html`<textarea data-bind="note" rows="2" placeholder="选填，如 基因型 / 载体 / 独立株系编号">${st.note}</textarea>`, { tag: 'label', cls: 'stack' })}
    </div>
    ${st.mode === 'new'
      ? html`<div class="sec-title"><span>自动生成的任务</span><button type="button" class="sec-btn" data-act="bf-add-task">${icon('plus')}添加</button></div>
        <div class="list form drafts">${st.tasks.length ? st.tasks.map(taskDraftRow) : html`<div class="empty-row">没有预设任务，点右上“添加”</div>`}</div>
        <p class="foot-note">“下次”默认从${ty.startLabel}推算；如果这批已经在做了，把它改成真正的下一次日期即可。之后每次打勾，都从实际完成那天往后顺延。</p>`
      : html`<p class="foot-note">任务的间隔、提前提醒等，在批次页里点任务修改。</p>`}
  </div>`;
}

function draftToTask(t, start) {
  const lead = clampInt(t.lead, 0, 30);
  const base = { name: String(t.name).trim(), kind: t.kind, lead, prep: lead > 0 ? String(t.prep || '').trim() : '' };
  if (t.kind === 'once') return { ...base, offset: isDate(t.next) ? diffDays(start, t.next) : t.offset || 0 };
  const every = clampInt(t.every, 1);
  const out = { ...base, every, mode: t.mode || 'float', firstOffset: isDate(t.next) ? diffDays(start, t.next) : every };
  if (t.countGen) Object.assign(out, { countGen: true, gen0: clampInt(t.gen0, 0) });
  return out;
}

export function saveBatchForm(st, go) {
  if (!isDate(st.start)) return toast('请填写日期');
  const base = {
    type: st.type, name: String(st.name || '').trim() || autoName(st), speciesId: st.speciesId || undefined, start: st.start,
    qty: st.qty === '' || st.qty == null ? undefined : Number(st.qty), unit: st.unit, location: String(st.location || '').trim(),
    medium: String(st.medium || '').trim(), note: String(st.note || '').trim(), planned: st.start > today(),
  };
  if (st.mode === 'edit') {
    actions.updateBatch(st.id, base);
    closeSheet();
    toast('已保存');
    return;
  }
  const tasks = st.tasks.filter((t) => t.include && String(t.name || '').trim()).map((t) => draftToTask(t, st.start));
  const b = actions.createBatch({ ...base, parentId: st.parentId || undefined }, tasks);
  closeSheet();
  go(`batch/${b.id}`);
  toast(`已创建「${b.name}」${tasks.length ? `，${tasks.length} 个任务已排好` : ''}`);
}

/** 新建表单里切换类型：重新生成该类型的模板任务 */
export function setBatchType(st, type) {
  st.type = type;
  st.unit = TYPES[type].units[0];
  st.tasks = makeDrafts(st);
  if (!st.nameTouched) st.name = autoName(st);
}

export function addDraftTask(st) {
  const t = { include: true, name: '', kind: 'repeat', every: 7, mode: 'float', lead: 0, prep: '' };
  st.tasks.push({ ...t, next: draftNext(t, st.start), nextTouched: false });
}

// ═════════════ 任务 ═════════════

export function openTaskForm({ id, batchId }) {
  const idx = index();
  let st;
  if (id) {
    const t = idx.tasks.get(id);
    if (!t) return;
    const b = idx.batches.get(t.batchId);
    const logs = idx.logsByTask.get(id) || [];
    st = {
      mode: 'edit', id, batchId: t.batchId, name: t.name, kind: t.kind || 'repeat', every: t.every || 7, sched: t.mode || 'float',
      next: nextDue(t, b, logs) || '', lead: t.lead || 0, prep: t.prep || '', note: t.note || '', countGen: !!t.countGen, gen0: t.gen0 || 0,
      paused: !!t.paused, hasLogs: logs.some((l) => l.kind === 'done' || l.kind === 'skip'),
    };
  } else {
    const b = idx.batches.get(batchId);
    if (!b) return;
    st = { mode: 'new', batchId, name: '', kind: 'repeat', every: 7, sched: 'float', next: maxDate(today(), addDays(b.start, 7)), lead: 0, prep: '', note: '', countGen: false, gen0: 0, paused: false, hasLogs: false };
  }
  st.hadOverride = !!(id && idx.tasks.get(id).override);
  st.nextTouched = false;
  openSheet({ kind: 'form', state: st, render: renderTaskForm, onChange: taskFormChange });
}

/** 改了间隔/排法而没手动改日期时，实时显示新的“下次日期” */
function taskFormChange(st, path) {
  if (path === 'next') {
    st.nextTouched = true;
    return false;
  }
  if ((path === 'every' || path === 'sched') && st.kind === 'repeat' && st.hasLogs && !st.nextTouched && !st.hadOverride) {
    const idx = index();
    const cur = idx.tasks.get(st.id);
    const b = idx.batches.get(st.batchId);
    if (cur && b) st.next = nextDue({ ...cur, kind: 'repeat', every: clampInt(st.every, 1), mode: st.sched, override: null }, b, idx.logsByTask.get(st.id) || []) || st.next;
    return true;
  }
  return ['kind', 'sched', 'countGen', 'lead', 'every'].includes(path);
}

function renderTaskForm(st) {
  const rep = st.kind === 'repeat';
  const done = st.mode === 'edit' && !st.next;
  return html`${sheetHead(st.mode === 'new' ? '添加任务' : '编辑任务', { right: '保存', rightAct: 'tf-save' })}
  <div class="sheet-body">
    <div class="quick">${['浇水', '浇营养液', '继代', '生根观察', '炼苗', '移栽', '接种', '取样', '拍照'].map((n) => html`<button type="button" class="chip-btn ${st.name === n ? 'on' : ''}" data-act="tf-name" data-v="${n}">${n}</button>`)}</div>
    <div class="list form">
      ${field('名称', html`<input data-bind="name" value="${st.name}" placeholder="如 浇水 / 继代 / 取样">`, { tag: 'label' })}
      ${field('类型', seg('kind', st.kind, [['repeat', '周期性'], ['once', '单次']]))}
      ${rep ? field('间隔', html`<span class="inline">每 ${stepper('every', st.every, { min: 1 })} 天</span>`) : ''}
      ${rep ? field('排法', seg('sched', st.sched, [['float', '按实际完成顺延'], ['fixed', '固定节奏']]), { hint: st.sched === 'fixed' ? '如“每周一浇营养液”：早做晚做，后面的计划日都不变' : '晚做一天，下一次也往后推一天（浇水、继代一般用这个）' }) : ''}
      ${done ? '' : field(rep ? '下次日期' : '日期', html`<input type="date" data-bind="next" value="${st.next}">`, { tag: 'label', hint: rep && st.hasLogs ? '只改这一次，之后照常按间隔顺延' : '' })}
      ${field('提前提醒', html`<span class="inline">${stepper('lead', st.lead, { min: 0, max: 30 })} 天</span>`, { hint: '到期前几天的早间推送会提醒你准备（配培养基、配营养液等）' })}
      ${st.lead > 0 ? field('要准备', html`<input data-bind="prep" value="${st.prep}" placeholder="如 配制并灭菌培养基">`, { tag: 'label' }) : ''}
      ${field('备注', html`<input data-bind="note" value="${st.note}" placeholder="如 1/2 Hoagland，每盆 50 mL">`, { tag: 'label' })}
      ${rep ? field('记录代数', toggle('countGen', st.countGen), { hint: st.countGen ? '' : '继代类任务建议打开，每次完成自动 +1 代' }) : ''}
      ${rep && st.countGen ? field('开始时第几代', stepper('gen0', st.gen0, { min: 0 })) : ''}
      ${field('暂停提醒', toggle('paused', st.paused))}
    </div>
    ${st.mode === 'edit' ? html`<button type="button" class="btn ghost danger block" data-act="tf-delete">${icon('trash')}删除任务</button>` : ''}
  </div>`;
}

export function saveTaskForm(st) {
  const name = String(st.name || '').trim();
  if (!name) return toast('请填写任务名称');
  const b = find('batches', st.batchId);
  if (!b) return closeSheet();
  const lead = clampInt(st.lead, 0, 30);
  const patch = { batchId: st.batchId, name, kind: st.kind, lead, prep: lead > 0 ? String(st.prep || '').trim() : '', note: String(st.note || '').trim(), paused: !!st.paused };
  if (st.kind === 'once') {
    Object.assign(patch, { offset: isDate(st.next) ? diffDays(b.start, st.next) : 0, override: null, countGen: false });
  } else {
    const every = clampInt(st.every, 1);
    Object.assign(patch, { every, mode: st.sched, countGen: !!st.countGen, gen0: st.countGen ? clampInt(st.gen0, 0) : undefined });
    if (st.mode === 'edit' && st.hasLogs) {
      const cur = find('tasks', st.id);
      const natural = nextDue({ ...cur, ...patch, override: null }, b, index().logsByTask.get(st.id) || []);
      if (st.nextTouched) patch.override = isDate(st.next) && st.next !== natural ? st.next : null;
      else patch.override = cur.override || null; // 没动日期：保留原来的推迟设置
    } else {
      patch.firstOffset = isDate(st.next) ? diffDays(b.start, st.next) : every;
      patch.override = null;
    }
  }
  actions.saveTask(st.mode === 'edit' ? { id: st.id, ...patch } : patch);
  closeSheet();
  toast('已保存');
}

// ═════════════ 完成于其他日期 / 推迟 ═════════════

export function openCompleteForm(taskId, kind = 'done') {
  openSheet({ kind: 'form', state: { taskId, date: today(), kind, note: '' }, render: renderCompleteForm, onChange: (s, p) => p === 'date' || p === 'kind' });
}
function renderCompleteForm(st) {
  const idx = index();
  const t = idx.tasks.get(st.taskId);
  const b = t && idx.batches.get(t.batchId);
  if (!t || !b) return html`${sheetHead('记录')}<div class="sheet-body"><div class="empty-row">任务不存在</div></div>`;
  const logs = idx.logsByTask.get(t.id) || [];
  let preview = '';
  if (isDate(st.date)) {
    const log = makeCompletion(t, b, logs, { date: st.date, kind: st.kind });
    const n = nextDue({ ...t, override: null }, b, [...logs, log]);
    preview = n ? `保存后，下次是 ${fmtCN(n)} ${weekCN(n)}（${relText(n, today())}）` : '保存后这个单次任务就完成了';
    if (log.gen) preview = `记为第 ${log.gen} 代。` + preview;
  }
  return html`${sheetHead('记录', { right: '保存', rightAct: 'cf-save' })}
  <div class="sheet-body">
    <div class="sheet-lead" style="--c:${T(b.type).color}"><span class="bar"></span><div><div class="t1">${t.name}</div><div class="t2">${b.name} · ${ruleText(t)}</div></div></div>
    <div class="list form">
      ${field('结果', seg('kind', st.kind, [['done', '完成'], ['skip', '跳过这一次']]))}
      ${field('日期', html`<input type="date" data-bind="date" value="${st.date}" max="${addDays(today(), 7)}">`, { tag: 'label' })}
      ${field('备注', html`<textarea data-bind="note" rows="2" placeholder="选填，如 土偏干多浇了些 / 污染 2 瓶已丢弃">${st.note}</textarea>`, { tag: 'label', cls: 'stack' })}
    </div>
    ${preview ? html`<p class="foot-note strong">${preview}</p>` : ''}
  </div>`;
}

export function openPostpone(key) {
  const td = today();
  const isStart = key.startsWith('start:');
  const nextMon = addDays(td, ((8 - weekday(td)) % 7) || 7);
  const opts = [['明天', addDays(td, 1)], ['后天', addDays(td, 2)], ['3 天后', addDays(td, 3)], ['下周一', nextMon]];
  openSheet({
    kind: 'form',
    state: { key, date: addDays(td, 1) },
    render: (st) => html`${sheetHead(isStart ? '修改计划日期' : '推迟 / 调整这一次', { right: '确定', rightAct: 'pp-save' })}
      <div class="sheet-body">
        <div class="quick">${opts.map(([l, d]) => html`<button type="button" class="chip-btn ${st.date === d ? 'on' : ''}" data-act="pp-pick" data-v="${d}">${l} · ${fmtMD(d)}</button>`)}</div>
        <div class="list form">${field('日期', html`<input type="date" data-bind="date" value="${st.date}">`, { tag: 'label' })}</div>
        <p class="foot-note">${isStart ? '批次的开始日期会一起改。' : '只影响这一次；做完打勾后，下一次照常按间隔从完成日顺延。'}</p>
      </div>`,
    onChange: (s, p) => p === 'date',
  });
}

// ═════════════ 记录（记一笔 / 编辑） ═════════════

export function openNoteForm({ batchId, logId }) {
  let st;
  if (logId) {
    const l = find('logs', logId);
    if (!l) return;
    st = { mode: 'edit', id: logId, batchId: l.batchId, date: l.date, title: l.title || '', note: l.note || '', kind: l.kind, gen: l.gen ?? '', isTask: !!l.taskId, device: l.device || '' };
  } else st = { mode: 'new', batchId, date: today(), title: '', note: '', kind: 'note' };
  openSheet({ kind: 'form', state: st, render: renderNoteForm, onChange: (s, p) => p === 'kind' });
}
function renderNoteForm(st) {
  const b = find('batches', st.batchId);
  return html`${sheetHead(st.mode === 'new' ? '记一笔' : '编辑记录', { right: '保存', rightAct: 'nf-save' })}
  <div class="sheet-body">
    ${b ? html`<div class="sheet-lead" style="--c:${T(b.type).color}"><span class="bar"></span><div><div class="t1">${b.name}</div><div class="t2">${T(b.type).label}</div></div></div>` : ''}
    ${st.mode === 'new' ? html`<div class="quick">${['观察', '拍照', '取样', '污染丢弃', '补苗', '换盆', '接种', '转培养基'].map((n) => html`<button type="button" class="chip-btn ${st.title === n ? 'on' : ''}" data-act="nf-title" data-v="${n}">${n}</button>`)}</div>` : ''}
    <div class="list form">
      ${st.isTask ? html`<div class="field"><span class="field-label">事项</span><span class="field-ctl">${st.title}</span></div>` : field('事项', html`<input data-bind="title" value="${st.title}" placeholder="如 观察到根瘤 / 污染丢弃 2 瓶">`, { tag: 'label' })}
      ${st.isTask ? field('结果', seg('kind', st.kind, [['done', '完成'], ['skip', '跳过']])) : ''}
      ${field('日期', html`<input type="date" data-bind="date" value="${st.date}">`, { tag: 'label' })}
      ${st.isTask && st.kind === 'done' && st.gen !== '' ? field('代数', stepper('gen', st.gen, { min: 0 })) : ''}
      ${field('备注', html`<textarea data-bind="note" rows="3" placeholder="选填">${st.note}</textarea>`, { tag: 'label', cls: 'stack' })}
    </div>
    ${st.device ? html`<p class="foot-note">记录自：${st.device}</p>` : ''}
    ${st.mode === 'edit' ? html`<button type="button" class="btn ghost danger block" data-act="nf-delete">${icon('trash')}删除这条记录</button>` : ''}
  </div>`;
}
export function saveNoteForm(st) {
  if (!isDate(st.date)) return toast('请填写日期');
  if (st.mode === 'new') {
    const title = String(st.title || '').trim();
    if (!title && !String(st.note || '').trim()) return toast('写点什么吧');
    actions.addNote(st.batchId, { date: st.date, title: title || '备注', note: String(st.note || '').trim() });
  } else {
    const patch = { date: st.date, note: String(st.note || '').trim() };
    if (!st.isTask) patch.title = String(st.title || '').trim() || '备注';
    if (st.isTask) patch.kind = st.kind;
    if (st.isTask && st.gen !== '' && st.kind === 'done') patch.gen = clampInt(st.gen, 0);
    actions.updateLog(st.id, patch);
  }
  closeSheet();
  toast('已保存');
}

// ═════════════ 物种 ═════════════

export function openSpeciesList() {
  openSheet({
    kind: 'form',
    render: () => html`${sheetHead('物种与默认间隔', { left: '完成' })}
      <div class="sheet-body">
        <div class="list">
          ${activeSpecies().map((s) => navRow({ act: 'sp-edit', id: s.id, title: s.name, sub: s.latin || '', value: `浇水 ${s.water} 天 · 营养液 ${s.feed} 天` }))}
          <button type="button" class="row add" data-act="sp-new">${icon('plus')}<span>添加物种</span></button>
        </div>
        <p class="foot-note">新建实生苗批次时按这里预填浇水、营养液间隔（默认值只是起点，按你的盆大小、基质、温室条件改）。已建的批次在批次页里单独改。</p>
      </div>`,
  });
}
export function openSpeciesForm(id) {
  const s = id ? find('species', id) : null;
  openSheet({
    kind: 'form',
    state: s ? { id, name: s.name, latin: s.latin || '', water: s.water, feed: s.feed } : { name: '', latin: '', water: 3, feed: 7 },
    render: (st) => html`${sheetHead(id ? '编辑物种' : '添加物种', { right: '保存', rightAct: 'spf-save' })}
      <div class="sheet-body">
        <div class="list form">
          ${field('名称', html`<input data-bind="name" value="${st.name}" placeholder="如 拟南芥">`, { tag: 'label' })}
          ${field('学名', html`<input data-bind="latin" value="${st.latin}" placeholder="选填">`, { tag: 'label' })}
          ${field('浇水', html`<span class="inline">每 ${stepper('water', st.water, { min: 1 })} 天</span>`)}
          ${field('浇营养液', html`<span class="inline">每 ${stepper('feed', st.feed, { min: 1 })} 天</span>`)}
        </div>
        ${id ? html`<button type="button" class="btn ghost danger block" data-act="spf-delete">${icon('trash')}删除物种</button>` : ''}
      </div>`,
  });
}

// ═════════════ 不在实验室的日期 ═════════════

export function openAway() {
  const td = today();
  openSheet({
    kind: 'form',
    state: { from: td, to: addDays(td, 6), note: '' },
    onChange: () => false,
    render: (st) => {
      const list = state.data.away.filter((a) => !a.deleted).sort((a, b) => (a.from < b.from ? 1 : -1));
      return html`${sheetHead('不在实验室的日期', { left: '完成' })}
      <div class="sheet-body">
        <div class="list form">
          ${field('从', html`<input type="date" data-bind="from" value="${st.from}">`, { tag: 'label' })}
          ${field('到', html`<input type="date" data-bind="to" value="${st.to}">`, { tag: 'label' })}
          ${field('说明', html`<input data-bind="note" value="${st.note}" placeholder="如 国庆 / 出差 / 开会">`, { tag: 'label' })}
        </div>
        <button type="button" class="btn block" data-act="away-add">${icon('plus')}添加</button>
        <div class="list">${list.length ? list.map((a) => html`<div class="row ${a.to < td ? 'past' : ''}"><span class="row-ic">${icon('suitcase')}</span><span class="grow"><span class="t1">${fmtMD(a.from)} ${weekCN(a.from)} – ${fmtMD(a.to)} ${weekCN(a.to)}</span><span class="t2">${a.note || '不在实验室'} · ${diffDays(a.from, a.to) + 1} 天${a.to < td ? ' · 已过去' : ''}</span></span><button type="button" class="icon-btn danger" data-act="away-del" data-id="${a.id}" aria-label="删除">${icon('trash')}</button></div>`) : html`<div class="empty-row">还没有添加</div>`}</div>
        <p class="foot-note">日历里会标出这些日子；出发前 3 天起，早间推送会提醒这段时间里要到期的事，方便提前处理或托人代劳。</p>
      </div>`;
    },
  });
}

// ═════════════ GitHub 连接 ═════════════

export function openGithub(invite = {}) {
  const invited = !!(invite.owner && invite.repo);
  openSheet({
    kind: 'form',
    state: { owner: invite.owner || state.cfg.owner || '', repo: invite.repo || state.cfg.repo || 'lab-planner-data', token: '', invited, busy: false, msg: '', err: '' },
    render: renderGithub,
  });
}
function renderGithub(st) {
  if (isConnected()) {
    const url = `https://github.com/${state.cfg.owner}/${state.cfg.repo}`;
    return html`${sheetHead('GitHub 同步', { left: '完成' })}
    <div class="sheet-body">
      ${state.cfg.isPrivate === false ? html`<div class="card hint warn static"><span class="card-ic">${icon('alert')}</span><span class="grow"><span class="t1">这个仓库是公开的</span><span class="t2">任何人都能看到你的实验记录。建议在 GitHub 仓库 Settings 里改成 Private。</span></span></div>` : ''}
      <div class="list">
        <div class="kv"><span class="k">数据仓库</span><span class="v">${state.cfg.owner}/${state.cfg.repo}</span></div>
        <div class="kv"><span class="k">上次同步</span><span class="v">${fmtTime(state.meta.lastSync)}</span></div>
        ${state.sync.error ? html`<div class="kv err"><span class="k">状态</span><span class="v">${state.sync.error}</span></div>` : ''}
        <a class="row nav" href="${url}" target="_blank" rel="noopener"><span class="row-ic">${icon('external')}</span><span class="grow"><span class="t1">在 GitHub 上查看</span><span class="t2">每次改动都有提交记录，可以回溯任何历史版本</span></span></a>
        <a class="row nav" href="${url}/actions" target="_blank" rel="noopener"><span class="row-ic">${icon('clock')}</span><span class="grow"><span class="t1">查看提醒任务运行记录</span></span></a>
      </div>
      ${st.msg ? html`<p class="foot-note strong">${st.msg}</p>` : ''}${st.err ? html`<p class="foot-note error">${st.err}</p>` : ''}
      <button type="button" class="btn block" data-act="gh-sync"${attr('disabled', st.busy)}>${icon('sync')}立即同步</button>
      <button type="button" class="btn ghost block" data-act="gh-reinstall"${attr('disabled', st.busy)}>重新安装提醒脚本</button>
      <button type="button" class="btn ghost danger block" data-act="gh-disconnect">断开连接（本机数据保留）</button>
    </div>`;
  }
  return html`${sheetHead('连接 GitHub', { right: st.busy ? '' : '连接', rightAct: 'gh-connect' })}
  <div class="sheet-body">
    ${st.invited ? html`<ol class="steps">
      <li><b>数据仓库已经建好</b>，用户名和仓库名已自动填好，不用改。</li>
      <li><b>粘贴 Token</b>：把单独发给你的那串 <code>github_pat_…</code> 粘贴到下面，点「连接并初始化」。Token 只保存在这台设备上，请不要转发给别人。</li>
    </ol>` : html`<ol class="steps">
      <li><b>新建一个私有仓库</b>用来放数据：名字填 <code>lab-planner-data</code>，选 <b>Private</b>，勾选 “Add a README file”。
        <a class="inline-link" href="https://github.com/new?name=lab-planner-data&visibility=private" target="_blank" rel="noopener">打开 GitHub 新建仓库 ${icon('external')}</a></li>
      <li><b>生成 Token</b>（Fine-grained）：Repository access 选 <b>Only select repositories</b> → 这个仓库；Permissions 里把 <b>Contents、Workflows、Actions</b> 都设为 <b>Read and write</b>。有效期选最长。
        <a class="inline-link" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">打开 Token 页面 ${icon('external')}</a></li>
      <li><b>粘贴到下面</b>。Token 只保存在这台设备上；每台设备各粘贴一次（可以用同一个）。</li>
    </ol>`}
    <div class="list form">
      ${field('GitHub 用户名', html`<input data-bind="owner" value="${st.owner}" placeholder="如 zenix802" autocapitalize="off" autocorrect="off" spellcheck="false">`, { tag: 'label' })}
      ${field('数据仓库', html`<input data-bind="repo" value="${st.repo}" autocapitalize="off" autocorrect="off" spellcheck="false">`, { tag: 'label' })}
      ${field('Token', html`<input type="password" data-bind="token" value="${st.token}" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false">`, { tag: 'label' })}
    </div>
    ${st.msg ? html`<p class="foot-note strong">${st.busy ? html`<span class="spinner"></span>` : ''}${st.msg}</p>` : ''}
    ${st.err ? html`<p class="foot-note error">${st.err}</p>` : ''}
    <button type="button" class="btn block" data-act="gh-connect"${attr('disabled', st.busy)}>${st.busy ? '连接中…' : '连接并初始化'}</button>
    <p class="foot-note">连接时会在这个仓库里写入：数据文件 <code>data/planner.json</code>、提醒脚本 <code>scripts/</code>、定时任务 <code>.github/workflows/remind.yml</code> 和推送密钥 <code>push/</code>。</p>
  </div>`;
}

export async function doConnect(sheet) {
  const st = sheet.state;
  const owner = String(st.owner || '').trim();
  const repo = String(st.repo || '').trim();
  const token = String(st.token || '').trim();
  if (!owner || !repo || !token) {
    st.err = '三项都要填';
    return refreshSheet(sheet);
  }
  st.busy = true;
  st.err = '';
  st.msg = '连接中…';
  refreshSheet(sheet);
  try {
    await connect({ owner, repo, token }, (m) => {
      st.msg = m;
      refreshSheet(sheet);
    });
    st.busy = false;
    st.msg = '';
    closeSheet(sheet);
    toast('已连接 ✓ 数据已同步，提醒任务已安装');
  } catch (e) {
    st.busy = false;
    st.msg = '';
    st.err = e.status ? errText(e) : e.message || String(e);
    if (isConnected()) st.err += '（数据同步已可用；修好权限后点“重新安装提醒脚本”）';
    refreshSheet(sheet);
  }
}

export async function ghSync(sheet) {
  sheet.state.busy = true;
  refreshSheet(sheet);
  await syncNow();
  sheet.state.busy = false;
  sheet.state.msg = state.sync.error ? '' : '已同步 ✓';
  sheet.state.err = state.sync.error;
  refreshSheet(sheet);
}
export async function ghReinstall(sheet) {
  sheet.state.busy = true;
  sheet.state.msg = '正在安装…';
  sheet.state.err = '';
  refreshSheet(sheet);
  try {
    if (!state.cfg.vapidPublic) await ensureVapid();
    await ensureEngine(true);
    sheet.state.msg = '提醒脚本和定时任务已更新 ✓';
  } catch (e) {
    sheet.state.msg = '';
    sheet.state.err = e.status ? errText(e) : e.message;
  }
  sheet.state.busy = false;
  refreshSheet(sheet);
}
export async function ghDisconnect() {
  if (!(await confirmDialog({ title: '断开 GitHub 连接？', message: '本机数据会保留，但不再同步、也收不到提醒。', ok: '断开', danger: true }))) return;
  disconnect();
  closeSheet();
  toast('已断开');
}

// ═════════════ 推送 ═════════════

export async function enablePush(swReg, rerender) {
  const env = pushEnv();
  if (env.ios && !env.standalone) return openInstallGuide();
  if (env.sw && !swReg) return toast('应用还在初始化，请过两秒再点一次');
  if (env.inApp) return openInstallGuide();
  if (!env.push) return toast('这个浏览器不支持推送：可以在「设置 → 每天提醒」里填写邮件地址，改用邮件提醒', { ms: 6000 });
  if (!isConnected()) {
    toast('先连接 GitHub：提醒由你仓库里的定时任务发送');
    return openGithub();
  }
  if (!state.cfg.vapidPublic) {
    toast('正在准备推送密钥…');
    try {
      await ensureVapid();
      toast('准备好了，请再点一次“开启”', { ms: 5000 });
    } catch (e) {
      toast(e.status ? errText(e) : e.message, { ms: 6000 });
    }
    return;
  }
  try {
    const sub = await subscribePush(swReg, state.cfg.vapidPublic); // 第一步就是弹出授权（必须由点击直接触发）
    await registerDevice(sub);
    ui.pushLost = false;
    rerender();
    toast('本机提醒已开启 ✓');
    swReg.showNotification('✅ 提醒已开启', { body: '每天早晚会在这里提醒你今天和明天的实验安排。', tag: 'enabled', icon: 'icons/icon-192.png' }).catch(() => {});
  } catch (e) {
    toast(e.status ? errText(e) : pushErrText(e), { ms: 8000 });
  }
}
/** subscribe() 失败多半是连不上浏览器的推送服务（安卓 Chrome 依赖 Google 服务，国内网络通常连不上） */
function pushErrText(e) {
  const m = (e && e.message) || String(e);
  if ((e && e.name === 'AbortError') || /push service|Registration failed|gcm|fcm/i.test(m)) {
    return '这台设备连不上浏览器的推送服务（安卓 Chrome 依赖 Google 服务，国内网络通常连不上）。请在「设置 → 每天提醒」里填写邮件地址，改用邮件提醒。';
  }
  return m;
}

export function openTestPush(swReg) {
  openSheet({
    kind: 'form',
    state: { status: '', runs: null },
    render: (st) => html`${sheetHead('测试通知', { left: '完成' })}
      <div class="sheet-body">
        <div class="list">
          ${navRow({ act: 'tp-local', ic: 'phone', title: '本机测试（立刻）', sub: '确认这台设备能弹出通知', chevron: false })}
          ${navRow({ act: 'tp-remote', ic: 'cloud', title: '完整测试（经 GitHub，约 1 分钟）', sub: '真正走一遍：GitHub 定时任务 → 已登记设备、提醒邮箱和其他提醒', chevron: false })}
        </div>
        ${st.status ? html`<p class="foot-note strong">${st.status}</p>` : ''}
        ${st.runs && st.runs.length ? html`<div class="sec-title"><span>最近的提醒任务</span></div><div class="list">${st.runs.map((r) => html`<a class="row nav" href="${r.html_url}" target="_blank" rel="noopener"><span class="grow"><span class="t1">${runLabel(r)}</span><span class="t2">${new Date(r.created_at).toLocaleString('zh-CN', { hour12: false })} · ${r.event === 'schedule' ? '定时' : '手动'}</span></span>${icon('external', 'chev')}</a>`)}</div>` : ''}
      </div>`,
  });
  loadRuns(topSheet());
}
function runLabel(r) {
  if (r.status !== 'completed') return r.status === 'queued' ? '⏳ 排队中' : '⏳ 运行中';
  return r.conclusion === 'success' ? '✓ 成功' : r.conclusion === 'failure' ? '✗ 失败（点开看原因）' : r.conclusion || '已结束';
}
async function loadRuns(sheet) {
  if (!isConnected()) return;
  try {
    sheet.state.runs = await lastRuns();
    refreshSheet(sheet);
  } catch {
    /* 没有 Actions 权限时忽略 */
  }
}
export async function testLocal(swReg) {
  const st = topSheet().state;
  try {
    if (!swReg || !('Notification' in window)) throw new Error('这个浏览器不支持通知');
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('没有通知权限');
    await swReg.showNotification('✅ 本机通知正常', { body: '到点时会像这样提醒你。', tag: 'local-test', icon: 'icons/icon-192.png' });
    st.status = '已发送本机通知。没看到？检查专注模式和系统通知设置。';
  } catch (e) {
    st.status = e.message;
  }
  refreshSheet();
}
export async function testRemoteRun() {
  const sheet = topSheet();
  const st = sheet.state;
  if (!isConnected()) {
    st.status = '先连接 GitHub';
    return refreshSheet(sheet);
  }
  st.status = '已请求 GitHub 运行提醒任务，约 30–90 秒后所有已登记设备都会收到“测试通知”…';
  refreshSheet(sheet);
  try {
    await testRemote();
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 10000));
      if (!sheet.el.isConnected) return;
      await loadRuns(sheet);
      const r = st.runs && st.runs[0];
      if (r && r.status === 'completed' && Date.now() - new Date(r.created_at).getTime() < 5 * 60000) {
        st.status = r.conclusion === 'success' ? '✓ 任务运行成功，通知应该已经到了。' : '✗ 任务失败了：点下面的记录查看原因（常见：还没有设备开启推送、仓库还没配置发件邮箱，或 Key 填错了）。';
        return refreshSheet(sheet);
      }
    }
  } catch (e) {
    st.status = e.status === 403 || e.status === 404 ? 'Token 需要 Actions 权限（Read and write）才能手动触发；定时提醒不受影响。' : errText(e);
    refreshSheet(sheet);
  }
}

export function openDevices() {
  const sheet = openSheet({
    kind: 'form',
    state: { loading: true, list: [], err: '' },
    render: (st) => html`${sheetHead('已登记的设备', { left: '完成' })}
      <div class="sheet-body">
        ${!isConnected() ? html`<div class="empty-row">先连接 GitHub</div>` : st.loading ? html`<div class="empty-row"><span class="spinner"></span>读取中…</div>` : ''}
        ${st.err ? html`<p class="foot-note error">${st.err}</p>` : ''}
        ${!st.loading && isConnected()
          ? html`<div class="list">${st.list.length ? st.list.map((s) => html`<div class="row"><span class="row-ic">${icon('phone')}</span><span class="grow"><span class="t1">${s.device || '设备'}${s.id === state.cfg.deviceId ? html`<span class="pill">本机</span>` : ''}</span><span class="t2">${s.createdAt ? '登记于 ' + new Date(s.createdAt).toLocaleDateString('zh-CN') : ''}${/apple\.com/.test(s.endpoint || '') ? ' · Apple 推送' : ''}</span></span><button type="button" class="icon-btn danger" data-act="dev-remove" data-id="${s.id}" aria-label="移除">${icon('trash')}</button></div>`) : html`<div class="empty-row">还没有设备开启推送</div>`}</div>
            <p class="foot-note">换手机或不再需要的设备可以移除；失效的设备会在推送失败时自动清理。</p>`
          : ''}
      </div>`,
  });
  if (isConnected())
    listDevices()
      .then((list) => Object.assign(sheet.state, { list, loading: false }))
      .catch((e) => Object.assign(sheet.state, { loading: false, err: errText(e) }))
      .finally(() => refreshSheet(sheet));
}
export async function devRemove(id) {
  const sheet = topSheet();
  if (!(await confirmDialog({ title: '移除这台设备？', message: '它将不再收到提醒。', ok: '移除', danger: true }))) return;
  try {
    await removeDevice(id);
    sheet.state.list = sheet.state.list.filter((s) => s.id !== id);
  } catch (e) {
    sheet.state.err = errText(e);
  }
  refreshSheet(sheet);
}

export function openHooksGuide() {
  openSheet({
    kind: 'form',
    render: () => html`${sheetHead('其他提醒方式', { left: '完成' })}
    <div class="sheet-body guide">
      <p>任选一种，把拿到的 Key 或机器人地址粘贴到「设置 → 每天提醒 → 其他提醒」。可以填多个，用空格隔开。填好后点「发送测试通知 → 完整测试」，约 1 分钟后应收到「测试通知」。</p>
      <h3>${icon('phone')} Server酱³ App（安卓推荐）</h3>
      <ol>
        <li>打开 <a class="inline-link" href="https://sc3.ft07.com/" target="_blank" rel="noopener">sc3.ft07.com ${icon('external')}</a>，用微信扫码登录，按页面提示下载安装 Server酱 App。</li>
        <li>在 SendKey 页面复制以 <code>sctp</code> 开头的 SendKey。</li>
      </ol>
      <p class="foot-note">走手机厂商自己的推送通道，华为、小米、OPPO、vivo 上不用后台常驻也能收到。</p>
      <h3>${icon('bell')} 微信：Server酱 Turbo</h3>
      <ol>
        <li>打开 <a class="inline-link" href="https://sct.ftqq.com/" target="_blank" rel="noopener">sct.ftqq.com ${icon('external')}</a>，微信扫码登录，关注公众号。</li>
        <li>在 SendKey 页面复制以 <code>SCT</code> 开头的 SendKey。</li>
      </ol>
      <p class="foot-note">免费额度有每日条数限制（以官网为准），每天两条提醒一般够用。</p>
      <h3>${icon('bell')} 微信：PushPlus</h3>
      <ol>
        <li>打开 <a class="inline-link" href="https://www.pushplus.plus/" target="_blank" rel="noopener">pushplus.plus ${icon('external')}</a>，微信扫码登录，并<b>完成实名认证</b>（不认证无法发送）。</li>
        <li>复制「一对一推送」里的 32 位 token。</li>
      </ol>
      <h3>${icon('cloud')} 企业微信 / 钉钉 / 飞书群机器人</h3>
      <ol>
        <li>建一个群（可以只有自己），在群设置里添加 <b>自定义机器人</b>（企业微信叫「群机器人」）。</li>
        <li>复制 Webhook 地址（以 <code>https://</code> 开头）。</li>
        <li><b>钉钉</b>：安全设置选「自定义关键词」，填 <code>实验日程</code>。</li>
      </ol>
      <p class="foot-note">提醒内容（任务名、批次名）会经过所选服务商的服务器。Key 和机器人地址存在你的私有数据仓库里，别人拿到也能往你那里发消息，请不要外传。</p>
    </div>`,
  });
}

export function openInstallGuide() {
  openSheet({
    kind: 'form',
    render: () => {
      const env = pushEnv();
      const android = html`<h3>${icon('phone')} 安卓手机</h3>
      <ol>
        <li>用 <b>Chrome</b> 或 <b>Edge</b> 浏览器打开本页面。在微信 / QQ 里收到的链接，先点右上角「···」→「在浏览器打开」。</li>
        <li>点右上角 <b>⋮</b> → <b>添加到主屏幕</b>（或「安装应用」），之后从桌面图标打开。</li>
        <li>进「设置 → GitHub 同步」粘贴 Token。</li>
        <li><b>在「设置 → 每天提醒」里填写邮件提醒，或「其他提醒」（微信 / Server酱 App / 群机器人）</b>。也可以试试开启「本机通知」，但国内网络下多半收不到。</li>
      </ol>
      <p class="foot-note">华为、小米、OPPO、vivo 等手机自带的浏览器，以及夸克、UC，对网页应用支持不完整，建议用 Chrome 或 Edge。</p>`;
      const windows = html`<h3>${icon('calendar')} Windows 电脑</h3>
      <ol>
        <li>用 <b>Edge</b> 浏览器（Windows 10/11 自带）打开本页面。</li>
        <li>点地址栏右侧的 <b>安装</b> 图标，或右上角 <b>···</b> → <b>应用</b> → <b>将此站点作为应用安装</b>，之后从开始菜单或任务栏打开。</li>
        <li>进「设置」粘贴 Token，再点「本机通知」允许通知。</li>
      </ol>
      <p class="foot-note">请用 Edge：它走微软的推送通道，国内能收到；Chrome 的推送依赖 Google 服务，在国内收不到。收不到时检查 Windows 设置 → 系统 → 通知，以及「专注助手 / 勿扰」。</p>`;
      const apple = html`<h3>${icon('phone')} iPhone / iPad</h3>
      <ol>
        <li>用 <b>Safari</b> 打开本页面。</li>
        <li>点底部（iPad 在右上）的 <b>分享</b> 按钮 ${icon('share')}，选 <b>添加到主屏幕</b>，打开“作为网页 App 打开”。</li>
        <li><b>从主屏幕图标打开</b>，进「设置」粘贴 GitHub Token，再点「本机通知」允许通知。</li>
      </ol>
      <p class="foot-note">需要 iOS / iPadOS 16.4 或更新。通知可在 系统设置 → 通知 → 实验日程 里调整；专注模式可能会拦截。</p>
      <h3>${icon('calendar')} Mac</h3>
      <ol>
        <li>用 <b>Safari</b> 打开本页面，菜单栏 <b>文件 → 添加到程序坞</b>（macOS Sonoma 14 及以上）。</li>
        <li>从程序坞打开，同样粘贴 Token、开启通知。</li>
      </ol>
      <p class="foot-note">Mac 上请用 Safari：Chrome 的推送依赖 Google 服务，在国内网络下通常收不到。</p>`;
      const order = env.android ? [android, windows, apple] : env.windows ? [windows, android, apple] : [apple, android, windows];
      return html`${sheetHead('安装到主屏幕 / 桌面', { left: '完成' })}
    <div class="sheet-body guide">
      ${env.inApp ? html`<div class="card hint warn static"><span class="card-ic">${icon('alert')}</span><span class="grow"><span class="t1">现在是在微信 / QQ 里打开的</span><span class="t2">这里收不到提醒，也不能安装：点右上角「···」→「在浏览器打开」</span></span></div>` : ''}
      ${order}
      <h3>${icon('cloud')} 多台设备</h3>
      <p>每台设备各自粘贴一次 Token、各自开启通知。数据通过 GitHub 私有仓库自动同步，提醒会同时推到所有开启了通知的设备；填写了邮件提醒的话，每次也会发一封邮件。</p>
    </div>`;
    },
  });
}

// ═════════════ 导出 / 导入 ═════════════

async function deliverFile(name, text, mime) {
  const file = new File([text], name, { type: mime });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function logRecords() {
  const idx = buildIndex(state.data);
  return state.data.logs
    .filter((l) => !l.deleted && idx.batches.has(l.batchId))
    .map((l) => {
      const b = idx.batches.get(l.batchId);
      const sp = b.speciesId && idx.species.get(b.speciesId);
      return { l, b, sp };
    })
    .sort((x, y) => (x.l.date < y.l.date ? 1 : x.l.date > y.l.date ? -1 : (y.l.createdAt || 0) - (x.l.createdAt || 0)));
}
const stampName = () => today().replace(/-/g, '');

export function exportJSON() {
  deliverFile(`实验日程备份-${stampName()}.json`, serialize(state.data), 'application/json');
}
export function exportCSV() {
  const q = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [['日期', '星期', '批次', '类型', '物种', '事项', '结果', '代数', '备注', '设备']];
  for (const { l, b, sp } of logRecords()) rows.push([l.date, weekCN(l.date), b.name, T(b.type).label, sp ? sp.name : '', l.title || '', l.kind === 'done' ? '完成' : l.kind === 'skip' ? '跳过' : '备注', l.gen ?? '', l.note || '', l.device || '']);
  deliverFile(`实验记录-${stampName()}.csv`, '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n', 'text/csv');
}
export function recordsMarkdown() {
  const out = [`# 实验记录（导出于 ${today()}）`];
  let cur = '';
  for (const { l, b } of logRecords()) {
    if (l.date !== cur) {
      cur = l.date;
      out.push('', `## ${l.date} ${weekCN(l.date)}`);
    }
    const mark = l.kind === 'done' ? '✅' : l.kind === 'skip' ? '⏭️' : '📝';
    out.push(`- ${mark} ${b.name} · ${l.title || '记录'}${l.gen ? `（第 ${l.gen} 代）` : ''}${l.note ? ` —— ${l.note}` : ''}`);
  }
  return out.join('\n') + '\n';
}
export async function exportMD() {
  const md = recordsMarkdown();
  const ok = await confirmDialog({ title: '导出 Markdown', message: '可以直接复制，粘贴到 Obsidian；或者存成 .md 文件。', ok: '复制到剪贴板' });
  if (ok) {
    try {
      await navigator.clipboard.writeText(md);
      toast('已复制，可以粘贴到 Obsidian 了');
      return;
    } catch {
      /* 剪贴板不可用时改为文件 */
    }
  }
  deliverFile(`实验记录-${stampName()}.md`, md, 'text/markdown');
}
// ═════════════ 批量导入（Excel / CSV）═════════════

export function openBulkImport() {
  openSheet({ kind: 'form', state: { plan: null, fileName: '', err: '', busy: false }, render: renderBulk });
}
function renderBulk(st) {
  const p = st.plan;
  const n = p ? p.items.length : 0;
  const tasks = p ? p.items.reduce((s, it) => s + it.tasks.length, 0) : 0;
  return html`${sheetHead('批量导入批次', { left: p ? '取消' : '完成' })}
  <div class="sheet-body">
    <ol class="steps">
      <li><b>下载模板</b>，每行一个任务；同一个「批次名称」的多行会合并成一个批次。不填任务的批次，按类型自动生成默认任务（和在应用里新建一样）。
        <a class="inline-link" href="${TEMPLATE_XLSX}" download="实验日程-批量导入模板.xlsx">Excel 模板 ${icon('download')}</a>
        <a class="inline-link" href="${TEMPLATE_CSV}" download="实验日程-批量导入模板.csv">CSV 模板 ${icon('download')}</a></li>
      <li><b>填好后选择文件</b>：支持 .xlsx 和 .csv。模板里的「示例」「说明」两页不会被导入。</li>
    </ol>
    <label class="btn block ${p ? 'ghost' : ''}">${icon('upload')}${st.fileName ? `重新选择（当前：${st.fileName}）` : '选择文件'}
      <input type="file" id="bulk-file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></label>
    ${st.err ? html`<p class="foot-note error">${st.err}</p>` : ''}
    ${p && p.errors.length ? html`<div class="sec-title"><span>需要修改（${p.errors.length}）</span></div><div class="list">${p.errors.map((e) => html`<div class="row err"><span class="grow">${e}</span></div>`)}</div>` : ''}
    ${p && p.warnings.length ? html`<div class="sec-title"><span>提示（${p.warnings.length}）</span></div><div class="list">${p.warnings.map((e) => html`<div class="row"><span class="grow note-wrap">${e}</span></div>`)}</div>` : ''}
    ${n ? html`<div class="sec-title"><span>将新建 ${n} 个批次、${tasks} 个任务</span></div>
      <div class="list">${p.items.map((it) => html`<div class="row"><span class="grow"><span class="t1">${it.batch.name}</span>
        <span class="t2">${T(it.batch.type).label}${it.speciesName ? ` · ${it.speciesName}` : ''} · ${it.batch.planned ? '计划' : ''}${fmtMD(it.batch.start)}${it.batch.planned ? '开始' : ''} · ${it.tasks.length ? it.tasks.map((t) => t.name).join('、') : '无任务'}${it.auto ? '（自动生成）' : ''}</span></span></div>`)}</div>
      <button type="button" class="btn block" data-act="bulk-apply"${attr('disabled', st.busy)}>${p.errors.length ? `先导入这 ${n} 个批次（有错的行修改后再导入一次）` : `导入 ${n} 个批次`}</button>
      <p class="foot-note">同名的批次会被跳过，所以改完出错的行，可以把整个文件再导入一次，不会重复。</p>` : ''}
  </div>`;
}
export async function bulkFile(input) {
  const f = input.files && input.files[0];
  input.value = '';
  const sheet = topSheet();
  if (!f || !sheet) return;
  const st = sheet.state;
  st.fileName = f.name;
  st.err = '';
  st.plan = null;
  try {
    const rows = await readTable(f);
    st.plan = planImport(rows, { today: today(), species: state.data.species, batches: state.data.batches });
  } catch (e) {
    st.err = e.message || String(e);
  }
  refreshSheet(sheet);
}
export function bulkApply(go) {
  const sheet = topSheet();
  const st = sheet && sheet.state;
  if (!st || !st.plan || st.busy) return;
  st.busy = true;
  const made = {};
  for (const it of st.plan.items) {
    let speciesId = it.batch.speciesId;
    if (it.newSpecies) {
      const key = it.speciesName.toLowerCase();
      if (!made[key]) {
        actions.saveSpecies({ name: it.speciesName, latin: '', water: 3, feed: 7 });
        made[key] = (state.data.species.find((s) => !s.deleted && s.name.toLowerCase() === key) || {}).id;
      }
      speciesId = made[key];
    }
    actions.createBatch({ ...it.batch, speciesId }, it.tasks);
  }
  const n = st.plan.items.length;
  closeSheet(sheet);
  go('batches');
  toast(`已导入 ${n} 个批次 ✓${isConnected() ? '，正在同步到 GitHub' : ''}`, { ms: 5000 });
}

export async function importFile(input) {
  const f = input.files && input.files[0];
  input.value = '';
  if (!f) return;
  try {
    const { parseData } = await import('./core.js');
    const data = parseData(await f.text());
    const n = data.batches.filter((b) => !b.deleted).length;
    const m = data.logs.filter((l) => !l.deleted).length;
    if (!(await confirmDialog({ title: '导入这个备份？', message: `包含 ${n} 个批次、${m} 条记录。会与现有数据合并（同一条目保留较新的版本），不会删除现有内容。`, ok: '合并导入' }))) return;
    actions.importData(data);
    toast('已导入');
  } catch (e) {
    toast('文件无法识别：' + e.message, { ms: 5000 });
  }
}

export { saveCfg };
