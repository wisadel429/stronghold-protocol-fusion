# 卫戍协议：盟约 · 融合版（源码）

> 非官方同人二创，与上海鹰角网络 / Yostar 无任何关系。
> **本仓库只包含源码，不包含任何美术资源、音频、字体。**

## 这个仓库是什么

一套跑在 Node.js 上的《明日方舟》「卫戍协议」同人复刻的**服务端 + 网页客户端 + 电脑版启动器**源码，
包含账号系统、好友/消息、房间与对局、后台管理、热更新等模块。

## 重要声明：美术资源不在此仓库

按业主明确要求，**美术资源一律不入库、不二次分发**：

- 立绘 / UI 素材 / 图标 / 音频 / 字体（`public/assets/`、`public/ui-art/`、`public/icons/`、`public/fonts/`）
- 仓库里由 `.gitignore` 与 `.githooks/pre-commit` **双重拦截**：只要暂存区出现媒体或二进制文件，提交会被直接拒绝

想在自己机器上跑起来，请使用**你自己的、来源合法**的资源包；本仓库不提供、也不引导获取这些素材。
所有《明日方舟》相关素材版权归 上海鹰角网络 / Yostar 所有。

## 目录结构

| 目录 | 内容 |
|---|---|
| `server/` | 服务端：HTTP/WebSocket、房间与对局、账号、社交、消息、反馈、公告、后台 |
| `shared/` | 前后端共用的协议、常量、校验逻辑 |
| `public/` | 网页客户端（**仅代码**：js / css / html） |
| `launcher/` | 电脑版启动器的页面（WebView2 加载的 HTML/CSS/JS） |
| `launcher-host/` | 启动器宿主源码（C# / WinForms + WebView2） |
| `tools/` | 素材导入与构建脚本（只放脚本，不放素材） |
| `docs/` | 设计文档与研究笔记 |

## 运行

```powershell
# 需要 Node.js 22+
node server/index.js          # 默认 3000 端口
```

首次启动会建立资源索引；缺少美术资源时部分画面会显示占位或空白，属预期行为。

## 电脑版启动器（自行编译）

```powershell
$p = (Get-Location)
& 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' /nologo /target:winexe `
  "/out:$p\Stronghold.exe" /win32icon:$p\launcher\game.ico `
  /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Core.dll `
  /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll `
  /r:$p\Microsoft.Web.WebView2.Core.dll /r:$p\Microsoft.Web.WebView2.WinForms.dll `
  "$p\launcher-host\Program.cs"
```

> WebView2 的托管 DLL（`Microsoft.Web.WebView2.*.dll`、`WebView2Loader.dll`）不在仓库里，
> 请从 WebView2 SDK 自行获取。

## 上游原始说明

原项目自带的长文档（安装细节、内容说明）见 [README-upstream.md](README-upstream.md)。

## 致谢与来源

本项目基于社区上游 `sganggs/Stronghold-Protocol` 的同人复刻继续开发，融合版改动、启动器与后台由本项目维护。
详见 `NOTICE.md`。

## 许可

代码部分仅供学习交流，请勿用于商业用途。美术资源版权归原权利人，不在本仓库范围内。
