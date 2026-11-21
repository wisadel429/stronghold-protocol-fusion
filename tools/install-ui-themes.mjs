// tools/install-ui-themes.mjs —— 把「两套 UI 分享包」（ac-ui-share-20261112）按「分组」接入本仓。
//
// 分组（--screens 逗号分隔，取并集，顺序无关）：
//   inmatch  对局内：screens/game・bandDraft・briefing・loadout・settle + hud/shopBar/bossPlates/… + render14-r3 三件套
//            + closure 的 acClosure* 皮肤（第一轮，已接）
//   sweep    S.W.E.E.P.报告：screens/sweep.js（缺依赖 0；样式在 hub-official.css）
//   skin     只装字体 + 大厅 CSS，一个 JS 都不接（最保守）
//
// 做法：主题文件覆盖本仓同名模块，靠入口 HTML 里的 **import map** 生效；缺的 API 由 public/ui-compat 提供，
// 并且只放在 `/ui-themes/` 这个 scope 里 —— 所以默认入口 `/`（本仓原版）完全不受影响。
// 素材只拷「被 CSS/JS 引用到」的；JS 动态拼路径的漏网文件用 tools/collect-theme-art.mjs 按 404 补齐。
//
// 用法：node tools/install-ui-themes.mjs --pack <解包目录> [--screens inmatch,sweep] [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const PACK = argVal('--pack', null);
if (!PACK) {
  console.error('用法: node tools/install-ui-themes.mjs --pack <解包后的 ac-ui-share-20261112 目录> [--screens inmatch,sweep] [--dry]');
  process.exit(2);
}
const GROUPS = new Set(argVal('--screens', 'inmatch').split(',').map((s) => s.trim()).filter(Boolean));
const ART_BASE = '/ui-art/';
const THEME_DIR = path.join(PUBLIC, 'ui-themes');

/** 分组定义。modules = 要接的主题模块；ac = 仅 closure 有的皮肤模块；css = 每个主题要装的样式表。 */
const GROUP_DEFS = {
  inmatch: {
    modules: [
      'js/screens/game.js', 'js/screens/bandDraft.js', 'js/screens/briefing.js', 'js/screens/loadout.js', 'js/screens/settle.js',
      'js/ui/components.js', 'js/ui/hud.js', 'js/ui/shopBar.js', 'js/ui/bossPlates.js', 'js/ui/matchPopups.js',
      'js/ui/choiceOverlay.js', 'js/ui/turnPopup.js', 'js/ui/turnBanner.js', 'js/ui/bondStrip.js', 'js/ui/downedPlate.js',
      'js/ui/matchInfo.js', 'js/ui/goalBanner.js', 'js/ui/protocolBoot.js', 'js/ui/shopUpFigure.js', 'js/ui/stagePreview.js',
      'js/ui/gameLogic/panel.js',
      'js/render14-r3/units.js', 'js/render14-r3/textures.js', 'js/render14-r3/fx/arrivals.js',
    ],
    ac: [
      'js/ui/acClosureBonds.js', 'js/ui/acClosureBoss.js', 'js/ui/acClosureChrome.js', 'js/ui/acClosureHud.js',
      'js/ui/acClosureRound.js', 'js/ui/acClosureShop.js', 'js/ui/acClosureSpine.js', 'js/ui/acClosureTurn.js',
      'js/ui/acClosureTv.js', 'js/ui/acClosureVoice.js', 'js/ui/acTheme.js', 'js/ui/acThemeAudio.js', 'js/ui/acTerminalTheme.js',
    ],
    css: {
      initial: ['fonts-ark/ark-fonts.css', 'css/screens/game.css', 'css/screens/match-popups.css', 'css/screens/goal-banner.css',
        'css/screens/boss-plates.css', 'css/screens/draft.css', 'css/screens/settle.css'],
      closure: ['fonts-ark/ark-fonts.css', 'css/screens/game.css', 'css/screens/match-popups.css', 'css/screens/goal-banner.css',
        'css/screens/boss-plates.css', 'css/screens/draft.css', 'css/screens/settle.css',
        'css/screens/ac-theme-closure.css', 'css/screens/ac-closure-battle.css', 'css/screens/ac-closure-shop.css',
        'css/screens/ac-closure-round.css', 'css/screens/ac-closure-tv.css', 'css/screens/ac-closure-bonds.css'],
    },
  },
  sweep: {
    modules: ['js/screens/sweep.js'],
    css: {
      // sweep 的整页遮罩与页签版式在 official-pages.css 里（hub-official.css 只管大厅那套卡片）
      initial: ['fonts-ark/ark-fonts.css', 'css/screens/hub-official.css', 'css/screens/official-pages.css'],
      closure: ['fonts-ark/ark-fonts.css', 'css/screens/hub-official.css', 'css/screens/official-pages.css', 'css/screens/ac-theme-closure.css'],
    },
  },
  // 局外：大厅 + 房间 + 成就面板 + SWEEP 报告（它们共用分享包自己的大厅外壳，必须一起接）
  lobby: {
    modules: [
      'js/screens/lobby.js', 'js/screens/room.js', 'js/screens/sweep.js',
      'js/ui/achievements.js', 'js/ui/officialHub.js', 'js/ui/protocolScene.js', 'js/ui/matchFlow.js',
    ],
    css: {
      initial: ['fonts-ark/ark-fonts.css', 'css/screens/hub-official.css', 'css/screens/official-pages.css'],
      closure: ['fonts-ark/ark-fonts.css', 'css/screens/hub-official.css', 'css/screens/official-pages.css', 'css/screens/ac-theme-closure.css'],
    },
  },
  // 第三轮：开场动画（分享包那一版画面）。注意它的资源门控读作者分支的 store.session.preloadReady，
  // 本仓从不设这个值 → 画面不挂载、跳过不武装。安装时会把那一行改成 `true`（见 patchThemeFile）。
  intro: {
    modules: ['js/ui/allianceScene.js'],
    css: {
      initial: [],
      closure: [],
    },
  },
  // 大厅背景场景（只换「难度选择后面那张场景图/网格」这一个组件，风险低）
  lobbybg: {
    modules: ['js/ui/protocolScene.js'],
    css: {
      initial: ['fonts-ark/ark-fonts.css', 'css/screens/hub-official.css'],
      closure: ['fonts-ark/ark-fonts.css', 'css/screens/hub-official.css', 'css/screens/ac-theme-closure.css'],
    },
  },
  skin: {
    modules: [],
    css: {
      initial: ['fonts-ark/ark-fonts.css', 'css/screens/hub-official.css'],
      closure: ['fonts-ark/ark-fonts.css', 'css/screens/hub-official.css', 'css/screens/ac-theme-closure.css'],
    },
  },
};

/** 主题用到的、本仓签名不同或根本没有的模块 → 兼容层（相对 public/）。只在 /ui-themes/ scope 里生效。 */
const COMPAT = {
  '/js/battle/observe.js': 'ui-compat/js/battle/observe.js',
  '/js/ui/accounts.js': 'ui-compat/js/ui/accounts.js',
  '/js/ui/gameLogic.js': 'ui-compat/js/ui/gameLogic.js',
  '/js/ui/damagePanel.js': 'ui-compat/js/ui/damagePanel.js',
  '/js/ui/skins.js': 'ui-compat/js/ui/skins.js',
  '/js/ui/seatArt.js': 'ui-compat/js/ui/seatArt.js',
  '/js/ui/transitions.js': 'ui-compat/js/ui/transitions.js',
  '/js/ui/loadoutModel.js': 'ui-compat/js/ui/loadoutModel.js',
  '/shared/constants.js': 'ui-compat/shared/constants.js',
  '/shared/randomMode.js': 'ui-compat/shared/randomMode.js',
  '/js/ui/bandSkill.js': 'ui-compat/js/ui/bandSkill.js',
  '/js/ui/crisisTags.js': 'ui-compat/js/ui/crisisTags.js',
  '/js/ui/demoMenu.js': 'ui-compat/js/ui/demoMenu.js',
  '/js/ui/panelDismiss.js': 'ui-compat/js/ui/panelDismiss.js',
  '/js/ui/rosterScroll.js': 'ui-compat/js/ui/rosterScroll.js',
  '/js/ui/bondBuildHints.js': 'ui-compat/js/ui/bondBuildHints.js',
  '/js/ui/bondHighlightPrefs.js': 'ui-compat/js/ui/bondHighlightPrefs.js',
  '/js/ui/bondTracker.js': 'ui-compat/js/ui/bondTracker.js',
  '/js/ui/blacklist.js': 'ui-compat/js/ui/blacklist.js',
  '/js/screens/diySelection.js': 'ui-compat/js/screens/diySelection.js',
  '/shared/regions.js': 'ui-compat/shared/regions.js',
  // 第二轮（大厅/房间/成就/SWEEP）
  '/js/federation.js': 'ui-compat/js/federation.js',
  '/js/screens/stats.js': 'ui-compat/js/screens/stats.js',
  '/js/ui/friends.js': 'ui-compat/js/ui/friends.js',
  '/js/nodeLatency.js': 'ui-compat/js/nodeLatency.js',
  '/js/ui/crisisEvent.js': 'ui-compat/js/ui/crisisEvent.js',
  '/js/ui/crisisRoomBadge.js': 'ui-compat/js/ui/crisisRoomBadge.js',
  '/js/ui/playerSupport.js': 'ui-compat/js/ui/playerSupport.js',
  '/js/ui/roomPolicy.js': 'ui-compat/js/ui/roomPolicy.js',
  '/js/ui/squadLabel-20261024.js': 'ui-compat/js/ui/squadLabel-20261024.js',
  '/js/ui/bossHpOption-20261024.js': 'ui-compat/js/ui/bossHpOption-20261024.js',
  '/js/ui/uiThemePicker.js': 'ui-compat/js/ui/uiThemePicker.js',
  '/shared/unifiedRegion-20261024.js': 'ui-compat/shared/unifiedRegion-20261024.js',
};

const PREFIX_IMPORTS = { '/js/render14-r3/': '/js/render/' };
const EXACT_IMPORTS = { '/js/ui/fieldHost.js?layout14=r3&oxi=13&v=guicheng-field-20261111': '/js/ui/fieldHost.js' };

const log = (...a) => console.log(...a);

/** JS 里的素材占位符：单参数 new URL(...) 必须补 location.origin（分享包原本写的是绝对 https URL）。 */
function rewriteJs(text) {
  const one = text.replace(/new URL\((['"`])__UI_ART_BASE__([\s\S]*?)\1\)/g,
    (_m, q, rest) => `new URL(${q}/ui-art/${rest}${q}, location.origin)`);
  return one.split('__UI_ART_BASE__').join(ART_BASE).split('/_v024/').join('/');
}
const rewriteCss = (text) => text.split('__UI_ART_BASE__').join(ART_BASE).split('/_v024/').join('/');

/** 所选分组的并集。 */
const jsListFor = (theme) => {
  const out = new Set();
  for (const g of GROUPS) for (const rel of GROUP_DEFS[g]?.modules || []) out.add(rel);
  if (theme === 'closure') for (const g of GROUPS) for (const rel of GROUP_DEFS[g]?.ac || []) out.add(rel);
  return [...out];
};
const cssListFor = (theme) => {
  const out = [];
  for (const g of GROUPS) for (const rel of GROUP_DEFS[g]?.css?.[theme] || []) if (!out.includes(rel)) out.push(rel);
  return out;
};
const HAS_JS = jsListFor('initial').length > 0 || jsListFor('closure').length > 0;

/**
 * 开场动画（`js/ui/allianceScene.js`）的一处定点修补。
 *
 * 分享包那版把「资源就绪」绑在作者分支的 `store.session.preloadReady` 上；本仓从不设这个字段，
 * 于是 `whenResourcesReady()` 永远不满足 → 开场画面不挂载、跳过也没被武装（业主报的「进场动画加载不了/跳不过」）。
 * 本仓的等价语义是「资源直接可用」（宿主 `ui/allianceScene.js` 就是 `() => true`），安装时把那一行改掉。
 * 改不到（分享包换了写法）就在日志里报警，不静默。
 */
function patchAllianceScene(text, label) {
  const re = /export const resourcesReady = \(\) => [^;]+;/;
  if (!re.test(text)) { log(`  ! ${label}: 没找到 resourcesReady 那一行，开场动画的资源门控未修补`); return text; }
  return text.replace(re, 'export const resourcesReady = () => true; /* patched: 本仓无 preloadReady 门控 */');
}

/**
 * 策略选择屏（`js/screens/bandDraft.js`）的一处定点修补。
 *
 * 分享包那一版是旧分支：直接 `allowedBands(gd.list('bands'), modeType)` —— 没有本仓 2026-10-29 加的
 * `officialBands(list, modeId)` 前置过滤。`gd.list('bands')` 是整张表，于是「炸惊」专属策略
 * （山岸风花 / 祀 这类 `zjOnly` 策略）会出现在标准/险境等普通模式的对局里；点「确认选择」时
 * 服务端 `gd.bandAllowed()` 拒绝 → BAD_TARGET（界面提示「无效的目标」），玩家卡在选策略。
 * 本仓同一条路是 screens/bandDraft.js 的 `selectableBands()`（officialBands → allowedBands），安装时补上。
 */
function patchBandDraft(text, label) {
  if (/officialBands\(gd\.list\('bands'\)/.test(text)) return text;
  const re = /const bands = useMemo\(\(\) => allowedBands\(gd\.list\('bands'\), mode\?\.type \|\| \(solo \? 'SINGLE' : 'MULTI'\)\), \[([^\]]*)\]\);/;
  if (!re.test(text)) { log(`  ! ${label}: 没找到策略表的 useMemo 行，策略选择屏的 zjOnly 过滤未修补`); return text; }
  let out = text.replace(re, (_m, deps) =>
    `const bands = useMemo(() => allowedBands(officialBands(gd.list('bands'), pub?.modeId ?? pub?.difficulty ?? null), mode?.type || (solo ? 'SINGLE' : 'MULTI')), [${deps}, pub?.modeId, pub?.difficulty]); /* patched: zjOnly 策略不进普通模式 */`);
  const anchor = /import \{ t, tParts \} from '\/shared\/i18n\.js';\n/;
  if (!anchor.test(out)) { log(`  ! ${label}: 没找到 i18n import 锚点，officialBands 的 import 未补`); return text; }
  out = out.replace(anchor, (m) => m + "import { officialBands } from '/js/ui/zjView.js';\n");
  return out;
}

function copyThemeFiles(theme) {
  const src = path.join(PACK, 'themes', theme);
  let js = 0, css = 0, bytes = 0;
  for (const rel of jsListFor(theme)) {
    const s = path.join(src, rel);
    if (!fs.existsSync(s)) { log(`  ! 主题缺 ${theme}/${rel}（跳过，继续用本仓的）`); continue; }
    const d = path.join(THEME_DIR, theme, rel);
    fs.mkdirSync(path.dirname(d), { recursive: true });
    let out = rewriteJs(fs.readFileSync(s, 'utf8'));
    if (rel === 'js/ui/allianceScene.js') out = patchAllianceScene(out, `${theme}/${rel}`);
    if (rel === 'js/screens/bandDraft.js') out = patchBandDraft(out, `${theme}/${rel}`);
    if (!DRY) fs.writeFileSync(d, out);
    js++; bytes += Buffer.byteLength(out);
  }
  for (const rel of cssListFor(theme)) {
    const s = path.join(src, rel);
    if (!fs.existsSync(s)) { log(`  ! 主题缺 ${theme}/${rel}`); continue; }
    const d = path.join(THEME_DIR, theme, rel);
    fs.mkdirSync(path.dirname(d), { recursive: true });
    const out = rewriteCss(fs.readFileSync(s, 'utf8'));
    if (!DRY) fs.writeFileSync(d, out);
    css++; bytes += Buffer.byteLength(out);
  }
  return { js, css, bytes };
}

/** 拷「被已安装 CSS/JS 引用」的素材（动态拼的路径由 tools/collect-theme-art.mjs 按 404 补）。 */
function copyAssets() {
  const needed = new Set();
  const scan = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { scan(p); continue; }
      if (!/\.(css|js)$/.test(e.name)) continue;
      const text = fs.readFileSync(p, 'utf8');
      for (const m of text.matchAll(/\/ui-art\/([^"')?#\s]+)/g)) needed.add(decodeURIComponent(m[1]));
    }
  };
  scan(THEME_DIR);
  for (const rel of ['selector/thumbnail_ac_n_initial.png', 'selector/thumbnail_ac_s_closur.png', 'selector/thumbnail_ac_n_iron.png']) needed.add(rel);

  const src = path.join(PACK, 'assets');
  const dst = path.join(PUBLIC, 'ui-art');
  let n = 0, bytes = 0, skipped = 0;
  const walk = (dir, rel = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const s = path.join(dir, e.name), key = path.posix.join(rel, e.name);
      if (e.isDirectory()) { walk(s, key); continue; }
      if (!needed.has(key)) { skipped++; continue; }
      const d = path.join(dst, key);
      fs.mkdirSync(path.dirname(d), { recursive: true });
      if (!DRY) fs.copyFileSync(s, d);
      n++; bytes += fs.statSync(s).size;
    }
  };
  walk(src);
  return { n, bytes, skipped };
}

/** 给一份 HTML 加：主题标记 + 主题 CSS + import map 的主题覆盖与兼容层 scope。 */
function decorateHtml(html, theme) {
  const baseMap = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]);
  const imports = { ...baseMap.imports };
  const scopes = {};
  if (HAS_JS) {
    Object.assign(imports, PREFIX_IMPORTS, EXACT_IMPORTS);
    // 只映射真的装上了的主题文件：initial 没带 closure 专属模块，给它写一条指向空文件的映射只会换来 404 + link error。
    for (const rel of jsListFor(theme)) {
      if (!fs.existsSync(path.join(THEME_DIR, theme, rel))) continue;
      imports['/' + rel] = `/ui-themes/${theme}/${rel}`;
    }
    const scope = {};
    for (const [host, compat] of Object.entries(COMPAT)) {
      if (fs.existsSync(path.join(PUBLIC, compat))) scope[host] = '/' + compat;
    }
    if (Object.keys(scope).length) scopes['/ui-themes/'] = scope;
  }
  const map = Object.keys(scopes).length ? { imports, scopes } : { imports };
  let out = html.replace(/<script type="importmap">[\s\S]*?<\/script>/,
    `<script type="importmap">\n${JSON.stringify(map, null, 1)}\n  </script>`);
  out = out.replace(/<html\s+lang="zh-CN">/,
    `<html lang="zh-CN" data-ui-theme="${theme}"${theme === 'closure' ? ' data-ac-terminal-theme="ac_s_closur"' : ''}>`);

  // CSS：本仓同名文件原位替换，其余追加
  const extra = [];
  for (const rel of cssListFor(theme)) {
    const url = `/ui-themes/${theme}/${rel}`;
    const original = `/css/screens/${path.basename(rel)}`;
    const re = new RegExp(`<link rel="stylesheet" href="${original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" />`);
    if (re.test(out)) { out = out.replace(re, `<link rel="stylesheet" href="${url}" data-ui-theme-css />`); continue; }
    extra.push(`  <link rel="stylesheet" href="${url}" data-ui-theme-css />`);
  }
  out = out.replace('</head>', `${extra.join('\n')}\n</head>`);
  // 主题补丁样式（整页屏定位/层级等结构性修补；只在 html[data-ui-theme] 下生效，见文件头注释）
  out = out.replace('</head>', `  <link rel="stylesheet" href="/css/ui-theme-bridge.css" data-ui-theme-bridge />\n</head>`);
  out = out.replace('</head>', `  <meta name="sp-ui-theme" content="${theme}" />\n</head>`);
  // 主题大厅里的「拓展模式」入口（本仓自己的模块；原版大厅不需要，它本来就有第三张卡）
  if (HAS_JS) {
    out = out.replace('</body>', `  <script type="module" src="/js/ui/extensionEntry.js"></script>\n</body>`);
  }

  if (theme === 'closure' && HAS_JS && jsListFor('closure').includes('js/ui/acTerminalTheme.js')
      && fs.existsSync(path.join(THEME_DIR, 'closure/js/ui/acTerminalTheme.js'))) {
    out = out.replace('</body>', `  <script type="module" src="/ui-themes/closure/js/ui/acTerminalTheme.js"></script>\n</body>`);
  }
  return out;
}

// ---- 执行 -----------------------------------------------------------------
log(`pack: ${PACK}`);
log(`screens: ${[...GROUPS].join(' + ')}`);

for (const theme of ['initial', 'closure']) {
  if (!fs.existsSync(path.join(PACK, 'themes', theme))) { log(`  ! 缺少 themes/${theme}`); continue; }
  const r = copyThemeFiles(theme);
  log(`  themes/${theme} → public/ui-themes/${theme}  (${r.js} 个 JS, ${r.css} 张 CSS, ${(r.bytes / 1024).toFixed(0)} KB)`);
}

{
  const r = copyAssets();
  log(`  assets/ → public/ui-art/  (${r.n} 个文件, ${(r.bytes / 1048576).toFixed(1)} MB；跳过 ${r.skipped} 个未引用)`);
}

const indexHtml = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
for (const theme of ['initial', 'closure']) {
  const html = decorateHtml(indexHtml, theme);
  if (!DRY) fs.writeFileSync(path.join(PUBLIC, `ui-theme-${theme}.html`), html);
  log(`  public/ui-theme-${theme}.html  (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
}

// 对局 mock 页也生成主题版：不登服务器就能截「对局内」的图（验证用）
if (HAS_JS) {
  const mockPath = path.join(PUBLIC, 'dev', 'game-mock.html');
  if (fs.existsSync(mockPath)) {
    const mock = fs.readFileSync(mockPath, 'utf8');
    for (const theme of ['initial', 'closure']) {
      const html = decorateHtml(mock, theme);
      if (!DRY) fs.writeFileSync(path.join(PUBLIC, 'dev', `game-mock-${theme}.html`), html);
    }
    log('  public/dev/game-mock-<theme>.html (验证用)');
  }
}

log(DRY ? 'dry run: 没写文件' : 'done');
