// Web Push：环境检测、VAPID 密钥生成、订阅
export const b64u = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export function unb64u(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

export function pushEnv() {
  const sw = 'serviceWorker' in navigator;
  const push = sw && 'PushManager' in window && 'Notification' in window;
  return { sw, push, ios: isIOS(), standalone: isStandalone(), permission: 'Notification' in window ? Notification.permission : 'unsupported' };
}

export function guessDevice() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  return '浏览器';
}

/** 用 WebCrypto 生成 VAPID 密钥（P-256），格式与提醒脚本一致 */
export async function generateVapid(subject) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const rawPub = await crypto.subtle.exportKey('raw', kp.publicKey);
  return { publicKey: b64u(rawPub), privateKey: jwk.d, x: jwk.x, y: jwk.y, subject, createdAt: new Date().toISOString() };
}

function sameKey(a, b) {
  if (!a || !b) return true; // 浏览器不告诉我们旧 key 时，默认沿用
  const x = new Uint8Array(a);
  if (x.length !== b.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== b[i]) return false;
  return true;
}

/**
 * 必须在点击事件里第一时间调用（iOS 要求由用户手势触发授权弹窗）。
 * 返回 PushSubscription 的 JSON：{ endpoint, keys: { p256dh, auth } }
 */
export async function subscribePush(reg, vapidPublic) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    throw new Error(perm === 'denied' ? '通知权限被关闭了：请到「设置 → 通知 → 实验日程」里允许通知，再回来点一次' : '没有获得通知权限，请再点一次并选择“允许”');
  }
  const key = unb64u(vapidPublic);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options && sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const j = sub.toJSON();
  return { endpoint: j.endpoint, keys: j.keys };
}
