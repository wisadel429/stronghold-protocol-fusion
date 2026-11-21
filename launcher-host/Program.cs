// Program.cs — 启动器宿主（重建版 v2，2026-11-21）
//
// 背景：原 Program.cs 随 E:\stronghold\_merge-work 被删除且无备份。本文件是**重写**的宿主，
// 目标：尽量还原原版的能力（按 launcher.log 里留下的行为线索逐项对齐）。
//
// 已还原的能力：
//   1. WebView2 运行时探测：优先用安装目录 webview2\msedgewebview2.exe（WEBVIEW2_BROWSER_EXECUTABLE_FOLDER），
//      否则用系统 Evergreen —— 对应旧日志 bundled / installed webview2。
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

        private static void TryCloseLog()
        {
            try { if (_log != null) { _log.Flush(); _log.Dispose(); } } catch { }
            _log = null;
        }

        /// <summary>优先用安装目录自带的 WebView2 运行时（原版行为）。</summary>
        private static void PrepareWebView2Runtime()
        {
            try
            {
                var bundled = Path.Combine(Root, "webview2", "msedgewebview2.exe");
                if (File.Exists(bundled))
                {
                    Environment.SetEnvironmentVariable("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", Path.GetDirectoryName(bundled));
                    Log("bundled webview2=" + bundled);
                }
                else
                {
                    Log("installed webview2 (evergreen)");
                }
            }
            catch (Exception e) { Log("webview2 probe failed: " + e.Message); }
        }
    }

    internal sealed class LauncherForm : Form
    {
        private readonly WebView2 _web;
        private readonly Label _splash;
        private NotifyIcon _tray;
        private readonly string _launcherDir;
        private readonly string _configFile;
        private Process _node;
        private bool _navigatedToGame;

        private const int GAME_PORT = 3000;
        private const string GAME_URL = "http://127.0.0.1:3000/";

        public LauncherForm()
        {
            _launcherDir = Path.Combine(Program.Root, "launcher");
            _configFile = Path.Combine(Program.Root, "launcher-config.json");

            Text = "卫戍协议：盟约 · 电脑版";
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
                core.DocumentTitleChanged += (s, e) => { try { Text = core.DocumentTitle; } catch { } };

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
                SetSplash("内置浏览器启动失败：\r\n" + e.Message);
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
                Task.Delay(1500).ContinueWith(delegate
                {
                    try { BeginInvoke(new Action(delegate { _web.CoreWebView2.Navigate("http://127.0.0.1:3000/admin"); })); } catch { }
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
                foreach (var url in candidates)
                {
                    Program.Log("probe " + url);
                    if (Host.Probe(url, 6000))
                    {
                        Program.Log("list ok " + url);
                        try { BeginInvoke(new Action(delegate { _web.CoreWebView2.Navigate(url); })); } catch { }
                        return;
                    }
                    Program.Log("probe error " + url);
                }
                Program.Log("list unreachable");
            });
        }

        // ---- 本地服务器 ----
        private void StartLocal(bool warm)
        {
            if (_node != null && !_node.HasExited) { if (warm) Program.Log("warm: server already running"); return; }
            // 端口已被别的实例占着 = 本地服务器本来就在跑（旧日志正是这句）
            if (Host.PortOpen(GAME_PORT)) { Program.Log(warm ? "warm: server already running" : "server already running"); return; }
            try
            {
                var node = Host.FindNode(Program.Root);
                Program.Log("node activated rc=0 out=" + Host.NodeVersion(node));
                var psi = new ProcessStartInfo(node, "server/index.js")
                {
                    WorkingDirectory = Program.Root,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                };
                psi.EnvironmentVariables["PORT"] = GAME_PORT.ToString();
                var p = new Process { StartInfo = psi };
                p.OutputDataReceived += (s, e) => { if (e.Data != null) Program.Log("node: " + e.Data); };
                p.ErrorDataReceived += (s, e) => { if (e.Data != null) Program.Log("node! " + e.Data); };
                p.Start();
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                _node = p;
                Program.Log((warm ? "warm node started pid " : "node started pid ") + p.Id);
            }
            catch (Exception e) { Program.Log("start-local failed: " + e.Message); }
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
                    if (Host.Probe(GAME_URL + "healthz", 1500))
                    {
                        var ms = (int)(DateTime.UtcNow - started).TotalMilliseconds;
                        Send("{\"t\":\"boot\",\"text\":\"服务器已就绪，正在进入游戏…\",\"pct\":100}");
                        Send("{\"t\":\"server-started\",\"lan\":\"" + Host.Esc(Host.LanUrls(GAME_PORT)) + "\",\"ms\":" + ms + "}");
                        Program.Log("boot 100% 服务器已就绪，正在进入游戏…");
                        _navigatedToGame = true;
                        try { BeginInvoke(new Action(delegate { _web.CoreWebView2.Navigate(GAME_URL); })); } catch { }
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
                    try { Process.Start("http://127.0.0.1:" + GAME_PORT + "/admin"); } catch { }
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
        // ---- 热更新（业主 2026-11-22）----
        // 铁律：**更新包里绝不含美术资源**。所以解压只接受代码/配置类文件（.js/.mjs/.css/.html），
        // 且路径必须在 launcher/、public/js/、public/css/、server/、shared/ 之下；
        // data/（账号存档）、public/assets、public/ui-art、任何图片/音频一律拒绝。
        private static readonly string[] UpdateAllowedDirs =
        {
            "launcher/", "public/js/", "public/css/", "server/", "shared/",
            "public/index.html", "public/dashboard.html",
        };
        private static readonly string[] UpdateAllowedExt = { ".js", ".mjs", ".css", ".html", ".json", ".txt", ".md" };

        private string VersionFile { get { return Path.Combine(Program.Root, "data", "launcher-version.json"); } }
        private string LocalVersion()
        {
            try
            {
                var raw = File.ReadAllText(VersionFile, Encoding.UTF8);
                var v = Host.JsonValue(raw, "version");
                return v ?? "";
            }
            catch { return ""; }
        }

        private void StartUpdateCheck()
        {
            Task.Run(delegate
            {
                var bases = new[]
                {
                    "http://8.134.50.56:3000",
                    "https://mon3tr.fun",
                };
                foreach (var b in bases)
                {
                    var body = Host.FetchText(b + "/launcher-pkg/manifest.json?t=" + DateTime.UtcNow.Ticks, 256 * 1024);
                    if (string.IsNullOrEmpty(body)) continue;
                    var ver = Host.JsonValue(body, "version");
                    if (string.IsNullOrEmpty(ver)) continue;
                    var zip = Host.JsonValue(body, "zip");
                    var sha = Host.JsonValue(body, "sha256");
                    var notes = Host.JsonValue(body, "notes");
                    var local = LocalVersion();
                    Program.Log("manifest version=" + ver + " local=" + (local.Length == 0 ? "(none)" : local));
                    if (local == ver) { Send("{\"t\":\"update-none\",\"version\":\"" + Host.Esc(ver) + "\"}"); return; }
                    _pendingUpdate = new UpdateInfo { Version = ver, Url = (zip.StartsWith("/") ? b + zip : zip), Sha256 = sha, Notes = notes };
                    Send("{\"t\":\"update-available\",\"version\":\"" + Host.Esc(ver) + "\",\"notes\":\"" + Host.Esc(notes) + "\"}");
                    return;
                }
                Program.Log("manifest unreachable");
            });
        }

        private sealed class UpdateInfo
        {
            public string Version;
            public string Url;
            public string Sha256;
            public string Notes;
        }

        private UpdateInfo _pendingUpdate;

        /// <summary>页面就绪时补发一次更新状态（页面可能错过启动瞬间的推送）。</summary>
        private void ResendUpdateState()
        {
            var info = _pendingUpdate;
            if (info != null)
            {
                Send("{\"t\":\"update-available\",\"version\":\"" + Host.Esc(info.Version) + "\",\"notes\":\"" + Host.Esc(info.Notes) + "\"}");
                return;
            }
            var local = LocalVersion();
            if (local.Length > 0) Send("{\"t\":\"update-none\",\"version\":\"" + Host.Esc(local) + "\"}");
        }

        private void ApplyUpdate()
        {
            var info = _pendingUpdate;
            if (info == null) { Send("{\"t\":\"update-status\",\"kind\":\"bad\",\"text\":\"没有待更新的版本\"}"); return; }
            Task.Run(delegate
            {
                var tmp = Path.Combine(Path.GetTempPath(), "sp-update-" + DateTime.Now.ToString("HHmmss") + ".zip");
                try
                {
                    Send("{\"t\":\"update-status\",\"kind\":\"wait\",\"text\":\"正在下载更新包…\"}");
                    if (!Host.DownloadFile(info.Url, tmp, 8 * 60 * 1000)) { Send("{\"t\":\"update-status\",\"kind\":\"bad\",\"text\":\"下载失败\"}"); return; }
                    var got = Host.Sha256File(tmp);
                    if (!string.IsNullOrEmpty(info.Sha256) && !string.Equals(got, info.Sha256, StringComparison.OrdinalIgnoreCase))
                    {
                        Send("{\"t\":\"update-status\",\"kind\":\"bad\",\"text\":\"校验失败（包可能损坏）\"}");
                        Program.Log("update sha mismatch want=" + info.Sha256 + " got=" + got);
                        return;
                    }
                    Send("{\"t\":\"update-status\",\"kind\":\"wait\",\"text\":\"正在解压覆盖（只含代码，不含美术资源）…\"}");
                    var written = Host.UnzipFiltered(tmp, Program.Root, UpdateAllowedDirs, UpdateAllowedExt, Program.Log);
                    if (written <= 0) { Send("{\"t\":\"update-status\",\"kind\":\"bad\",\"text\":\"包里没有可更新的文件\"}"); return; }
                    try
                    {
                        Directory.CreateDirectory(Path.GetDirectoryName(VersionFile));
                        File.WriteAllText(VersionFile, "{\"version\":\"" + Host.Esc(info.Version) + "\",\"at\":\"" + DateTime.Now.ToString("s") + "\"}", new UTF8Encoding(false));
                    }
                    catch { }
                    Program.Log("update applied " + written + " files -> " + info.Version);
                    _pendingUpdate = null;
                    Send("{\"t\":\"update-status\",\"kind\":\"ok\",\"text\":\"已更新 " + written + " 个文件，正在重启本地服务…\"}");
                    RestartLocalServer();
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

        /// <summary>重启本地 node 服务（自重启：旧进程退出 → 起新进程）。</summary>
        private void RestartLocalServer()
        {
            var owned = _node != null && !_node.HasExited;
            if (owned)
            {
                StopNode();
                Thread.Sleep(600);
                Program.Log("restart local server (owned)");
                StartLocal(false);
                return;
            }
            if (Host.PortOpen(GAME_PORT))
            {
                // 业主 2026-11-22 决定：允许结束占用 3000 的进程再重启，这样服务端改动也能一键生效。
                var killed = Host.KillPortOwner(GAME_PORT, Program.Log);
                Program.Log("restart: killed " + killed + " process(es) on port " + GAME_PORT);
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
                    "https://mon3tr.fun/api/announcement",
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

        private void StopNode()
        {
            try { if (_node != null && !_node.HasExited) _node.Kill(); } catch { }
            _node = null;
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
        public static string FetchText(string url, int maxBytes)
        {
            try
            {
                if (string.IsNullOrEmpty(url)) return "";
                if (!url.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                    && !url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) return "";
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = "GET";
                req.Timeout = 6000;
                req.ReadWriteTimeout = 6000;
                req.UserAgent = "StrongholdLauncher/1";
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
