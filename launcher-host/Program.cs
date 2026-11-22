// Program.cs — 启动器宿主（重建版 v2，2026-11-21）
//
// 背景：原 Program.cs 随 E:\stronghold\_merge-work 被删除且无备份。本文件是**重写**的宿主，
// 目标：尽量还原原版的能力（按 launcher.log 里留下的行为线索逐项对齐）。
//
// 已还原的能力：
//   1. WebView2 运行时探测：**优先系统已装的 Evergreen**（业主 2026-11-22：不再随包分发），
//      只有系统没有、且安装目录里还留着旧 webview2\ 时才回退到包内那份。
//   2. Node 探测与激活：node\node.exe → 系统 node；日志记 `node activated rc=0 out=vX`。
//   3. 预热本地服务器：启动即拉起 server/index.js（旧日志 `warm node started pid N`）。
//   4. 本地资源扫描：统计 public/assets 等目录的文件数，按 `art` 消息回报进度（旧界面 53673/53673）。
//   5. 本地服务器就绪探测：轮询 /healthz，回报 `boot` 进度与 `server-started`，随后进入游戏页。
//   6. 服务器列表探测：并发探测 list / listBackup / listBackup2，回报 `list` 状态（旧日志 probe error / list unreachable）。
//   7. JS 错误回传：文档级注入 window.onerror → 宿主日志 `JS ERROR ...`。
//   8. 消息协议：ready / config / save-server / start-local / start-public / start-remote / open-list / quit。
//   9. 地址拼接修正：**不再强制 :3000**（见 BuildUrl）。
//
// 编译（csc 4.x，C# 5 语法，勿用 ?. / $"..." / nameof）：
//   csc /target:winexe /out:Stronghold-rebuild.exe Program.cs
//       /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Core.dll
//       /r:Microsoft.Web.WebView2.Core.dll /r:Microsoft.Web.WebView2.WinForms.dll
//       /win32icon:launcher\game.ico

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace StrongholdLauncher
{
    internal static class Program
    {
        public static string Root;
        private static StreamWriter _log;
        private static readonly object LogLock = new object();

        [STAThread]
        private static void Main()
        {
            Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            try { _log = new StreamWriter(Path.Combine(Root, "launcher.log"), true, new UTF8Encoding(false)) { AutoFlush = true }; }
            catch { _log = null; }

            Log("=== launcher (rebuild v2) start ===");
            Log("software=False");
            Log("os=" + Environment.OSVersion + " 64bit=" + Environment.Is64BitProcess);
            Log("clr=" + Environment.Version);
            // 业主 2026-11-22：宿主默认只开 TLS 1.0（实测 SecurityProtocol = Ssl3, Tls），
            // GitHub 只接受 TLS 1.2+，不开就会 SecureChannelFailure ——
            // 顺带修好 https 公告源（mon3tr.fun）一直失败的问题（日志里 https 公告成功次数是 0）。
            try { ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12 | SecurityProtocolType.Tls11; }
            catch (Exception e) { Log("tls setup failed: " + e.Message); }
            // 业主 2026-11-22：启动器有**自己的**版本号（launcher/version.json），与游戏热更包版本分开
            Log("launcher version=" + (LauncherVersion().Length > 0 ? LauncherVersion() : "(none)"));
            // 业主 2026-11-22：启动器独立于游戏版本 —— 先读版本注册表（launcher-versions.json）
            try { VersionStore.Load(); } catch (Exception e) { Log("versions init failed: " + e.Message); }
            PrepareWebView2Runtime();
            // 调试开关（默认关）：SP_LAUNCHER_DEBUG=1 时开本地 CDP 端口，便于用 DevTools 查页面真实 DOM。
            try
            {
                if (Environment.GetEnvironmentVariable("SP_LAUNCHER_DEBUG") == "1")
                {
                    var args = Environment.GetEnvironmentVariable("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") ?? "";
                    if (args.IndexOf("remote-debugging-port", StringComparison.OrdinalIgnoreCase) < 0)
                        Environment.SetEnvironmentVariable("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                            (args + " --remote-debugging-port=9334").Trim());
                    Log("debug: remote-debugging-port=9334");
                }
            }
            catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try { Application.Run(new LauncherForm()); }
            catch (Exception e) { Log("FATAL " + e); }
            finally { Log("=== launcher (rebuild v2) exit ==="); TryCloseLog(); }
        }

        public static void Log(string msg)
        {
            if (_log == null) return;
            lock (LogLock) { try { _log.WriteLine(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + msg); } catch { } }
        }

        /// <summary>启动器版本号（launcher/version.json 里的 launcher 字段）。读不到返回空串。</summary>
        public static string LauncherVersion()
        {
            try
            {
                var file = Path.Combine(Root ?? AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\'), "launcher", "version.json");
                if (!File.Exists(file)) return "";
                var raw = File.ReadAllText(file, Encoding.UTF8);
                const string key = "\"launcher\"";
                var i = raw.IndexOf(key, StringComparison.Ordinal);
                if (i < 0) return "";
                var q1 = raw.IndexOf('"', i + key.Length);
                if (q1 < 0) return "";
                var q2 = raw.IndexOf('"', q1 + 1);
                if (q2 < 0) return "";
                return raw.Substring(q1 + 1, q2 - q1 - 1).Trim();
            }
            catch { return ""; }
        }

        private static void TryCloseLog()
        {
            try { if (_log != null) { _log.Flush(); _log.Dispose(); } } catch { }
            _log = null;
        }

        /// <summary>系统已安装的 WebView2 运行时版本号（Evergreen）；找不到返回空串。</summary>
        public static string SystemWebView2Version()
        {
            try
            {
                var roots = new[]
                {
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "EdgeWebView", "Application"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "EdgeWebView", "Application"),
                };
                foreach (var root in roots)
                {
                    if (!Directory.Exists(root)) continue;
                    foreach (var dir in Directory.GetDirectories(root))
                    {
                        if (File.Exists(Path.Combine(dir, "msedgewebview2.exe"))) return Path.GetFileName(dir);
                    }
                }
            }
            catch { }
            try
            {
                using (var reg = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(
                    @"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"))
                {
                    if (reg != null)
                    {
                        var pv = reg.GetValue("pv") as string;
                        if (!string.IsNullOrEmpty(pv)) return pv;
                    }
                }
            }
            catch { }
            return "";
        }

        /// <summary>
        /// 业主 2026-11-22：WebView2 **不再随包分发**，用系统已装的 Evergreen 运行时。
        /// 只有系统里没有、而安装目录里还留着旧 webview2\ 时才回退到包内那份（兼容老的安装包）。
        /// </summary>
        private static void PrepareWebView2Runtime()
        {
            try
            {
                var sys = SystemWebView2Version();
                var bundled = Path.Combine(Root, "webview2", "msedgewebview2.exe");
                if (sys.Length > 0 || !File.Exists(bundled))
                {
                    Program.Log("installed webview2 (evergreen)" + (sys.Length > 0 ? " " + sys : "（未查到版本号，交给 loader 自行查找）"));
                    return;
                }
                Environment.SetEnvironmentVariable("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", Path.GetDirectoryName(bundled));
                Program.Log("bundled webview2 (legacy fallback)=" + bundled);
            }
            catch (Exception e) { Program.Log("webview2 probe failed: " + e.Message); }
        }
    }

    /// <summary>一个可开服/游玩的游戏版本（业主 2026-11-22：启动器独立于游戏版本）。</summary>
    internal sealed class VersionEntry
    {
        public string Id;
        public string Name;
        /// <summary>相对启动器根目录，或绝对路径。</summary>
        public string Dir;
        public int Port;

        public string FullDir
        {
            get
            {
                try { return Path.IsPathRooted(Dir) ? Dir : Path.GetFullPath(Path.Combine(Program.Root, Dir)); }
                catch { return Program.Root; }
            }
        }
    }

    /// <summary>
    /// 版本注册表（launcher-versions.json）。
    /// 格式：{"active":"id","versions":[{"id","name","dir","port"}]}
    /// 解析用 Host.JsonValue 逐块读，避免为了一个 JSON 数组引入依赖（C# 5 / 无外部库）。
    /// </summary>
    internal static class VersionStore
    {
        public static readonly List<VersionEntry> Entries = new List<VersionEntry>();
        public static string ActiveId = "";

        private static string FilePath { get { return Path.Combine(Program.Root, "launcher-versions.json"); } }

        public static void Load()
        {
            Entries.Clear();
            ActiveId = "";
            try
            {
                if (File.Exists(FilePath))
                {
                    var raw = File.ReadAllText(FilePath, Encoding.UTF8);
                    ActiveId = Host.JsonValue(raw, "active") ?? "";
                    var start = raw.IndexOf("\"versions\"", StringComparison.Ordinal);
                    if (start >= 0)
                    {
                        var open = raw.IndexOf('[', start);
                        var close = raw.LastIndexOf(']');
                        if (open >= 0 && close > open)
                        {
                            var body = raw.Substring(open + 1, close - open - 1);
                            var depth = 0;
                            var from = -1;
                            for (var i = 0; i < body.Length; i++)
                            {
                                var c = body[i];
                                if (c == '{') { if (depth == 0) from = i; depth++; }
                                else if (c == '}')
                                {
                                    depth--;
                                    if (depth == 0 && from >= 0)
                                    {
                                        var block = body.Substring(from, i - from + 1);
                                        from = -1;
                                        var id = Host.JsonValue(block, "id") ?? "";
                                        var name = Host.JsonValue(block, "name") ?? "";
                                        var dir = Host.JsonValue(block, "dir") ?? ".";
                                        // port 是数字型（JsonValue 只认字符串值），这里直接按字段抓数字
                                        var port = 0;
                                        var pIdx = block.IndexOf("\"port\"", StringComparison.Ordinal);
                                        if (pIdx >= 0)
                                        {
                                            var colon = block.IndexOf(':', pIdx);
                                            if (colon >= 0)
                                            {
                                                var digits = new StringBuilder();
                                                for (var j = colon + 1; j < block.Length; j++)
                                                {
                                                    var ch2 = block[j];
                                                    if (ch2 >= '0' && ch2 <= '9') digits.Append(ch2);
                                                    else if (digits.Length > 0) break;
                                                }
                                                int.TryParse(digits.ToString(), out port);
                                            }
                                        }
                                        if (id.Length > 0) Entries.Add(new VersionEntry
                                        {
                                            Id = id,
                                            Name = name.Length > 0 ? name : id,
                                            Dir = dir.Length > 0 ? dir : ".",
                                            Port = port > 0 ? port : 3000,
                                        });
                                        Program.Log("versions parse: block=" + block + " -> id=" + id + " port=" + port);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            catch (Exception e) { Program.Log("versions load failed: " + e.Message); }

            // 首次运行：把「当前目录」登记成唯一版本 —— 老安装包不用改结构就能继续玩
            if (Entries.Count == 0)
            {
                Entries.Add(new VersionEntry { Id = "local", Name = "当前目录（内置）", Dir = ".", Port = 3000 });
                ActiveId = "local";
                Save();
                Program.Log("versions: 初始化注册表（当前目录 + 端口 3000）");
            }
            if (Find(ActiveId) == null) ActiveId = Entries[0].Id;
        }

        public static void Save()
        {
            try
            {
                var sb = new StringBuilder();
                sb.Append("{\"active\":\"").Append(Host.Esc(ActiveId)).Append("\",\"versions\":[");
                for (var i = 0; i < Entries.Count; i++)
                {
                    var e = Entries[i];
                    if (i > 0) sb.Append(',');
                    sb.Append("{\"id\":\"").Append(Host.Esc(e.Id))
                      .Append("\",\"name\":\"").Append(Host.Esc(e.Name))
                      .Append("\",\"dir\":\"").Append(Host.Esc(e.Dir))
                      .Append("\",\"port\":").Append(e.Port).Append('}');
                }
                sb.Append("]}");
                File.WriteAllText(FilePath, sb.ToString(), new UTF8Encoding(false));
            }
            catch (Exception e) { Program.Log("versions save failed: " + e.Message); }
        }

        public static VersionEntry Find(string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            foreach (var e in Entries) if (e.Id == id) return e;
            return null;
        }

        public static VersionEntry Active { get { var e = Find(ActiveId); return e ?? (Entries.Count > 0 ? Entries[0] : null); } }

        /// <summary>这个目录是不是一个游戏（能开服）—— 包含 server\index.js。</summary>
        public static bool LooksLikeGame(string dir)
        {
            return !string.IsNullOrEmpty(dir) && File.Exists(Path.Combine(dir, "server", "index.js"));
        }

        /** 找一个没被占用的端口（从 3000 起，逐 10 递增，避开 3000 默认值）。 */
        public static int FreePort()
        {
            for (var p = 3010; p < 3200; p += 10)
            {
                var used = false;
                foreach (var e in Entries) if (e.Port == p) used = true;
                if (!used && !Host.PortOpen(p)) return p;
            }
            return 3999;
        }

        /** 登记一个已存在的游戏目录。返回新条目，失败返回 null。 */
        public static VersionEntry Add(string dir, string name)
        {
            try
            {
                var full = Path.GetFullPath(dir).TrimEnd('\\');
                foreach (var e in Entries)
                    if (string.Equals(e.FullDir.TrimEnd('\\'), full, StringComparison.OrdinalIgnoreCase)) return e;
                var folder = Path.GetFileName(full);
                var id = (name.Length > 0 ? name : folder).ToLowerInvariant();
                var clean = new StringBuilder();
                foreach (var ch in id)
                {
                    if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) clean.Append(ch);
                    else if (clean.Length > 0 && clean[clean.Length - 1] != '-') clean.Append('-');
                }
                var slug = clean.ToString().Trim('-');
                if (slug.Length == 0) slug = "version";
                var unique = slug;
                var n = 2;
                while (Find(unique) != null) { unique = slug + "-" + n; n++; }
                var entry = new VersionEntry { Id = unique, Name = name.Length > 0 ? name : folder, Dir = full, Port = FreePort() };
                Entries.Add(entry);
                Save();
                Program.Log("versions: 导入 " + entry.Id + " -> " + full + " :" + entry.Port);
                return entry;
            }
            catch (Exception e) { Program.Log("versions add failed: " + e.Message); return null; }
        }
    }

    internal sealed class LauncherForm : Form
    {
        private readonly WebView2 _web;
        private readonly Label _splash;
        private NotifyIcon _tray;
        private readonly string _launcherDir;
        private readonly string _configFile;
        /// <summary>每个版本一个 node 进程（业主 2026-11-22：允许同时跑多个版本，各占一个端口）。</summary>
        private readonly Dictionary<string, Process> _runs = new Dictionary<string, Process>();
        private bool _navigatedToGame;

        private const int GAME_PORT = 3000;
        private const string GAME_URL = "http://127.0.0.1:3000/";

        public LauncherForm()
        {
            _launcherDir = Path.Combine(Program.Root, "launcher");
            _configFile = Path.Combine(Program.Root, "launcher-config.json");

            Text = "卫戍协议：盟约 · 电脑版";
            var lv = Program.LauncherVersion();
            if (lv.Length > 0) Text += "（启动器 v" + lv + "）";
            Width = 1296;
            Height = 939;
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(720, 520);
            BackColor = Color.FromArgb(11, 15, 14);
            try { Icon = Icon.ExtractAssociatedIcon(Path.Combine(Program.Root, "Stronghold.exe")); } catch { }

            _web = new WebView2 { Dock = DockStyle.Fill, Visible = false, DefaultBackgroundColor = Color.FromArgb(11, 15, 14) };
            Controls.Add(_web);

            // 启动闪屏（业主 2026-11-22：这个提示词不见了，做回来）
            // 与旧宿主一致：WebView2 起来之前先显示「正在启动内置浏览器…」，就绪后自动隐藏。
            _splash = new Label
            {
                Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleCenter,
                Text = "正在启动内置浏览器…",
                ForeColor = Color.FromArgb(123, 240, 176),
                BackColor = Color.FromArgb(11, 15, 14),
                Font = new Font("Microsoft YaHei", 11f),
            };
            Controls.Add(_splash);
            _splash.BringToFront();

            Load += async (s, e) => await InitAsync();
            FormClosing += (s, e) => { SaveBounds(); try { if (_tray != null) { _tray.Visible = false; _tray.Dispose(); } } catch { } StopNode(); };
            // 业主 2026-11-22 Q-07：最小化到托盘
            Resize += (s, e) => { if (WindowState == FormWindowState.Minimized) HideToTray(); };
            SetupTray();
            RestoreWindowBounds();
        }

        private async Task InitAsync()
        {
            try
            {
                var userData = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "StrongholdProtocol", "WebView2", "EBWebView");
                Directory.CreateDirectory(userData);
                SetSplash("正在启动内置浏览器…");
                var env = await CoreWebView2Environment.CreateAsync(null, userData);
                SetSplash("正在载入启动页…");
                await _web.EnsureCoreWebView2Async(env);

                var core = _web.CoreWebView2;
                core.Settings.AreDefaultContextMenusEnabled = false;
                // 旧日志里的 webview args
                try { core.Settings.IsStatusBarEnabled = false; } catch { }
                core.SetVirtualHostNameToFolderMapping("app.local", _launcherDir, CoreWebView2HostResourceAccessKind.Allow);
                core.WebMessageReceived += OnWebMessage;
                core.NavigationStarting += OnNavigationStarting;
                core.DocumentTitleChanged += (s, e) =>
                {
                    // 页面标题会覆盖窗口标题：把启动器版本号接回去，免得和游戏版本混淆
                    try
                    {
                        var lv = Program.LauncherVersion();
                        Text = core.DocumentTitle + (lv.Length > 0 ? "（启动器 v" + lv + "）" : "");
                    }
                    catch { }
                };

                // JS 错误回传（旧日志 JS ERROR ...）
                try
                {
                    await core.AddScriptToExecuteOnDocumentCreatedAsync(
                        "window.onerror=function(m,s,l,c,e){try{window.chrome.webview.postMessage({t:'js-error',text:String(m)+' @ '+String(s)+':'+String(l)});}catch(_){}};");
                }
                catch { }

                Program.Log("webview ready; root=" + Program.Root);
                // 内置浏览器就绪 → 收起闪屏，显示页面
                HideSplash();
                core.Navigate("https://app.local/index.html");
                PushConfig(core);

                // 业主 2026-11-21「启动软件就弹」：宿主启动即取公告，页面一就绪就推过去
                StartAnnouncementPrefetch();
                // 业主 2026-11-22：启动即检查热更新（只更新代码，不含美术资源）
                StartUpdateCheck();

                // 预热本地服务器（旧日志 warm node started）
                StartLocal(true);

                // 本地资源扫描（旧界面 本地资源 53673/53673）
                StartArtScan(core);
            }
            catch (Exception e)
            {
                Program.Log("webview init failed: " + e.Message);
                // 业主 2026-11-22：运行时不再随包，缺了要**说清楚怎么装**，而不是丢一句异常
                var missing = Program.SystemWebView2Version().Length == 0;
                var hint = missing
                    ? "未检测到 WebView2 运行时。\r\n本启动器已不再自带它，请先安装微软官方的「Microsoft Edge WebView2 Runtime」（常青版，约 2 MB）后重试：\r\nhttps://go.microsoft.com/fwlink/p/?LinkId=2124703\r\n\r\n"
                    : "";
                SetSplash("内置浏览器启动失败：\r\n" + hint + e.Message);
                if (missing)
                {
                    try { Process.Start("https://go.microsoft.com/fwlink/p/?LinkId=2124703"); } catch { }
                }
            }
        }

        private void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            Program.Log("nav -> " + e.Uri);
            // 原版会拦下页面对游戏页的导航、改走 loading 页；这里只做记录，不拦（避免再次引入 :3000 之类的改写）
        }

        private void PushConfig(CoreWebView2 core)
        {
            string server = "", list = "", listBackup = "", listBackup2 = "";
            try
            {
                var raw = File.ReadAllText(_configFile, Encoding.UTF8);
                server = Host.JsonValue(raw, "server");
                list = Host.JsonValue(raw, "list");
                listBackup = Host.JsonValue(raw, "listBackup");
                listBackup2 = Host.JsonValue(raw, "listBackup2");
            }
            catch { }
            var json = "{\"t\":\"config\",\"server\":\"" + Host.Esc(server) + "\",\"list\":\"" + Host.Esc(list)
                     + "\",\"listBackup\":\"" + Host.Esc(listBackup) + "\",\"listBackup2\":\"" + Host.Esc(listBackup2) + "\"}";
            try { core.PostWebMessageAsJson(json); } catch (Exception e) { Program.Log("post config failed: " + e.Message); }
        }

        private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            var raw = e.WebMessageAsJson;
            var t = Host.JsonValue(raw, "t");
            if (t != "js-error" && t != "art") Program.Log("msg " + raw);

            if (t == "js-error")
            {
                Program.Log("JS ERROR " + Host.JsonValue(raw, "text"));
                return;
            }
            if (t == "ready" || t == "config")
            {
                PushConfig(_web.CoreWebView2);
                PushVersions();
                // 页面就绪后回报本地资源进度（旧界面那一行）
                ReportArtNow();
                // 页面可能错过了启动时的推送，这里补发一次公告与更新状态
                StartAnnouncementPrefetch();
                ResendUpdateState();
                return;
            }
            if (t == "quit")
            {
                StopNode();
                Close();
                return;
            }
            if (t == "save-server")
            {
                SaveServer(Host.JsonValue(raw, "addr"));
                return;
            }
            if (t == "start-remote")
            {
                var addr = Host.JsonValue(raw, "addr");
                var url = BuildUrl(addr);
                Program.Log("enter server " + addr + " -> " + url);
                _navigatedToGame = true;
                if (!string.IsNullOrEmpty(url)) _web.CoreWebView2.Navigate(url);
                return;
            }
            if (t == "update-check") { StartUpdateCheck(); return; }
            if (t == "update-now") { ApplyUpdate(); return; }
            if (t == "restart-server") { RestartLocalServer(); Send("{\"t\":\"status\",\"text\":\"本地服务器已重启\"}"); return; }
            if (t == "start-local")
            {
                StartLocal(false);
                WaitServerThenEnter();
                return;
            }
            if (t == "fetch")
            {
                // 代取（业主 2026-11-21）：页面是 https://app.local，取 http://8.134.50.56 的公告会被混合内容拦，
                // 由宿主发请求再回传。只允许 http/https，且限制响应大小。
                var id = Host.JsonValue(raw, "id");
                var url = Host.JsonValue(raw, "url");
                Task.Run(delegate
                {
                    var body = Host.FetchText(url, 8 * 1024 * 1024);
                    Send("{\"t\":\"fetch-ok\",\"id\":\"" + Host.Esc(id) + "\",\"body\":\"" + Host.Esc(body) + "\"}");
                });
                return;
            }
            if (t == "exportlog")
            {
                // 「导出日志」按钮：把 launcher.log 复制到桌面
                try
                {
                    var src = Path.Combine(Program.Root, "launcher.log");
                    var dst = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
                        "launcher-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".log");
                    File.Copy(src, dst, true);
                    Program.Log("exportlog -> " + dst);
                    Send("{\"t\":\"status\",\"text\":\"日志已导出到桌面：" + Host.Esc(Path.GetFileName(dst)) + "\"}");
                }
                catch (Exception ex) { Program.Log("exportlog failed: " + ex.Message); }
                return;
            }
            if (t == "start-public")
            {
                StartLocal(false);
                var port = ActivePort;
                Task.Delay(1500).ContinueWith(delegate
                {
                    try { BeginInvoke(new Action(delegate { _web.CoreWebView2.Navigate("http://127.0.0.1:" + port + "/admin"); })); } catch { }
                });
                return;
            }
            // ---- 多版本（业主 2026-11-22：启动器独立于游戏版本，可分别开服/游玩）----
            if (t == "versions") { PushVersions(); return; }
            if (t == "fs-list") { SendFsList(Host.JsonValue(raw, "path") ?? ""); return; }
            if (t == "fs-detail")
            {
                var dpath = Host.JsonValue(raw, "path") ?? "";
                Task.Run(delegate { SendFsDetail(dpath); });
                return;
            }
            if (t == "version-import")
            {
                var dir = Host.JsonValue(raw, "dir") ?? "";
                if (dir.Length == 0) { PickVersionFolder(); return; }
                if (!VersionStore.LooksLikeGame(dir))
                {
                    Send("{\"t\":\"version-status\",\"kind\":\"bad\",\"text\":\"这个目录不是游戏目录（缺 server/index.js）\"}");
                    return;
                }
                var added = VersionStore.Add(dir, Host.JsonValue(raw, "name") ?? "");
                if (added == null) { Send("{\"t\":\"version-status\",\"kind\":\"bad\",\"text\":\"导入失败，看日志\"}"); return; }
                Send("{\"t\":\"version-status\",\"kind\":\"ok\",\"text\":\"已导入 " + Host.Esc(added.Name) + "（端口 " + added.Port + "）\"}");
                PushVersions();
                return;
            }
            if (t == "version-active")
            {
                var id = Host.JsonValue(raw, "id");
                if (VersionStore.Find(id) != null)
                {
                    VersionStore.ActiveId = id;
                    VersionStore.Save();
                    Program.Log("versions: 当前版本 -> " + id);
                    PushVersions();
                }
                return;
            }
            if (t == "version-start")
            {
                var target = VersionStore.Find(Host.JsonValue(raw, "id"));
                StartVersion(target, false);
                var entry = target;
                Task.Run(delegate
                {
                    if (entry == null) return;
                    for (var i = 0; i < 90; i++)
                    {
                        if (Host.Probe("http://127.0.0.1:" + entry.Port + "/healthz", 1200))
                        {
                            Send("{\"t\":\"version-status\",\"id\":\"" + Host.Esc(entry.Id) + "\",\"kind\":\"ok\",\"text\":\"" + Host.Esc(entry.Name) + " 已就绪（端口 " + entry.Port + "）\"}");
                            PushVersions();
                            return;
                        }
                        Thread.Sleep(500);
                    }
                    Send("{\"t\":\"version-status\",\"id\":\"" + Host.Esc(entry.Id) + "\",\"kind\":\"bad\",\"text\":\"启动超时，看日志\"}");
                });
                return;
            }
            if (t == "version-stop") { StopVersion(Host.JsonValue(raw, "id")); return; }
            if (t == "version-remove")
            {
                var rid = Host.JsonValue(raw, "id");
                if (rid == VersionStore.ActiveId) { Send("{\"t\":\"version-status\",\"kind\":\"bad\",\"text\":\"当前版本不能删除，先切到别的版本\"}"); return; }
                StopVersion(rid);
                for (var i = VersionStore.Entries.Count - 1; i >= 0; i--)
                    if (VersionStore.Entries[i].Id == rid) VersionStore.Entries.RemoveAt(i);
                VersionStore.Save();
                PushVersions();
                return;
            }
            if (t == "version-enter")
            {
                var ev = VersionStore.Find(Host.JsonValue(raw, "id"));
                if (ev == null) return;
                VersionStore.ActiveId = ev.Id;
                VersionStore.Save();
                StartVersion(ev, false);
                var url = "http://127.0.0.1:" + ev.Port + "/";
                Task.Run(delegate
                {
                    for (var i = 0; i < 120; i++)
                    {
                        if (Host.Probe(url + "healthz", 1200))
                        {
                            try { BeginInvoke(new Action(delegate { _navigatedToGame = true; _web.CoreWebView2.Navigate(url); })); } catch { }
                            return;
                        }
                        Thread.Sleep(500);
                    }
                });
                return;
            }
            if (t == "open-list")
            {
                var list = Host.JsonValue(raw, "url");
                if (string.IsNullOrEmpty(list)) list = Host.JsonValue(File.Exists(_configFile) ? File.ReadAllText(_configFile) : "", "list");
                if (!string.IsNullOrEmpty(list)) OpenServerList(list);
                return;
            }
        }

        // ---- 服务器列表：探测 → 打开（旧日志 probe error / list unreachable / list-test click sent）----
        //
        // 业主 2026-11-22：探测改并行。
        // 旧版是串行 foreach + Host.Probe(url, 6000)：三站里前两站不通时要**等两次超时**（最坏 18 秒）
        // 才轮到第三站，玩家看到的就是「点服务器游玩之后卡住十几秒」。
        // 现在所有候选同时探，然后**按原来的优先顺序**逐个取结果：
        //   * 主站活着 → 300ms 就进去，和以前一样，不会为了等备站而多等；
        //   * 主站死了 → 备站大概率早就探完了，最坏总耗时从 18 秒降到约 6 秒（一次超时）。
        // 站点顺序（Q-02「保持现有顺序不动」）在这里没有被改动：并行只影响等待时间，不影响选谁。
        private const int ListProbeTimeoutMs = 6000;

        private void OpenServerList(string primary)
        {
            var cfg = File.Exists(_configFile) ? File.ReadAllText(_configFile) : "";
            var candidates = new List<string>();
            candidates.Add(primary);
            foreach (var k in new[] { "list", "listBackup", "listBackup2" })
            {
                var v = Host.JsonValue(cfg, k);
                if (!string.IsNullOrEmpty(v) && !candidates.Contains(v)) candidates.Add(v);
            }
            Task.Run(delegate
            {
                var started = DateTime.UtcNow;
                var n = candidates.Count;
                var results = new bool[n];
                var tasks = new Task[n];
                for (var i = 0; i < n; i++)
                {
                    var idx = i;              // 闭包捕获的是这个副本，不是循环变量
                    var url = candidates[i];
                    Program.Log("probe " + url);
                    tasks[i] = Task.Factory.StartNew(delegate
                    {
                        try { results[idx] = Host.Probe(url, ListProbeTimeoutMs); }
                        catch (Exception ex) { Program.Log("probe threw " + url + ": " + ex.Message); results[idx] = false; }
                    });
                }
                // 按优先顺序取结果：等第一个的时候其余几个在并行跑，所以「主站活」不会变慢
                for (var i = 0; i < n; i++)
                {
                    try { tasks[i].Wait(ListProbeTimeoutMs + 2000); } catch { /* 探测线程自己会记日志 */ }
                    var ms = (int)(DateTime.UtcNow - started).TotalMilliseconds;
                    if (!results[i]) { Program.Log("probe error " + candidates[i] + " (" + ms + "ms)"); continue; }
                    Program.Log("list ok " + candidates[i] + " (" + ms + "ms, " + n + " 个候选并行)");
                    var target = candidates[i];
                    try { BeginInvoke(new Action(delegate { _web.CoreWebView2.Navigate(target); })); } catch { }
                    return;
                }
                Program.Log("list unreachable (" + (int)(DateTime.UtcNow - started).TotalMilliseconds + "ms, " + n + " 个候选并行)");
            });
        }

        // ---- 本地服务器（按版本起停，可同时跑多个） ----
        private int ActivePort { get { var e = VersionStore.Active; return e != null ? e.Port : GAME_PORT; } }
        private string ActiveUrl { get { return "http://127.0.0.1:" + ActivePort + "/"; } }

        private void StartLocal(bool warm) { StartVersion(VersionStore.Active, warm); }

        private bool RunningOf(VersionEntry entry)
        {
            if (entry == null) return false;
            Process p;
            if (_runs.TryGetValue(entry.Id, out p) && p != null && !p.HasExited) return true;
            return Host.PortOpen(entry.Port);
        }

        private void StartVersion(VersionEntry entry, bool warm)
        {
            if (entry == null) return;
            if (RunningOf(entry))
            {
                Program.Log((warm ? "warm" : "start") + ": " + entry.Id + " 已在运行（端口 " + entry.Port + "）");
                return;
            }
            try
            {
                var dir = entry.FullDir;
                if (!VersionStore.LooksLikeGame(dir))
                {
                    Program.Log("start " + entry.Id + " 失败：目录里没有 server\\index.js（" + dir + "）");
                    Send("{\"t\":\"version-status\",\"id\":\"" + Host.Esc(entry.Id) + "\",\"kind\":\"bad\",\"text\":\"这个目录不是游戏目录（缺 server/index.js）\"}");
                    return;
                }
                // 版本目录里可能不自带 node（别人给的游戏目录），依次回退：本目录 → 启动器根目录 → 系统 node
                var node = Path.Combine(dir, "node", "node.exe");
                if (!File.Exists(node)) node = Path.Combine(Program.Root, "node", "node.exe");
                if (!File.Exists(node)) node = Host.FindNode(dir);
                Program.Log("node activated rc=0 out=" + Host.NodeVersion(node));
                var psi = new ProcessStartInfo(node, "server/index.js")
                {
                    WorkingDirectory = dir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                psi.EnvironmentVariables["PORT"] = entry.Port.ToString();
                var p = new Process { StartInfo = psi };
                p.OutputDataReceived += (s, e) => { if (e.Data != null) Program.Log("node[" + entry.Id + "]: " + e.Data); };
                p.ErrorDataReceived += (s, e) => { if (e.Data != null) Program.Log("node![" + entry.Id + "] " + e.Data); };
                p.Start();
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                _runs[entry.Id] = p;
                Program.Log((warm ? "warm node started pid " : "node started pid ") + p.Id + " [" + entry.Id + ":" + entry.Port + "]");
                PushVersions();
            }
            catch (Exception e) { Program.Log("start-local failed: " + e.Message); }
        }

        private void StopVersion(string id)
        {
            Process p;
            if (_runs.TryGetValue(id, out p))
            {
                try { if (p != null && !p.HasExited) p.Kill(); } catch { }
                _runs.Remove(id);
                Program.Log("stopped " + id);
            }
            var entry = VersionStore.Find(id);
            if (entry != null && Host.PortOpen(entry.Port))
            {
                var killed = Host.KillPortOwner(entry.Port, Program.Log);
                Program.Log("stopped " + id + "（结束占用端口 " + entry.Port + " 的 " + killed + " 个进程）");
            }
            PushVersions();
        }

        /// <summary>把版本列表与运行状态推给页面。</summary>
        private void PushVersions()
        {
            var sb = new StringBuilder();
            sb.Append("{\"t\":\"versions\",\"active\":\"").Append(Host.Esc(VersionStore.ActiveId)).Append("\",\"items\":[");
            for (var i = 0; i < VersionStore.Entries.Count; i++)
            {
                var e = VersionStore.Entries[i];
                if (i > 0) sb.Append(',');
                sb.Append("{\"id\":\"").Append(Host.Esc(e.Id))
                  .Append("\",\"name\":\"").Append(Host.Esc(e.Name))
                  .Append("\",\"dir\":\"").Append(Host.Esc(e.FullDir))
                  .Append("\",\"port\":").Append(e.Port)
                  .Append(",\"running\":").Append(RunningOf(e) ? "true" : "false")
                  .Append(",\"game\":").Append(VersionStore.LooksLikeGame(e.FullDir) ? "true" : "false")
                  .Append('}');
            }
            sb.Append("]}");
            Send(sb.ToString());
        }

        /// <summary>
        /// 目录列举（业主 2026-11-22：不再用系统文件夹对话框，改成页面里那套「UI 编辑器选择器」样式的界面）。
        /// path 为空 → 列驱动器；否则列该目录下的子目录，并标出哪些是游戏目录。
        /// </summary>
        private void SendFsList(string path)
        {
            var sb = new StringBuilder();
            sb.Append("{\"t\":\"fs\",\"path\":\"");
            try
            {
                sb.Append(Host.Esc(path)).Append("\",\"parent\":\"");
                var items = new List<string>();
                if (string.IsNullOrEmpty(path))
                {
                    foreach (var d in DriveInfo.GetDrives())
                    {
                        try
                        {
                            if (!d.IsReady) continue;
                            items.Add("{\"name\":\"" + Host.Esc(d.Name) + "\",\"path\":\"" + Host.Esc(d.RootDirectory.FullName)
                                + "\",\"game\":false,\"drive\":true,\"free\":\"" + (d.AvailableFreeSpace / (1024L * 1024L * 1024L)) + " GB\"}");
                        }
                        catch { }
                    }
                    sb.Append("\",\"items\":[");
                }
                else
                {
                    var full = Path.GetFullPath(path);
                    var parent = Path.GetDirectoryName(full.TrimEnd('\\'));
                    sb.Append(Host.Esc(parent ?? "")).Append("\",\"items\":[");
                    var dirs = Directory.GetDirectories(full);
                    Array.Sort(dirs, StringComparer.OrdinalIgnoreCase);
                    var first = true;
                    foreach (var d in dirs)
                    {
                        if (!first) items.Add(null);   // 占位，下面统一拼接
                        items.Add("{\"name\":\"" + Host.Esc(Path.GetFileName(d)) + "\",\"path\":\"" + Host.Esc(d)
                            + "\",\"game\":" + (VersionStore.LooksLikeGame(d) ? "true" : "false") + "}");
                        first = false;
                    }
                    items.RemoveAll(x => x == null);
                }
                sb.Append(string.Join(",", items.ToArray())).Append("]}");
            }
            catch (Exception e)
            {
                sb.Append(Host.Esc(path)).Append("\",\"parent\":\"\",\"error\":\"").Append(Host.Esc(e.Message)).Append("\",\"items\":[]}");
            }
            Send(sb.ToString());
        }

        /// <summary>
        /// 一个目录的「整体情况」（业主 2026-11-22：可用的游戏文件夹要标出包内版本与规模）。
        /// 目录可能上 GB，统计有 3 秒预算，超时返回 partial=true 的近似值。
        /// </summary>
        private void SendFsDetail(string path)
        {
            Program.Log("fs-detail ask " + path);
            var version = "";
            var files = 0L;
            var bytes = 0L;
            var partial = false;
            var hasNode = false;
            var hasData = false;
            var hasAssets = false;
            try
            {
                if (string.IsNullOrEmpty(path) || !Directory.Exists(path))
                {
                    Send("{\"t\":\"fs-detail\",\"path\":\"" + Host.Esc(path) + "\",\"error\":\"目录不存在\",\"game\":false}");
                    return;
                }
                hasNode = File.Exists(Path.Combine(path, "node", "node.exe"));
                hasData = Directory.Exists(Path.Combine(path, "data"));
                hasAssets = Directory.Exists(Path.Combine(path, "public", "assets"));
                // 版本：package.json 里第一个 version（注意后面 extraMetadata 还有一份）
                try
                {
                    var pkg = Path.Combine(path, "package.json");
                    if (File.Exists(pkg))
                    {
                        var txt = File.ReadAllText(pkg, Encoding.UTF8);
                        var idx = txt.IndexOf("\"version\"", StringComparison.Ordinal);
                        if (idx >= 0)
                        {
                            var c = txt.IndexOf(':', idx);
                            var q1 = c >= 0 ? txt.IndexOf('"', c) : -1;
                            var q2 = q1 >= 0 ? txt.IndexOf('"', q1 + 1) : -1;
                            if (q1 >= 0 && q2 > q1) version = txt.Substring(q1 + 1, q2 - q1 - 1).Trim();
                        }
                    }
                }
                catch { }
                var sw = Stopwatch.StartNew();
                var stack = new Stack<string>();
                stack.Push(path);
                var seen = 0;
                while (stack.Count > 0)
                {
                    if (sw.ElapsedMilliseconds > 2000) { partial = true; break; }
                    var dir = stack.Pop();
                    try
                    {
                        foreach (var f in Directory.EnumerateFiles(dir))
                        {
                            files++;
                            // 每 500 个文件检查一次预算：单个目录里可能有几万个文件，只在目录边界检查会卡很久
                            if ((++seen % 500) == 0 && sw.ElapsedMilliseconds > 2000) { partial = true; break; }
                            try { bytes += new FileInfo(f).Length; } catch { }
                        }
                        if (partial) break;
                        foreach (var d in Directory.EnumerateDirectories(dir)) stack.Push(d);
                    }
                    catch { }
                }
            }
            catch (Exception e)
            {
                Program.Log("fs-detail failed: " + e.GetType().Name + " " + e.Message);
                Send("{\"t\":\"fs-detail\",\"path\":\"" + Host.Esc(path) + "\",\"error\":\"" + Host.Esc(e.Message) + "\",\"game\":false}");
                return;
            }
            var json = "{\"t\":\"fs-detail\",\"path\":\"" + Host.Esc(path) + "\",\"game\":" + (VersionStore.LooksLikeGame(path) ? "true" : "false")
                + ",\"version\":\"" + Host.Esc(version) + "\",\"files\":" + files + ",\"bytes\":" + bytes
                + ",\"partial\":" + (partial ? "true" : "false")
                + ",\"node\":" + (hasNode ? "true" : "false") + ",\"data\":" + (hasData ? "true" : "false")
                + ",\"assets\":" + (hasAssets ? "true" : "false") + "}";
            Program.Log("fs-detail send " + json.Length + "B partial=" + partial + " files=" + files);
            Send(json);
        }

        /// <summary>导入一个游戏目录（老路径：宿主自带文件夹对话框；页面选择器走 version-import + dir）。</summary>
        private void PickVersionFolder()
        {
            try
            {
                using (var dlg = new FolderBrowserDialog())
                {
                    dlg.Description = "选择游戏根目录（包含 server/index.js 的那一层）";
                    dlg.ShowNewFolderButton = false;
                    if (dlg.ShowDialog(this) != DialogResult.OK) return;
                    var dir = dlg.SelectedPath;
                    if (!VersionStore.LooksLikeGame(dir))
                    {
                        Send("{\"t\":\"version-status\",\"kind\":\"bad\",\"text\":\"这个目录不是游戏目录（缺 server/index.js）\"}");
                        return;
                    }
                    var entry = VersionStore.Add(dir, "");
                    if (entry == null) { Send("{\"t\":\"version-status\",\"kind\":\"bad\",\"text\":\"导入失败，看日志\"}"); return; }
                    Send("{\"t\":\"version-status\",\"kind\":\"ok\",\"text\":\"已导入 " + Host.Esc(entry.Name) + "（端口 " + entry.Port + "）\"}");
                    PushVersions();
                }
            }
            catch (Exception e) { Program.Log("pick folder failed: " + e.Message); }
        }

        /// <summary>轮询 /healthz，就绪后回报 boot / server-started 并进入游戏。</summary>
        private void WaitServerThenEnter()
        {
            if (_navigatedToGame) return;
            Task.Run(delegate
            {
                var started = DateTime.UtcNow;
                for (var i = 0; i < 120; i++)
                {
                    if (Host.Probe(ActiveUrl + "healthz", 1500))
                    {
                        var ms = (int)(DateTime.UtcNow - started).TotalMilliseconds;
                        Send("{\"t\":\"boot\",\"text\":\"服务器已就绪，正在进入游戏…\",\"pct\":100}");
                        Send("{\"t\":\"server-started\",\"lan\":\"" + Host.Esc(Host.LanUrls(ActivePort)) + "\",\"ms\":" + ms + "}");
                        Program.Log("boot 100% 服务器已就绪，正在进入游戏… (" + ActiveUrl + ")");
                        _navigatedToGame = true;
                        try { BeginInvoke(new Action(delegate { _web.CoreWebView2.Navigate(ActiveUrl); })); } catch { }
                        return;
                    }
                    Thread.Sleep(500);
                    if (i % 4 == 0) Send("{\"t\":\"boot\",\"text\":\"正在启动本地服务器…\",\"pct\":" + Math.Min(90, 10 + i) + "}");
                }
                Send("{\"t\":\"error\",\"text\":\"本地服务器启动超时（60 秒）\"}");
                Program.Log("local server timeout");
            });
        }

        /// <summary>托盘图标 + 右键菜单（业主 2026-11-22 Q-07）。</summary>
        private void SetupTray()
        {
            try
            {
                var icon = Icon;
                try { icon = Icon.ExtractAssociatedIcon(Path.Combine(Program.Root, "Stronghold.exe")) ?? Icon; } catch { }
                _tray = new NotifyIcon
                {
                    Icon = icon ?? SystemIcons.Application,
                    Text = "卫戍协议：盟约 · 电脑版",
                    Visible = true,
                };
                var menu = new ContextMenuStrip();
                menu.Items.Add("显示启动器", null, delegate { ShowFromTray(); });
                menu.Items.Add(new ToolStripSeparator());
                menu.Items.Add("重启本地服务器", null, delegate { RestartLocalServer(); ShowFromTray(); });
                menu.Items.Add("打开后台", null, delegate
                {
                    try { Process.Start("http://127.0.0.1:" + ActivePort + "/admin"); } catch { }
                });
                menu.Items.Add(new ToolStripSeparator());
                menu.Items.Add("退出", null, delegate { _tray.Visible = false; Close(); });
                _tray.ContextMenuStrip = menu;
                _tray.DoubleClick += delegate { ShowFromTray(); };
                Program.Log("tray icon ready");
            }
            catch (Exception e) { Program.Log("tray setup failed: " + e.Message); }
        }

        private void HideToTray()
        {
            try
            {
                Hide();
                ShowInTaskbar = false;
                if (_tray != null)
                {
                    _tray.Visible = true;
                    try { _tray.ShowBalloonTip(1500, "卫戍协议：盟约", "已最小化到托盘，双击图标可以恢复。", ToolTipIcon.Info); } catch { }
                }
                Program.Log("minimized to tray");
            }
            catch { }
        }

        private void ShowFromTray()
        {
            try
            {
                ShowInTaskbar = true;
                Show();
                WindowState = FormWindowState.Normal;
                Activate();
            }
            catch { }
        }

        private string BoundsFile { get { return Path.Combine(Program.Root, "data", "launcher-window.json"); } }

        /// <summary>记住窗口位置与大小（业主 2026-11-22 Q-07）。</summary>
        private void SaveBounds()
        {
            try
            {
                var max = WindowState == FormWindowState.Maximized;
                var b = max ? RestoreBounds : Bounds;
                Directory.CreateDirectory(Path.GetDirectoryName(BoundsFile));
                File.WriteAllText(BoundsFile,
                    "{\"x\":" + b.X + ",\"y\":" + b.Y + ",\"w\":" + b.Width + ",\"h\":" + b.Height + ",\"max\":" + (max ? "true" : "false") + "}",
                    new UTF8Encoding(false));
                Program.Log("bounds saved " + b.Width + "x" + b.Height + " max=" + max);
            }
            catch { }
        }

        private void RestoreWindowBounds()
        {
            try
            {
                if (!File.Exists(BoundsFile)) return;
                var raw = File.ReadAllText(BoundsFile, Encoding.UTF8);
                var w = (int)Host.JsonNumber(raw, "w", 0);
                var h = (int)Host.JsonNumber(raw, "h", 0);
                var x = (int)Host.JsonNumber(raw, "x", 0);
                var y = (int)Host.JsonNumber(raw, "y", 0);
                var max = Host.JsonValue(raw, "max") == "true" || raw.IndexOf("\"max\":true", StringComparison.Ordinal) >= 0;
                if (w < 800 || h < 560) return;
                var rect = new Rectangle(x, y, w, h);
                var visible = false;
                foreach (var scr in Screen.AllScreens) { if (scr.WorkingArea.IntersectsWith(rect)) { visible = true; break; } }
                if (!visible) return;
                StartPosition = FormStartPosition.Manual;
                Bounds = rect;
                if (max) WindowState = FormWindowState.Maximized;
                Program.Log("bounds restored " + w + "x" + h + " max=" + max);
            }
            catch { }
        }

        private void Send(string json)
        {
            try { BeginInvoke(new Action(delegate { try { _web.CoreWebView2.PostWebMessageAsJson(json); } catch { } })); } catch { }
        }

        /// <summary>显示/更新启动闪屏（「正在启动内置浏览器…」）。</summary>
        private void SetSplash(string text)
        {
            try
            {
                if (_splash == null) return;
                if (InvokeRequired) { BeginInvoke(new Action(delegate { SetSplash(text); })); return; }
                _splash.Visible = true;
                _splash.BringToFront();
                _splash.Text = text;
                Program.Log("splash: " + text);
            }
            catch { }
        }

        /// <summary>收起闪屏，把 WebView2 显示出来。</summary>
        private void HideSplash()
        {
            try
            {
                if (_splash == null) return;
                if (InvokeRequired) { BeginInvoke(new Action(HideSplash)); return; }
                _splash.Visible = false;
                _web.Visible = true;
                _web.BringToFront();
                Program.Log("splash hidden (webview shown)");
            }
            catch { }
        }
        // ---- 热更新（业主 2026-11-22「拆分启动器热更」）----
        // 两条**互相独立**的通道，各自白名单、各自版本标记、各自解压根目录：
        //   launcher：只含 launcher/（启动页）→ 解压到启动器根目录 → 应用后**只重载页面**，不动 node；
        //   game    ：游戏代码 → 解压到**当前选中的游戏目录** → 应用后重启那个版本的 node。
        // 这样「换启动器界面」不会逼游戏重启，「改游戏代码」也不会去碰启动器文件。
        // 铁律不变：任何一条通道都只收代码/配置类文件，美术资源一律拒绝。
        private static readonly string[] LauncherPkgDirs = { "launcher/" };
        private static readonly string[] UpdateAllowedExt = { ".js", ".mjs", ".css", ".html", ".json", ".txt", ".md" };

        /// <summary>
        /// 热更总开关（业主 2026-11-22 二次口径）：`data/update-channel.json` 的 enabled 必须为 true 才联网检查。
        /// **文件不存在 = 关闭**（fail-closed）。分发版一律带 `enabled:false`，只有业主自己那套开着。
        /// 另外「游戏代码」通道已按业主要求**关闭**：这里只剩「启动器页面」一条，且只覆盖 launcher/。
        /// </summary>
        private static bool UpdateChannelEnabled()
        {
            try
            {
                var file = Path.Combine(Program.Root, "data", "update-channel.json");
                var raw = File.ReadAllText(file, Encoding.UTF8);
                return Host.JsonBool(raw, "enabled", false);
            }
            catch { return false; }
        }

        private string VersionFileOf()
        {
            return Path.Combine(Program.Root, "data", "launcher-version.json");
        }

        private string LocalVersion()
        {
            try
            {
                var raw = File.ReadAllText(VersionFileOf(), Encoding.UTF8);
                var v = Host.JsonValue(raw, "version");
                return v ?? "";
            }
            catch { return ""; }
        }

        private void StartUpdateCheck()
        {
            // 分发版封死：不联网、不提示，只在日志留一行
            if (!UpdateChannelEnabled())
            {
                Program.Log("update channel disabled (data/update-channel.json 缺失或 enabled!=true)");
                Send("{\"t\":\"update-off\"}");
                return;
            }
            Task.Run(delegate
            {
                CheckLauncherChannel();
                if (_pending == null)
                    Send("{\"t\":\"update-none\",\"version\":\"" + Host.Esc(LocalVersion()) + "\"}");
            });
        }

        /// <summary>自有服务器（IP，不用域名 —— 域名换手等于把代码供源交出去）。</summary>
        private const string ServerOrigin = "http://8.134.50.56:3000";

        /// <summary>
        /// 查「启动器页面」通道：自有服务器优先（国内实测 9 MB/s），连不上/下载失败才落到 GitHub Release
        /// （实测 63 KB/s，但服务器挂了也能更）。**游戏代码通道已关闭，这里不再有第二条。**
        /// </summary>
        private void CheckLauncherChannel()
        {
            var ghManifest = GitHubPkgBase + "/launcher-pkg-manifest.json";
            var sources = new[] { ServerOrigin + "/launcher-pkg/manifest.json", ghManifest };
            for (int i = 0; i < sources.Length; i++)
            {
                var src = sources[i];
                var isGitHub = src.IndexOf("github.com", StringComparison.OrdinalIgnoreCase) >= 0;
                // GitHub 要走一次 302 再连 release-assets 域，6 秒在跨国链路上容易被掐断
                var body = Host.FetchText(src + "?t=" + DateTime.UtcNow.Ticks, 256 * 1024, isGitHub ? 15000 : 6000);
                if (string.IsNullOrEmpty(body)) continue;
                var ver = Host.JsonValue(body, "version");
                if (string.IsNullOrEmpty(ver)) continue;
                var local = LocalVersion();
                Program.Log("manifest source=" + (isGitHub ? "github" : "server")
                    + " version=" + ver + " local=" + (local.Length == 0 ? "(none)" : local));
                // 版本号是 YYYYMMDD-NN，字典序即时间序；必须**比本机新**才提示，
                // 否则服务器临时回退一个旧包会把玩家「升级」回旧版（本地自测踩到过）。
                if (local.Length > 0 && string.CompareOrdinal(ver, local) <= 0) return;
                var zip = Host.JsonValue(body, "zip");
                var fallback = Host.JsonValue(body, "zipFallback");
                _pending = new UpdateInfo
                {
                    Version = ver,
                    Url = Host.ResolveUrl(src, zip),
                    FallbackUrl = string.IsNullOrEmpty(fallback) ? "" : Host.ResolveUrl(src, fallback),
                    Sha256 = Host.JsonValue(body, "sha256"),
                    Notes = Host.JsonValue(body, "notes"),
                };
                Send("{\"t\":\"update-available\",\"version\":\"" + Host.Esc(ver) + "\",\"notes\":\""
                    + Host.Esc(_pending.Notes) + "\"}");
                return;
            }
            Program.Log("manifest unreachable");
        }

        /// <summary>GitHub Release 的稳定地址：latest 永远指向最新一版，不需要 API、不吃速率限制。</summary>
        private const string GitHubPkgBase = "https://github.com/wisadel429/stronghold-protocol-fusion/releases/latest/download";

        private sealed class UpdateInfo
        {
            public string Version;
            public string Url;
            /// <summary>主源下载失败/校验不通过时改用的备用地址（业主口径：GitHub 兜底）。</summary>
            public string FallbackUrl;
            public string Sha256;
            public string Notes;
        }

        private UpdateInfo _pending;

        /// <summary>页面就绪时补发一次更新状态（页面可能错过启动瞬间的推送）。</summary>
        private void ResendUpdateState()
        {
            if (!UpdateChannelEnabled()) { Send("{\"t\":\"update-off\"}"); return; }
            if (_pending != null)
            {
                Send("{\"t\":\"update-available\",\"version\":\"" + Host.Esc(_pending.Version)
                    + "\",\"notes\":\"" + Host.Esc(_pending.Notes) + "\"}");
                return;
            }
            var local = LocalVersion();
            if (local.Length > 0) Send("{\"t\":\"update-none\",\"version\":\"" + Host.Esc(local) + "\"}");
        }

        /// <summary>
        /// 应用更新：只覆盖 launcher/（启动器页面）。装完只重载界面，**不重启 node**。
        /// 游戏代码通道已关闭 —— 分发版想换代码只能整包换。
        /// </summary>
        private void ApplyUpdate()
        {
            if (!UpdateChannelEnabled())
            {
                Send("{\"t\":\"update-status\",\"kind\":\"bad\",\"text\":\"这个分发包已关闭热更通道\"}");
                return;
            }
            var info = _pending;
            if (info == null) { Send("{\"t\":\"update-status\",\"kind\":\"bad\",\"text\":\"没有待更新的版本\"}"); return; }
            Task.Run(delegate
            {
                var tmp = Path.Combine(Path.GetTempPath(), "sp-update-" + DateTime.Now.ToString("HHmmss") + ".zip");
                try
                {
                    Send("{\"t\":\"update-status\",\"kind\":\"wait\",\"text\":\"正在下载启动器更新包…\"}");
                    // 主源（自有服务器）先试；下载失败或 sha 对不上 → 走 GitHub 兜底重试一次
                    var ok = Host.DownloadFile(info.Url, tmp, 8 * 60 * 1000) && ShaOk(info, tmp);
                    if (!ok) ok = TryFallbackDownload(info, tmp) && ShaOk(info, tmp);
                    if (!ok)
                    {
                        Send("{\"t\":\"update-status\",\"kind\":\"bad\",\"text\":\"下载失败（主源与备用源都不通）\"}");
                        return;
                    }
                    Send("{\"t\":\"update-status\",\"kind\":\"wait\",\"text\":\"正在解压覆盖启动器页面（只含代码）…\"}");
                    var written = Host.UnzipFiltered(tmp, Program.Root, LauncherPkgDirs, UpdateAllowedExt, Program.Log);
                    if (written <= 0)
                    {
                        Send("{\"t\":\"update-status\",\"kind\":\"bad\",\"text\":\"包里没有可更新的文件\"}");
                        return;
                    }
                    try
                    {
                        var vf = VersionFileOf();
                        Directory.CreateDirectory(Path.GetDirectoryName(vf));
                        File.WriteAllText(vf, "{\"version\":\"" + Host.Esc(info.Version) + "\",\"at\":\"" + DateTime.Now.ToString("s") + "\"}", new UTF8Encoding(false));
                    }
                    catch { }
                    Program.Log("update applied " + written + " files -> " + info.Version);
                    _pending = null;
                    Send("{\"t\":\"update-status\",\"kind\":\"ok\",\"text\":\"已更新 " + written + " 个文件，正在重载界面…\"}");
                    try { BeginInvoke(new Action(delegate { try { _web.CoreWebView2.Reload(); } catch { } })); } catch { }
                    Send("{\"t\":\"update-done\",\"version\":\"" + Host.Esc(info.Version) + "\"}");
                }
                catch (Exception e)
                {
                    Program.Log("update failed: " + e.Message);
                    Send("{\"t\":\"update-status\",\"kind\":\"bad\",\"text\":\"更新失败：" + Host.Esc(e.Message) + "\"}");
                }
                finally { try { File.Delete(tmp); } catch { } }
            });
        }

        /// <summary>sha256 与 manifest 一致（manifest 没给 sha 时视为通过）。</summary>
        private static bool ShaOk(UpdateInfo info, string file)
        {
            if (info == null) return false;
            if (string.IsNullOrEmpty(info.Sha256)) return true;
            var got = Host.Sha256File(file);
            if (string.Equals(got, info.Sha256, StringComparison.OrdinalIgnoreCase)) return true;
            Program.Log("update sha mismatch want=" + info.Sha256 + " got=" + got);
            return false;
        }

        /// <summary>主源（自有服务器）失败时改走 GitHub 兜底 —— 业主 2026-11-22 定的 C 方案。</summary>
        private bool TryFallbackDownload(UpdateInfo info, string tmp)
        {
            if (info == null || string.IsNullOrEmpty(info.FallbackUrl)) return false;
            if (string.Equals(info.FallbackUrl, info.Url, StringComparison.OrdinalIgnoreCase)) return false;
            Program.Log("update: 主源失败，改用备用源 " + info.FallbackUrl);
            Send("{\"t\":\"update-status\",\"kind\":\"wait\",\"text\":\"主源不可用，正在从备用源（GitHub）下载，可能较慢…\"}");
            return Host.DownloadFile(info.FallbackUrl, tmp, 15 * 60 * 1000);
        }

        /// <summary>重启本地 node 服务（自重启：旧进程退出 → 起新进程）。</summary>
        private void RestartLocalServer()
        {
            var owned = false;
            foreach (var kv in _runs) { if (kv.Value != null && !kv.Value.HasExited) owned = true; }
            if (owned)
            {
                StopNode();
                Thread.Sleep(600);
                Program.Log("restart local server (owned)");
                StartLocal(false);
                return;
            }
            if (Host.PortOpen(ActivePort))
            {
                // 业主 2026-11-22 决定：允许结束占用端口的进程再重启，这样服务端改动也能一键生效。
                var killed = Host.KillPortOwner(ActivePort, Program.Log);
                Program.Log("restart: killed " + killed + " process(es) on port " + ActivePort);
                Thread.Sleep(800);
            }
            StartLocal(false);
        }


        private void StartAnnouncementPrefetch()
        {
            Task.Run(delegate
            {
                var urls = new[]
                {
                    "http://8.134.50.56:3000/api/announcement",
                    // mon3tr.fun 已停用（业主 2026-11-22），不再从该域名取公告
                };
                foreach (var url in urls)
                {
                    var body = Host.FetchText(url, 256 * 1024);
                    if (string.IsNullOrEmpty(body)) continue;
                    if (body.IndexOf("\"announcement\":null", StringComparison.Ordinal) >= 0) { Program.Log("announcement none @" + url); return; }
                    Program.Log("announcement ok @" + url + " (" + body.Length + "B)");
                    Send("{\"t\":\"announcement\",\"body\":\"" + Host.Esc(body) + "\"}");
                    return;
                }
                Program.Log("announcement unreachable");
            });
        }



        // ---- 本地资源扫描 ----
        private int _artFiles = -1, _artChecked;
        private void StartArtScan(CoreWebView2 core)
        {
            Task.Run(delegate
            {
                var roots = new[] { "public\\assets", "public\\ui-art", "public\\icons" };
                var files = 0;
                foreach (var r in roots)
                {
                    var dir = Path.Combine(Program.Root, r);
                    try { if (Directory.Exists(dir)) files += Directory.GetFiles(dir, "*", SearchOption.AllDirectories).Length; } catch { }
                }
                _artFiles = files;
                Program.Log("art files=" + files);
                for (var c = 0; c <= files; c += Math.Max(1, files / 20))
                {
                    _artChecked = Math.Min(files, c);
                    Send("{\"t\":\"art\",\"files\":" + files + ",\"checked\":" + _artChecked + "}");
                    Thread.Sleep(40);
                }
                _artChecked = files;
                Send("{\"t\":\"art\",\"files\":" + files + ",\"checked\":" + files + "}");
            });
        }

        private void ReportArtNow()
        {
            if (_artFiles > 0) Send("{\"t\":\"art\",\"files\":" + _artFiles + ",\"checked\":" + _artChecked + "}");
        }

        private void SaveServer(string addr)
        {
            try
            {
                var raw = File.Exists(_configFile) ? File.ReadAllText(_configFile, Encoding.UTF8) : "{}";
                raw = Host.SetJsonString(raw, "server", addr ?? "");
                File.WriteAllText(_configFile, raw, new UTF8Encoding(false));
                Program.Log("saved server=" + addr);
            }
            catch (Exception e) { Program.Log("save-server failed: " + e.Message); }
        }

        /// <summary>停掉所有由本启动器拉起的 node（业主 2026-11-22：可能同时有多个版本在跑）。</summary>
        private void StopNode()
        {
            foreach (var kv in _runs)
            {
                try { if (kv.Value != null && !kv.Value.HasExited) kv.Value.Kill(); } catch { }
            }
            _runs.Clear();
        }

        /// <summary>
        /// 手动地址 → 完整 URL。**不再强制 :3000**：
        ///   带协议头 → 原样；带端口 → http://主机:端口/；裸域名 → https://域名/；裸 IP → http://IP/。
        /// </summary>
        internal static string BuildUrl(string addr)
        {
            var s = (addr ?? "").Trim();
            if (s.Length == 0) return null;
            if (s.StartsWith("https://", StringComparison.OrdinalIgnoreCase) || s.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
                return s.EndsWith("/") ? s : s + "/";
            var host = s.TrimEnd('/');
            var colon = host.LastIndexOf(':');
            var hasPort = colon > 0 && colon < host.Length - 1 && Host.IsDigits(host.Substring(colon + 1));
            if (hasPort) return "http://" + host + "/";
            return (Host.IsIpv4(host) ? "http://" : "https://") + host + "/";
        }
    }

    /// <summary>与界面无关的小工具（JSON、探测、路径）。</summary>
    internal static class Host
    {
        public static string Esc(string s)
        {
            if (s == null) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", "");
        }

        /// <summary>
        /// 读 JSON 布尔值（`true` 与 `"true"` 都认）；缺失或非法返回 def。
        /// 为什么单独写一个：JsonValue 只解析带引号的字符串，`"enabled": true` 会被它读成空串
        /// —— 这样「热更总开关」就会永远关着，而且现象极难发现（日志只会说 manifest unreachable）。
        /// </summary>
        public static bool JsonBool(string json, string key, bool def)
        {
            if (string.IsNullOrEmpty(json)) return def;
            var marker = "\"" + key + "\"";
            var i = json.IndexOf(marker, StringComparison.Ordinal);
            if (i < 0) return def;
            i = json.IndexOf(':', i + marker.Length);
            if (i < 0) return def;
            i++;
            while (i < json.Length && char.IsWhiteSpace(json[i])) i++;
            if (i >= json.Length) return def;
            if (json[i] == '"')
            {
                var q2 = json.IndexOf('"', i + 1);
                if (q2 < 0) return def;
                return string.Equals(json.Substring(i + 1, q2 - i - 1).Trim(), "true", StringComparison.OrdinalIgnoreCase);
            }
            var rest = json.Substring(i);
            if (rest.StartsWith("true", StringComparison.OrdinalIgnoreCase)) return true;
            if (rest.StartsWith("false", StringComparison.OrdinalIgnoreCase)) return false;
            return def;
        }

        public static string JsonValue(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return "";
            var marker = "\"" + key + "\"";
            var i = json.IndexOf(marker, StringComparison.Ordinal);
            if (i < 0) return "";
            i = json.IndexOf(':', i + marker.Length);
            if (i < 0) return "";
            i++;
            while (i < json.Length && char.IsWhiteSpace(json[i])) i++;
            if (i >= json.Length || json[i] != '"') return "";
            i++;
            var sb = new StringBuilder();
            while (i < json.Length && json[i] != '"')
            {
                if (json[i] == '\\' && i + 1 < json.Length) { i++; sb.Append(json[i]); }
                else sb.Append(json[i]);
                i++;
            }
            return sb.ToString();
        }

        public static string SetJsonString(string json, string key, string value)
        {
            if (string.IsNullOrWhiteSpace(json)) json = "{}";
            var marker = "\"" + key + "\"";
            var i = json.IndexOf(marker, StringComparison.Ordinal);
            if (i >= 0)
            {
                var c = json.IndexOf(':', i + marker.Length);
                if (c >= 0)
                {
                    var end = c + 1;
                    while (end < json.Length && char.IsWhiteSpace(json[end])) end++;
                    if (end < json.Length && json[end] == '"')
                    {
                        end++;
                        while (end < json.Length && json[end] != '"') { if (json[end] == '\\') end++; end++; }
                        if (end < json.Length) end++;
                        return json.Substring(0, c + 1) + "\"" + Esc(value) + "\"" + json.Substring(end);
                    }
                }
            }
            var close = json.LastIndexOf('}');
            if (close < 0) return "{\"" + key + "\":\"" + Esc(value) + "\"}";
            var sep = json.Substring(0, close).TrimEnd().EndsWith("{") ? "" : ",";
            return json.Substring(0, close) + sep + "\"" + key + "\":\"" + Esc(value) + "\"}";
        }

        /// <summary>取 JSON 里的数字字段（不存在返回 def）。</summary>
        public static double JsonNumber(string json, string key, double def)
        {
            if (string.IsNullOrEmpty(json)) return def;
            var marker = "\"" + key + "\"";
            var i = json.IndexOf(marker, StringComparison.Ordinal);
            if (i < 0) return def;
            i = json.IndexOf(':', i + marker.Length);
            if (i < 0) return def;
            i++;
            var start = i;
            while (i < json.Length && (char.IsDigit(json[i]) || json[i] == '-' || json[i] == '.')) i++;
            double v;
            if (i > start && double.TryParse(json.Substring(start, i - start), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out v)) return v;
            return def;
        }

        public static bool IsDigits(string s)
        {
            if (s.Length == 0) return false;
            foreach (var c in s) if (c < '0' || c > '9') return false;
            return true;
        }

        public static bool IsIpv4(string s)
        {
            var parts = s.Split('.');
            if (parts.Length != 4) return false;
            foreach (var p in parts)
            {
                if (!IsDigits(p) || p.Length > 3) return false;
                if (int.Parse(p) > 255) return false;
            }
            return true;
        }

        public static string FindNode(string root)
        {
            var bundled = Path.Combine(root, "node", "node.exe");
            if (File.Exists(bundled)) return bundled;
            var candidates = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
            };
            foreach (var c in candidates) if (File.Exists(c)) return c;
            return "node.exe";
        }

        public static string NodeVersion(string nodeExe)
        {
            try
            {
                var psi = new ProcessStartInfo(nodeExe, "-v") { RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true };
                using (var p = Process.Start(psi))
                {
                    var v = p.StandardOutput.ReadToEnd().Trim();
                    p.WaitForExit(4000);
                    return v;
                }
            }
            catch { return "unknown"; }
        }

        /// <summary>本机端口是否已被监听（判断"服务器已经在跑"）。</summary>
        public static bool PortOpen(int port)
        {
            try
            {
                using (var c = new TcpClient())
                {
                    var ar = c.BeginConnect(IPAddress.Loopback, port, null, null);
                    if (!ar.AsyncWaitHandle.WaitOne(600)) return false;
                    c.EndConnect(ar);
                    return true;
                }
            }
            catch { return false; }
        }

        /// <summary>取一个 URL 的文本正文（宿主侧发起，绕开页面的混合内容限制）。失败返回空串。</summary>
        public static string FetchText(string url, int maxBytes, int timeoutMs = 6000)
        {
            try
            {
                if (string.IsNullOrEmpty(url)) return "";
                if (!url.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                    && !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return "";
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = "GET";
                req.Timeout = timeoutMs;
                req.ReadWriteTimeout = timeoutMs;
                req.UserAgent = "StrongholdLauncher/1";
                req.Proxy = null;
                using (var res = (HttpWebResponse)req.GetResponse())
                using (var s = res.GetResponseStream())
                {
                    var buffer = new byte[8192];
                    var ms = new MemoryStream();
                    int n;
                    while ((n = s.Read(buffer, 0, buffer.Length)) > 0)
                    {
                        ms.Write(buffer, 0, n);
                        if (ms.Length > maxBytes) break;
                    }
                    return Encoding.UTF8.GetString(ms.ToArray());
                }
            }
            catch (Exception e) { Program.Log("fetch failed " + url + " : " + e.Message); return ""; }
        }

        /// <summary>把 manifest 里的相对路径解析成绝对地址（已是绝对 URL 就原样返回）。
        /// 相对路径按**清单所在目录**解析 —— GitHub 上的清单与 zip 是同一目录的兄弟资产，
        /// 按 origin 拼会丢路径（例如 /x.zip 会变成 https://github.com/x.zip）。</summary>
        public static string ResolveUrl(string manifestUrl, string rel)
        {
            if (string.IsNullOrEmpty(rel)) return "";
            if (rel.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                || rel.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return rel;
            try { return new Uri(new Uri(manifestUrl), rel).AbsoluteUri; }
            catch { return rel; }
        }

        /// <summary>下载到文件（带超时）。成功返回 true。</summary>
        public static bool DownloadFile(string url, string saveTo, int timeoutMs)
        {
            try
            {
                if (string.IsNullOrEmpty(url)) return false;
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = "GET";
                req.Timeout = timeoutMs;
                req.ReadWriteTimeout = timeoutMs;
                req.UserAgent = "StrongholdLauncher/1";
                req.Proxy = null;
                using (var res = (HttpWebResponse)req.GetResponse())
                using (var s = res.GetResponseStream())
                using (var f = File.Create(saveTo))
                {
                    var buf = new byte[64 * 1024];
                    int n;
                    while ((n = s.Read(buf, 0, buf.Length)) > 0) f.Write(buf, 0, n);
                }
                return new FileInfo(saveTo).Length > 0;
            }
            catch (Exception e) { Program.Log("download failed " + url + " : " + e.Message); return false; }
        }

        /// <summary>文件 sha256（小写十六进制）。</summary>
        public static string Sha256File(string file)
        {
            try
            {
                using (var sha = System.Security.Cryptography.SHA256.Create())
                using (var f = File.OpenRead(file))
                {
                    var hash = sha.ComputeHash(f);
                    var sb = new StringBuilder(hash.Length * 2);
                    foreach (var b in hash) sb.Append(b.ToString("x2"));
                    return sb.ToString();
                }
            }
            catch (Exception e) { Program.Log("sha256 failed: " + e.Message); return ""; }
        }

        /// <summary>
        /// 按白名单解压：只写允许的目录与扩展名（**绝不含美术资源**），
        /// 拒绝 .. 、绝对路径、盘符、以及 data/ 与 public/assets|ui-art 之类。
        /// 返回写入的文件数。
        /// </summary>
        public static int UnzipFiltered(string zipPath, string root, string[] allowedDirs, string[] allowedExt, Action<string> log)
        {
            var count = 0;
            var rootFull = Path.GetFullPath(root).TrimEnd('\\') + "\\";
            using (var zip = System.IO.Compression.ZipFile.OpenRead(zipPath))
            {
                foreach (var entry in zip.Entries)
                {
                    if (entry.FullName.EndsWith("/")) continue;                    // 目录项跳过
                    var name = entry.FullName.Replace('\\', '/');
                    // 去掉统一的顶层目录（打包时常带一层包名）
                    var slash = name.IndexOf('/');
                    var stripped = slash > 0 ? name.Substring(slash + 1) : name;
                    var rel = stripped.Replace('\\', '/');
                    if (rel.Length == 0) continue;
                    if (rel.IndexOf("..", StringComparison.Ordinal) >= 0) { log("skip (..): " + rel); continue; }
                    if (rel.IndexOf(':') >= 0) { log("skip (colon): " + rel); continue; }
                    var ext = Path.GetExtension(rel).ToLowerInvariant();
                    if (Array.IndexOf(allowedExt, ext) < 0) { log("skip (ext " + ext + "): " + rel); continue; }
                    var ok = false;
                    foreach (var d in allowedDirs)
                    {
                        if (d.EndsWith("/")) { if (rel.StartsWith(d, StringComparison.OrdinalIgnoreCase)) { ok = true; break; } }
                        else { if (string.Equals(rel, d, StringComparison.OrdinalIgnoreCase)) { ok = true; break; } }
                    }
                    if (!ok) { log("skip (dir): " + rel); continue; }
                    if (rel.StartsWith("data/", StringComparison.OrdinalIgnoreCase)) { log("skip (data): " + rel); continue; }
                    if (rel.StartsWith("public/assets/", StringComparison.OrdinalIgnoreCase)
                        || rel.StartsWith("public/ui-art/", StringComparison.OrdinalIgnoreCase)) { log("skip (art): " + rel); continue; }

                    var dest = Path.GetFullPath(Path.Combine(root, rel.Replace('/', '\\')));
                    if (!dest.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase)) { log("skip (outside): " + rel); continue; }
                    Directory.CreateDirectory(Path.GetDirectoryName(dest));
                    entry.ExtractToFile(dest, true);
                    count++;
                }
            }
            return count;
        }

        /// <summary>结束占用指定端口的进程（只结束监听该端口的那个 PID）。返回结束的进程数。</summary>
        public static int KillPortOwner(int port, Action<string> log)
        {
            var killed = 0;
            try
            {
                var props = System.Net.NetworkInformation.IPGlobalProperties.GetIPGlobalProperties();
                var listeners = props.GetActiveTcpListeners();
                var pids = new List<int>();
                foreach (var ep in listeners)
                {
                    if (ep.Port != port) continue;
                    // 通过 netstat 反查 PID（GetActiveTcpListeners 不带 PID）
                }
                // 用 netstat -ano 解析
                var psi = new ProcessStartInfo("netstat", "-ano")
                {
                    RedirectStandardOutput = true, UseShellExecute = false, CreateNoWindow = true,
                };
                using (var p = Process.Start(psi))
                {
                    var text = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(4000);
                    foreach (var line in text.Split('\n'))
                    {
                        if (line.IndexOf("LISTENING", StringComparison.OrdinalIgnoreCase) < 0) continue;
                        var parts = line.Trim().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                        if (parts.Length < 5) continue;
                        var local = parts[1];
                        var idx = local.LastIndexOf(':');
                        if (idx < 0) continue;
                        int p2;
                        if (!int.TryParse(local.Substring(idx + 1), out p2) || p2 != port) continue;
                        int procId;
                        if (!int.TryParse(parts[parts.Length - 1], out procId)) continue;
                        if (procId == Process.GetCurrentProcess().Id) continue;
                        if (pids.Contains(procId)) continue;
                        pids.Add(procId);
                    }
                }
                foreach (var procId in pids)
                {
                    try
                    {
                        var victim = Process.GetProcessById(procId);
                        log("kill port " + port + " owner: pid " + procId + " (" + victim.ProcessName + ")");
                        victim.Kill();
                        victim.WaitForExit(3000);
                        killed++;
                    }
                    catch (Exception e) { log("kill failed pid " + procId + ": " + e.Message); }
                }
            }
            catch (Exception e) { log("KillPortOwner failed: " + e.Message); }
            return killed;
        }

        public static bool Probe(string url, int timeoutMs)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = "GET";
                req.Timeout = timeoutMs;
                req.ReadWriteTimeout = timeoutMs;
                req.AllowAutoRedirect = true;
                // 业主 2026-11-22：本机的系统代理是「自动检测」，.NET 每次请求都可能卡在 WPAD 上十几秒，
                // 实测同一地址走代理 12 秒超时、直连 330 毫秒返回 —— 服务器列表探测超时也是这个原因。
                req.Proxy = null;
                using (var res = (HttpWebResponse)req.GetResponse())
                    return (int)res.StatusCode >= 200 && (int)res.StatusCode < 500;
            }
            catch { return false; }
        }

        public static string LanUrls(int port)
        {
            var list = new List<string>();
            try
            {
                foreach (var ip in Dns.GetHostAddresses(Dns.GetHostName()))
                {
                    if (ip.AddressFamily != AddressFamily.InterNetwork) continue;
                    var s = ip.ToString();
                    if (s.StartsWith("127.")) continue;
                    list.Add("http://" + s + ":" + port);
                }
            }
            catch { }
            return string.Join("  ", list.ToArray());
        }
    }
}
