// server/index.js — process entry & boot (DESIGN §1, §2). Plain node:http + ws, no framework: startServer() below
// wires the modules under server/http/, in this order —
//
//   http/config.js     ROOT, the served directories, the environment (PORT 3000, HOST '::' dual-stack, TRUST_PROXY auto, DEBUG),
//                      which startServer() options go to net.js / lobby.js, the console logger, the official versions
//                      this server offers (SP_VERSIONS / SP_VERSION_DEFAULT / SP_MAX_VERSION_HOSTS — versions.js below)
//   versions.js        the official versions (DESIGN §35.23, M1): each enabled one's cs, data, manifest
//                      (/cs/<cs16>/index.json) and data directory (/data/versions/<slug>/); their matches run in match
//                      hosts of their own (match/host/, kind 'version') — the pool exists when another version is
//                      enabled (the default: all four) and forks a process on the first match of one, never at boot;
//                      none when only 第二期下半 is enabled
//   http/websocket.js  session wiring (SessionRegistry → Lobby → Network) and the WebSocket at /ws (maxPayload 64 KB,
//                      permessage-deflate from 1 KB; refused at upgrade with 404 / 429 per network / 503)
//   http/static.js     the static mounts (/ → public/, /data/, /shared/, /sim/ `.js` only), the /data.js browser stand-in,
//                      the language packs (/packs/index.json, /packs/<id>/<file>), the plugin catalogue
//                      (/plugins/index.json — the registry is plugins/registry.js), the vanilla content set's manifest
//                      (/cs/<cs16>/index.json — plugins/identity.js: the content hash `cs`, DESIGN §32), the visual sets
//                      of cosmetic plugins (/vs/<vs16>/…, plugins/visualSet.js) and their files (/p/<id>/<hash8>/…),
//                      the content sets of gameplay plugins (/cs/<cs16>/…, plugins/contentSets.js — DESIGN §32.6; the
//                      server owner's plugins/config.json: plugins/policy.js; a room's plugins: plugins/roomSets.js; its
//                      match then runs in that set's worker: match/host/)
//   http/media.js      /media/bgm/act1 → public/assets/audio/bgm/act1.mp3 (audio addressed without its extension)
//   http/files.js      one file → response: MIME, brotli / gzip + memory cache, ETag / Last-Modified / 304, Cache-Control, ranges
//   http/assetIndex.js the content hashes of public/assets and public/fonts (built in the background, cached in
//                      .cache/asset-hashes.json by path + size + mtime; Spine models share one hash)
//   http/assetViews.js the served /data/assets.json, /data/local-assets.json and /data/local-fx.json: every art URL with
//                      its hash segment (/assets/~<hash>/…, immutable when the hash matches); the files stay unchanged
//   http/buildTag.js   the build tag of the served browser runtime (/healthz `build`, public/js/ui/buildGuard.js)
//   http/routes.js     the request listener: security headers, 414 / 400, the plugin studio (/studio/, studio/index.js —
//                      this machine and the local network only), 405, GET /healthz → JSON status, else static
//   http/traffic.js    the traffic counters: bytes sent per category (assets / audio / code / data) and on the
//                      WebSocket, since the start (GET /healthz?traffic=1)
//   http/common.js     what every answer shares: security headers, URL split, error page, JSON replies, bare 400
//   http/boot.js       a pending update package first (update.js: old files deleted, the install verified against
//                      MANIFEST.json), banner (Local / LAN / tunnel URLs), port-in-use hint, graceful shutdown on SIGINT /
//                      SIGTERM
//
// Per-network limits for internet clients (see net.js clientAddress; local/LAN peers are exempt): open sockets
// (maxConnectionsPerAddr, refused at upgrade with 429), rooms and running matches (lobby.js).
//
// Programmatic use (tests): `const srv = await startServer({ port: 0, quiet: true }); … await srv.close();`
// The server only auto-listens when this file is the process entry point.

import http from 'node:http';
import path from 'node:path';
import { getData, loadData } from './data.js';
import { getBotStrategy } from './match/botStrategies.js';
import { noteLlmIgnored, releaseIgnoresExternalAi, validateExternalConfig } from './match/llmGate.js';
import { ROOT, listenAddress, bindCandidates, serveDirs, makeLogger, parseTrustProxy, assetIndexOptionsFrom, versionsFrom, parseRoomCode } from './http/config.js';
import { WS_MAX_PAYLOAD, createSessionStack, attachWebSocket } from './http/websocket.js';
import { siteCsp } from './http/csp.js';
import { DATA_SHIM_JS, createStaticHandler } from './http/static.js';
import { createDevGate } from './http/devGate.js';
import { isLocalIp, normalizeIp } from './net.js';
// 业主 2026-11-21：「域名 mon3tr.fun 一输入就进游戏」—— 额外端口（80）透明代理到主端口
import { readExtraPorts, startExtraPorts } from './http/extraPorts.js';
import { ensureArtKey, hasArtKey } from './artKeyFetch.js';
import { createPluginRegistry } from './plugins/registry.js';
import { computeVanillaContent } from './plugins/identity.js';
import { createVisualSets } from './plugins/visualSet.js';
import { createContentSets } from './plugins/contentSets.js';
import { createPluginPolicy } from './plugins/policy.js';
import { createRoomSets } from './plugins/roomSets.js';
import { createMatchHosts } from './match/host/index.js';
import { Matchmaker } from './matchmaking.js';
import { createVersionSets } from './versions.js';
import { readVersionPolicy, applyVersionPolicy } from './versionPolicy.js';
import { versionById } from '../shared/versions.js';
import { t } from '../shared/i18n.js';
import { createTrustedRuntime } from './plugins/trustedRuntime.js';
import { trustedHostAllowed } from './plugins/trusted.js';
import { createStudio } from './studio/index.js';
import { ADMIN_DEFAULTS, ADMIN_CSP, adminPageExists, createAdminServer } from './admin.js';
import { createAdminLive } from './admin-live.js';
import { createResourceMonitor } from './admin-monitor.js';
import { MIME, COMPRESSIBLE, acceptsGzip, pickEncoding, parseRange } from './http/files.js';
import { BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag } from './http/buildTag.js';
import { createRequestHandler } from './http/routes.js';
import { createTrafficCounter } from './http/traffic.js';
import { createAssetIndex } from './http/assetIndex.js';
import { createManifestViews } from './http/assetViews.js';
import { answerClientError, sendJson, sendError } from './http/common.js';
import { createEventLoopMonitor } from './health/eventLoop.js';
import { createRoomWorkerPool } from './workers/roomPool.js';
import { AccountStore } from './accounts/store.js';
import { AccountService } from './accounts/service.js';
import { createAccountApi, parseCookies, COOKIE } from './accounts/http.js';
import { SocialStore, SocialService } from './accounts/social.js';
import { createSocialApi } from './accounts/socialHttp.js';
import { createUpdateApi } from './updateApi.js';
// 公开只读 API（/api/rooms 房间目录 · /api/create_room · /api/ping · /api/announcement）：
// 服务器列表靠它读「房间 / 对局」，这个融合版之前没接线，列表就只能显示「— 房间」和 0% 在线。
import { createPublicApi } from './publicApi.js';
import { Announcements } from './announcements.js';
import { createFeedbackStore, createFeedbackApi } from './feedback.js';
import { MessageStore } from './accounts/messages.js';
import { createAutostart } from './autostart.js';
import { lanUrls, displayHost, isProcessEntry, runMain } from './http/boot.js';

// The public API of this module (tests and tools import it from here); the code lives in ./http/.
export {
  ROOT, WS_MAX_PAYLOAD, DATA_SHIM_JS, MIME, COMPRESSIBLE, BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag,
  acceptsGzip, pickEncoding, parseRange, createStaticHandler, lanUrls, parseTrustProxy,
};

/**
 * Build and start the HTTP + WebSocket server.
 * @param {{
 *   port?: number, host?: string, quiet?: boolean, log?: object,
 *   publicDir?: string, dataDir?: string, sharedDir?: string, packsDir?: string, pluginsDir?: string,
 *   MatchClass?: Function, seedFn?: () => number,
 *   lobbyGraceMs?: number, reconnectWindowMs?: number, heartbeatMs?: number, helloTimeoutMs?: number,
 *   ratePerSec?: number, rateBurst?: number, maxConnections?: number, maxRooms?: number,
 *   maxConnectionsPerAddr?: number, maxRoomsPerAddr?: number, maxMatchesPerAddr?: number, resyncMinGapMs?: number,
 *   heavyPerSec?: number, heavyBurst?: number, trustProxy?: 'auto' | boolean, soloReconnectWindowMs?: number,
 *   versionVoteMs?: number, versionRetryMs?: number,
 *   roomCode?: string | null,
 *   assetIndex?: boolean | { cacheFile?: string | null, delayMs?: number }, studio?: boolean,
 *   matchHost?: object, versions?: { enabled?: 'all' | string[], default?: string, maxHosts?: number },
 * }} [opts]
 *   assetIndex: the content-hash index (default on; false or SP_ASSET_INDEX=0: off — config.js assetIndexOptionsFrom);
 *   studio: the plugin studio at /studio/ (default on for this machine and the local network — SP_STUDIO=local|off;
 *   false: none);
 *   matchHost: options of the match hosts (server/match/host/index.js — watchdogMs, matchOptions …; tests) — the
 *   version hosts' too; versions: the official versions this server offers (http/config.js versionsFrom; DESIGN §35.23);
 *   versionVoteMs / versionRetryMs: the version vote's answer window and the guard after a declined or expired vote (tests;
 *   server/lobby.js header "Official versions")
 *   roomCode: a fixed alliance key for every new room (--room-code; four letters or digits — config.js parseRoomCode);
 * @returns {Promise<{ port: number, host: string, url: string, server: http.Server, wss: import('ws').WebSocketServer,
 *                     lobby: import('./lobby.js').Lobby, network: import('./net.js').Network,
 *                     registry: import('./net.js').SessionRegistry, packs: ReturnType<typeof createPluginRegistry>,
 *                     content: import('./plugins/identity.js').VanillaContent, visual: ReturnType<typeof createVisualSets>,
 *                     contents: ReturnType<typeof createContentSets>, hosts: ReturnType<typeof createMatchHosts>,
 *                     versions: ReturnType<typeof createVersionSets>, versionHosts: ReturnType<typeof createMatchHosts> | null,
 *                     traffic: ReturnType<typeof createTrafficCounter>, assetIndex: ReturnType<typeof createAssetIndex> | null,
 *                     views: ReturnType<typeof createManifestViews> | null, studio: ReturnType<typeof createStudio> | null,
 *                     close: () => Promise<void> }>}
 */
export async function startServer(opts = {}) {
  // A release ignores external-AI settings (one log line) and keeps the built-in bot (§35.66).
  // An unknown strategy id still fails here, before data is loaded or the port is opened.
  const log = opts.log || makeLogger(!!opts.quiet);
  if (releaseIgnoresExternalAi()) noteLlmIgnored(log);
  try {
    const strategy = getBotStrategy(process.env.SP_BOT_STRATEGY);
    if (strategy.id === 'external') validateExternalConfig();
  } catch (cause) {
    throw new Error(`Invalid SP_BOT_STRATEGY: ${cause.message}. Unset SP_BOT_STRATEGY to use the original bot (legacy).`, { cause });
  }
  const { port, host } = listenAddress(opts);
  const { publicDir, dataDir, sharedDir, packsDir, pluginsDir } = serveDirs(opts);
  const simDir = path.join(ROOT, 'server', 'sim');

  // The process-wide singleton serves the default data dir; a custom dir (tests) gets its own copy.
  const data = opts.dataDir ? loadData(dataDir, { log }) : getData({ dir: dataDir, log });
  // the vanilla content hash `cs` (DESIGN §32): the bytes of the served sim, shared code and game data, read once now —
  // like the data the matches use and the build tag below
  const content = computeVanillaContent({ simDir, sharedDir, dataDir, shim: DATA_SHIM_JS, log });
  log.info(`[content] vanilla ${content.cs.slice(0, 16)} (${Object.keys(content.simFiles).length} code files, ${Object.keys(content.data).length} data files)`);
  // language packs and plugins (docs/PACKS.md, docs/PLUGINS.md): scanned now — the start log names them — and again
  // whenever their folders change
  const scriptMode = process.env.SP_PLUGIN_SCRIPTS;
  const packs = createPluginRegistry({ publicDir, dataDir, packsDir, pluginsDir }, { log, scriptHost:host, scriptMode });
  packs.refresh(true);
  // the content hashes of the art (built in the background once listening) and the manifests served with them
  const indexOptions = assetIndexOptionsFrom(opts, publicDir);
  const assetIndex = indexOptions ? createAssetIndex({ publicDir, log, ...indexOptions }) : null;
  const views = createManifestViews({ dataDir, index: assetIndex, log });
  // the visual sets of the cosmetic plugins (DESIGN §32 P1a): what a room's host switches on, served at /vs/ and /p/
  const visual = createVisualSets({ registry: packs, log });
  // the server owner's policy (plugins/config.json), the content sets of the gameplay plugins (served at /cs/<cs16>/…),
  // what a room's plugins make of both, and the match hosts a room with gameplay plugins plays in (DESIGN §32.6)
  const policy = createPluginPolicy({ pluginsDir, log });
  const contents = createContentSets({ registry: packs, vanillaData: data, log, maxSets: () => policy.get().maxSets });
  const roomSets = createRoomSets({ registry: packs, visual, contents, policy });
  // a child process per content set; SP_MATCH_HOST=worker asks for a worker thread instead (match/host/index.js header:
  // an out-of-memory abort in a worker thread ends the whole server)
  const transport = String(process.env.SP_MATCH_HOST || '').trim().toLowerCase() === 'worker' ? 'worker' : 'process';
  const hosts = createMatchHosts({ contents, log, options: { transport, maxWorkers: Math.max(1, policy.get().maxSets), ...(opts.matchHost || {}) } });
  // the official versions (DESIGN §35.23, M1): which ones (the option, else SP_VERSIONS …), their content, and — only
  // when one beyond 第二期下半 is enabled — the match hosts their rooms play in (counted apart from the plugin hosts).
  // 业主口径 2026-11-17「封禁除第二期下半以外的所有版本」：<dataDir>/versions-policy.json 里 disabled 的版本不加载、
  // 不能开局，但仍随 welcome.versions 下发（disabled + reason），客户端在选择器里灰掉并提示「暂未开放」。
  const versionPolicy = readVersionPolicy(dataDir, { log });
  const versionCfg = applyVersionPolicy(versionsFrom(opts, log), versionPolicy);
  const versions = createVersionSets({ enabled: versionCfg.enabled, defaultId: versionCfg.default, dataDir, vanilla: content, defaultData: data, blocked: versionCfg.blocked, blockedHint: versionCfg.hint, log });
  // (the test options of matchHost apply to both pools, but never the version pool's kind or its own SP_MAX_VERSION_HOSTS)
  const versionHosts = versions.nonDefault.length
    ? createMatchHosts({ contents: versions, log, options: { transport, ...(opts.matchHost || {}), kind: 'version', maxWorkers: Math.max(1, versionCfg.maxHosts) } })
    : null;
  log.info(`[versions] enabled: ${versions.ids.map((id) => `${id} (${t(/** @type {any} */ (versionById(id)).label)}${id === versions.defaultId ? ', default' : ''})`).join(', ')}${versions.blocked.length ? ` · 暂未开放: ${versions.blocked.join(', ')}` : ''}`);
  const simPool = createRoomWorkerPool({ data });
  /**
   * 账号系统（server/accounts，业主 2026-11-14）：
   *   HTTP 登录（HttpOnly cookie `sp_acc`）→ WS 升级时凭 cookie 解析账号 → hello 时绑定到 session。
   *   `requireAccount` 打开后**必须登录才能 hello**（= 必须登录才能进大厅/房间）；`SP_ACCOUNTS=off` 或 startServer({accounts:false})
   *   可临时关掉（本地调试用），关掉时行为与接入前逐字节一致。
   */
  const accountsOn = !(opts.accounts === false || process.env.SP_ACCOUNTS === 'off');
  // 账号数据目录：默认跟游戏数据放一起；SP_ACCOUNTS_DIR 可指到别处（测试隔离 / 单独备份盘）
  const accountsDir = process.env.SP_ACCOUNTS_DIR ? path.resolve(process.env.SP_ACCOUNTS_DIR) : dataDir;
  const accountStore = new AccountStore({ dir: accountsDir, log });
  const accountService = new AccountService({ store: accountStore });
  const resolveAccount = accountsOn
    ? (req) => {
      try {
        const token = parseCookies(req && req.headers && req.headers.cookie)[COOKIE];
        return token ? (accountService.resolve(token)?.id || null) : null;
      } catch { return null; }
    }
    : null;
  // /dev/** 闸门（业主 2026-11-28）：管理员会话，或本机直连（无反代头）。见 server/http/devGate.js。
  const devGate = createDevGate({
    accountsOn,
    accountOf: accountsOn
      ? (req) => {
        try {
          const token = parseCookies(req && req.headers && req.headers.cookie)[COOKIE];
          return token ? (accountService.resolve(token) || null) : null;
        } catch { return null; }
      }
      : null,
    isLocal: (req) => isLocalIp(normalizeIp(req && req.socket && req.socket.remoteAddress)),
    log,
  });
  const { registry, lobby, network } = createSessionStack({ ...opts, requireAccount: accountsOn, resolveAccount },
    { data, log, content, plugins: roomSets, hosts, versions, versionHosts, simPool });
  // 社交（账号系统第二期）：好友 / 黑名单 / 邀请；在线状态由 network 现算，不落盘
  const socialStore = accountsOn ? new SocialStore({ dir: accountsDir, log }) : null;
  // 消息中心（业主 2026-11-21）：好友请求 / 房间邀请 / 后台回复反馈，都往这里追加一条
  // 实时推送（业主 2026-11-22）：消息一落盘就顺着 sendToAccount() 推给该账号在线的连接（`account.msg`），
  // 客户端收到立刻刷新列表；没在线的人下次拉 /api/messages 照样拿到，所以推送只是加速，不是唯一通道。
  // 用参数传进来的 unread 而不是回头读 messageStore —— 构造期间它还不可见（TDZ）。
  const messageStore = accountsOn
    ? new MessageStore({
      dir: accountsDir,
      log,
      notify: (accountId, row, unread) => { network.sendToAccount(accountId, { t: 'account.msg', item: row, unread }); },
    })
    : null;
  const socialService = socialStore ? new SocialService({ store: socialStore, accounts: accountService, network, log, messages: messageStore }) : null;
  if (socialService) lobby.social = socialService;   // 房间列表可见性（黑名单）由 lobby 读取
  // 账号头像（业主 2026-11-14）：座位/对局/结算按 accountId 读每个玩家**自己**的干员立绘头像
  lobby.accounts = accountsOn ? accountService : null;
  // 搜寻队友 (server/matchmaking.js): starts on the first queue entry; the lobby forwards room.matchmake to it.
  // 两个超时是分开的（业主 2026-11-27）：
  //   queueTimeoutMs   = 散人撮合单次等待 45 秒（到点把已匹到的人全部送进房间，只匹到一个就取消匹配）
  //   confirmTimeoutMs = 房间补齐 / 确认入场倒计时 30 秒（超时踢掉未准备的、保留已准备的继续匹配）
  // 以前这里只有 `timeoutMs: 10_000`，把 matchmaking.js 的默认值压掉了 —— 线上两个超时其实都是 10 秒
  // （所以 11-26 那次「确认倒计时 30 秒」从来没生效过）。
  const matchmaker = new Matchmaker(lobby, {
    queueTimeoutMs: Number(process.env.SP_MATCH_QUEUE_TIMEOUT_MS) || 45_000,
    confirmTimeoutMs: Number(process.env.SP_MATCH_CONFIRM_TIMEOUT_MS)
      || Number(process.env.SP_MATCHMAKE_TIMEOUT_MS) || 30_000,
  });
  lobby.matchmaker = matchmaker;
  // Main-thread event-loop delay sampling (server/health/eventLoop.js): opt-in with SP_LOOP_SAMPLE=1, no worker pool involved, and a
  // LOCAL log line per window (`[loop] p50=… p95=… p99=… max=… cpu=… mem=… rooms=… humans=… phase=…`) — deliberately not
  // part of /healthz. This is what tells an operator whether a stall is the rehearsal / battle slice or something else.
  const eventLoop = createEventLoopMonitor({
    log,
    windowMs: opts.loopSample?.windowMs,
    counts: () => {
      const s = lobby.stats();
      const phases = new Set();
      let rehearsals = 0;
      for (const room of lobby.rooms.values()) {
        if (room.match?.phase) phases.add(room.match.phase);
        rehearsals += room.match?._rehearsalTasks?.size || 0;
      }
      return { rooms: s.rooms, matches: s.matches, humans: s.humans, spectators: s.spectators,
        phase: [...phases].sort().join('+') || 'idle', rehearsals };
    },
  });
  // 美术资源密钥（业主 2026-11-15）：分发包里不带密钥，首次启动向主服务器领一次。
  // 拿不到也不阻断启动（只会有破图），玩家联网后重开即可。
  await ensureArtKey({ root: ROOT, log });
  // 前端要据此弹「没拿到密钥」的提示（/healthz.artKey）。
  // 用函数而不是快照：后台重试一旦领到，下一次 /healthz 立刻变成 'ok'。
  const artKeyStatus = () => (hasArtKey(ROOT) ? 'ok' : 'missing');
  if (artKeyStatus() === 'missing') log.warn?.('[artkey] 资源密钥缺失：加密资源会显示为破图（后台会自动重试）');
  // 后台重试（业主 2026-11-15）：启动时没领到，就每 30 秒再试一次，最多 20 次（10 分钟）。
  // 玩家把网络接上、或者服务器恢复后，不用重启游戏也能自动恢复。
  if (artKeyStatus() === 'missing') {
    let tries = 0;
    const timer = setInterval(async () => {
      if (artKeyStatus() === 'ok' || ++tries > 20) { clearInterval(timer); return; }
      const r = await ensureArtKey({ root: ROOT, log });
      if (r.ok) { log.info?.('[artkey] 后台重试成功，资源密钥已就绪'); clearInterval(timer); }
    }, 30_000);
    timer.unref?.();
  }
  const serveStatic = createStaticHandler({ publicDir, dataDir, sharedDir, simDir, packsDir, pluginsDir, packs, content, log, assetIndex, views, visual, contents, versions, devGate });
  // the plugin studio (DESIGN §32.9): its page and API for this machine and the local network; it watches plugins/ only
  // once it is used (hot reload), and rooms whose host is the author or alone follow a plugin's changes by themselves
  const studio = opts.studio === false ? null : createStudio({ publicDir, pluginsDir, dataDir, registry: packs, lobby, sessions: registry, log, fetch: opts.fetch });
  const trustedRuntime = await createTrustedRuntime({registry:packs,log});
  lobby.trustedRuntime = trustedRuntime;
  const startedAt = Date.now();
  // The tag is per process (see buildTag): read the browser runtime once, here, not on every /healthz.
  resetBuildTag();
  buildTag(ROOT, { servedVersionDirs: versions.servedDirs() });

  const traffic = createTrafficCounter();
  // 开机自启（业主 2026-11-22，待办 T-06）：每次启动自检一遍计划任务，缺了就自己建一个。
  // 建任务要管理员权限；失败只记一条 warn 并在 /healthz 里写 'denied'，绝不阻断启动。
  // 用函数暴露状态：ensure() 是异步的（要跑 schtasks），/healthz 每次读到的都是当前值。
  const autostart = createAutostart({ root: ROOT, dataDir, log });
  const autostartStatus = () => autostart.status();
  const serverName = opts.serverName ?? process.env.SERVER_NAME ?? 'server1';
  // 后台 (server/admin.js): the portable backend + this tree's adapter (admin-live.js). The gate wraps the WebSocket hook,
  // so it is wired before the HTTP listener exists; the page rides on the game port at /admin.
  const monitor = createResourceMonitor({ traffic, network, registry, lobby, startedAt, log, trustProxy: network.opts.trustProxy });
  const live = createAdminLive({ lobby, registry, network, monitor, log, serverName });
  const baseHandleConnection = network.handleConnection.bind(network);
  network.handleConnection = (ws, req) => { if (!live.onConnect(ws, req)) return; baseHandleConnection(ws, req); };
  const externalAdminPassword = opts.adminPassword ?? process.env.ADMIN_PASSWORD ?? null;
  const adminPassword = externalAdminPassword ?? ADMIN_DEFAULTS.password;
  const adminMounted = opts.admin === false ? null : createAdminServer({
    live, lobby, registry, network, monitor, log, password: adminPassword, passwordFromEnv: externalAdminPassword != null, startedAt, serverName,
    accounts: accountsOn ? accountService : null,
    // 后台删除账号时用它清理好友/黑名单/邀请（业主 2026-11-17）；同样延迟取，社交存储在账号之后才创建
    social: () => socialStore,
    root: ROOT,
    // 反馈存储稍后才创建，用 getter 延迟取（后台第一次请求时它一定已就绪）
    feedback: () => feedbackStore,
    // 消息中心（业主 2026-11-21）：后台回复反馈后给该账号推一条消息
    messages: () => messageStore,
    // 历史公告（业主 2026-11-22）：后台要能列出/删除历史，必须用同一个内存实例（否则会被下次写盘覆盖回去）
    announcements: () => announcements,
  });
  // 缺人同盟：GET /api/recruit — public co-op rooms still waiting for players (the lobby card polls it every 8 s)
  const recruitApi = async (req, res, pathname) => {
    if (pathname !== '/api/recruit') return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendJson(req, res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
      return true;
    }
    const rooms = [];
    for (const r of lobby.rooms.values()) {
      if (!r || r.disposed || r.match || !(r.mode === 'coop' || r.mode === 'coop_infinite')) continue;
      const seats = (r.seats || []).filter((s) => s && !s.left);
      const humans = seats.filter((s) => !s.isBot).length;
      const maxSeats = Number.isInteger(r.maxSeats) ? r.maxSeats : 4;
      if (humans < 1 || humans >= maxSeats) continue;
      const host = typeof r.seatOf === 'function' ? r.seatOf(r.hostId) : null;
      rooms.push({
        code: r.code, difficulty: r.difficulty, humans, maxSeats,
        bots: seats.filter((s) => s.isBot).length,
        hostName: host && !host.left ? host.name : '',
        quickSearch: !!r.matching,
      });
    }
    rooms.sort((a, b) => (b.maxSeats - b.humans) - (a.maxSeats - a.humans) || b.humans - a.humans);
    sendJson(req, res, 200, { ok: true, count: rooms.length, rooms });
    return true;
  };
  // 账号 HTTP API（/api/account/*）：必须挂在方法门之前（登录/注册是 POST）
  const accountApi = accountsOn
    ? createAccountApi({
      service: accountService,
      log,
      trustProxy: network.opts.trustProxy,
      // 单设备会话：新登录把旧连接踢掉（旧 token 已由 service 作废，客户端会回到登录页）
      onSessionReplaced: (accountId) => network.dropAccount(accountId),
    })
    : null;
  const socialApi = socialService ? createSocialApi({ service: socialService, accounts: accountService, log, lobby, messages: messageStore }) : null;
  // 导入热更包（启动器「导入热更包」按键 → server/updateApi.js）：只接受本机回环请求，解压到安装根目录
  const updateApi = createUpdateApi({ root: ROOT, log, trustProxy: network.opts.trustProxy });
  // 公开只读 API：房间目录与开关服探针（服务器列表用）。公告文件不存在就当作没有公告。
  // 公告文件不存在就当作没有公告。历史公告另存一份（业主 2026-11-22）：被覆盖的旧公告要能被玩家翻回去、被后台删掉
  const announcements = new Announcements({
    file: path.join(dataDir, 'announcement.json'),
    historyFile: path.join(dataDir, 'announcement-history.json'),
    // 业主 2026-11-22：公告一变就推给在线客户端（以前这里没接 broadcast，只能靠客户端轮询）。
    // 紧急公告因此能在对局中「立刻」弹出，而不是最多等一轮轮询。
    broadcast: (frame) => { try { live.broadcast(frame); } catch (e) { log.warn?.('[announcements] 推送失败', e); } },
    log,
  });
  announcements.start().catch((e) => log.warn?.('[announcements] 启动失败', e));
  const publicApi = createPublicApi({
    lobby, announcements, trustProxy: network.opts.trustProxy, sendJson, sendError, now: Date.now,
  });
  // 问题反馈：客户端提交 → data/feedback.json → 后台列表查看
  const feedbackStore = createFeedbackStore({ file: path.join(dataDir, 'feedback.json'), log });
  const feedbackApi = createFeedbackApi({
    store: feedbackStore,
    log,
    // 业主 2026-11-21：登录状态下提交的反馈记下账号，后台回复后能给他推一条消息
    identify: (req) => {
      try {
        const token = parseCookies(req.headers.cookie)[COOKIE];
        const acc = token && accountService ? accountService.resolve(token) : null;
        return acc && acc.id ? acc.id : '';
      } catch { return ''; }
    },
  });
  const server = http.createServer(createRequestHandler({ serveStatic, csp: process.env.SP_CSP === 'off' ? null : siteCsp(publicDir), admin: adminMounted, adminCsp: ADMIN_CSP, recruitApi, accountApi, socialApi, updateApi, publicApi, feedbackApi, health: { startedAt, network, registry, lobby, content, traffic, assetIndex, views, trusted:trustedRuntime?.health, versions, versionHosts, artKey: artKeyStatus, autostart: autostartStatus }, log, trustProxy: network.opts.trustProxy, studio, trustedRuntime }));
  server.on('clientError', answerClientError);
  const wss = attachWebSocket(server, { network, log, traffic });

  // The address actually bound. The default may fall back to IPv4; the returned host and url follow that.
  let boundHost;
  try {
    // A host with IPv6 switched off refuses '::'. Fall back to IPv4 rather than not booting. Only the default is
    // retried: an explicit HOST is literal (server/http/config.js bindCandidates).
    let bound = null;
    let lastError = null;
    const candidates = bindCandidates(host);
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      try {
        await new Promise((resolve, reject) => {
          const onError = (e) => { server.off('listening', onListening); reject(e); };
          const onListening = () => { server.off('error', onError); resolve(); };
          server.once('error', onError);
          server.once('listening', onListening);
          server.listen(port, candidate);
        });
        bound = candidate;
        break;
      } catch (e) {
        lastError = e;
        const retry = ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EINVAL'].includes(e.code) && i < candidates.length - 1;
        if (!retry) break;
        log.warn(`[boot] cannot bind ${candidate} (${e.code}) — falling back to IPv4 only`);
      }
    }
    if (bound === null) throw lastError;
    boundHost = bound;
    // Check the kernel's address too: aliases/DNS and bind fallback cannot weaken the owner gate.
    const actual = server.address();
    const scriptHost = actual && typeof actual === 'object' ? actual.address : '';
    packs.setScriptHost(scriptHost);
    const testGate = lobby.setTestHost(scriptHost);
    if (testGate.warn) log.warn(`[test-mode] ${testGate.warn}`);
    else if (testGate.enabled) log.info('[test-mode] test rooms enabled');
    if (!trustedHostAllowed(scriptHost, scriptMode)) {
      lobby.trustedRuntime = null;
      await trustedRuntime?.close();
    }
  } catch (e) {
    network.close(); // stop heartbeat/sweep timers of the half-built server
    hosts.close();
    versionHosts?.close();
    assetIndex?.close();
    studio?.close();
    eventLoop?.close();
    await simPool?.close();
    await trustedRuntime?.close();
    throw e;
  }
  server.on('error', (e) => log.error('[http] server error', e));
  assetIndex?.start();
  // started only once the server is listening: the first window then reports real counts, not a half-built hall
  eventLoop?.start();
  // 自启自检放在监听成功之后：起不来就别去动系统的计划任务（业主 2026-11-22）
  void autostart.ensure();

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const url = `http://${displayHost(boundHost)}:${actualPort}`;
  adminMounted?.setPublicPort?.(actualPort);
  if (adminMounted) {
    log.info(`[admin] 管理后台: ${url}/admin${adminMounted.usingDefaultPassword?.() ? '（初始口令 88888888，登录后请修改）' : ''}`);
    if (!adminPageExists()) log.warn('[admin] server/admin.html 缺失：后台页面打不开（API 仍可用）');
  }

  // 业务口径 2026-11-21：域名 mon3tr.fun 直接进游戏。data/http-ports.json 里配的额外端口（如 80）
  // 透明代理到主端口，主端口行为不变；配置不存在或绑不上都只告警，不影响启动。
  const extraPorts = startExtraPorts({
    ...readExtraPorts(path.join(dataDir, 'http-ports.json'), { log }),
    targetPort: actualPort,
    log,
  });
  if (extraPorts.ports.length) {
    extraPorts.ready().then((bound) => {
      for (const p of bound) log.info(`[extra-ports] 端口 ${p} → 127.0.0.1:${actualPort}（HTTP + WebSocket 透传）`);
      if (extraPorts.domain) {
        const d = extraPorts.domain;
        if (bound.includes(80)) log.info(`[extra-ports] 域名入口: http://${d}  （等价于 ${url}）`);
        else log.info(`[extra-ports] 域名入口: http://${d}:${actualPort}`);
      }
    }).catch(() => { /* 日志用，不影响运行 */ });
  }

  let closing = null;
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      try { lobby.shutdown('shutdown'); } catch (e) { log.error('[shutdown] lobby', e); }
      try { matchmaker.stop(); } catch (e) { log.error('[shutdown] matchmaker', e); }
      try { live.close(); } catch (e) { log.error('[shutdown] admin live', e); }
      try { adminMounted?.close(); } catch (e) { log.error('[shutdown] admin', e); }
      // 账号系统：把还没落盘的脏数据写完（存档/会话），避免退出丢最后一次改动
      try { accountStore.close(); } catch (e) { log.error('[shutdown] accounts', e); }
      try { socialStore?.close(); } catch (e) { log.error('[shutdown] social', e); }
      try { hosts.close(); } catch (e) { log.error('[shutdown] match hosts', e); }
      try { versionHosts?.close(); } catch (e) { log.error('[shutdown] version hosts', e); }
      // after the lobby: every room is gone, so no rehearsal can still be waiting on a thread
      try { await simPool?.close(); } catch (e) { log.error('[shutdown] simulation pool', e); }
      eventLoop?.close();
      network.close();
      assetIndex?.close();
      studio?.close();
      await trustedRuntime?.close();
      try { await extraPorts.close(); } catch (e) { log.error('[shutdown] extra ports', e); }
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections?.();
        setTimeout(() => { server.closeAllConnections?.(); }, 500).unref();
      });
      try { wss.close(); } catch { /* ignore */ }
    })();
    return closing;
  }

  return { port: actualPort, host: boundHost, url, server, wss, lobby, network, registry, packs, content, visual, contents, hosts, versions, versionHosts, traffic, assetIndex, views, studio, eventLoop, simPool, admin: adminMounted, live, monitor, extraPorts, close };
}

/**
 * The `--room-code ABCD` / `--room-code=ABCD` argument of this process entry, or null when it is absent. The value is
 * read once at startup and lives only in this server instance: there is no environment variable and nothing is
 * persisted, so stopping the server and starting it again without the argument is random again. A missing or invalid
 * value throws (the boot helper reports it and exits) instead of silently starting random.
 * @param {string[]} [argv]
 * @returns {string | null}
 */
export function roomCodeFromArgv(argv = process.argv.slice(2)) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--room-code') {
      const v = argv[i + 1];
      if (v == null || v.startsWith('-') || !v.trim()) throw new RangeError('--room-code needs 4 letters or digits');
      return parseRoomCode(v);
    }
    if (a.startsWith('--room-code=')) {
      const v = a.slice('--room-code='.length);
      if (!v.trim()) throw new RangeError('--room-code needs 4 letters or digits');
      return parseRoomCode(v);
    }
  }
  return null;
}

// `node server/index.js` / npm start: listen, print the banner, stop on SIGINT / SIGTERM (http/boot.js).
if (isProcessEntry(import.meta.url)) {
  runMain(() => startServer({ roomCode: roomCodeFromArgv() }));
  // 业主 2026-11-22：可选的「服务器列表上报」（探测与展示分离，方案 A）。
  // 只有 data/list-agent.json 存在时才会启动；模块内部把所有异常都吞掉了，不影响游戏本体。
  // 用 .then/.catch 而不是 top-level await —— 别让这个可选功能改变模块的加载时机。
  import('./listReporter.mjs')
    // 2026-11-22 17:1x：dataDir 必须用绝对路径。计划任务（开机自启）的 cwd 是 C:\Windows\System32，
    // 传相对 'data' 会让上报器找不到 data/list-agent.json 而静默关闭 —— 且异常被吞，日志里看不出来。
    .then((m) => m.startListReporter?.({ dataDir: path.join(ROOT, 'data'), log: console }))
    .catch(() => { /* 可选功能：加载失败就当没有 */ });
}
