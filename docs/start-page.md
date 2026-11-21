> 端：PC（Windows 启动器 / WebView2）

# 启动页（电脑版 launcher）设计与实现

- 日期：2026-10-31
- 状态：**已放入游戏根目录**（`Stronghold.exe` + `launcher/` + WebView2 DLL），可直接双击试用；构建源码仍在 `_merge-work/launcher-build/`
- 目标：双击 `Stronghold.exe` 先进入启动页；点「本地游戏」后才启动本地 node 服务器，再把同一窗口切到游戏。

![启动页原型](assets/start-page.png)

---

## 1. 它解决什么

现在双击 `start-game.bat` 会直接起服务器、再开浏览器。启动页把这两步拆开：

1. **先给一个“入口”**：本地游戏 / 服务器游玩 / 服务器地址 / 资源状态；
2. **本地服务器按需启动**：不点「本地游戏」就不占端口、不跑 node；
3. **窗口内完成**：点「本地游戏」后，同一个 WebView2 窗口导航到 `http://localhost:3000/`，看起来像客户端，而不是浏览器标签页。

---

## 2. 组成

| 部分 | 位置（原型） | 作用 |
|---|---|---|
| 宿主 exe | `_merge-work/launcher-build/Stronghold.exe` | WinForms + WebView2，开窗口、起 node、导航 |
| 启动页 | `_merge-work/launcher-build/launcher/` | `index.html` / `style.css` / `app.js` |
| WebView2 运行库 | `WebView2Loader.dll`、`Microsoft.Web.WebView2.*.dll` | 随 exe 放同目录 |
| Node 运行时 | 可选 `node\node.exe`（83 MB） | 没有就用 PATH 里的 node |
| 服务器 | 游戏目录 `server/index.js` | 点「本地游戏」后才启动 |

正式安装时建议：

```text
Stronghold-Protocol-v0.3.3-Fusion\
  Stronghold.exe
  WebView2Loader.dll
  Microsoft.Web.WebView2.Core.dll
  Microsoft.Web.WebView2.WinForms.dll
  launcher\                 ← index.html / style.css / app.js
  node\node.exe             ← 可选，随包
  server\ public\ data\ plugins\ ...   ← 原游戏目录
  start-game.bat              ← 保留（无 WebView2 的兜底）
```

---

## 3. 交互流程

### 3.1 启动页 → 本地游戏

```text
双击 Stronghold.exe
  → 窗口加载 https://app.local/index.html（WebView2 虚拟主机映射到 launcher/）
  → 页面 postMessage {t:'ready'}
  → 宿主回 {t:'config', server, version} 和 {t:'art', files, checked}
  → 用户点「本地游戏」
  → 页面 postMessage {t:'start-local'}
  → 宿主：
      1) 若 http://127.0.0.1:3000/healthz 已 200，直接导航；
      2) 否则 Process.Start(node server\index.js)，PORT=3000，隐藏窗口；
      3) 每 500ms 轮询 /healthz，最多 90s，状态回传页面；
      4) 就绪后回 {t:'server-started', url, lan}，导航到 http://localhost:3000/
```

### 3.2 启动页 → 服务器游玩

```text
用户填地址（可省略端口，默认 3000）→ 点「连接服务器」
  → 页面 postMessage {t:'start-remote', addr}
  → 宿主规范化 URL，探测 <addr>/healthz
  → 200：导航到远程地址；失败：页面显示红色“连不上”
```

### 3.3 网页版服务器列表

- **默认连接就是服务器列表**：备1 `https://wei.jiangjiangze.icu/`，备2 `http://121.4.51.247/`（主站 bbsmc 已不可用，已从默认值和界面移除）。
- 打开前按顺序探测（原样和带尾斜杠都试）；前一个 404/超时/拒绝连接就切下一个，全都不通才提示。
- 点「服务器游玩 / 打开服务器列表」→ 宿主在**同一个 WebView2 窗口**打开该列表页。
- 列表页里点到具体服务器（包括 `target=_blank` / `window.open`）→ 拦下新窗口请求，改为当前窗口跳转。
- 只允许 `http/https`（以及启动页自己的 `app.local`）；`file:` 等其它协议取消导航并交给系统处理。
- 远程页面左上角会注入一个「← 返回」按钮，`Alt+←` 也可以返回：先回列表，再回启动页。
- 列表地址没配置时，点「服务器游玩」会提示先配置，不会白屏。
- **进入服务器也有加载页**：打开列表、点列表里的服务器、`target=_blank` 链接，都会先进入 `launcher/loading.html`（「正在连接服务器列表 / 正在进入服务器」+ 目标地址 + 进度 + 返回启动页），约 0.7 秒后 `location.replace` 到目标，返回时不会卡在加载页。

### 3.4 启动中页面

点「本地游戏」后页面切换到全屏启动页：转圈 + 「正在启动服务器」+ 当前步骤（检查 → 启动进程 → 等待响应 → 载入插件/版本/网络 → 进入游戏）+ 已用时间 + 进度条 + 轮换提示；失败时变红并出现「返回启动页」。

### 3.5 退出

- 启动页「退出」→ 宿主关闭窗口，并 `taskkill /T` 结束它启动的 node 进程树；
- 直接关窗口同样会清理 node。

---

## 4. 页面与代码的对应

| 页面元素 | id | 行为 |
|---|---|---|
| 本地游戏卡片 | `localCard` / `localGo` / `localState` | 触发 `start-local`，显示启动进度 |
| 服务器游玩卡片 | `remoteGo` / `remoteAddr` / `remoteState` | 触发 `start-remote` |
| 服务器地址 | `addr` / `saveAddr` / `resetAddr` / `addrStatus` | 保存到 `localStorage` 与 `launcher-config.json`；不写端口按 3000 |
| 服务器列表 | `listUrl` / `saveList` / `listStatus` | 网页版列表地址，保存到 `launcher-config.json` 的 `list` |
| 启动中页面 | `loading` / `loadingStep` / `loadingBar` / `loadingTime` / `loadingBack` | 全屏启动进度与失败返回 |
| 本地资源 | `artBar` / `artText` / `artCount` | 宿主统计 `public/assets` 文件数（31,601） |
| 页脚 | `lanUrls` / `quit` | 服务器就绪后显示局域网地址；退出 |

宿主消息类型（`launcher/app.js` ↔ `Program.cs`）：

| `t` | 方向 | 说明 |
|---|---|---|
| `ready` | 页面 → 宿主 | 页面加载完 |
| `config` | 宿主 → 页面 | 已保存的服务器地址、版本 |
| `art` | 宿主 → 页面 | 资源文件数 / 已检查数 |
| `start-local` | 页面 → 宿主 | 启动本地服务器 |
| `server-started` | 宿主 → 页面 | 本地服务器就绪（附 url、lan） |
| `start-remote` | 页面 → 宿主 | 连接远程服务器 |
| `remote-started` | 宿主 → 页面 | 远程探测通过 |
| `status` | 宿主 → 页面 | `kind: wait/ok/bad` + 文案 |
| `error` | 宿主 → 页面 | 失败原因 |
| `save-server` | 页面 → 宿主 | 写 `launcher-config.json` |
| `quit` | 页面 → 宿主 | 退出 |

---

## 5. 构建

需要：.NET Framework 4.8 的 `csc.exe`、WebView2 SDK 的 `lib/net462` DLL、`WebView2Loader.dll`。

```bat
csc /target:winexe /platform:x64 /win32icon:launcher/app.ico /out:Stronghold.exe Program.cs ^
  /r:libs\Microsoft.Web.WebView2.Core.dll ^
  /r:libs\Microsoft.Web.WebView2.WinForms.dll ^
  /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.dll /r:System.Core.dll
```

WebView2 SDK 取自 NuGet `Microsoft.Web.WebView2`：

- `lib/net462/Microsoft.Web.WebView2.Core.dll`
- `lib/net462/Microsoft.Web.WebView2.WinForms.dll`
- `runtimes/win-x64/native/WebView2Loader.dll`

运行时要求：系统已安装 **Microsoft Edge WebView2 Runtime**（本机 156.x；Win10/11 一般自带）。没有时弹窗提示安装。

### 图标

- 源图：`launcher/app-source.jpg`（文件夹里的「卫戍协议：盟约」logo，447×447）。
- `launcher/app.ico`：用这张图生成的 16/24/32/48/64/128/256 多尺寸 ICO，**所有尺寸都是整张 logo**（不再使用 SP 徽标）。
- 小尺寸（16/24/32）因为图本身细节多会偏暗、字看不清，这是整图缩放的正常结果；如果要更醒目，可以后续给 16/32 单独做“只保留三角 + 绿色标题”的简化版。
- 编译参数 `/win32icon:launcher/app.ico` 嵌入 exe；运行时 `form.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath)` 让标题栏和任务栏用同一个图标。
- 换图：替换 `launcher/app-source.jpg` 后重新生成 `app.ico` 再编译。

---

## 6. 已验证

- 启动器窗口能加载启动页（`NavigationCompleted IsSuccess=True`）。
- 点「本地游戏」/ `--autostart`：node 启动，`/healthz` 返回 200，窗口导航到游戏标题页（“点击进入”）。
- 关闭窗口后 node 进程树被清理。
- 启动页在 1280×820 窗口内一屏放下（见顶部截图）。

---

## 7. 已知限制 / 待办

1. **默认服务器地址未配置**：等给定后写进 `DEFAULT_SERVER` 与 `launcher-config.json`。
2. **没有“返回启动页”**：进入游戏后只能关窗重开；后续可在宿主加 `Alt+←` 或标题栏返回按钮。
3. **资源校验是统计文件数**，还不是逐文件 sha256；需要的话可接现有 `UPDATE.json` / 美术包机制。
4. **单实例**：目前只做了 `healthz` 判重（3000 已起则直接导航），没有跨进程锁。
5. **端口固定 3000**（可用 `--port` 改），未做占用时自动递增。
6. **未做代码签名**：分发时 SmartScreen 可能提示。
7. **WebView2 依赖**：极简系统没装运行时会弹窗；可用 `start-game.bat` 兜底。
8. 启动器目前是原型，放在 `_merge-work/launcher-build/`；合入产品时需要把 `launcher/`、DLL、exe 一起放进根目录，并补一个“构建启动器.bat”。

---

## 8. 下一步

1. 收到默认服务器地址后落进配置；
2. 加“返回启动页”和单实例锁；
3. 端口占用自动递增；
4. 决定是否把 node 运行时随包（+83 MB）还是要求系统装 Node；
5. 最后再考虑 Inno Setup 打成 `Setup.exe`。

---

## 9. 生命周期（2026-10-31 追加）

- **本地服务器退出 / 无响应**：宿主监听 node 进程 `Exited`，并每 3 秒探一次 `/healthz`（连续 3 次失败）→ 自动导航回启动页 `?stopped=…`，本地游戏卡片显示「状态：本地服务器已停止」，服务器地址行变红「本地服务器已退出」。
- **关闭启动器**：`FormClosing` 里 `taskkill /PID <node> /T /F`，node 及其 worker 子进程一起结束；窗口关闭后端口释放。
- **游戏进程结束**：等价于本地服务器退出，按第一条自动回启动页，不会留下孤儿进程。
- **开场动画**：游戏客户端的「点击进入 / TAP TO START」已移除——进入游戏页后立即播放开场动画，再进标题页；启动器给 WebView2 加了 `--autoplay-policy=no-user-gesture-required`，所以启动器内通常有声音；普通浏览器若拦截自动播放则静音播放，不再挡点击。
