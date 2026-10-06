// 状态、持久化、业务操作、与 GitHub 私有仓库同步
import {
  DATA_PATH, DEFAULT_SETTINGS, ENGINE_VERSION, buildIndex, canonical, cronFor, engineStamp, makeCompletion, mergeData,
  nextDue, normalizeData, parseData, serialize, todayIn, uid,
} from './core.js';
import { GitHub, errText } from './github.js';
import { generateVapid, guessDevice } from './push.js';

const KEY = { data: 'lp.data.v1', cfg: 'lp.cfg.v1', meta: 'lp.meta.v1' };
const ls = {
  get(k, fb) {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : fb;
    } catch {
      return fb;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* 存储不可用时只在内存里保留 */
    }
  },
};

function guessOwner() {
  const h = location.hostname;
  return h.endsWith('.github.io') ? h.slice(0, -'.github.io'.length) : '';
}

export const state = {
  data: normalizeData(ls.get(KEY.data)),
  cfg: { owner: guessOwner(), repo: 'lab-planner-data', token: '', connected: false, deviceName: guessDevice(), ...ls.get(KEY.cfg, {}) },
  meta: { lastSync: 0, dirty: false, engineStamp: '', ...ls.get(KEY.meta, {}) },
  sync: { status: 'idle', error: '' },
};
if (!state.cfg.deviceId) {
  state.cfg.deviceId = uid();
  ls.set(KEY.cfg, state.cfg);
}

const listeners = new Set();
let raf = 0;
export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export function emit() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    listeners.forEach((f) => f());
  });
}
const saveData = () => ls.set(KEY.data, state.data);
export const saveCfg = () => ls.set(KEY.cfg, state.cfg);
const saveMeta = () => ls.set(KEY.meta, state.meta);

export const today = () => todayIn(state.data.settings.tz);
export const index = () => buildIndex(state.data);

// ───────────── 修改数据 ─────────────

function stamp(o) {
  o.updatedAt = Math.max(Date.now(), (o.updatedAt || 0) + 1);
  return o;
}
export const find = (col, id) => state.data[col].find((x) => x.id === id);
function upsert(col, obj) {
  stamp(obj);
  const arr = state.data[col];
  const i = arr.findIndex((x) => x.id === obj.id);
  if (i >= 0) arr[i] = obj;
  else arr.push(obj);
  return obj;
}
function tomb(col, id) {
  const x = find(col, id);
  if (x && !x.deleted) {
    x.deleted = true;
    stamp(x);
  }
}
function commit() {
  state.meta.dirty = true;
  saveMeta();
  saveData();
  emit();
  scheduleSync();
}

export const actions = {
  createBatch(batch, tasks) {
    const t = Date.now();
    const b = upsert('batches', { ...batch, id: uid(), status: 'active', createdAt: t });
    tasks.forEach((tk, i) => upsert('tasks', { ...tk, id: uid(), batchId: b.id, order: i, createdAt: t + i }));
    const verb = { seedling: '播种', rooting: '转入生根培养基' }[b.type];
    if (!b.planned && verb) {
      upsert('logs', { id: uid(), batchId: b.id, taskId: null, kind: 'note', date: b.start, title: verb, createdAt: t, device: state.cfg.deviceName });
    }
    commit();
    return b;
  },
  updateBatch(id, patch) {
    const b = find('batches', id);
    if (!b) return;
    upsert('batches', { ...b, ...patch });
    commit();
  },
  deleteBatch(id) {
    tomb('batches', id);
    for (const t of state.data.tasks) if (t.batchId === id) tomb('tasks', t.id);
    for (const l of state.data.logs) if (l.batchId === id) tomb('logs', l.id);
    commit();
  },
  startPlanned(id, date) {
    const b = find('batches', id);
    if (!b) return;
    const verb = { seedling: '播种', rooting: '转入生根培养基' }[b.type] || '开始';
    upsert('batches', { ...b, planned: false, start: date || b.start });
    upsert('logs', { id: uid(), batchId: id, taskId: null, kind: 'note', date: date || b.start, title: verb, createdAt: Date.now(), device: state.cfg.deviceName });
    commit();
  },
  saveTask(task) {
    const cur = task.id && find('tasks', task.id);
    if (cur) upsert('tasks', { ...cur, ...task });
    else {
      const siblings = state.data.tasks.filter((t) => t.batchId === task.batchId && !t.deleted);
      upsert('tasks', { ...task, id: uid(), createdAt: Date.now(), order: siblings.reduce((m, t) => Math.max(m, t.order ?? 0), -1) + 1 });
    }
    commit();
  },
  deleteTask(id) {
    tomb('tasks', id);
    commit();
  },
  /** 完成/跳过；返回 { log, next, undo } */
  complete(taskId, { date, kind = 'done', note = '' } = {}) {
    const idx = index();
    const task = idx.tasks.get(taskId);
    const batch = task && idx.batches.get(task.batchId);
    if (!task || !batch) return null;
    const logs = idx.logsByTask.get(taskId) || [];
    const log = makeCompletion(task, batch, logs, { date: date || today(), kind, note, device: state.cfg.deviceName });
    state.data.logs.push(log);
    const prevOverride = task.override || null;
    const t = find('tasks', taskId);
    if (t.override) upsert('tasks', { ...t, override: null });
    commit();
    const next = nextDue(find('tasks', taskId), batch, [...logs, log]);
    return {
      log,
      next,
      undo: () => {
        tomb('logs', log.id);
        if (prevOverride) {
          const cur = find('tasks', taskId);
          if (cur) upsert('tasks', { ...cur, override: prevOverride });
        }
        commit();
      },
    };
  },
  postpone(taskId, date) {
    const t = find('tasks', taskId);
    if (!t) return;
    upsert('tasks', { ...t, override: date });
    commit();
  },
  clearOverride(taskId) {
    const t = find('tasks', taskId);
    if (!t) return;
    upsert('tasks', { ...t, override: null });
    commit();
  },
  addNote(batchId, { date, title, note }) {
    upsert('logs', { id: uid(), batchId, taskId: null, kind: 'note', date, title, note, createdAt: Date.now(), device: state.cfg.deviceName });
    commit();
  },
  updateLog(id, patch) {
    const l = find('logs', id);
    if (!l) return;
    upsert('logs', { ...l, ...patch });
    commit();
  },
  deleteLog(id) {
    tomb('logs', id);
    commit();
  },
  saveSpecies(sp) {
    const cur = sp.id && find('species', sp.id);
    upsert('species', cur ? { ...cur, ...sp } : { ...sp, id: uid() });
    commit();
  },
  deleteSpecies(id) {
    tomb('species', id);
    commit();
  },
  saveAway(a) {
    const cur = a.id && find('away', a.id);
    upsert('away', cur ? { ...cur, ...a } : { ...a, id: uid() });
    commit();
  },
  deleteAway(id) {
    tomb('away', id);
    commit();
  },
  updateSettings(patch) {
    state.data.settings = stamp({ ...DEFAULT_SETTINGS, ...state.data.settings, ...patch });
    commit();
  },
  importData(obj) {
    state.data = mergeData(state.data, obj);
    commit();
  },
};

// ───────────── 同步 ─────────────

let gh = null;
let ghKey = '';
export function github() {
  const { owner, repo, token } = state.cfg;
  if (!owner || !repo || !token) return null;
  const k = `${owner}/${repo}/${token}`;
  if (k !== ghKey) {
    gh = new GitHub({ owner, repo, token });
    ghKey = k;
  }
  return gh;
}
export const isConnected = () => !!(state.cfg.connected && github());

function setSync(status, error = '') {
  state.sync = { status, error };
  emit();
}

let timer = 0;
export function scheduleSync(delay = 1500) {
  if (!isConnected()) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), delay);
}

function commitMessage(before, after) {
  const dev = state.cfg.deviceName || '设备';
  if (!before) return `初始化实验日程数据（${dev}）`;
  const names = new Map(after.batches.map((b) => [b.id, b.name]));
  const seen = new Set(before.logs.map((l) => l.id));
  const added = after.logs.filter((l) => !seen.has(l.id) && !l.deleted);
  if (added.length) {
    const s = added.slice(0, 3).map((l) => `${names.get(l.batchId) || ''}·${l.kind === 'skip' ? '跳过' : ''}${l.title || '记录'}`).join('、');
    return `记录 ${added.length} 条：${s}${added.length > 3 ? '…' : ''}（${dev}）`;
  }
  const bs = new Set(before.batches.map((b) => b.id));
  const nb = after.batches.filter((b) => !bs.has(b.id) && !b.deleted);
  if (nb.length) return `新批次：${nb.map((b) => b.name).join('、')}（${dev}）`;
  return `更新数据（${dev}）`;
}

/** 拉取远端 → 合并 → 有差异就写回；并发写冲突时自动重试 */
async function pullPush() {
  const g = github();
  for (let attempt = 0; attempt < 5; attempt++) {
    const remote = await g.readFile(DATA_PATH);
    let remoteData = null;
    if (remote) {
      try {
        remoteData = parseData(remote.text);
      } catch {
        throw new Error('仓库里的 data/planner.json 格式损坏，请在 GitHub 上查看历史版本恢复');
      }
    }
    const merged = remoteData ? mergeData(state.data, remoteData) : canonical(state.data);
    const text = serialize(merged);
    if (text !== serialize(state.data)) {
      state.data = merged;
      saveData();
      emit();
    }
    if (remote && text === remote.text) return;
    try {
      await g.writeFile(DATA_PATH, text, remote && remote.sha, commitMessage(remoteData, merged));
      return;
    } catch (e) {
      if (e.status === 409 || e.status === 422) continue;
      throw e;
    }
  }
  throw new Error('同步冲突重试次数过多，请稍后再试');
}

let running = null;
let again = false;
let engineCheckedThisSession = false;
let lastEngineWant = '';
export async function syncNow() {
  if (!isConnected()) return;
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    setSync('syncing');
    try {
      await pullPush();
      state.meta.lastSync = Date.now();
      state.meta.dirty = false;
      saveMeta();
      setSync('ok');
      const want = engineStamp(state.data.settings);
      if (!engineCheckedThisSession || (state.meta.engineStamp !== want && lastEngineWant !== want)) {
        engineCheckedThisSession = true;
        lastEngineWant = want;
        ensureEngine()
          .then(() => {
            if (state.meta.engineError) {
              state.meta.engineError = '';
              saveMeta();
              emit();
            }
          })
          .catch((e) => {
            state.meta.engineError = e.status ? errText(e) : e.message || String(e);
            saveMeta();
            emit();
          });
      }
    } catch (e) {
      console.warn(e);
      setSync(e.offline ? 'offline' : 'error', errText(e));
    }
  })();
  try {
    await running;
  } finally {
    running = null;
    if (again) {
      again = false;
      scheduleSync(300);
    }
  }
}

const APP_BASE = new URL('./', location.href);
async function fetchText(p) {
  const r = await fetch(new URL(p, APP_BASE), { cache: 'no-store' });
  if (!r.ok) throw new Error(`读取 ${p} 失败（${r.status}）`);
  return r.text();
}

/** 把提醒脚本和定时任务写进数据仓库（版本或提醒时间变化时自动更新） */
export async function ensureEngine(force = false) {
  const g = github();
  if (!g) return false;
  const want = engineStamp(state.data.settings);
  const cur = await g.readFile('scripts/engine-version.txt');
  // 另一台设备已装了更新版本的脚本：不降级（这台设备更新应用后会自动跟上）
  const remoteVer = cur ? parseInt((/engine=(\d+)/.exec(cur.text) || [])[1], 10) || 0 : 0;
  if (remoteVer > parseInt(ENGINE_VERSION, 10)) return false;
  if (!force && cur && cur.text === want) {
    state.meta.engineStamp = want;
    saveMeta();
    return false;
  }
  const [core, remind, yml] = await Promise.all([fetchText('js/core.js'), fetchText('engine/remind.mjs'), fetchText('engine/remind.yml')]);
  const s = { ...DEFAULT_SETTINGS, ...state.data.settings };
  const wf = yml.replace('__MORNING_CRON__', cronFor(s.morningAt, s.tz)).replace('__EVENING_CRON__', cronFor(s.eveningAt, s.tz)).replace('__APP_URL__', new URL('./', location.href).href);
  await g.putText('scripts/package.json', '{\n  "private": true,\n  "type": "module"\n}\n', '安装/更新提醒脚本');
  await g.putText('scripts/core.js', core, '安装/更新提醒脚本');
  await g.putText('scripts/remind.mjs', remind, '安装/更新提醒脚本');
  try {
    await g.putText('.github/workflows/remind.yml', wf, '安装/更新定时提醒任务');
  } catch (e) {
    if (e.status === 403 || e.status === 404) throw new Error('写入定时任务失败：Token 还需要 Workflows 权限（Read and write）');
    throw e;
  }
  await g.putText('scripts/engine-version.txt', want, '更新提醒脚本版本');
  state.meta.engineStamp = want;
  state.meta.engineError = '';
  saveMeta();
  return true;
}

function subjectUrl() {
  return new URL('./', location.href).href.split('#')[0];
}

/** 保证数据仓库里有 VAPID 推送密钥，返回公钥 */
export async function ensureVapid() {
  const g = github();
  for (let i = 0; i < 2; i++) {
    const cur = await g.readFile('push/vapid.json');
    if (cur) {
      const v = JSON.parse(cur.text);
      state.cfg.vapidPublic = v.publicKey;
      saveCfg();
      return v.publicKey;
    }
    const v = await generateVapid(subjectUrl());
    try {
      await g.writeFile('push/vapid.json', JSON.stringify(v, null, 2) + '\n', null, '生成推送密钥');
      state.cfg.vapidPublic = v.publicKey;
      saveCfg();
      return v.publicKey;
    } catch (e) {
      if (!(e.status === 409 || e.status === 422)) throw e; // 另一台设备刚好也在生成：重新读取
    }
  }
  throw new Error('生成推送密钥失败');
}

/** 连接数据仓库：校验 → 同步数据 → 安装提醒脚本 → 准备推送密钥 */
export async function connect({ owner, repo, token }, progress = () => {}) {
  const g = new GitHub({ owner, repo, token });
  progress('检查仓库和权限…');
  const info = await g.repoInfo();
  if (info.permissions && info.permissions.push === false) throw new Error('这个 Token 没有写入权限：Contents 需要选 Read and write');
  state.cfg = { ...state.cfg, owner, repo, token, connected: true, branch: info.default_branch || 'main', isPrivate: !!info.private };
  saveCfg();
  progress('同步数据…');
  await pullPush();
  state.meta.lastSync = Date.now();
  state.meta.dirty = false;
  saveMeta();
  setSync('ok');
  progress('准备推送密钥…');
  await ensureVapid();
  progress('安装定时提醒任务…');
  await ensureEngine(true);
  engineCheckedThisSession = true;
  return info;
}

export function disconnect() {
  state.cfg = { ...state.cfg, token: '', connected: false, push: false };
  saveCfg();
  setSync('idle');
}

export async function registerDevice(sub) {
  const g = github();
  const entry = { id: state.cfg.deviceId, device: state.cfg.deviceName || '设备', endpoint: sub.endpoint, keys: sub.keys, createdAt: new Date().toISOString() };
  await g.updateJson('push/subscriptions.json', [], (list) => [...(Array.isArray(list) ? list : []).filter((s) => s.id !== entry.id && s.endpoint !== entry.endpoint), entry], `登记推送设备：${entry.device}`);
  state.cfg.push = true;
  state.cfg.pushEndpoint = sub.endpoint;
  saveCfg();
}

export async function listDevices() {
  const cur = await github().readFile('push/subscriptions.json');
  if (!cur) return [];
  try {
    const list = JSON.parse(cur.text);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function removeDevice(id) {
  await github().updateJson('push/subscriptions.json', [], (list) => (Array.isArray(list) ? list : []).filter((s) => s.id !== id), '移除推送设备');
  if (id === state.cfg.deviceId) {
    state.cfg.push = false;
    saveCfg();
  }
}

export async function testRemote() {
  const g = github();
  await g.dispatch('remind.yml', state.cfg.branch || 'main', { mode: 'test' });
}

export async function lastRuns() {
  return github().runs('remind.yml', 5);
}

export { errText };
