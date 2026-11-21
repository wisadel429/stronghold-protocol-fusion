# 2026-11-17 可露希尔界面（closure）故障修复记录

> 业主报障：「UI 加载错了」「主界面 UI 也是错的」「对局内 UI 错位 / 元素缺失」，
> 线上公告也写着「可露希尔 UI 出现较严重 BUG」。本文件记录**根因**与**改动**，便于回滚与复验。

## 一、根因（三类，互相叠加）

1. **标题页（主界面）根本没有主题**：主题包只提供对局内 / 大厅 / 房间组件，
   既没有 `js/screens/title.js`，所有主题 CSS 里也**没有任何 `.title-*` 规则**
   （`grep '\.title-' public/ui-themes/closure/css → 0 命中`）。于是 `/ui-theme-closure.html`
   的标题页 100% 是本仓原版薄荷绿外观 —— 入口写着「可露希尔」，界面却和网页原版一样。

2. **UI 布局编辑器的历史微调把标题页挤花了**：`public/ui-layout.json` 里存着一批按**旧版式**
   手调的覆盖（`apply.js` 每次载入编译成 CSS 并用 `!important` 套用）。其中：
   - 版权那条 `<span>` 被写成 `translate: -0.26rem 0.655rem` → 被硬挪到下一行 + 右下角 `SERVER-1` 水印上；
   - `.title-thanks` `translate(624.5, -69)` + `width: 950.6` + `scale: 1.3` → 滚动名单溢出到版权行；
   - `.title-foot__meta` `translate(-12.5, 16.5)` + `scale: 1.3` → 版本号压在水印上；
   - 手机端更夸张（`translate(289, -61.5)` / `(-280.5, -96)`）。
   实测证据：`#app > … > .title-foot__row--legal > span { translate: -0.26rem 0.655rem }` 这条
   内联 `<style>` 规则命中版权文字，`getBoundingClientRect()` 显示它与版本号/水印三重重叠。

3. **对局内 `重刷本局` 条叠在 `玩法说明` 按钮上**：本仓 `.brief-reroll` 按**本仓** brief 版式
   绝对定位在页头中部；closure 用分享包的 `brief--split` 版式，页头右侧是「玩法说明」。
   1366×768 实测：重刷本局 `(581,13,625,69)` vs 玩法说明 `(1132,42,89,26)`，重叠 44×26px。

## 二、改动

| 文件 | 改动 |
|---|---|
| `public/ui-themes/closure/css/screens/title.css`（新增） | 可露希尔标题页皮肤：AC 终端配色（`#59F3FE`）、深色面板、四角括号、青色主按钮、底栏配色；**只改颜色/边框/装饰，不动布局尺寸** |
| `public/ui-theme-closure.html` | 引入上面这份 `title.css`（`data-ui-theme-css`），并引入新的 `briefing.css` |
| `public/ui-themes/closure/css/screens/briefing.css`（新增） | 主题下把 `.brief-reroll` 从页头中部挪到标题与「玩法说明」之间的空档（窄屏 <1100px 改为底部居中），不再叠字 |
| `public/dev/game-mock-closure.html` | 同步引入 `briefing.css`，让对局内 mock 与真实入口一致 |
| `public/css/screens/title.css` | 底栏重排：版权行改单行 nowrap + 版权贴右；感谢名单自己钳高（`height`/`overflow`）；底栏整体抬高 `.22rem` 给 `SERVER-1` 水印留槽；副标题上边距 `.12rem → .18rem`（1366 实测「盟约」字脚压住副标题 3px）；≤760px 收掉左上铭牌（实测 390×844 会与「统计」按钮重叠 13×4px） |
| `public/ui-layout.json` | 删掉 13 条会把标题页/顶栏挤坏的历史微调（标题底栏 8 条 + 顶栏 5 条）。原文件已备份为 `public/ui-layout.json.bak-2026-11-17`；编辑器里重新微调即可，**不要**再整体平移 footer 子元素 |

## 三、复验方法（无头 Edge + CDP）

```sh
# 标题页：可见文字两两求交，应为 0；主题色应为 #59F3FE
node .cache/probe/title-check.mjs /ui-theme-closure.html shot.png 1920 1080
# 对局内：确认本局信息 / 备战
node .cache/probe/overlap-check.mjs '/dev/game-mock-closure.html?phase=INFO_CHECK&shot=1' shot.png 1366 768
node .cache/probe/overlap-check.mjs '/dev/game-mock-closure.html?phase=PREP&shot=1' shot.png 1366 768
```

2026-11-17 实测结果：

| 检查 | 结果 |
|---|---|
| 标题页 1920×1080（closure） | 重叠 0、溢出 0、`en __b` = `rgb(89,243,254)`（主题生效）、无 JS 异常 |
| 标题页 1366×768（closure） | 重叠 0、溢出 0 |
| 标题页 390×844（closure） | 重叠 0、溢出 0 |
| 标题页 1920/1366（网页原版） | 重叠 0、溢出 0、主题 CSS 0 份（原版不受影响） |
| 对局内 INFO_CHECK 1366 / 1920 | 重叠 0、无异常 |
| 对局内 PREP 1366 | 重叠 0、无异常 |

## 四、追加：确认盟约界面的数字样式（2026-11-17 二轮）

业主：「确认盟约界面的数字样式用错了」。核对结果：主题 `ac-closure-bonds.css` 只把 **对局内** 盟约条
（`.gm__bonds .bstrip--closure`）的数字/名称换成了 `ArkWide` / `ArkCN`，「确认本局信息」这一屏的盟约区
（`.brief-bonds`）一条主题规则都命中不了，于是同一套皮肤里两种字体：

| 元素 | 修前 | 修后 |
|---|---|---|
| 步骤号「1/2」`.stephead__title .num` | Bender 900 / 薄荷绿 `rgb(89,244,202)` | ArkWide 400 / AC 青蓝 `rgb(89,243,254)` |
| 已就绪「2/4」的前一个数 `.brief-ready__txt b.num` | Bender / 薄荷绿 `rgb(35,232,177)` | ArkWide / AC 青蓝 |
| 盟约禁用人数徽标 `.brief-bond__ban.num` | Bender 700 / 10px | ArkWide 400 + 描边阴影 |
| 盟约名 `.bond__name` | Noto Sans SC / `rgb(214,218,218)` | ArkCN 500 / `#a5a5a7`（激活/上阵转 `#fff`） |
| 「本局禁用干员 N」`.brief-banned__n` | Bender | ArkWide |

> 注：`official-pages.css:2506` 的 `.brief--split .brief-bond__ban > * { display: none }` 是主题**有意**把
> 徽标子元素换成 `img_bond_banned.png` 贴图（分享包那版就不逐盟约显示数字），这条保持原样没动。

复验：`INFO_CHECK` / `PREP` / `BAND_DRAFT` 在 1366×768 与 1920×1080 下均 `overlaps=0`、无 JS 异常。
（`SETTLE` 屏在 1366 有两条 `data:` 图片的 CSP 报错，是 mock 自身资源，与本轮改动无关。）


## 五、倒计时七段数字（2026-11-17 三轮）

业主：「选择策略和前一页面右上角倒计时数字字体样式错了」。

**根因是资源用错，不是 CSS**：主题 `ac-theme-closure.css` 用 10 个 mask 画数字
（`.numfont__d--N::after` + `mask-size: 100% 100%`，格子 32/48 × 68/48），引用
`/ui-art/img/official/hub/ac/battle/numfont/digit_N.png`；但该目录里放的是**裁掉留白的字形切片**：

| 资源 | 尺寸 | 说明 |
|---|---|---|
| `/ui-art/img/.../numfont/digit_0.png`（原） | 29×31 | 字形切片，被拉伸进 35×75 的格子 |
| `/ui-art/img/.../numfont/digit_1.png`（原） | 14×31 | 同上（每张宽高比都不一样） |
| `/ui-art/original/img/.../numfont/digit_N.png` | **32×68 ×10** | 整格版，正好是主题要的比例 |

把 31 px 高的切片拉到 75 px 高 → 数字变形、糊成一团，`COUNTDOWN` 还被压在字下面。

处理（两步）：

1. **资源修正**（主）：用 `ui-art/original/...` 的 10 张 32×68 整格图覆盖 `ui-art/img/...`；
   旧的那批移到 `.cache/backup/numfont.bak-cropped-2026-11-17/`（不在 `public/` 下，不会被下发）。
   这些文件是明文（无 `SPLOCK1` 头），artLock 按原样输出，所以覆盖后立即可用。
2. **强制失效浏览器缓存**（辅）：旧图当初是经 artLock 下发的（`Cache-Control: public, max-age=3600`），
   换文件不改 URL，玩家可能还缓存着变形的图。新增
   `public/ui-themes/closure/css/screens/numfont.css`，用 `?v=2` 重新声明 10 条 mask 规则；
   两个入口（`ui-theme-closure.html`、`dev/game-mock-closure.html`）都已引入。以后换图把 `v` 递增即可。

复验（1366×768 / 1920×1080，`INFO_CHECK` / `BAND_DRAFT`）：`overlaps=0`、`errors=0`；
倒计时渲染成标准 AC 七段数字（清淅段缝、`COUNTDOWN` 完整可见）。

## 六、还没做的


- 大厅（分享包 `oh-*` 版式）在 1366 下仍然偏挤：右上版本/在线数/账号胶囊贴得近、底部三张模式卡贴着视口下沿。
  这是主题大厅自身按 1280×720 设计、未做窄屏回流导致的，**本次未改**（两套主题共用，改它要动 `hub-official.css` 的整块定位）。
- 线上公告「可露希尔 UI 出现较严重 BUG」仍在 `公告` 里，确认这轮修复后建议在后台删掉这条。
