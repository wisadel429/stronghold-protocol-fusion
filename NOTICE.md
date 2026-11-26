# 版权与使用声明（NOTICE）

**Stronghold Launcher**（下称「启动器」）是一个独立的 Windows 桌面工具，只做三件事：

1. 拉起本机的服务进程（`node server/index.js`），并管理它的启动/停止；
2. 用内嵌浏览器窗口显示界面（Microsoft Edge WebView2）；
3. 更新它自己的启动页（`launcher/`）。

本仓库**只包含启动器自身的源码**，不含任何游戏内容、美术资源或第三方运行时。

---

## 1. 许可证：GPL-3.0-or-later

Copyright (C) 2026 Stronghold Launcher contributors

本仓库自己编写的源码与文档 —— `launcher-host/`（宿主，C#）、`launcher/`（启动页，HTML/CSS/JS）、
`build-launcher.ps1`、`README.md`、`NOTICE.md` —— 以 **GNU 通用公共许可证第 3 版或（由你选择）任何更新版本**
（GPL-3.0-or-later）发布，全文见 [LICENSE](LICENSE)。
你可以在该许可证的条件下使用、修改和再分发这些代码。

## 2. 第三方组件

| 组件 | 许可 | 是否随包分发 |
|---|---|---|
| Microsoft Edge WebView2 | Microsoft 软件许可条款 | **否**：运行时用系统已安装的 Evergreen 版；包里只有加载器 `WebView2Loader.dll` 与托管包装 `Microsoft.Web.WebView2.*.dll` |
| .NET Framework 4.x | Windows 系统组件 | 否 |
| 其余全部代码 | 本仓库自写 | — |

包内图标与界面样式为本项目自有。除此之外不含任何第三方素材。

## 3. 运行与隐私

- 启动器只在**本机**操作：启动/停止服务进程、读写同目录下的配置与日志
  （`launcher.log`、`data/*.json`、`launcher-versions.json`）。
- **不收集、不上传**任何使用数据、遥测或崩溃信息。
- **不读取、不索取**任何账号凭据；登录与账号数据都发生在被启动的服务里，与启动器无关。
- 会主动发起的网络请求只有两类：
  1. **更新检查与下载**：只访问本项目 GitHub Release；
  2. **由界面发起的探测与公告拉取**：目标地址来自你自己的运行配置，启动器不内置任何地址。

## 4. 更新

启动器**只从本仓库的 GitHub Release 获取更新**，不连接任何其它更新服务器，也不从第三方镜像拉取。

- 发给别人的分发包默认**关闭更新**（`data/update-channel.json` 里 `enabled: false`）；
- 更新只覆盖启动页文件（`launcher/`），不会替换 `Stronghold.exe` 本体，也不会触碰服务进程的数据目录。

## 5. 免责声明

- 本软件按**「原样」**提供，**不附带任何明示或暗示的担保**（详见 LICENSE 第 15、16 条）。
- 使用本软件的风险（包括本机安全、端口暴露、所启动服务的可用性）由使用者自行承担。
- 本软件不保证与任何特定服务端版本兼容。

## 6. 权利人通知与删除

如果你是相关权利人，认为本仓库的任何内容不妥，请在本仓库提交 Issue，我们会尽快删除相关内容或下架发布。

---

**English summary.** A standalone Windows launcher: it starts a local process, shows a UI in an embedded
WebView2 window, and updates its own launcher page. This repository contains the launcher's own source code
only — no game content, art assets or bundled runtimes. The launcher's own code is GPL-3.0-or-later
(see LICENSE). Microsoft Edge WebView2 is used as the system-installed Evergreen runtime and is not
redistributed here. The launcher runs locally, collects no telemetry and asks for no credentials; its only
network requests are update checks against this repository's GitHub Releases and probes/announcement fetches
addressed by your own configuration. No warranty of any kind.
