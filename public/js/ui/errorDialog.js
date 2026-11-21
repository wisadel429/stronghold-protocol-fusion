// public/js/ui/errorDialog.js — the error-report dialog: what went wrong, the log lines that belong to it, and where to
// ask for help.
//
// Until now an error was a toast that disappeared, and only 设置 → 问题反馈 reached the detail — a player who saw
// 「发生意外错误」 had no idea what to do next. A recorded error now also opens this dialog (once per distinct error per
// five minutes, at most one on screen): a cause in plain words with the steps that usually fix it (ui/errorCause.js
// classifies it), the few log entries closest to it, the raw message and stack behind a fold, and the pointer to the QQ
// group — the place every player here got the game from, where the administrators read the diagnostics the dialog copies.
//
// It is driven by the client's own error log (diag.js watchErrors), so every reporter already in the codebase takes part
// without knowing about this file: uncaught errors and rejections (main.js), the battle runner and the sim's content
// errors (battle/runner.js), failed requests (ui/toasts.js). Sources that would be noise are left to their own UI: a
// content error the sim isolated ('sim' can fire per frame) and a screen crash ('ui' — the crash screen shows the same
// panel in full). 设置 →「出错时弹出详细说明」 turns the dialog off; the log and 问题反馈 keep working.
//
//   installErrorReporter()   main.js boot: listen to diag.js (idempotent)
//   reportProblem(entry)     open the dialog for one entry (also used by the crash screen)
//   <ErrorDialogHost/>       mount once near the app root
//   <ProblemBody input=… />  the panel on its own (main.js ScreenCrashed renders it full screen)

import { h, Fragment } from '../../vendor/preact.module.js';
import { useEffect, useReducer, useState } from '../../vendor/hooks.module.js';
import htm from '../../vendor/htm.module.js';
import { Modal, Button, MicroLabel, Icon } from './components.js';
import { errorLog, watchErrors, diagnosticsText, browserEnv } from '../diag.js';
import { store, selectRoute } from '../store.js';
import { settingsStore } from './settingsStore.js';
import { copyText } from './clipboard.js';
import { personalApplied } from '../content.js';
import { classifyProblem, relatedEntries, RELATED_LIMIT, CONFIDENCE_TEXT } from './errorCause.js';
import { APP_VERSION } from '../../shared/constants.js';
import { t } from '../../../shared/i18n.js';

// no shared static vnodes (see components.js hFresh: htm's static cache would retain unmounted DOM)
function hFresh(type, props, ...children) {
  if (this && typeof this === 'object') this[0] = 3;
  return h(type, props, ...children);
}
const html = htm.bind(hFresh);

/** At most this many open at once (the oldest closes when a new one arrives). */
const MAX_QUEUE = 3;
/** The same error (source + message) opens the dialog at most once in this window. */
export const DEDUPE_MS = 5 * 60 * 1000;
const MESSAGE_MAX = 200;

/** Where an entry came from, in a player's words (msgids). */
const SOURCE_LABEL = {
  error: '脚本错误', rejection: '未处理的异常', request: '网络请求', sim: '战斗数据', runner: '战斗模拟', ui: '界面',
};

/** @typedef {{ id: number, key: string, at: number, entry: { source: string, message: string, stack: string|null, detail: string|null, at: number, count: number } }} Item */

/** @type {Item[]} */
let queue = [];
let seq = 0;
/** key → when its dialog last opened */
const shownAt = new Map();
const listeners = new Set();
const emit = () => { for (const fn of [...listeners]) { try { fn(); } catch (err) { console.error(err); } } };

/**
 * Should this recorded error open the dialog? A repeat (the same entry counted again) does not; a source with its own
 * UI does not (`sim`: a content error the battle isolated may repeat every frame; `ui`: the crash screen shows it);
 * a failed request is a toast, except the two that leave the player stuck (a version mismatch, a server fault).
 * @param {{ source: string, message: string, detail: string|null, count: number }} entry
 */
export function shouldReport(entry) {
  if (!entry || entry.count > 1) return false;
  switch (entry.source) {
    case 'error':
    case 'rejection':
    case 'runner':
      return true;
    case 'request':
      return /\((VERSION|INTERNAL)\)|版本不一致|服务器内部错误/.test(String(entry.message || ''));
    default:
      return false;
  }
}

/** The dialog's view of the page: enough for ui/errorCause.js to sharpen its guess. */
export function problemContext() {
  let s = null;
  try { s = store.get(); } catch { s = null; }
  const conn = s?.connection || {};
  let gpu = null;
  try { gpu = browserEnv().gpu; } catch { gpu = null; }
  return {
    // 'offline' is the only state that says "not connected now"; 'idle' / 'connecting' / a page that never connected
    // are unknown — otherwise every early error would be classified as a network problem
    online: conn.status ? conn.status !== 'offline' : null,
    route: s ? selectRoute(s) : undefined,
    inMatch: !!(s?.room?.inMatch && !s?.match?.result),
    attempt: conn.attempt,
    netCode: conn.lastError?.code || null,
    gpu,
  };
}

/**
 * Open the error-report dialog for one entry (diag.js's shape, or anything with a message).
 * @param {{ source?: string, message?: string, stack?: string|null, detail?: string|null, at?: number, count?: number }|Error|string} input
 * @param {{ force?: boolean }} [opts] `force`: the player asked for this error by hand (设置 → 问题反馈) — skip the dedupe
 * @returns {number|null} the item id, or null when it was dropped (a repeat, a benign error, the switch off)
 */
export function reportProblem(input, opts = {}) {
  if (!input) return null;
  if (settingsStore.get()?.errorReport === false && !opts.force) return null;
  const message = String(
    typeof input === 'string' ? input
      : /** @type {any} */ (input).message || /** @type {any} */ (input).msg || input,
  ).slice(0, MESSAGE_MAX);
  if (!message) return null;
  // media autoplay / aborted loads are expected browser behaviour (main.js does not log them either)
  if (/NotAllowedError|AbortError/.test(message)) return null;
  const entry = {
    source: typeof (/** @type {any} */ (input)).source === 'string' ? (/** @type {any} */ (input)).source : 'error',
    message,
    stack: typeof (/** @type {any} */ (input)).stack === 'string' ? (/** @type {any} */ (input)).stack : null,
    detail: typeof (/** @type {any} */ (input)).detail === 'string' ? (/** @type {any} */ (input)).detail : null,
    at: Number.isFinite(/** @type {any} */ (input).at) ? Number(/** @type {any} */ (input).at) : Date.now(),
    count: Number(/** @type {any} */ (input).count) || 1,
  };
  const key = `${entry.source}|${message}`;
  const now = Date.now();
  const last = shownAt.get(key);
  if (!opts.force) {
    if (last != null && now - last < DEDUPE_MS) return null;
    if (queue.some((q) => q.key === key)) return null;
  }
  for (const [k, at] of shownAt) if (now - at > DEDUPE_MS * 4) shownAt.delete(k);
  const item = { id: ++seq, key, at: now, entry };
  // the open one stays on screen; a burst of errors leaves the newest behind it
  queue = [...queue, item];
  if (queue.length > MAX_QUEUE) queue = [queue[0], ...queue.slice(-(MAX_QUEUE - 1))];
  emit();
  return item.id;
}

/** Close one dialog (the player acknowledged it); a closed error counts as shown for DEDUPE_MS. */
export function dismissProblem(id) {
  const item = queue.find((q) => q.id === id);
  if (!item) return;
  queue = queue.filter((q) => q.id !== id);
  shownAt.set(item.key, Date.now());
  emit();
}

let installed = false;
/**
 * Follow diag.js: every newly recorded error of a source that has no UI of its own opens the dialog. Idempotent.
 * @returns {() => void} stop watching
 */
export function installErrorReporter() {
  if (installed) return () => {};
  installed = true;
  return watchErrors((entry, isNew) => {
    if (!isNew || !shouldReport(entry)) return;
    reportProblem(entry);
  });
}

const pad2 = (n) => String(n).padStart(2, '0');
/** `14:03:27` in the player's own timezone. */
const clockOf = (ms) => {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};
const dateOf = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${clockOf(ms)}`;
};

/**
 * The log on its own, for pasting into a QQ message: the error (message, detail, stack), the entries closest to it and
 * the whole log, in plain text. The full diagnostics (版本、内容标识、浏览器、战斗数据 …) stay on 复制诊断信息; this one is
 * small enough that a player can paste it straight into the group.
 * @param {{ source?: string, message?: string, stack?: string|null, detail?: string|null, at?: number, count?: number }|null} input
 * @param {{ source?: string, message?: string, at?: number, lastAt?: number, count?: number }[]} [entries]
 * @returns {string}
 */
export function problemLogText(input, entries = errorLog()) {
  const e = /** @type {any} */ (input) || {};
  const at = Number.isFinite(e.at) ? Number(e.at) : Date.now();
  const lines = [
    'Stronghold-Protocol 错误日志',
    `版本: ${APP_VERSION}`,
    `时间: ${dateOf(at)}`,
    `来源: ${e.source || 'error'}`,
    `错误: ${e.message || ''}`,
  ];
  if (e.detail) lines.push(`补充: ${e.detail}`);
  if (e.stack) {
    lines.push('堆栈:');
    for (const line of String(e.stack).split('\n')) lines.push(`  ${line}`);
  }
  const related = relatedEntries(e, entries, RELATED_LIMIT);
  if (related.length) {
    lines.push('相关日志:');
    for (const { entry } of related) lines.push(`${clockOf(entry.at)} ${entry.source}: ${entry.message}${entry.count > 1 ? ` ×${entry.count}` : ''}`);
  }
  lines.push(`全部日志（${entries.length} 条，新到旧）:`);
  for (const entry of entries.slice().reverse()) lines.push(`${clockOf(entry.at)} ${entry.source}: ${entry.message}${entry.count > 1 ? ` ×${entry.count}` : ''}`);
  return lines.join('\n');
}

/**
 * The report panel: cause, what to try, the related log lines, the raw detail behind a fold, and the QQ group.
 * `cause` may be passed in (the dialog and the crash screen both compute it once); `showTitle` false drops the headline
 * when the dialog's own title already carries it.
 * @param {{ input: any, cause?: ReturnType<typeof classifyProblem>, note?: string|null, manual?: string|null,
 *   onCopy?: (() => void)|null, onCopyLog?: (() => void)|null, logNote?: string|null, showTitle?: boolean }} props
 */
export function ProblemBody({ input, cause, note = null, manual = null, onCopy = null, onCopyLog = null, logNote = null, showTitle = true }) {
  const info = cause || classifyProblem(input, problemContext());
  const related = relatedEntries(input, errorLog(), RELATED_LIMIT);
  const all = errorLog().slice().reverse();
  const detailLines = [
    `${t('错误信息')}：${String(input?.message ?? input ?? '')}`,
    input?.detail ? `${t('补充')}：${input.detail}` : null,
    input?.stack ? `${t('调用堆栈')}：\n${input.stack}` : null,
  ].filter(Boolean);
  const allLines = all.map((e) => `${clockOf(e.at)} ${e.source}: ${e.message}${e.count > 1 ? ` ×${e.count}` : ''}`);
  const confidence = CONFIDENCE_TEXT[info.confidence] || CONFIDENCE_TEXT.medium;
  return html`<div class="errrep">
    <section class="errrep__cause">
      <div class="errrep__cause-head">
        <${MicroLabel}>PROBABLE CAUSE<//>
        <span class=${`errrep__conf errrep__conf--${info.confidence}`}>${t(confidence)}</span>
      </div>
      ${showTitle ? html`<h3 class="errrep__title">${t(info.title)}</h3>` : null}
      <p class="errrep__reason">${t(info.reason)}</p>
      ${info.basis ? html`<p class="errrep__basis">${t('判断依据')}：${t(info.basis)}</p>` : null}
    </section>

    <section class="errrep__block">
      <h4 class="errrep__h">${t('你可以试试')}</h4>
      <ol class="errrep__steps">
        ${info.steps.map((s) => html`<li key=${s}>${t(s)}</li>`)}
      </ol>
    </section>

    ${related.length ? html`<section class="errrep__block">
      <h4 class="errrep__h">${t('相关日志')}<span class="errrep__h-sub">${t('与这条错误最接近的 {n} 条', { n: related.length })}</span></h4>
      <ul class="errrep__log">
        ${related.map(({ entry }) => html`<li key=${`${entry.at}:${entry.message}`} class="errrep__line">
          <span class="errrep__time num">${clockOf(entry.at)}</span>
          <span class=${`errrep__src errrep__src--${entry.source}`}>${t(SOURCE_LABEL[entry.source] || entry.source)}</span>
          <span class="errrep__msg">${entry.message}${entry.count > 1 ? html`<b class="errrep__x">×${entry.count}</b>` : null}</span>
        </li>`)}
      </ul>
    </section>` : null}

    <details class="errrep__details">
      <summary>${t('错误详情与全部日志（{n} 条）', { n: all.length })}</summary>
      <pre class="errrep__pre">${detailLines.join('\n')}</pre>
      ${allLines.length ? html`<pre class="errrep__pre errrep__pre--log">${allLines.join('\n')}</pre>` : null}
    </details>

    ${onCopyLog ? html`<div class="errrep__tools">
      <${Button} variant="secondary" size="sm" icon="copy" class="errrep__copylog" data-testid="errrep-copy-log" onClick=${onCopyLog}>${t('复制日志')}<//>
      <span class="errrep__tools-hint">${t('只复制这条错误和相关日志，方便直接发到 QQ 群')}</span>
      ${logNote === 'copied' ? html`<span class="errrep__note" role="status">${t('已复制日志')}</span>` : null}
      ${logNote === 'refused' ? html`<span class="errrep__note is-warn" role="status">${t('无法写入剪贴板，请手动复制下面的内容')}</span>` : null}
    </div>` : null}

    <section class="errrep__ask">
      <div class="errrep__ask-head">
        <${Icon} name="users" />
        <b>${t('还是解决不了？')}</b>
      </div>
      <p class="errrep__ask-text">${t('请到 QQ 群里找管理员询问（游戏就是在群里下载的，管理员都在）。把「复制诊断信息」的内容一起发给他，管理员能看到这个错误的详细信息，更容易定位问题。')}</p>
      ${onCopy ? html`<${Button} variant="secondary" size="sm" icon="copy" onClick=${onCopy}>${t('复制诊断信息')}<//>` : null}
      ${note === 'copied' ? html`<p class="errrep__note" role="status">${t('已复制诊断信息，可以直接粘贴到 QQ 群里')}</p>` : null}
      ${note === 'refused' ? html`<p class="errrep__note is-warn" role="status">${t('无法写入剪贴板，请手动全选复制下面的内容')}</p>` : null}
      ${manual ? html`<textarea class="errrep__manual" readOnly spellcheck=${false} value=${manual}
        onFocus=${(e) => e.currentTarget.select()}></textarea>` : null}
    </section>
  </div>`;
}

/** The modal: the panel plus the actions a player can take right away. */
function ErrorReportDialog({ item }) {
  const [note, setNote] = useState(/** @type {string|null} */ (null));
  const [logNote, setLogNote] = useState(/** @type {string|null} */ (null));
  const [manual, setManual] = useState(/** @type {string|null} */ (null));
  const cause = classifyProblem(item.entry, problemContext());
  const copy = async () => {
    let text = '';
    try {
      text = diagnosticsText({ state: store.get(), settings: settingsStore.get(), attachBattle: true, personal: personalApplied() });
    } catch (err) {
      console.warn('[errrep] diagnostics failed', err);
      text = String(item.entry.message || '');
    }
    const ok = await copyText(text);
    setManual(ok ? null : text);
    setNote(ok ? 'copied' : 'refused');
  };
  // 复制日志: the error and the log lines only (small enough to paste into the QQ group); the full diagnostics stay on 复制诊断信息
  const copyLog = async () => {
    const text = problemLogText(item.entry);
    const ok = await copyText(text);
    setManual(ok ? null : text);
    setLogNote(ok ? 'copied' : 'refused');
  };
  return html`<${Modal} open=${true} micro="ERROR REPORT" tone=${cause.tone} width="7.4rem"
      title=${t(cause.title)} onClose=${() => dismissProblem(item.id)}
      actions=${html`<${Fragment}>
        <${Button} variant="ghost" icon="refresh" onClick=${() => location.reload()}>${t('重新加载页面')}<//>
        <${Button} variant="secondary" icon="copy" onClick=${copy}>${t('复制诊断信息')}<//>
        <${Button} variant="primary" icon="check" data-autofocus onClick=${() => dismissProblem(item.id)}>${t('知道了')}<//>
      <//>`}>
    <${ProblemBody} input=${item.entry} cause=${cause} note=${note} manual=${manual} logNote=${logNote} onCopyLog=${copyLog} showTitle=${false} />
  <//>`;
}

/** Renders the queued error reports (one at a time). Mount once near the app root. */
export function ErrorDialogHost() {
  const [, force] = useReducer((c) => c + 1, 0);
  useEffect(() => {
    listeners.add(force);
    // an error recorded before this host mounted (a very early boot failure) still opens its dialog
    if (queue.length) force({});
    return () => listeners.delete(force);
  }, []);
  const item = queue[0];
  if (!item) return null;
  return html`<${ErrorReportDialog} key=${item.id} item=${item} />`;
}
