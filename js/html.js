// 极简 HTML 模板：插值默认转义，防止批次名/备注里的字符破坏页面
class Safe {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v).replace(/[&<>"']/g, (c) => MAP[c]);
export const raw = (s) => new Safe(String(s));
const val = (v) => (v == null || v === false ? '' : v instanceof Safe ? v.s : Array.isArray(v) ? v.map(val).join('') : esc(v));

export function html(strings, ...vals) {
  let s = strings[0];
  for (let i = 0; i < vals.length; i++) s += val(vals[i]) + strings[i + 1];
  return new Safe(s);
}
/** 布尔属性：attr('checked', true) → ' checked' */
export const attr = (name, on) => (on ? raw(' ' + name) : '');
