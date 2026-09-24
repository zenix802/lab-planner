// 界面基础件：图标、底部弹层、提示、确认框、表单控件
import { html, raw, attr } from './html.js';

export const ui = {
  route: { name: 'today' },
  batchFilter: 'active',
  calMonth: '',
  calSel: '',
  calMode: 'month',
  showAllLogs: false,
};

const P = {
  today: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  flask: '<path d="M9.5 3h5M10.5 3v5.6L5.2 17.7A2.2 2.2 0 0 0 7.1 21h9.8a2.2 2.2 0 0 0 1.9-3.3L13.5 8.6V3"/><path d="M7.4 15h9.2"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  chevR: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  chevL: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
  sync: '<path d="M19.5 10.5A7.8 7.8 0 0 0 5.6 7.3L4 9"/><path d="M4 4.5V9h4.5"/><path d="M4.5 13.5a7.8 7.8 0 0 0 13.9 3.2L20 15"/><path d="M20 19.5V15h-4.5"/>',
  cloud: '<path d="M7 18.5h10a4 4 0 0 0 .6-8 5.5 5.5 0 0 0-10.7 1.4A3.3 3.3 0 0 0 7 18.5z"/>',
  cloudOk: '<path d="M7 18.5h10a4 4 0 0 0 .6-8 5.5 5.5 0 0 0-10.7 1.4A3.3 3.3 0 0 0 7 18.5z"/><path d="m9.6 14 1.9 1.9 3.4-3.5"/>',
  cloudOff: '<path d="M7 18.5h10a4 4 0 0 0 .6-8 5.5 5.5 0 0 0-10.7 1.4A3.3 3.3 0 0 0 7 18.5z"/><path d="M4 4l16 16"/>',
  alert: '<path d="M12 4.2 2.9 19.5h18.2z"/><path d="M12 10v4.2M12 17h.01"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  share: '<path d="M12 3.5v11M7.8 7.7 12 3.5l4.2 4.2"/><path d="M5.5 11.5v7a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-7"/>',
  suitcase: '<rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M9 7.5V5.6c0-.9.7-1.6 1.6-1.6h2.8c.9 0 1.6.7 1.6 1.6v1.9M3.5 12.5h17"/>',
  box: '<path d="M4 8.2 12 4l8 4.2v7.6L12 20l-8-4.2z"/><path d="m4 8.2 8 4.3 8-4.3M12 12.5V20"/>',
  sprout: '<path d="M12 20.5V13"/><path d="M12 13c0-4 2.7-6.5 7-6.5 0 4-2.7 6.5-7 6.5z"/><path d="M12 11C12 7.7 9.8 5.5 5.5 5.5c0 3.3 2.2 5.5 6.5 5.5z"/>',
  cells: '<circle cx="9" cy="9.5" r="4.2"/><circle cx="15.8" cy="12.8" r="3.5"/><circle cx="10" cy="17" r="3.2"/>',
  flask2: '<path d="M10 3h4M10.6 3v6L6 18a2 2 0 0 0 1.8 3h8.4A2 2 0 0 0 18 18l-4.6-9V3"/><path d="M12 19v-4M12 16.3c0-1.7 1.1-2.8 2.8-2.8"/>',
  roots: '<path d="M12 3.5v7.5M12 7.2c1.3-1.8 3-2.5 4.8-2.3M5 11h14M12 11v9.5M12 13.2c-1.6 1.2-3.4 2.9-4.6 5.2M12 13.2c1.6 1.2 3.4 2.9 4.6 5.2"/>',
  dot: '<circle cx="12" cy="12" r="3.5"/>',
  chevDown: '<path d="m7 9.5 5 5 5-5"/>',
  external: '<path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  skip: '<path d="M4.5 12h11M11.5 7.5 16 12l-4.5 4.5"/><path d="M19.5 6v12"/>',
  note: '<path d="M6 3.5h8.5L18 7v13.5H6z"/><path d="M9 11h6M9 15h4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 19.5h14"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8h.01"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  branch: '<circle cx="7" cy="5.5" r="2"/><circle cx="7" cy="18.5" r="2"/><circle cx="17" cy="9" r="2"/><path d="M7 7.5v9M17 11c0 3-3.5 3.5-8.3 5.8"/>',
};
export const TYPE_ICON = { seedling: 'sprout', callus: 'cells', shoot: 'flask2', rooting: 'roots', other: 'dot' };

export const icon = (name, cls = '') => raw(`<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`);

// ───────────── 页面结构 ─────────────

export function pageHead(title, sub = '', right = '', back = '') {
  return html`<header class="page-head">
    ${back ? html`<div class="head-back">${back}</div>` : ''}
    <div class="head-row"><h1>${title}</h1><div class="head-actions">${right}</div></div>
    ${sub ? html`<div class="head-sub">${sub}</div>` : ''}
  </header>`;
}

export function section(title, body, extra = '', cls = '') {
  return html`<section class="sec ${cls}">
    ${title || extra ? html`<div class="sec-title"><span>${title}</span>${extra}</div>` : ''}
    <div class="list">${body}</div>
  </section>`;
}

export function field(label, control, { hint = '', cls = '', tag = 'div' } = {}) {
  const inner = html`<span class="field-label">${label}</span><span class="field-ctl">${control}</span>`;
  const h = hint ? html`<div class="field-hint">${hint}</div>` : '';
  return tag === 'label' ? html`<label class="field ${cls}">${inner}</label>${h}` : html`<div class="field ${cls}">${inner}</div>${h}`;
}

export function stepper(path, value, { min = 0, max = 999 } = {}) {
  return html`<span class="stepper">
    <button type="button" data-act="step" data-path="${path}" data-d="-1" data-min="${min}" data-max="${max}" aria-label="减少">−</button>
    <input type="number" inputmode="numeric" pattern="[0-9]*" min="${min}" max="${max}" data-bind="${path}" value="${value ?? ''}">
    <button type="button" data-act="step" data-path="${path}" data-d="1" data-min="${min}" data-max="${max}" aria-label="增加">+</button>
  </span>`;
}

export function seg(path, value, options, act = 'seg') {
  return html`<span class="seg" role="tablist">${options.map(
    ([v, label]) => html`<button type="button" role="tab" class="${String(v) === String(value) ? 'on' : ''}" aria-selected="${String(v) === String(value)}" data-act="${act}" data-path="${path}" data-v="${v}">${label}</button>`,
  )}</span>`;
}

/** 下拉框：显示选中项文字，点按弹出系统原生选择器 */
export function selectCtl(path, value, options) {
  const cur = options.find(([v]) => String(v) === String(value ?? ''));
  return html`<span class="select"><span class="select-val">${cur ? cur[1] : ''}</span>${icon('chevDown')}<select data-bind="${path}" aria-label="${cur ? cur[1] : ''}">${options.map(
    ([v, label]) => html`<option value="${v}"${attr('selected', String(v) === String(value ?? ''))}>${label}</option>`,
  )}</select></span>`;
}

export function toggle(path, on, extra = '') {
  return html`<label class="switch"><input type="checkbox" data-bind="${path}" ${raw(extra)}${attr('checked', on)}><span class="knob"></span></label>`;
}

export function navRow({ act, id = '', title, value = '', sub = '', ic = '', cls = '', chevron = true, data = '' }) {
  return html`<button class="row nav ${cls}" data-act="${act}" data-id="${id}" ${raw(data)}>
    ${ic ? html`<span class="row-ic">${icon(ic)}</span>` : ''}
    <span class="grow"><span class="t1">${title}</span>${sub ? html`<span class="t2">${sub}</span>` : ''}</span>
    ${value ? html`<span class="row-val">${value}</span>` : ''}
    ${chevron ? icon('chevR', 'chev') : ''}
  </button>`;
}

// ───────────── 底部弹层（表单、菜单、确认框共用） ─────────────

const stack = [];
export const topSheet = () => stack[stack.length - 1];

export function openSheet(opts) {
  const root = document.getElementById('sheets');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap' + (opts.kind ? ' ' + opts.kind : '');
  wrap.innerHTML = '<div class="sheet-backdrop" data-act="sheet-backdrop"></div><div class="sheet" role="dialog" aria-modal="true"></div>';
  root.appendChild(wrap);
  const sheet = { ...opts, el: wrap, body: wrap.querySelector('.sheet'), state: opts.state || {} };
  stack.push(sheet);
  refreshSheet(sheet);
  document.body.classList.add('has-sheet');
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  return sheet;
}

export function refreshSheet(sheet = topSheet()) {
  if (!sheet) return;
  morph(sheet.body, sheet.render(sheet.state, sheet));
}

export function closeSheet(sheet = topSheet(), result) {
  if (!sheet) return;
  const i = stack.indexOf(sheet);
  if (i < 0) return;
  stack.splice(i, 1);
  sheet.el.classList.remove('open');
  setTimeout(() => sheet.el.remove(), 280);
  if (!stack.length) document.body.classList.remove('has-sheet');
  if (sheet.onClose) sheet.onClose(result);
}
export function closeAllSheets() {
  while (stack.length) closeSheet(topSheet());
}

export function sheetHead(title, { left = '取消', leftAct = 'sheet-close', right = '', rightAct = '' } = {}) {
  return html`<div class="sheet-head">
    <button type="button" class="link" data-act="${leftAct}">${left}</button>
    <div class="sheet-title">${title}</div>
    ${right ? html`<button type="button" class="link strong" data-act="${rightAct}">${right}</button>` : html`<span class="link-ph"></span>`}
  </div>`;
}

/** 菜单：buttons = [{ label, fn, danger, ic }] */
export function actionSheet({ title = '', subtitle = '', buttons }) {
  openSheet({
    kind: 'menu',
    state: { buttons },
    render: () => html`<div class="menu">
      ${title || subtitle ? html`<div class="menu-head">${title ? html`<div class="menu-title">${title}</div>` : ''}${subtitle ? html`<div class="menu-sub">${subtitle}</div>` : ''}</div>` : ''}
      <div class="menu-list">${buttons.map((b, i) => html`<button type="button" class="menu-btn ${b.danger ? 'danger' : ''}" data-act="menu" data-i="${i}">${b.ic ? icon(b.ic) : ''}<span>${b.label}</span></button>`)}</div>
      <button type="button" class="menu-btn cancel" data-act="sheet-close">取消</button>
    </div>`,
  });
}

export function confirmDialog({ title, message = '', ok = '确定', danger = false }) {
  return new Promise((resolve) => {
    openSheet({
      kind: 'alert',
      state: { resolve },
      onClose: (r) => resolve(!!r),
      render: () => html`<div class="alert">
        <div class="alert-title">${title}</div>
        ${message ? html`<div class="alert-msg">${message}</div>` : ''}
        <div class="alert-btns">
          <button type="button" data-act="alert-no">取消</button>
          <button type="button" class="${danger ? 'danger' : 'strong'}" data-act="alert-yes">${ok}</button>
        </div>
      </div>`,
    });
  });
}

// ───────────── 轻提示 ─────────────

let toastTimer = 0;
let toastAction = null;
export function toast(msg, { actionLabel = '', action = null, ms = 3200 } = {}) {
  const el = document.getElementById('toast');
  toastAction = action;
  el.innerHTML = String(html`<div class="toast-inner"><span class="toast-msg">${msg}</span>${actionLabel ? html`<button type="button" data-act="toast-action">${actionLabel}</button>` : ''}</div>`);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, ms);
}
export function hideToast() {
  document.getElementById('toast').classList.remove('show');
}
export function runToastAction() {
  const a = toastAction;
  toastAction = null;
  hideToast();
  if (a) a();
}

// ───────────── 就地更新 DOM ─────────────
// 重新渲染时尽量复用已有节点（只改变化的属性/文字），这样：
// 正在点的按钮不会被替换掉（否则点击会丢失）、输入框焦点和滚动位置都能保留。

export function morph(el, markup) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(markup);
  morphChildren(el, tpl.content);
}
function sameKind(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return false;
  if (a.nodeType !== 1) return true;
  return a.getAttribute('data-key') === b.getAttribute('data-key') && a.getAttribute('type') === b.getAttribute('type');
}
function morphChildren(from, to) {
  const a = [...from.childNodes];
  const b = [...to.childNodes];
  for (let i = 0; i < b.length; i++) {
    const na = a[i];
    const nb = b[i];
    if (!na) from.appendChild(nb);
    else if (sameKind(na, nb)) morphNode(na, nb);
    else from.replaceChild(nb, na);
  }
  for (let i = b.length; i < a.length; i++) from.removeChild(a[i]);
}
function morphNode(a, b) {
  if (a.nodeType !== 1) {
    if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
    return;
  }
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
  for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  const tag = a.tagName;
  const focused = a === document.activeElement;
  if (tag === 'INPUT') {
    if (a.type === 'checkbox' || a.type === 'radio') a.checked = b.hasAttribute('checked');
    else if (!focused) {
      const v = b.getAttribute('value') ?? '';
      if (a.value !== v) a.value = v;
    }
    return;
  }
  if (tag === 'TEXTAREA') {
    if (!focused && a.value !== b.value) a.value = b.value;
    return;
  }
  morphChildren(a, b);
  if (tag === 'SELECT') {
    const sel = [...b.options].find((o) => o.hasAttribute('selected'));
    if (sel && a.value !== sel.value) a.value = sel.value;
  }
}

// ───────────── 小工具 ─────────────

export function setPath(obj, path, value) {
  const keys = String(path).split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (o[k] == null) o[k] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}
export function getPath(obj, path) {
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function readInput(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number') return el.value === '' ? '' : Number(el.value);
  return el.value;
}
export function fmtTime(ts) {
  if (!ts) return '从未';
  const d = new Date(ts);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}
