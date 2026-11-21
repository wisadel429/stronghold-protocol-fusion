// public/js/ui/errorCause.js — what an error probably means, and which of the page's own log entries belong to it.
//
// The error-report dialog (ui/errorDialog.js) shows a player three things: what probably went wrong (a cause, in plain
// words, with the steps that usually fix it), the few log lines that are relevant (the rest stay in 设置 → 问题反馈),
// and where to ask for help (the QQ group). This module is the pure half — no DOM, no store, no i18n runtime — so the
// rules are easy to check on their own:
//
//   classifyProblem(input, ctx)     input: an Error, a { source, message, stack, detail } log entry or a string;
//                                   ctx:   { online, gpu, route, inMatch, attempt, settings } (all optional)
//                                   → { id, title, reason, steps, basis, confidence, tone }
//   relatedEntries(target, entries, limit)   the log entries closest to `target`, best first
//   keywordsOf(text) / fileRefs(text)        what "close" means: shared code files, shared words, close in time
//
// Every user-visible string is a Chinese msgid (shared/i18n.js: another language falls back to it), so a translation
// pack can pick them up later without touching this file. `basis` says why the guess was made, which keeps the dialog
// honest: a rule that cannot tell says so (`confidence: 'low'`).

/** @typedef {{ source?: string, message?: string, stack?: string|null, detail?: string|null, code?: string|number, at?: number }} ProblemInput */
/** @typedef {{ id: string, title: string, reason: string, steps: string[], basis: string|null, confidence: 'high'|'medium'|'low', tone: string }} Cause */

const LOW = (s) => String(s ?? '').toLowerCase();

/**
 * The text of a problem: message, stack, detail and code, plus one lower-cased haystack to match the rules against.
 * Accepts an Error, a log entry (diag.js), a NetError, a { code, msg } push or a plain string.
 * @param {ProblemInput|Error|string|null|undefined} input
 */
export function problemText(input) {
  const e = /** @type {any} */ (input) || {};
  const message = typeof e === 'string' ? e
    : typeof e.message === 'string' && e.message ? e.message
      : typeof e.msg === 'string' ? e.msg : '';
  const stack = typeof e.stack === 'string' ? e.stack : '';
  const detail = typeof e.detail === 'string' ? e.detail : '';
  const code = typeof e.code === 'string' || typeof e.code === 'number' ? String(e.code) : '';
  const source = typeof e.source === 'string' ? e.source : '';
  return { message, stack, detail, code, source, text: LOW([code, e.name, message, detail, stack].join(' ')) };
}

/** The .js files a message, a detail or a stack frame names (`net.js`, `/js/ui/toasts.js:12:5`). */
export function fileRefs(text) {
  const out = new Set();
  const re = /(?:^|[\/\s(@])([\w.-]+\.m?js)(?=[:)\s]|$)/g;
  let m;
  while ((m = re.exec(String(text ?? '')))) out.add(m[1].toLowerCase());
  return out;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'not', 'null', 'undefined', 'error', 'failed',
  'undefined', 'function', 'object', 'cannot', 'read', 'properties', 'true', 'false']);

/** Tokens two log lines can share: latin identifiers of 3+ characters (without the stop words) and every CJK 2-gram. */
export function keywordsOf(text) {
  const out = new Set();
  const s = String(text ?? '');
  for (const m of s.matchAll(/[a-z][a-z0-9_.$-]{2,}/gi)) {
    const w = m[0].toLowerCase();
    if (!STOP.has(w)) out.add(w);
  }
  for (const run of s.match(/[\u4e00-\u9fff]{2,}/g) || []) {
    for (let i = 0; i + 2 <= run.length; i++) out.add(run.slice(i, i + 2));
  }
  return out;
}

/**
 * The log entries most related to `target` (the entry being reported), best first. A shared source, a shared code file
 * or a shared word scores; so does being close in time. The target itself never comes back, and an unrelated entry
 * (score 0) is left out: the dialog shows what is on file, not a random tail of the log.
 * @param {{ source?: string, message?: string, stack?: string|null, detail?: string|null, at?: number }|null} target
 * @param {{ source?: string, message?: string, stack?: string|null, detail?: string|null, at?: number, lastAt?: number, count?: number }[]} entries
 * @param {number} [limit]
 * @returns {{ entry: any, score: number }[]}
 */
export function relatedEntries(target, entries, limit = 3) {
  if (!target || !Array.isArray(entries)) return [];
  const baseFiles = fileRefs([target.message, target.detail, target.stack].filter(Boolean).join('\n'));
  const baseWords = keywordsOf([target.message, target.detail].filter(Boolean).join(' '));
  const at = Number.isFinite(target.at) ? Number(target.at) : null;
  const scored = [];
  for (const e of entries) {
    if (!e) continue;
    if (e === target) continue;
    if (e.message === target.message && e.source === target.source && e.at === target.at) continue;
    let score = 0;
    if (e.source && e.source === target.source) score += 4;
    const files = fileRefs([e.message, e.detail, e.stack].filter(Boolean).join('\n'));
    for (const f of files) if (baseFiles.has(f)) { score += 6; break; }
    let shared = 0;
    for (const w of keywordsOf([e.message, e.detail].filter(Boolean).join(' '))) {
      if (baseWords.has(w) && ++shared >= 4) break;
    }
    score += shared;
    if (at != null && Number.isFinite(e.at)) {
      const gap = Math.abs(at - Number(e.at));
      if (gap <= 30_000) score += 3;
      else if (gap <= 120_000) score += 1;
    }
    // a crash outranks a warning that happened to share a word
    if (e.source === 'error' || e.source === 'rejection' || e.source === 'ui') score += 1;
    if (score >= 2) scored.push({ entry: e, score });
  }
  scored.sort((a, b) => b.score - a.score || (Number(b.entry.at) || 0) - (Number(a.entry.at) || 0));
  return scored.slice(0, Math.max(1, limit));
}

/** @returns {Cause} */
const cause = (id, title, reason, steps, basis = null, confidence = 'medium', tone = 'red') => ({ id, title, reason, steps, basis, confidence, tone });

const WEBGL = /webgl|webgl2|getcontext\(|createprogram|linkprogram|shader|context lost|gpu|显卡|图形接口|three\.js/;
const MEMORY = /out of memory|allocation failed|allocate|array buffer|buffer allocation|heap|invalid array length|maximum call stack|too much recursion|内存不足|内存/;
const AUDIO = /decodeaudio|audiocontext|audio worklet|no supported sources|mediadecodeerror|音效|音频|播放/;
const ASSET_FILE = /\.(png|jpe?g|webp|avif|gif|mp3|ogg|wav|m4a|json|spine|atlas)(\?|$|\b)/;
const ASSET_TEXT = /image failed|failed to load|load failed|资源|素材|sprite|atlas|asset/;
const NETWORK = /websocket|failed to fetch|networkerror|net::err|err_connection|err_internet|err_name|load failed|offline|断线|连接|超时|timeout|timed out|socket/;
const SERVER = /internal|500|502|503|504|服务器|server/;
const PLUGIN = /plugin|插件|content set|内容集|hash|sha256|signature|签名|mode id|规则/;
const SIM = /sim|simulation|snapshot|battle|step failed|战斗|模拟|快照/;
/** A plain JavaScript fault in the page's own code (the most common kind: a null the code expected to be filled). */
const SCRIPT = /cannot read propert|is not a function|is not iterable|of null|of undefined|undefined is not|typeerror|referenceerror|syntaxerror|cannot convert|not a constructor/;

/**
 * What an error probably is, in a player's words, and what usually helps. The first rule that fits names the cause; a
 * distinctive marker (an error code, a status, "WebGL", a file that failed) raises the confidence, a vague match lowers
 * it. `ctx` sharpens the guess with what the page knows about itself (offline, no WebGL, which screen).
 * @param {ProblemInput|Error|string|null|undefined} input
 * @param {{ online?: boolean, gpu?: string|null, route?: string, inMatch?: boolean, attempt?: number, netCode?: string }} [ctx]
 * @returns {Cause}
 */
export function classifyProblem(input, ctx = {}) {
  const p = problemText(input);
  const ctxCode = String(ctx.netCode || p.code || '').toUpperCase();
  const offline = ctx.online === false || ctxCode === 'OFFLINE' || ctxCode === 'DISCONNECTED';
  const source = p.source;
  const isUi = source === 'ui';
  const isRunner = source === 'runner' || source === 'sim';

  // 1. a client that is older than the server (the usual after an update) — refresh fixes it
  if (ctxCode === 'VERSION' || /版本不一致|version mismatch|old client|客户端版本/.test(p.text)) {
    return cause('version', '客户端和服务器不是同一个版本',
      '服务器已经更新，这个页面还是旧的版本；两边对不上时请求会被拒绝。',
      ['按 Ctrl + F5（或长按刷新按钮）强制刷新页面', '如果是从启动器进入的，关掉启动器重新打开一次', '还不行就到 QQ 群里问管理员服务器是不是刚更新过'],
      ctxCode === 'VERSION' ? '错误码是 VERSION' : '错误信息里提到了版本不一致', 'high', 'amber');
  }

  // 2. the session belongs to another tab / the player was removed
  if (ctxCode === 'SESSION_IN_USE' || ctxCode === 'REPLACED') {
    return cause('session', '这局已经在另一个窗口里开着',
      '同一个身份不能在两个页面同时游戏：服务器会保留其中一个窗口，另一个被拒绝。',
      ['关掉其他开着这个游戏的标签页或窗口，再刷新这一页', '如果确实找不到另一个窗口，刷新本页会重新建立一个连接'],
      '错误码是 ' + (ctxCode || 'SESSION_IN_USE'), 'high', 'amber');
  }
  if (ctxCode === 'KICKED') {
    return cause('kicked', '你被管理员移出了服务器',
      '服务器后台把这个玩家移出了服务器，页面无法继续连接。',
      ['如果不知道原因，到 QQ 群里找管理员询问', '稍后可以刷新页面重新进入服务器'],
      '错误码是 KICKED', 'high', 'amber');
  }
  if (ctxCode === 'SERVER_CLOSED') {
    return cause('closed', '服务器已经被管理员关闭',
      '开服的人关闭了服务器，页面因此断开。',
      ['稍后再试；如果群里通知了维护时间，等维护结束再进', '一直是这样的话，到 QQ 群里问一下管理员'],
      '错误码是 SERVER_CLOSED', 'high', 'amber');
  }

  // 3. a room's plugins / custom content disagreed with the client
  if (PLUGIN.test(p.text) && !SIM.test(p.text)) {
    return cause('plugin', '插件或自定义内容出了错',
      '房间里启用的插件（或它带来的玩法数据）和这个客户端的版本不匹配，或者插件本身有错。',
      ['让房主关掉这个插件后再试一次', '换一个原版房间看看是否正常（能玩说明是插件的问题）', '把「复制诊断信息」的内容发到 QQ 群给管理员'],
      '错误信息里出现了插件 / 内容集的字样', 'medium', 'orange');
  }

  // 4. graphics
  if (WEBGL.test(p.text) || ctx.gpu === 'no WebGL') {
    return cause('webgl', '显卡或网页图形接口（WebGL）初始化失败',
      '游戏画面要用浏览器的 WebGL 绘制；驱动太旧、关掉了硬件加速、远程桌面或虚拟机环境，都会让它启动不了。',
      ['刷新页面再试一次', '在设置里把「画质」调到中或低，并关掉「官方 3D 棋盘」', '在浏览器设置里打开「使用硬件加速」，或换用最新版 Edge / Chrome', '更新显卡驱动后重启电脑'],
      ctx.gpu === 'no WebGL' ? '这台电脑的浏览器没有可用的 WebGL' : '错误信息里提到了 WebGL / 图形接口',
      ctx.gpu === 'no WebGL' ? 'high' : 'medium', 'red');
  }

  // 5. memory
  if (MEMORY.test(p.text)) {
    return cause('memory', '内存不足或数据量异常',
      '浏览器没能申请到足够的内存。页面开得太久、画质太高、同时开了很多标签页都会这样。',
      ['刷新页面（会清掉这一页占用的内存）', '关掉其他标签页和占内存的程序再试', '在设置里把「画质」调到低', '关掉启动器重新打开一次'],
      '错误信息里提到了内存 / 数组分配', 'high', 'red');
  }

  // 6. audio
  if (AUDIO.test(p.text)) {
    return cause('audio', '音频没能加载或播放',
      '某个音效、语音或背景音乐没能解码或播放：格式不被浏览器支持、文件缺失，或者系统没有可用的声音设备。',
      ['刷新页面再试一次', '检查系统的声音输出设备是否正常、是否被其他程序独占', '如果只是个别音效或语音没了，可以继续游戏，不影响战斗'],
      '错误信息里提到了音频 / 解码', 'medium', 'orange');
  }

  // 7. a missing or broken asset (the tell is a file name the page tried to load)
  if (ASSET_FILE.test(p.text) && (ASSET_TEXT.test(p.text) || /fetch|404|not found/.test(p.text))) {
    return cause('asset', '素材文件没能加载',
      '页面没下载到某个图片、音频或数据文件。常见原因：本地素材不完整、被浏览器或安全软件拦截、缓存损坏。',
      ['按 Ctrl + F5 强制刷新页面', '设置 → 「清理旧版本素材」，然后刷新', '检查网络或安全软件是否拦截了本地服务器', '如果服务器本来就缺素材，请联系管理员'],
      '错误信息里点名了一个素材文件', 'high', 'orange');
  }

  // 8. the connection
  if (offline || ctxCode === 'TIMEOUT' || ctxCode === 'CLOSED' || NETWORK.test(p.text)) {
    const timedOut = ctxCode === 'TIMEOUT' || /timeout|timed out/.test(p.text);
    return cause('network', timedOut ? '请求服务器超时' : '和服务器断开了连接',
      timedOut
        ? '服务器在规定时间里没有回应：网络慢、开了代理 / 加速器，或者服务器正忙。'
        : '页面和游戏服务器的 WebSocket 连接断了。网络切换、电脑休眠、服务器重启都会这样。',
      ['等几秒——页面会自动重连；也可以直接刷新', '确认启动器里的本地服务器还在运行（不要关掉那个窗口）', '如果开了代理 / 加速器 / VPN，先关掉再试', '还连不上就到 QQ 群里问管理员服务器是否正常'],
      offline ? '页面现在是离线状态' : '错误信息里出现了连接 / 超时的字样', offline ? 'high' : 'medium', 'amber');
  }

  // 9. the battle simulation itself
  if (isRunner || (SIM.test(p.text) && (ctx.inMatch || ctx.route === 'game'))) {
    return cause('sim', '这一场战斗的内部计算出错了',
      '战斗是在你的浏览器里计算的；某个干员、技能或敌人的数据处理时抛了异常。这不是你的操作问题，游戏会尽量把这局结束掉。',
      ['这局结束后重新开一局，通常就恢复正常了', '如果总是同一个回合出错，把「复制诊断信息」发到 QQ 群给管理员（附上本场战斗更有用）'],
      isRunner ? '出错的是战斗模拟' : '错误发生在战斗界面', isRunner ? 'high' : 'medium', 'red');
  }

  // 10. the server answered with an internal error
  if (ctxCode === 'INTERNAL' || SERVER.test(p.text)) {
    return cause('server', '服务器内部错误',
      '游戏服务器处理这次操作时出了异常，通常和你的操作无关。',
      ['稍等几秒再试一次同样的操作', '刷新页面重连', '反复出现就到 QQ 群里找管理员，把「复制诊断信息」发给他'],
      '错误码是 ' + (ctxCode || 'INTERNAL'), 'high', 'red');
  }

  // 11. a screen failed to render (the error boundary caught it)
  if (isUi) {
    return cause('ui', '界面渲染出错',
      '某个界面组件在渲染时抛出了异常。为了不让界面继续错下去，游戏已经停住了这个界面。',
      ['点「重新加载界面」通常就能恢复', '如果同一个界面反复出错，把「复制诊断信息」发到 QQ 群给管理员'],
      '错误来自界面渲染', 'high', 'red');
  }

  // 12. a plain JavaScript fault in the page (a null/undefined the code expected to be filled, a missing method)
  if (SCRIPT.test(p.text)) {
    return cause('script', '页面脚本碰到了意外的数据',
      '游戏里某段代码读到了不该是空的值（或调用了不存在的函数）。常见于数据没加载完、界面被快速切走、或某个插件 / 版本的数据和这份客户端对不上。',
      ['刷新页面再试一次（多数情况一次就好）', '如果每次都在同一个操作后出现，记下当时在哪个界面做什么', '把「复制诊断信息」发到 QQ 群给管理员——里面的堆栈能直接定位到哪段代码'],
      '错误信息是典型的脚本异常（读到了空值 / 缺少函数）', 'medium', 'red');
  }

  return cause('unknown', '暂时判断不出具体原因',
    '这条错误没有命中已知的常见情况。它可能只影响一小部分界面，也可能和这次的版本、插件组合有关。',
    ['先刷新页面再试一次', '如果反复出现，请到 QQ 群里找管理员询问，并把「复制诊断信息」的内容一起发给他——管理员能据此定位'],
    null, 'low', 'orange');
}

/** 高 / 中 / 低: how sure the dialog says it is (msgids; the caller translates). */
export const CONFIDENCE_TEXT = Object.freeze({ high: '根据错误信息，大概率就是这个原因', medium: '可能的原因', low: '这只是推测' });

/** The entries a report shows by default (the rest is one 「查看全部」 away). */
export const RELATED_LIMIT = 3;
