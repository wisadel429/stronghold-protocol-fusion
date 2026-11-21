// public/js/accountApi.js — 账号系统 HTTP 客户端（server/accounts/http.js 的对端）。
//
// 会话是 HttpOnly cookie（`sp_acc`），所以这里一律 `credentials: 'include'`，JS 拿不到 token 也读不到密码。
// 约定：成功 resolve 服务端 JSON；失败 throw 一个带 `code`（E_*）与 `status` 的 Error，调用方按 code 决定文案。
const BASE = '/api/account';

/**
 * @param {string} path @param {{ method?: string, body?: any }} [opts]
 * @returns {Promise<any>}
 */
async function call(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw Object.assign(new Error('连不上服务器'), { code: 'E_NET', status: 0, cause: e });
  }
  let json = null;
  try { json = await res.json(); } catch { /* 非 JSON（502 页面等）走下面 */ }
  if (!res.ok || !json || json.ok === false) {
    const err = new Error((json && json.message) || (json && json.error) || `请求失败（${res.status}）`);
    err.code = (json && json.error) || (res.status === 0 ? 'E_NET' : 'E_HTTP');
    err.status = res.status;
    throw err;
  }
  return json;
}

export const accountApi = {
  /** 当前登录的账号（未登录时 account === null）。本人视图带 qq。 */
  me: () => call('/me'),
  register: ({ qq, password, nickname, agree = true }) => call('/register', { method: 'POST', body: { username: qq, password, nickname, agree } }),
  login: ({ qq, password }) => call('/login', { method: 'POST', body: { username: qq, password } }),
  logout: () => call('/logout', { method: 'POST', body: {} }),
  rename: (nickname) => call('/rename', { method: 'POST', body: { nickname } }),
  profile: (patch) => call('/profile', { method: 'POST', body: patch }),
  getSave: () => call('/save'),
  putSave: (save) => call('/save', { method: 'PUT', body: { save } }),
  mergeSave: (save) => call('/save/merge', { method: 'POST', body: { save } }),
};
