// server/http/devGate.js — /dev/** 的访问闸门（业主 2026-11-28 要求）。
//
// 背景：public/dev/ 里是开发工具（game-mock、simcheck、trainer …），之前跟着 public/ 一起被静态服务放出去，
// 任何人都能拉。game-mock 只是造假对局，但 /dev/trainer 是一套能在战斗里改数值的客户端工具——文件公开就等于
// 把引擎送出去了（面板上的管理员判断挡不住直接 import engine.js 的人）。
//
// 口径，两条，任一满足即放行：
//   1) **管理员会话**：sp_acc 是 HttpOnly 会话票，服务端用 accountService.resolve(token) 换回账号，客户端伪造不了。
//   2) **本机直连**：对端是回环/内网**且没有反代头**（x-forwarded-for / x-real-ip / forwarded 都没有）。
//
// 为什么不按 IP 放行公网请求：线上 80 端口有反代（server/http/extraPorts.js），转发时**必定**补
// `x-forwarded-for`（那两处赋值）。所以「回环 + 无反代头」只会出现在 RDP / 本机浏览器直连 127.0.0.1:3000 时；
// 经反代进来的公网请求一定带 x-forwarded-for，走不到这一条。反过来，如果只按 remoteAddress 判断，
// 公网请求全是 127.0.0.1，等于全放行。
//
// 账号系统关闭时（SP_ACCOUNTS=off，纯本机开发）只剩第 2 条，行为不变。

/** 这个前缀下的所有路径都走本闸门。 */
export const DEV_PREFIX = '/dev';

const PROXY_HEADERS = ['x-forwarded-for', 'x-real-ip', 'forwarded', 'x-forwarded-host'];

/** 请求是否经过反代转进来。 */
export function isProxied(req) {
  const h = req && req.headers;
  if (!h) return false;
  return PROXY_HEADERS.some((k) => h[k] != null && h[k] !== '');
}

/**
 * @param {{ accountsOn?: boolean, accountOf?: ((req: any) => any) | null,
 *           isLocal?: ((req: any) => boolean) | null, allowLocal?: boolean, log?: object }} [opts]
 *   accountOf：`req → account | null`（管理员账号是 `.admin === true`）
 *   isLocal：`req → boolean`，对端是否回环/内网（不含反代判断，本模块自己判）
 * @returns {(req: any) => boolean} true = 放行
 */
export function createDevGate({ accountsOn = true, accountOf = null, isLocal = null, allowLocal = true, log = null } = {}) {
  return function devGate(req) {
    // 1) 本机直连（无反代头）
    if (allowLocal && typeof isLocal === 'function' && !isProxied(req)) {
      try {
        if (isLocal(req) === true) return true;
      } catch (e) {
        log?.warn?.('[dev] 判断来源失败', e);
      }
    }
    // 2) 管理员会话
    if (!accountsOn || typeof accountOf !== 'function') return false;
    try {
      const acc = accountOf(req);
      return !!(acc && acc.admin === true);
    } catch (e) {
      log?.warn?.('[dev] 读取会话失败', e);
      return false;
    }
  };
}

/** 路径是否落在 /dev 下（含裸 `/dev`）。 */
export const isDevPath = (p) => typeof p === 'string' && (p === DEV_PREFIX || p.startsWith(`${DEV_PREFIX}/`));
