// GitHub REST API（只用仓库级接口）：读写数据文件、触发/查看提醒任务
const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function b64decode(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
const isConflict = (e) => e && (e.status === 409 || e.status === 422);

export class GitHub {
  constructor({ owner, repo, token }) {
    this.owner = owner;
    this.repo = repo;
    this.token = token;
  }

  async req(method, path, body, { allow404 = false } = {}) {
    let res;
    try {
      res = await fetch(`${API}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}${path}`, {
        method,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      const err = new GitHubError(0, '网络不可用');
      err.offline = true;
      throw err;
    }
    if (res.status === 404 && allow404) return null;
    if (res.status === 204) return null;
    let j = null;
    try {
      j = await res.json();
    } catch {
      /* 空响应 */
    }
    if (!res.ok) throw new GitHubError(res.status, (j && j.message) || res.statusText || String(res.status), j);
    return j;
  }

  repoInfo() {
    return this.req('GET', '');
  }

  /** 读取文本文件；不存在返回 null */
  async readFile(path) {
    const j = await this.req('GET', `/contents/${encPath(path)}`, null, { allow404: true });
    if (!j) return null;
    if (Array.isArray(j)) throw new GitHubError(400, `${path} 是目录`);
    let text;
    if (j.encoding === 'base64' && typeof j.content === 'string' && (j.content || !j.size)) text = b64decode(j.content);
    else {
      // 超过 1MB 的文件 contents 接口不返回内容，改用 blob 接口
      const blob = await this.req('GET', `/git/blobs/${j.sha}`);
      text = b64decode(blob.content);
    }
    return { sha: j.sha, text };
  }

  async writeFile(path, text, sha, message) {
    const body = { message, content: b64encode(text) };
    if (sha) body.sha = sha;
    const j = await this.req('PUT', `/contents/${encPath(path)}`, body);
    return { sha: j && j.content && j.content.sha };
  }

  /** 内容不同才写；遇到并发冲突自动重试 */
  async putText(path, text, message) {
    for (let i = 0; ; i++) {
      const cur = await this.readFile(path);
      if (cur && cur.text === text) return false;
      try {
        await this.writeFile(path, text, cur && cur.sha, message);
        return true;
      } catch (e) {
        if (isConflict(e) && i < 3) continue;
        throw e;
      }
    }
  }

  /** 读-改-写 JSON 文件，冲突自动重试 */
  async updateJson(path, fallback, fn, message) {
    for (let i = 0; ; i++) {
      const cur = await this.readFile(path);
      let val = fallback;
      if (cur) {
        try {
          val = JSON.parse(cur.text);
        } catch {
          val = fallback;
        }
      }
      const next = fn(val);
      const text = JSON.stringify(next, null, 2) + '\n';
      if (cur && cur.text === text) return next;
      try {
        await this.writeFile(path, text, cur && cur.sha, message);
        return next;
      } catch (e) {
        if (isConflict(e) && i < 3) continue;
        throw e;
      }
    }
  }

  dispatch(workflow, ref, inputs) {
    return this.req('POST', `/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, { ref, inputs });
  }

  async runs(workflow, n = 5) {
    const j = await this.req('GET', `/actions/workflows/${encodeURIComponent(workflow)}/runs?per_page=${n}`, null, { allow404: true });
    return j ? j.workflow_runs || [] : [];
  }
}

export function errText(e) {
  if (!e) return '';
  if (e.offline) return '网络不可用：改动已保存在本机，联网后会自动同步';
  switch (e.status) {
    case 401:
      return 'Token 无效或已过期，请在「设置 → GitHub 同步」里重新粘贴';
    case 403:
      return /rate limit/i.test(e.message || '') ? 'GitHub 请求太频繁，稍后会自动重试' : '权限不足：请检查 Token 是否给了这个仓库 Contents / Workflows / Actions 的 Read and write 权限';
    case 404:
      return '找不到数据仓库：检查用户名和仓库名，以及 Token 是否授权了这个仓库';
    default:
      return e.message || String(e);
  }
}
