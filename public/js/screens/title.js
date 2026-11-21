// Title screen: season-style backdrop, big title 卫戍协议：盟约, remembered nickname, 开始, the language menu
// (中文 | English | every pack in public/i18n/, ui/lang.js; a title in an alphabetic script — English — is the big one and
// the small wordmark above it hides).
//
// Pressing 开始 validates the nickname (1..NAME_MAX_LEN chars, no control characters), stores it,
// marks this tab as "entered" (so reloads skip the title) and hands the name to net.js, which
// sends `hello` (now, or as soon as the socket is open). The router then shows the lobby.
//
// Backdrop art: if data/assets.json lists a UI backdrop (`ui.titleBackdrop`, or one of the
// entry/loading illustration names) it is layered under the CSS art; otherwise the screen is
// pure CSS/SVG (radar, ridgelines, glow), so it never issues a request that can 404.
//
// The full art, under the login box: 下载完整素材 (ui/assetDownload.js — its dialog downloads from this server) and
// 导入素材包 (ui/assetImport.js — the player's own folder or zip, no server download) side by side, so an import never
// opens the download (docs/history/0.3.0.md §32.14.39).
//
// Plugins (DESIGN §32 P1a, the design study's §7.4): when the server has unofficial plugins (content.plugins of /healthz or
// welcome — content.js installedCount), the footer says 「本服务器安装了 N 个插件」 — a button that loads the list
// (ui/pluginPanel.js InstalledPlugins, which fetches the catalogue when it opens); nothing on a server without any, which
// the page never asks for its catalogue — and the title page loads none of the panel's code.

import { ResumeMatchButton } from '../ui/resumeMatch.js';
import { AssetDownloadButton } from '../ui/assetDownload.js';
import { AssetImportButton } from '../ui/assetImport.js';
import { useEffect, useMemo, useState , useRef } from '../../vendor/hooks.module.js';
import { NAME_MAX_LEN, APP_VERSION, DEV_BUILD } from '../../../shared/constants.js';
import { html, Button, Icon, MicroLabel, TextField, PingPill } from '../ui/components.js';
import { GuideButton } from '../ui/guide.js';
// 界面主题的局外入口（网页原版 / 卫戍协议终端 / 可露希尔）——与「皮肤」系统无关，跳 /ui-theme.html。
// 主页(`/`)本身仍是本仓原版 UI：这里只放一颗入口按钮，不做任何自动跳转。
import { UiThemeButton } from '../ui/uiThemeSwitch.js';
// 账号系统：标题页右上角的「昵称#tag」按钮（改名 / 退出登录），以及「开始」卡里的登录/注册表单（AuthCard）
import { AccountButton, AuthCard } from './auth.js';
import { accountApi } from '../accountApi.js';
import { installCloudSave } from '../ui/cloudSave.js';
// 好友（账号系统第二期）：标题页右上角的「好友」按钮 + 面板（以及登录成功后的邀请浮层安装）
import { SocialButton, installSocialInvites } from './social.js';
import { openStats } from './stats.js';
import { toast } from '../ui/toasts.js';
import { net, identity } from '../net.js';
import { store, useStore, shallowEqual } from '../store.js';
import { data, useData } from '../data.js';
import { FullscreenButton, PwaInstallButton, detectFeatures } from '../ui/device.js';
import { LangToggle, useLang } from '../ui/lang.js';
import { t, N_ } from '../../../shared/i18n.js';
import { scriptOf } from '../../../shared/i18nPacks.js';
import { GIcon } from '../ui/gameComponents.js';
import { SettingsModal } from '../ui/settings.js';
import { installedCount } from '../content.js';
import { sanitizeName, isValidName } from '../ui/playerName.js';

export { stripLoneSurrogates, sanitizeName, isValidName } from '../ui/playerName.js';

/**
 * Enter the game shell with a nickname (title → lobby).
 * @param {string} rawName
 * @returns {boolean} false when the name is invalid
 */
export function enterSession(rawName) {
  const name = sanitizeName(rawName);
  if (!name) return false;
  identity.saveName(name);
  identity.setEntered(true);
  store.set((s) => ({ me: { ...s.me, name }, session: { ...s.session, entered: true } }));
  net.setName(name);
  return true;
}

// data/assets.json `ui` keys are 'group/key' (docs/ASSETS.md).
const BACKDROP_KEYS = ['titleBackdrop', 'entry/bkg_01', 'entry/bkg_02'];
const RIDGE_KEYS = ['titleRidges', 'entry/bg_mountains_tiled'];

/**
 * Find a UI image URL in data/assets.json (tolerant of a few plausible shapes).
 * @param {any} assets
 * @param {string[]} names
 * @returns {string|null}
 */
export function findUiAsset(assets, names) {
  if (!assets || typeof assets !== 'object') return null;
  const asUrl = (v) => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') return v.url || v.path || v.src || null;
    return null;
  };
  const ui = assets.ui;
  if (ui && typeof ui === 'object' && !Array.isArray(ui)) {
    for (const n of names) {
      const u = asUrl(ui[n]);
      if (u) return u;
    }
  }
  const lists = [Array.isArray(ui) ? ui : null, Array.isArray(assets.files) ? assets.files : null].filter(Boolean);
  for (const list of lists) {
    for (const n of names) {
      const hit = list.map(asUrl).find((u) => typeof u === 'string' && u.includes('/ui/') && u.toLowerCase().split('/').pop().startsWith(n.toLowerCase()));
      if (hit) return hit;
    }
  }
  return null;
}

// Dot-matrix watchtower emblem (13×14 bitmap; dots grow toward the base for depth).
const EMBLEM = [
  'XXX..XXX..XXX',
  'XXX..XXX..XXX',
  'XXXXXXXXXXXXX',
  '.XXXXXXXXXXX.',
  '..XXXXXXXXX..',
  '..XXXXXXXXX..',
  '..XXXX.XXXX..',
  '..XXXX.XXXX..',
  '..XXXXXXXXX..',
  '..XXXXXXXXX..',
  '..XXXXXXXXX..',
  '.XXXXXXXXXXX.',
  'XXXXXXXXXXXXX',
  'XXXXXXXXXXXXX',
];

export function Emblem() {
  const dots = useMemo(() => {
    const out = [];
    EMBLEM.forEach((row, r) => {
      [...row].forEach((ch, c) => {
        if (ch !== 'X') return;
        const rad = 0.2 + (r / (EMBLEM.length - 1)) * 0.2;
        const accent = (r === 6 || r === 7) && (c === 5 || c === 7);
        out.push({ cx: c + 0.5, cy: r + 0.5, r: rad, accent, d: (r * 13 + c) % 7 });
      });
    });
    return out;
  }, []);
  return html`<div class="emblem" aria-hidden="true">
    <span class="emblem__bracket emblem__bracket--l"></span>
    <svg class="emblem__svg" viewBox="-0.5 -0.5 14 15">
      ${dots.map((d, i) => html`<circle key=${i} cx=${d.cx} cy=${d.cy} r=${d.r} class=${d.accent ? 'is-accent' : `d${d.d}`} />`)}
    </svg>
    <span class="emblem__bracket emblem__bracket--r"></span>
  </div>`;
}

function Ridges() {
  return html`<svg class="title-bg__ridges" viewBox="0 0 1920 420" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="ridge-far" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#16231f" /><stop offset="1" stop-color="#0a0e0d" />
      </linearGradient>
      <linearGradient id="ridge-near" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0f1714" /><stop offset=".6" stop-color="#080b0a" />
      </linearGradient>
      <linearGradient id="ridge-edge" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#17f9b7" stop-opacity="0" />
        <stop offset=".3" stop-color="#17f9b7" stop-opacity=".55" />
        <stop offset=".7" stop-color="#17f9b7" stop-opacity=".55" />
        <stop offset="1" stop-color="#17f9b7" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path class="ridge ridge--far" fill="url(#ridge-far)" stroke="url(#ridge-edge)"
      d="M0 420V250l120-40 90 30 90-70 60 20 80-70 80 55 80-25 90 70 90-20 80 50 100-15 90 25 90-55 90-55 70-55 70 45 80-20 90 65 80-20 100 55 100-20 100 40v180z" />
    <path class="ridge ridge--near" fill="url(#ridge-near)" stroke="url(#ridge-edge)"
      d="M0 420V322l160-32 100 20 120-50 90 40 130-20 120 50 140-30 140 35 120-35 140 20 140-50 120 30 120-20 120 40 160-20v147z" />
  </svg>`;
}

const STATUS_TEXT = {
  idle: N_('准备连接'), connecting: N_('正在连接服务器'), connected: N_('已连接服务器'), handshaking: N_('正在验证身份'),
  online: N_('已连接服务器'), reconnecting: N_('连接中断，正在重连'), closed: N_('连接已关闭'),
};

/** Title screen component. */
export function TitleScreen() {
  const conn = useStore((s) => s.connection, shallowEqual);
  const pendingJoin = useStore((s) => s.ui.pendingJoin);
  useLang(); // re-render on a language switch
  const currentName = useStore((s) => s.me.name);
  // 账号系统：登录后的账号（未登录/服务器未挂账号 API 时为 null），以及服务器是否挂了账号 API
  const account = useStore((s) => s.account);
  const accountsEnabled = useStore((s) => s.accountsEnabled);
  // 服务器挂了账号 API 但没登录：标题页的「开始」卡换成登录/注册表单（业主 2026-11-14：登录直接长在标题页上）
  const loginMode = accountsEnabled && !account;
  // 已登录（账号系统开启 + 有账号）：不再显示「博士代号」输入框，直接一个开始按钮（业主 2026-11-14「又出现了输入名字的界面，清掉他」）
  const hasAccount = accountsEnabled && !!account;
  // 入场区（业主 2026-11-21 设计稿）：头像方块里的首字母、当前线路提示、「切换账号」
  const entryInitial = String((account && account.nickname) || '?').trim().charAt(0).toUpperCase() || '?';
  const serverHost = String((globalThis.location && globalThis.location.host) || '');
  const serverTip = serverHost ? t('当前服务器：{host}', { host: serverHost }) : t('当前服务器');
  /** 切换账号 = 退出当前账号再回到标题页（登录卡会重新出现）。 */
  const switchAccount = async () => {
    try { await accountApi.logout(); } catch (e) { console.warn('[title] 退出登录失败', e); }
    try { globalThis.location.reload(); } catch { /* 某些壳里 reload 不可用，忽略 */ }
  };
  // 登录卡里当前是「登录」还是「注册」：注册时临时收起徽记与大标题，给表单让出高度
  const [authTab, setAuthTab] = useState('login');
  const [name, setName] = useState(() => currentName || identity.loadName() || '');
  // An import may restore the current name while this screen remains behind the stats overlay.
  useEffect(() => {
    if (currentName) setName((draft) => draft || currentName);
  }, [currentName]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 彩蛋入口（业主 2026-10-22）：连点页脚的版本号 5 次进 /arg/ —— 那套 REC 解谜页不放在任何菜单里，
  // 只有知道的人点得到。计数放在 ref 里，5 次后整页跳转。
  const egg = useRef({ n: 0, at: 0 });
  const eggClick = () => {
    const now = Date.now();
    const e = egg.current;
    e.n = now - e.at > 1500 ? 1 : e.n + 1;
    e.at = now;
    if (e.n >= 5) { e.n = 0; globalThis.location.href = '/arg/puzzle-demo.html'; }
  };
  // the list of the server's plugins once loaded (ui/pluginPanel.js — a component in state: set through an updater)
  const [Installed, setInstalled] = useState(null);
  const openPlugins = () => {
    import('../ui/pluginPanel.js').then((m) => setInstalled(() => m.InstalledPlugins), (err) => console.warn('[plugins] the list did not load', err));
  };
  // 安卓外壳里素材是**全量内置**的（tools/bundle-android.mjs 把 public/ 整份打进 APK，
  // 989 MB 的安装包里就有 public/assets），所以开始页不需要「下载完整素材」和「导入素材包」
  // —— 那两个按钮是给浏览器端补素材用的，在手机上点开只会白等一场（2026-10-17 业主反馈）。
  const nativeShell = Boolean(globalThis.AndroidNative?.isNativeApp?.());
  const installed = useStore(installedCount);
  const assetsSettled = useData('assets');
  const assets = data.get('assets');
  const backdrop = findUiAsset(assets, BACKDROP_KEYS);
  const ridges = findUiAsset(assets, RIDGE_KEYS);
  // Track load/fail per URL (not as booleans reset in effects: an image can load before an effect runs).
  const [bgLoadedUrl, setBgLoadedUrl] = useState(null);
  const [ridgesLoadedUrl, setRidgesLoadedUrl] = useState(null);
  const [ridgesFailedUrl, setRidgesFailedUrl] = useState(null);
  const bgLoaded = !!backdrop && bgLoadedUrl === backdrop;
  const ridgesLoaded = !!ridges && ridgesLoadedUrl === ridges;
  const ridgesFailed = !!ridges && ridgesFailedUrl === ridges;
  // CSS ridgelines only when there is no ridge art (avoids a swap flash when the art arrives).
  const cssRidges = assetsSettled && (!ridges || ridgesFailed);

  const valid = isValidName(name);
  const start = () => {
    // 已登录：用账号昵称进游戏，不再要求输入代号
    if (hasAccount) {
      const n = sanitizeName(account.nickname);
      if (n) { enterSession(n); return; }
    }
    if (!valid) { toast(t('请输入博士代号'), 'warn'); return; }
    enterSession(name);
  };
  // 登录成功（标题页登录卡）：账号进 store → 装云存档 / 好友邀请浮层 → 连服务器 → **直接用账号昵称进游戏**（业主 2026-11-14：
  // 登录后不再让玩家重复输一次「博士代号」；只有服务器没挂账号 API 时才保留代号输入框那条老路）。
  const signedIn = (acc) => {
    if (!acc) return;
    const name = sanitizeName(acc.nickname);
    store.set((s) => ({ ...s, account: acc, accountsEnabled: true, me: { ...s.me, name: name || s.me.name } }));
    try { installCloudSave({ api: accountApi, onError: (e) => console.warn('[cloudSave] 同步失败', e && e.message) }); }
    catch (err) { console.warn('[cloudSave] 安装失败', err); }
    try { installSocialInvites(); } catch (err) { console.warn('[social] 邀请浮层安装失败', err); }
    try { net.connect(); } catch (err) { console.warn('[net] 登录后连接失败', err); }
    // 两步 store 写入在同一次 Preact 批量更新里合并，所以不会闪一下「代号 + 开始」卡
    if (name) enterSession(name);
  };

  const online = conn.status === 'online' || conn.status === 'connected';
  // 未登录时不连 socket：状态行说「登录后自动连接」，别让一个 idle/closed 的红点吓人
  const waitingLogin = loginMode && !online;
  const dotClass = online ? 'is-on' : waitingLogin ? 'is-warn' : conn.status === 'reconnecting' || conn.status === 'connecting' || conn.status === 'handshaking' ? 'is-warn' : 'is-bad';
  const statusText = waitingLogin
    ? t('登录后自动连接服务器')
    : (STATUS_TEXT[conn.status] ? t(STATUS_TEXT[conn.status]) : conn.status);

  // touch screens: no autofocus (it would pop the on-screen keyboard over a landscape phone's whole view)
  const touchUi = useMemo(() => detectFeatures().coarse, []);
  // a title in an alphabetic script (English, French …) is the big one in the display face and the wordmark above it
  // hides; a CJK / kana / Hangul title keeps the Chinese layout (shared/i18nPacks.js scriptOf — a pack needs no flag)
  const alphabetic = scriptOf(t('卫戍协议')) === 'alphabetic';
  return html`<div class=${`screen title-screen${loginMode ? ' title-screen--auth' : ''}${loginMode && authTab === 'register' ? ' title-screen--register' : ''}`}>
    <div class=${`title-bg${bgLoaded ? ' has-art' : ''}${ridgesLoaded ? ' has-ridges' : ''}`} aria-hidden="true">
      ${backdrop ? html`<img class="title-bg__art" src=${backdrop} alt="" draggable=${false}
        onLoad=${() => setBgLoadedUrl(backdrop)} />` : null}
      <div class="title-bg__glow"></div>
      <div class="title-bg__radar"><div class="title-bg__sweep"></div></div>
      <div class="title-bg__target"></div>
      ${cssRidges ? html`<${Ridges} />` : null}
      ${ridges && !ridgesFailed ? html`<div class="title-bg__ridge-art" style=${`background-image:url("${ridges}")`}>
        <img src=${ridges} alt="" hidden onLoad=${() => setRidgesLoadedUrl(ridges)} onError=${() => setRidgesFailedUrl(ridges)} />
      </div>` : null}
      <div class="title-bg__haze"></div>
      <span class="cross" style="left:7%;top:22%"></span>
      <span class="cross" style="left:93%;top:30%"></span>
      <span class="cross" style="left:14%;top:70%"></span>
      <span class="cross" style="left:88%;top:62%"></span>
      <span class="cross" style="left:60%;top:12%"></span>
    </div>

    <div class="title-corner title-corner--tl">
      <span class="title-corner__mark"></span>
      <div><${MicroLabel} tone="mint">RHODES ISLAND // SIMULATION SERVICE<//><br /><${MicroLabel}>TACTICAL CO-OP NODE · 02<//></div>
    </div>
    <div class="title-corner title-corner--tr">
      <div>
        <div class="title-corner__tools">
          <${Button} variant="ghost" size="sm" icon="chart" class="title-stats" onClick=${openStats} title=${t('统计数据')}>${t('统计')}<//>
          ${account ? html`<${AccountButton} account=${account} />` : null}
          ${account ? html`<${SocialButton} />` : null}
          <${UiThemeButton} />
          <${LangToggle} class="title-lang" />
        </div>
        <${MicroLabel} tone="hi">TARGET POINT<//><br /><${MicroLabel}>STRONGHOLD PROTOCOL<//>
      </div>
    </div>

    <main class="title-main">
      <${Emblem} />
      ${alphabetic ? null : html`<div class="title-en">
        <span class="title-en__a">STRONGHOLD PROTOCOL</span>
        <span class="title-en__b">ALLIANCE</span>
      </div>`}
      <h1 class=${`title-cn${alphabetic ? ' title-cn--latin' : ''}`}>${t('卫戍协议')}<span class="title-cn__colon">${alphabetic ? ': ' : '：'}</span><em>${t('盟约')}</em></h1>
      <p class="title-tag">${t('调配资金与干员，与同伴协同布防，抵御多波次进攻，直至击败敌方领袖。')}</p>

      <div class=${`title-login${loginMode ? ' title-login--auth' : ''}${hasAccount ? ' title-login--entry' : ''}`}>
        ${pendingJoin ? html`<div class="title-invite">
          <${Icon} name="key" />
          <span>${t('收到同盟邀请')}</span><b class="num">${pendingJoin}</b>
          <span class="t-lo">${loginMode ? t('· 登录后将自动加入') : t('· 输入代号后将自动加入')}</span>
        </div>` : null}
        ${loginMode
          ? html`<${AuthCard} onReady=${signedIn} autoFocus=${!touchUi} onTabChange=${setAuthTab} />`
          : hasAccount
            ? html`<div class="tentry">
                <div class="tentry__acct">
                  <span class="tentry__avatar" aria-hidden="true">${entryInitial}</span>
                  <span class="tentry__meta">
                    <small>${t('已登录账号 · 以此名字进入')}</small>
                    <b>${account.nickname}<i>#${account.tag}</i></b>
                  </span>
                  <button type="button" class="tentry__switch tapx" onClick=${switchAccount}>${t('切换账号')}</button>
                </div>
                <button type="button" class="tentry__start tapx" disabled=${!online} onClick=${start}>
                  <span class="tentry__start-label">${t('开始')}</span>
                  <svg class="tentry__chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5l7.5 7.5L5 19.5M12.5 4.5L20 12l-7.5 7.5" /></svg>
                </button>
                <div class="tentry__tools">
                  <button type="button" class="tentry__line tapx" title=${serverTip} onClick=${() => toast(serverTip)}>
                    <span class="tentry__dot" aria-hidden="true"></span>${t('自动线路')}<span class="tentry__caret" aria-hidden="true"></span>
                  </button>
                  <${GuideButton} class="tentry__tool" label=${t('玩法说明')} />
                  <button type="button" class="tentry__ico tapx" aria-label=${t('设置')} title=${t('设置')}
                    onClick=${() => setSettingsOpen(true)}><${GIcon} name="gear" /></button>
                  <${FullscreenButton} class="tentry__ico" />
                </div>
              </div>`
            : html`<${TextField} label=${t('博士代号')} micro="CALLSIGN" size="lg" icon="user" value=${name} maxLength=${NAME_MAX_LEN}
                placeholder=${t('输入你的代号（最多 {NAME_MAX_LEN} 字）', { NAME_MAX_LEN })} autoFocus=${!touchUi}
                onInput=${setName} onEnter=${start} />
              <${Button} variant="primary" size="xl" block=${true} iconRight="chevrons" disabled=${!valid} onClick=${start}>${t('开始')}<//>`}
        ${hasAccount ? null : html`<div class="title-conn">
          <span class=${`status-dot ${dotClass}`}></span>
          <span>${statusText}</span>
          ${conn.status === 'online' ? html`<${PingPill} ms=${conn.ping} />` : null}
          <${GuideButton} class="title-guide" label=${t('玩法说明')} />
          <button type="button" class="title-settings fsbtn tapx" aria-label=${t('设置')} title=${t('设置')}
            onClick=${() => setSettingsOpen(true)}><${GIcon} name="gear" /></button>
          <${FullscreenButton} class="title-fs" />
        </div>`}
      </div>
      ${nativeShell ? null : html`<div class="title-assets">
        <${AssetDownloadButton} />
        <${AssetImportButton} />
      </div>
      `}
    </main>

    <${SettingsModal} open=${settingsOpen} onClose=${() => setSettingsOpen(false)} />
    ${Installed ? html`<${Installed} open=${true} onClose=${() => setInstalled(null)} />` : null}

    ${/* 底栏 = 两行（业主口径 2026-10-29）：上一轮把感谢名单单独提到第三行，手机上压住了 --legal 里的插件按钮，
         版本号也被挤到中间那一行的右侧而不是右下角。现在只有两行：
           --legal  恢复对局 / PWA 安装 / 本服务器安装了 N 个插件 / 版权（靠上）
           --thanks 感谢名单（行首，贴左下角滚动）+ .title-foot__meta（行尾，贴右下角）
         .title-foot__meta 的顺序是「项目仓库 → 开发版标签 → 版本号」，版本号必须是最后一项 —— 它要贴在最右下角，
         也是彩蛋入口（点 5 次进 /arg/）。title.css 的 .title-foot__row--thanks 用 space-between + nowrap 锁住这个
         结构；test/ui/title-footer.test.js 是这套结构的静态守卫。 */ ''}
    <footer class="title-foot">
      <div class="title-foot__row title-foot__row--legal">
        <${ResumeMatchButton} />
        <${PwaInstallButton} />
        ${installed ? html`<button type="button" class="title-plugins" data-testid="title-plugins" onClick=${openPlugins}>
          <${Icon} name="info" />${t('本服务器安装了 {n} 个插件', { n: installed })}</button>` : null}
        <span>${t('非官方同人复刻 · 游戏素材版权归 上海鹰角网络 / Yostar 所有')}</span>
      </div>
      <div class="title-foot__row title-foot__row--thanks">
        <${ThanksMarquee} />
        <span class="title-foot__meta">
          <a class="title-repo" href="https://github.com/sganggs/Stronghold-Protocol" target="_blank" rel="noopener noreferrer">${t('项目仓库')}</a>
          ${DEV_BUILD ? html`<span class="title-dev" role="note">${t('开发版 · 不稳定，请勿用于公开服务器')}</span>` : null}
          <span class="title-egg" role="button" tabIndex=0 title="" onClick=${eggClick}
            onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); eggClick(); } }}>
            <${MicroLabel}>v${APP_VERSION} · WEB SIMULATION<//>
          </span>
        </span>
      </div>
    </footer>
  </div>`;
}

// i18n-ignore: 兜底名单（名字与角色都来自网络名单接口，这里只是它不可达时的静态兜底）
const THANKS_FALLBACK = [
  { name: 'Ausevay', role: '一切的起点' },
  { name: '纸鸢安好', role: '安卓端适配的神' },
  { name: '水沫沐沐', role: 'MOD管理器作者' },
  { name: 'jingjiangze', role: '兼容MOD管理器' },
  { name: '剑光卤煮-斩尽牛杂', role: '新开一期卫' },
  { name: '不知名信箱', role: '' },
  { name: '雨千代Chiyo', role: '' },
  { name: '伊佐那邪_', role: '多功能优化Mod' },
  { name: 'Sakanine', role: '' },
  { name: '万い（千万言语）', role: '百人服家宽暴力开' },
  { name: '服务器', role: 'Mod 管理器，mod 制作，三端开发' },

  { name: "Wiš'adel", role: 'PC强兼中' },
];

function ThanksMarquee() {
  const [list, setList] = useState(THANKS_FALLBACK);

  useEffect(() => {
    let dead = false;
    const fetchThanks = async () => {
      try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 4000);
        // 使用标准简单请求（不带自定义 header），避免跨域预检 preflight 被拦截
        const res = await fetch(`https://ganxiemingdan.jiangjiangze.icu/api/thanks?_t=${Date.now()}`, {
          signal: ctrl.signal,
        });
        clearTimeout(tid);
        if (res.ok) {
          const json = await res.json();
          if (!dead && Array.isArray(json?.names) && json.names.length) {
            const combined = [...json.names];
            if (json.dedication?.name) combined.push(json.dedication);
            // 本地补充名单：线上名单没有的名字（/data/thanks.json）也一起显示
            try {
              const local = await fetch(`/data/thanks.json?_t=${Date.now()}`, { cache: 'no-store' });
              if (local.ok) {
                const lj = await local.json();
                const seen = new Set(combined.map((n) => n?.name));
                for (const n of lj?.names || []) if (n?.name && !seen.has(n.name)) { combined.push(n); seen.add(n.name); }
              }
            } catch { /* the remote list is still usable */ }
            setList(combined);
            return;
          }
        }
      } catch { /* ignore and try fallback */ }

      try {
        const resLocal = await fetch(`/data/thanks.json?_t=${Date.now()}`, { cache: 'no-store' });
        if (resLocal.ok) {
          const json = await resLocal.json();
          if (!dead && Array.isArray(json?.names)) {
            const combined = [...json.names];
            if (json.dedication?.name) combined.push(json.dedication);
            setList(combined);
          }
        }
      } catch { /* use default fallback */ }
    };

    fetchThanks();
    // 热更新机制：每 25 秒自动重新检查并热更新名单
    const timer = setInterval(fetchThanks, 25000);
    return () => { dead = true; clearInterval(timer); };
  }, []);

  return html`<div class="title-thanks">
    <a class="title-thanks__tag" href="https://ganxiemingdan.jiangjiangze.icu/" target="_blank" rel="noopener noreferrer" title=${t('查看完整感谢名单')}>
      <span class="title-thanks__dot"></span>
      <span>${t('感谢名单')}</span>
    </a>
    <div class="title-thanks__viewport">
      <div class="title-thanks__track">
        <div class="title-thanks__group">
          ${list.map((item, idx) => html`<span key=${idx} class="title-thanks__item">
            <b class="title-thanks__name">${item.name}</b>
            ${item.role ? html`<span class="title-thanks__role">${item.role}</span>` : null}
            <span class="title-thanks__sep" aria-hidden="true">◆</span>
          </span>`)}
        </div>
        <div class="title-thanks__group" aria-hidden="true">
          ${list.map((item, idx) => html`<span key=${`dup-${idx}`} class="title-thanks__item">
            <b class="title-thanks__name">${item.name}</b>
            ${item.role ? html`<span class="title-thanks__role">${item.role}</span>` : null}
            <span class="title-thanks__sep" aria-hidden="true">◆</span>
          </span>`)}
        </div>
      </div>
    </div>
  </div>`;
}
