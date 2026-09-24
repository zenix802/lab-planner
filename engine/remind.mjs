// 实验日程 · 定时提醒脚本
// 由数据仓库里的 GitHub Actions 每天早晚各运行一次：读取 data/planner.json，
// 算出今天/明天的待办，通过 Web Push 推送到已登记的 iPhone / iPad / Mac。
// 这个文件由应用自动写入数据仓库的 scripts/ 目录，不需要手动修改。零依赖，只用 Node 自带模块。

import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import { buildDigest, normalizeData, pickMode, todayIn, fmtMD, DATA_PATH } from './core.js';

const ROOT = process.env.DATA_ROOT || process.cwd();
const out = [];
const log = (s) => {
  out.push(s);
  console.log(s);
};

async function readJson(p, fallback = null) {
  try {
    return JSON.parse(await readFile(join(ROOT, p), 'utf8'));
  } catch {
    return fallback;
  }
}

// ───────────── Web Push（RFC 8291 aes128gcm 加密 + RFC 8292 VAPID）─────────────

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

export function vapidHeader(endpoint, vapid, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: vapid.subject || 'https://github.com/' + (process.env.GITHUB_REPOSITORY || '') }));
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: vapid.privateKey, x: vapid.x, y: vapid.y }, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${vapid.publicKey}`;
}

export function encryptPayload(sub, plaintext) {
  const uaPublic = unb64u(sub.keys.p256dh);
  const auth = unb64u(sub.keys.auth);
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = crypto.randomBytes(16);
  const prkKey = hmac(auth, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext, 'utf8'), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

export async function sendPush(sub, payload, vapid) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '43200',
      Urgency: 'high',
      Authorization: vapidHeader(sub.endpoint, vapid),
    },
    body: encryptPayload(sub, payload),
  });
  return { status: res.status, text: await res.text().catch(() => '') };
}

// ───────────── 可选：同时在 GitHub 上建一个待办 Issue（装了 GitHub App 会收到推送/邮件）─────────────

async function issueBackup(digest, today) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const owner = process.env.GITHUB_REPOSITORY_OWNER;
  if (!token || !repo) return;
  const api = async (path, method = 'GET', body) => {
    const r = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}/repos/${repo}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'lab-planner', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status}`);
    return r.status === 204 ? null : r.json();
  };
  const open = await api(`/issues?state=open&per_page=50&creator=${encodeURIComponent('github-actions[bot]')}`);
  for (const is of open || []) if (is.title && is.title.startsWith('📅')) await api(`/issues/${is.number}`, 'PATCH', { state: 'closed' });
  await api('/issues', 'POST', {
    title: `📅 ${fmtMD(today)} ${digest.title}`,
    body: `${digest.lines.map((l) => `- ${l}`).join('\n')}\n\n_由「实验日程」自动生成，完成后在应用里打勾即可。_${owner ? ` @${owner}` : ''}`,
    assignees: owner ? [owner] : [],
  });
  log('已同步创建 GitHub Issue 提醒');
}

// ───────────── 主流程 ─────────────

async function main() {
  const now = process.env.NOW ? new Date(process.env.NOW) : new Date();
  const raw = await readJson(DATA_PATH, {});
  const data = normalizeData(raw);
  const s = data.settings;
  let mode = String(process.env.MODE || 'auto').trim();
  if (!['morning', 'evening', 'test'].includes(mode)) mode = pickMode(s, now);
  const today = todayIn(s.tz, now);
  log(`实验日程提醒 · ${today} · ${mode}`);

  let digest;
  if (mode === 'test') {
    const d = buildDigest(data, 'morning', today);
    digest = { title: '✅ 测试通知', body: d ? `推送链路正常。${d.title}：\n${d.body}` : '推送链路正常。今天暂无待办 🌱', badge: d ? d.badge : 0, tag: 'test', url: './#/today', lines: d ? d.lines : [] };
  } else if ((mode === 'morning' && s.morning === false) || (mode === 'evening' && s.evening === false)) {
    log('该时段的提醒已在应用里关闭，跳过。');
  } else {
    digest = buildDigest(data, mode, today);
    if (!digest) log('没有需要提醒的事项，不打扰。');
  }

  let sent = 0;
  let failed = 0;
  if (digest) {
    log(`\n${digest.title}\n${digest.body}\n`);
    const vapid = await readJson('push/vapid.json');
    const subs = (await readJson('push/subscriptions.json', [])) || [];
    if (!vapid || !subs.length) {
      log('还没有设备开启推送：请在应用「设置 → 提醒」里点“开启本机提醒”。');
    } else {
      const payload = JSON.stringify({ title: digest.title, body: digest.body, badge: digest.badge, tag: digest.tag, url: digest.url, ts: now.getTime() });
      const keep = [];
      for (const sub of subs) {
        const name = sub.device || '设备';
        try {
          const r = await sendPush(sub, payload, vapid);
          if (r.status === 404 || r.status === 410) {
            log(`× ${name}：订阅已失效（${r.status}），已移除。重新打开应用即可再次开启。`);
            continue;
          }
          if (r.status >= 200 && r.status < 300) {
            sent++;
            log(`✓ 已推送到 ${name}`);
          } else {
            failed++;
            log(`! ${name} 推送失败：HTTP ${r.status} ${r.text.slice(0, 200)}`);
          }
        } catch (e) {
          failed++;
          log(`! ${name} 推送失败：${e.message}`);
        }
        keep.push(sub);
      }
      if (keep.length !== subs.length) await writeFile(join(ROOT, 'push/subscriptions.json'), JSON.stringify(keep, null, 2) + '\n');
    }
    if (s.issue && mode !== 'test') await issueBackup(digest, today).catch((e) => log('GitHub Issue 提醒失败：' + e.message));
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, '```\n' + out.join('\n') + '\n```\n').catch(() => {});
  }
  if (digest && sent === 0 && (failed > 0 || mode === 'test')) process.exitCode = 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
