// 入口：路由、渲染、事件分发、Service Worker
import { TYPES, addDays, buildIndex, dueItems, fmtMD, nextDue, relText, isDate } from './core.js';
import { state, actions, subscribe, today, index, find, isConnected, syncNow, scheduleSync, saveCfg, registerDevice } from './store.js';
import { ui, icon, morph, closeSheet, closeAllSheets, refreshSheet, topSheet, actionSheet, confirmDialog, toast, runToastAction, setPath, getPath, readInput } from './ui.js';
import { viewToday, viewCalendar, viewBatches, viewBatch, viewSettings, ruleText, shiftMonth, pushStatus } from './views.js';
import * as F from './forms.js';

const $main = document.getElementById('main');
const $tabbar = document.getElementById('tabbar');
let swReg = null;

// ───────────── 路由 ─────────────

function parseHash() {
  const [name, id] = location.hash.replace(/^#\/?/, '').split('/');
  if (name === 'batch' && id) return { name: 'batch', id };
  return ['today', 'calendar', 'batches', 'settings'].includes(name) ? { name } : { name: 'today' };
}
function go(path, sel) {
  if (sel && isDate(sel)) {
    ui.calSel = sel;
    ui.calMonth = sel.slice(0, 7);
    ui.calMode = 'month';
  }
  if (!path.startsWith('batch/')) ui.lastTab = path;
  if (location.hash !== '#/' + path) location.hash = '#/' + path;
  else render();
}
window.addEventListener('hashchange', () => {
  const prev = ui.route;
  ui.route = parseHash();
  closeAllSheets();
  if (prev.name !== ui.route.name || prev.id !== ui.route.id) {
    ui.showAllLogs = false;
    window.scrollTo(0, 0);
  }
  render();
});

// ───────────── 渲染 ─────────────

const TABS = [
  ['today', '今天', 'today'],
  ['calendar', '日历', 'calendar'],
  ['batches', '批次', 'flask'],
  ['settings', '设置', 'settings'],
];

function pendingCount() {
  return dueItems(state.data, today(), 0).length;
}

function render() {
  const r = ui.route;
  let view;
  if (r.name === 'batch') view = viewBatch(r.id);
  else if (r.name === 'calendar') view = viewCalendar();
  else if (r.name === 'batches') view = viewBatches();
  else if (r.name === 'settings') view = viewSettings();
  else view = viewToday();
  morph($main, view);
  const cur = r.name === 'batch' ? ui.lastTab || 'batches' : r.name;
  const n = pendingCount();
  morph($tabbar, TABS.map(
    ([k, label, ic]) => `<button class="tab ${k === cur ? 'on' : ''}" data-act="go" data-to="${k}" aria-label="${label}"${k === cur ? ' aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${k === 'today' && n ? `<i class="tab-badge">${n > 99 ? '99+' : n}</i>` : ''}</button>`,
  ).join(''));
  try {
    if ('setAppBadge' in navigator && window.Notification && Notification.permission === 'granted') {
      if (n) navigator.setAppBadge(n).catch(() => {});
      else navigator.clearAppBadge().catch(() => {});
    }
  } catch {
    /* 不支持角标 */
  }
}
subscribe(render);

// ───────────── 操作 ─────────────

function doComplete(taskId, opts) {
  const res = actions.complete(taskId, opts);
  if (!res) return;
  const t = find('tasks', taskId);
  const b = find('batches', t.batchId);
  const verb = opts.kind === 'skip' ? '已跳过' : '已完成';
  const gen = res.log.gen ? `（第 ${res.log.gen} 代）` : '';
  toast(`${verb}：${b.name} · ${t.name}${gen}${res.next ? `，下次 ${fmtMD(res.next)}` : ''}`, {
    actionLabel: '撤销',
    action: () => {
      res.undo();
      toast('已撤销');
    },
    ms: 5000,
  });
}

const pendingDone = new Set(); // 防止动画期间连点两次记成两条
function quickDone(el) {
  const key = el.dataset.key;
  if (pendingDone.has(key)) return;
  pendingDone.add(key);
  el.classList.add('checked');
  const row = el.closest('.row');
  if (row) row.classList.add('leaving');
  setTimeout(() => {
    try {
      if (key.startsWith('start:')) {
        const b = find('batches', key.slice(6));
        actions.startPlanned(key.slice(6), today());
        toast(`已记录：${b ? b.name : ''} ${TYPES[b ? b.type : 'other'].startVerb}`);
      } else doComplete(key, { date: today() });
    } finally {
      pendingDone.delete(key);
    }
  }, 280);
}

async function bulkDone(kind) {
  const td = today();
  const items = dueItems(state.data, td, 0).filter((i) => !i.virtual && (kind === 'overdue' ? i.rel < 0 : i.rel === 0));
  if (!items.length) return;
  const ok = await confirmDialog({ title: `把 ${items.length} 项记为今天完成？`, message: items.map((i) => `${i.batch.name} · ${i.task.name}`).join('\n'), ok: '全部完成' });
  if (!ok) return;
  const done = items.map((i) => actions.complete(i.task.id, { date: td })).filter(Boolean);
  toast(`已完成 ${done.length} 项`, {
    actionLabel: '撤销',
    action: () => {
      done.forEach((d) => d.undo());
      toast('已撤销');
    },
    ms: 6000,
  });
}

function openItemMenu(key) {
  const idx = index();
  const td = today();
  if (key.startsWith('start:')) {
    const b = idx.batches.get(key.slice(6));
    if (!b) return;
    const verb = TYPES[b.type].startVerb;
    return actionSheet({
      title: `${verb}（计划）`,
      subtitle: `${b.name} · 计划 ${fmtMD(b.start)}（${relText(b.start, td)}）`,
      buttons: [
        { label: `已${verb}（今天）`, ic: 'check', fn: () => { actions.startPlanned(b.id, td); toast('已记录'); } },
        { label: '修改计划日期…', ic: 'clock', fn: () => F.openPostpone(key) },
        { label: '查看批次', ic: 'flask', fn: () => go('batch/' + b.id) },
      ],
    });
  }
  const t = idx.tasks.get(key);
  if (!t) return;
  const b = idx.batches.get(t.batchId);
  const n = nextDue(t, b, idx.logsByTask.get(t.id) || []);
  const buttons = [];
  if (n && !t.paused && b.status !== 'done') {
    buttons.push({ label: '完成（今天）', ic: 'check', fn: () => doComplete(t.id, { date: td }) });
    buttons.push({ label: '补记 / 选择完成日期…', ic: 'calendar', fn: () => F.openCompleteForm(t.id) });
    buttons.push({ label: '推迟这一次…', ic: 'clock', fn: () => F.openPostpone(t.id) });
    buttons.push({ label: '跳过这一次', ic: 'skip', fn: () => doComplete(t.id, { date: td, kind: 'skip' }) });
    if (t.override) buttons.push({ label: '恢复原计划日期', ic: 'sync', fn: () => { actions.clearOverride(t.id); toast('已恢复'); } });
  }
  buttons.push({ label: '编辑任务', ic: 'edit', fn: () => F.openTaskForm({ id: t.id }) });
  if (ui.route.name !== 'batch') buttons.push({ label: '查看批次', ic: 'flask', fn: () => go('batch/' + b.id) });
  const sub = t.paused ? `${b.name} · 已暂停` : n ? `${b.name} · ${ruleText(t)} · 下次 ${fmtMD(n)}（${relText(n, td)}）` : `${b.name} · 已完成`;
  actionSheet({ title: t.name, subtitle: sub, buttons });
}

function deriveBatch(id) {
  const b = find('batches', id);
  if (!b) return;
  const type = { shoot: 'rooting', callus: 'callus', seedling: 'seedling', rooting: 'other', other: 'other' }[b.type] || 'other';
  F.openBatchForm({ preset: { type, speciesId: b.speciesId || '', parentId: b.id, location: b.location || '', name: `${b.name} → ${TYPES[type].label}` } });
}

function pushRow() {
  // 不能在这里 await 任何东西：iOS 要求通知授权由这次点击直接触发
  const [val] = pushStatus();
  if (val === '已开启') return F.openTestPush(swReg);
  return F.enablePush(swReg, render);
}

function sheetChanged(el, value) {
  const sheet = topSheet();
  if (!sheet || !el.closest('.sheet')) return;
  const path = el.dataset.bind;
  setPath(sheet.state, path, value);
  const again = sheet.onChange ? sheet.onChange(sheet.state, path, value) : false;
  if (again || el.tagName === 'SELECT') refreshSheet(sheet);
}

const A = {
  go: (el) => go(el.dataset.to, el.dataset.sel),
  back: () => go(ui.lastTab || 'batches'),
  sync: () => {
    if (!isConnected()) return F.openGithub();
    syncNow().then(() => toast(state.sync.error ? state.sync.error : '已同步 ✓'));
  },
  'sync-error': () => toast(state.sync.error || '同步出错', { actionLabel: '重试', action: () => syncNow(), ms: 6000 }),
  'new-batch': (el) => F.openBatchForm({ preset: el.dataset.start ? { start: el.dataset.start } : {} }),
  'open-batch': (el) => go('batch/' + el.dataset.id),
  'edit-batch': (el) => F.openBatchForm({ id: el.dataset.id }),
  'derive-batch': (el) => deriveBatch(el.dataset.id),
  'end-batch': async (el) => {
    if (await confirmDialog({ title: '结束这个批次？', message: '结束后不再提醒，记录会保留，随时可以恢复。', ok: '结束' })) {
      actions.updateBatch(el.dataset.id, { status: 'done', endDate: today() });
      toast('已结束');
    }
  },
  'reopen-batch': (el) => {
    actions.updateBatch(el.dataset.id, { status: 'active', endDate: null });
    toast('已恢复');
  },
  'delete-batch': async (el) => {
    const b = find('batches', el.dataset.id);
    if (await confirmDialog({ title: `删除「${b ? b.name : ''}」？`, message: '批次、任务和全部记录都会删除（GitHub 历史里仍能找回）。', ok: '删除', danger: true })) {
      actions.deleteBatch(el.dataset.id);
      go(ui.lastTab || 'batches');
      toast('已删除');
    }
  },
  'new-task': (el) => F.openTaskForm({ batchId: el.dataset.id }),
  item: (el) => openItemMenu(el.dataset.key),
  done: (el) => quickDone(el),
  'bulk-done': (el) => bulkDone(el.dataset.kind),
  'new-note': (el) => F.openNoteForm({ batchId: el.dataset.id }),
  'edit-log': (el) => F.openNoteForm({ logId: el.dataset.id }),
  'show-all-logs': () => {
    ui.showAllLogs = true;
    render();
  },
  'cal-prev': () => {
    ui.calMonth = shiftMonth(ui.calMonth, -1);
    render();
  },
  'cal-next': () => {
    ui.calMonth = shiftMonth(ui.calMonth, 1);
    render();
  },
  'cal-today': () => {
    ui.calMonth = today().slice(0, 7);
    ui.calSel = today();
    render();
  },
  'cal-day': (el) => {
    ui.calSel = el.dataset.date;
    render();
  },
  'cal-mode': (el) => {
    ui.calMode = el.dataset.v;
    render();
  },
  'batch-filter': (el) => {
    ui.batchFilter = el.dataset.v;
    render();
  },
  'open-github': () => F.openGithub(),
  'push-row': () => pushRow(),
  'enable-push': () => F.enablePush(swReg, render),
  'test-push': () => F.openTestPush(swReg),
  'tp-local': () => F.testLocal(swReg),
  'tp-remote': () => F.testRemoteRun(),
  devices: () => F.openDevices(),
  'dev-remove': (el) => F.devRemove(el.dataset.id),
  species: () => F.openSpeciesList(),
  'sp-new': () => F.openSpeciesForm(),
  'sp-edit': (el) => F.openSpeciesForm(el.dataset.id),
  away: () => F.openAway(),
  'install-guide': () => F.openInstallGuide(),
  'export-json': () => F.exportJSON(),
  'export-csv': () => F.exportCSV(),
  'export-md': () => F.exportMD(),
  import: () => document.getElementById('import-file').click(),

  // 弹层通用
  'sheet-close': () => closeSheet(),
  'sheet-backdrop': () => {
    const s = topSheet();
    if (s && s.kind === 'alert') return closeSheet(s, false);
    closeSheet(s);
  },
  menu: (el) => {
    const s = topSheet();
    const b = s.state.buttons[+el.dataset.i];
    closeSheet(s);
    if (b && b.fn) setTimeout(b.fn, 30);
  },
  'alert-yes': () => closeSheet(topSheet(), true),
  'alert-no': () => closeSheet(topSheet(), false),
  'toast-action': () => runToastAction(),
  step: (el) => {
    const sheet = topSheet();
    if (!sheet) return;
    const path = el.dataset.path;
    const min = +el.dataset.min;
    const max = +el.dataset.max;
    const v = Math.min(max, Math.max(min, (Number(getPath(sheet.state, path)) || 0) + +el.dataset.d));
    setPath(sheet.state, path, v);
    if (sheet.onChange) sheet.onChange(sheet.state, path, v);
    refreshSheet(sheet);
  },
  seg: (el) => {
    const sheet = topSheet();
    if (!sheet) return;
    setPath(sheet.state, el.dataset.path, el.dataset.v);
    if (sheet.onChange) sheet.onChange(sheet.state, el.dataset.path, el.dataset.v);
    refreshSheet(sheet);
  },

  // 批次表单
  'bf-type': (el) => {
    F.setBatchType(topSheet().state, el.dataset.v);
    refreshSheet();
  },
  'bf-add-task': () => {
    F.addDraftTask(topSheet().state);
    refreshSheet();
  },
  'bf-save': () => F.saveBatchForm(topSheet().state, go),
  'tf-save': () => F.saveTaskForm(topSheet().state),
  'tf-name': (el) => {
    const st = topSheet().state;
    st.name = el.dataset.v;
    if (el.dataset.v === '继代') {
      st.countGen = true;
      st.kind = 'repeat';
      if (!st.lead) {
        st.lead = 2;
        st.prep = st.prep || '配制并灭菌培养基';
      }
    }
    refreshSheet();
  },
  'tf-delete': async () => {
    const st = topSheet().state;
    if (await confirmDialog({ title: '删除这个任务？', message: '已有的记录会保留在批次里。', ok: '删除', danger: true })) {
      actions.deleteTask(st.id);
      closeSheet();
      toast('已删除');
    }
  },
  'cf-save': () => {
    const st = topSheet().state;
    if (!isDate(st.date)) return toast('请选择日期');
    closeSheet();
    doComplete(st.taskId, { date: st.date, kind: st.kind, note: String(st.note || '').trim() });
  },
  'pp-pick': (el) => {
    topSheet().state.date = el.dataset.v;
    refreshSheet();
  },
  'pp-save': () => {
    const st = topSheet().state;
    if (!isDate(st.date)) return toast('请选择日期');
    closeSheet();
    if (st.key.startsWith('start:')) {
      actions.updateBatch(st.key.slice(6), { start: st.date, planned: st.date > today() });
      toast(`计划日期改为 ${fmtMD(st.date)}`);
    } else {
      actions.postpone(st.key, st.date);
      toast(`这一次改到 ${fmtMD(st.date)}（${relText(st.date, today())}）`);
    }
  },
  'nf-title': (el) => {
    topSheet().state.title = el.dataset.v;
    refreshSheet();
  },
  'nf-save': () => F.saveNoteForm(topSheet().state),
  'nf-delete': async () => {
    const st = topSheet().state;
    if (await confirmDialog({ title: '删除这条记录？', message: st.isTask ? '对应任务的下次日期会重新计算。' : '', ok: '删除', danger: true })) {
      actions.deleteLog(st.id);
      closeSheet();
      toast('已删除');
    }
  },
  'spf-save': () => {
    const st = topSheet().state;
    const name = String(st.name || '').trim();
    if (!name) return toast('请填写名称');
    actions.saveSpecies({ ...(st.id ? { id: st.id } : {}), name, latin: String(st.latin || '').trim(), water: Math.max(1, +st.water || 1), feed: Math.max(1, +st.feed || 1) });
    closeSheet();
    refreshSheet();
    toast('已保存');
  },
  'spf-delete': async () => {
    const st = topSheet().state;
    if (await confirmDialog({ title: `删除物种「${st.name}」？`, message: '已有批次不受影响。', ok: '删除', danger: true })) {
      actions.deleteSpecies(st.id);
      closeSheet();
      refreshSheet();
    }
  },
  'away-add': () => {
    const st = topSheet().state;
    if (!isDate(st.from) || !isDate(st.to)) return toast('请选择日期');
    const [from, to] = st.from <= st.to ? [st.from, st.to] : [st.to, st.from];
    actions.saveAway({ from, to, note: String(st.note || '').trim() });
    st.note = '';
    refreshSheet();
    toast('已添加');
  },
  'away-del': (el) => {
    actions.deleteAway(el.dataset.id);
    refreshSheet();
  },
  'gh-connect': () => F.doConnect(topSheet()),
  'gh-sync': () => F.ghSync(topSheet()),
  'gh-reinstall': () => F.ghReinstall(topSheet()),
  'gh-disconnect': () => F.ghDisconnect(),
};



document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = A[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'A') return; // 外链交给浏览器
  e.preventDefault();
  fn(el, e);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && topSheet()) closeSheet();
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-act]')) {
    e.preventDefault();
    e.target.click();
  }
});
document.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.matches('[data-bind]')) return;
  const sheet = topSheet();
  if (!sheet || !el.closest('.sheet')) return;
  setPath(sheet.state, el.dataset.bind, readInput(el));
  if (el.dataset.bind === 'name' && sheet.onChange) sheet.onChange(sheet.state, 'name', el.value);
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'import-file') return F.importFile(el);
  if (el.matches('[data-set]')) {
    const v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'time' && !/^\d{2}:\d{2}$/.test(v)) return;
    actions.updateSettings({ [el.dataset.set]: v });
    toast(el.type === 'time' ? `已改为 ${v}${isConnected() ? '，定时任务会自动更新' : ''}` : '已保存');
    return;
  }
  if (el.matches('[data-time]')) {
    const key = el.dataset.time;
    const [h, m] = String(state.data.settings[key] || '00:00').split(':');
    const v = el.dataset.part === 'h' ? `${el.value}:${m}` : `${h}:${el.value}`;
    if (!/^\d{2}:\d{2}$/.test(v)) return;
    actions.updateSettings({ [key]: v });
    toast(`已改为 ${v}${isConnected() ? '，定时任务会自动更新' : ''}`);
    return;
  }
  if (el.matches('[data-cfg]')) {
    state.cfg[el.dataset.cfg] = el.value.trim();
    saveCfg();
    toast('已保存');
    return;
  }
  if (el.matches('[data-bind]')) sheetChanged(el, readInput(el));
});

// ───────────── Service Worker / 推送健康检查 ─────────────

async function checkPush() {
  if (!swReg || !state.cfg.push || !('PushManager' in window)) return;
  try {
    const sub = await swReg.pushManager.getSubscription();
    const lost = !sub || Notification.permission !== 'granted';
    if (lost !== !!ui.pushLost) {
      ui.pushLost = lost;
      render();
    }
    if (sub && sub.endpoint !== state.cfg.pushEndpoint && isConnected()) {
      const j = sub.toJSON();
      registerDevice({ endpoint: j.endpoint, keys: j.keys }).catch(() => {});
    }
  } catch {
    /* 忽略 */
  }
}

let reloading = false;
async function initSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
    const offer = (w) =>
      toast('有新版本可用', {
        actionLabel: '更新',
        action: () => {
          reloading = true;
          w.postMessage('skipWaiting');
        },
        ms: 20000,
      });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w)
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) location.reload();
    });
    swReg = await navigator.serviceWorker.ready;
    setInterval(() => reg.update().catch(() => {}), 3600 * 1000);
    checkPush();
  } catch (e) {
    console.warn('Service Worker 注册失败', e);
  }
}

// ───────────── 启动 ─────────────

ui.route = parseHash();
if (ui.route.name !== 'batch') ui.lastTab = ui.route.name;
render();
initSW();
if (isConnected()) syncNow();

let lastDay = today();
setInterval(() => {
  if (today() !== lastDay) {
    lastDay = today();
    render();
  }
}, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  render();
  if (Date.now() - (state.meta.lastSync || 0) > 20000) syncNow();
  checkPush();
});
window.addEventListener('online', () => syncNow());
setInterval(() => {
  if (document.visibilityState === 'visible') syncNow();
}, 5 * 60000);
if (state.meta.dirty) scheduleSync(500);

// 调试/测试钩子
window.__lp = { state, actions, go, render, syncNow, buildIndex, addDays };
