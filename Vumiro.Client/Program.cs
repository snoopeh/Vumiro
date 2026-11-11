using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Xml.Linq;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Vumiro.Client
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            GamingDependencies.Register();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (ClientRuntime.Current.IsLocalQa)
                Environment.SetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER", ClientRuntime.Current.BrowserProfileDirectory);
            using (var instance = DesktopInstance.Acquire())
            {
                if (instance == null) return;
                ClientDiagnostics.Current.Start();
                AppDomain.CurrentDomain.UnhandledException += (s, e) => {
                    var error = e.ExceptionObject as Exception;
                    if (error != null) ClientDiagnostics.Current.RecordException("unhandled-error", error);
                };
                TaskScheduler.UnobservedTaskException += (s, e) => ClientDiagnostics.Current.EnqueueException("host-error", e.Exception);
                var window = new ClientWindow();
                instance.Listen(window);
                Application.Run(window);
                // A failing disk must not prevent exit or hold up the updater helper.
                try { Task.Run(() => ClientDiagnostics.Current.End()).Wait(TimeSpan.FromSeconds(5)); }
                catch (AggregateException) { /* Shutdown diagnostics are best effort. */ }
            }
        }
    }

    internal sealed partial class ClientWindow : Form
    {
        private readonly WebView2 browser = new WebView2 { Dock = DockStyle.Fill, Enabled = false, DefaultBackgroundColor = Color.FromArgb(11, 11, 12) };
        private readonly StartupLoading loading = new StartupLoading { Dock = DockStyle.Fill, Text = "Opening Vumiro…" };
        private NotifyIcon trayIcon;
        private ContextMenuStrip trayMenu;
        private bool exitRequested;
        private FormWindowState lastWindowState = FormWindowState.Normal;
        // Keep this origin and ClientBrowser folder stable: IndexedDB stores
        // existing identity keys and contacts under these compatibility names.
        private const string Origin = "https://screentask.local";
        private const string DefaultSignaling = "wss://vumiro-rooms.vumiro-signaling.workers.dev/call-signaling";
        private Rectangle windowBounds;
        private FormWindowState windowState;
        private bool startupOverlayActive = true;
        private readonly ClientUpdates updates;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private readonly OAuthLogin oauthLogin = new OAuthLogin();
        private readonly string launchId = Guid.NewGuid().ToString("N");

        internal ClientWindow()
        {
            updates = new ClientUpdates(this, state => {
                if (startupOverlayActive && !loading.IsDisposed) loading.Text = updates.StatusText;
                if (!IsDisposed && browser.CoreWebView2 != null) browser.CoreWebView2.PostWebMessageAsJson(json.Serialize(state));
            });
            Text = ClientRuntime.Current.IsLocalQa ? "Vumiro · " + ClientRuntime.Current.Label : "Vumiro";
            BackColor = Color.FromArgb(11, 11, 12);
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(1160, 800);
            MinimumSize = new Size(940, 640);
            if (ClientRuntime.Current.IsLocalQa) WindowState = FormWindowState.Maximized;
            InitializeWindowChrome();
            InitializeTrayIcon();
            Controls.Add(browser); Controls.Add(loading);
            loading.BringToFront();
            Shown += async (s, e) => await OpenAsync();
            FormClosed += (s, e) => {
                StopGaming();
                oauthLogin.Dispose();
                StopStreamAudio();
                trayIcon.Visible = false;
                trayIcon.Dispose();
                trayMenu.Dispose();
                browser.Dispose();
            };
        }

        private void InitializeTrayIcon()
        {
            trayMenu = new ContextMenuStrip();
            var open = new ToolStripMenuItem("Open Vumiro");
            var quit = new ToolStripMenuItem("Quit Vumiro");
            open.Click += (s, e) => RestoreFromTray();
            quit.Click += (s, e) => ExitApplication();
            trayMenu.Items.Add(open);
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add(quit);
            trayIcon = new NotifyIcon { Icon = Icon ?? SystemIcons.Application, Text = ClientRuntime.Current.IsLocalQa ? "Vumiro · LOCAL QA" : "Vumiro", ContextMenuStrip = trayMenu, Visible = false };
            trayIcon.DoubleClick += (s, e) => RestoreFromTray();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            base.OnFormClosing(e);
            if (ClientRuntime.Current.IsLocalQa) return;
            if (e.Cancel || e.CloseReason != CloseReason.UserClosing || exitRequested) return;

            // Keep the existing WebView alive so room media, capture and
            // signaling continue while the window is out of sight.
            if (WindowState != FormWindowState.Minimized) lastWindowState = WindowState;
            trayIcon.Visible = true;
            Hide();
            e.Cancel = true;
        }

        internal void ExitApplication()
        {
            if (IsDisposed) return;
            exitRequested = true;
            trayIcon.Visible = false;
            Close();
        }

        internal void ActivateExistingInstance() { RestoreFromTray(); }

        private void RestoreFromTray()
        {
            if (IsDisposed) return;
            if (WindowState == FormWindowState.Minimized) WindowState = lastWindowState;
            Show();
            if (WindowState == FormWindowState.Minimized) WindowState = lastWindowState;
            Activate();
        }

        private async Task OpenAsync()
        {
            try
            {
                var profile = ClientRuntime.Current.BrowserProfileDirectory;
                var environment = await CoreWebView2Environment.CreateAsync(null, profile);
                if (IsDisposed) return;
                await browser.EnsureCoreWebView2Async(environment);
                Version webviewVersion;
                if (Version.TryParse(environment.BrowserVersionString.Split(' ')[0], out webviewVersion))
                    ClientDiagnostics.Current.Enqueue("runtime", new Dictionary<string, object> { { "webviewMajor", webviewVersion.Major }, { "webviewBuild", webviewVersion.Build } });
                browser.CoreWebView2.ProcessFailed += (s, e) => ClientDiagnostics.Current.Enqueue("webview-failed", new Dictionary<string, object> { { "code", (int)e.ProcessFailedKind } });
                browser.CoreWebView2.SetVirtualHostNameToFolderMapping(new Uri(Origin).Host, ClientRuntime.Current.WebRoot, CoreWebView2HostResourceAccessKind.DenyCors);
                await browser.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("Object.defineProperty(window,'__VUMIRO_LAUNCH_ID__',{value:" + json.Serialize(launchId) + ",writable:false,configurable:false});");
                await browser.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync("Object.defineProperty(window,'__VUMIRO_WAIT_FOR_HOST__',{value:true,writable:false,configurable:false});");
                await EnableLocalQaToolsAsync();
                browser.CoreWebView2.Settings.IsStatusBarEnabled = false;
                browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                browser.CoreWebView2.ContainsFullScreenElementChanged += (s, e) => {
                    SetContentFullscreen(browser.CoreWebView2.ContainsFullScreenElement);
                };
                browser.CoreWebView2.NavigationStarting += (s, e) => {
                    Uri target;
                    if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out target) || target.GetLeftPart(UriPartial.Authority) != Origin) e.Cancel = true;
                    if (!e.Cancel) { StopGaming(); StopStreamAudio(); oauthLogin.Cancel(); }
                };
                browser.CoreWebView2.NewWindowRequested += (s, e) => { e.Handled = true; };
                browser.CoreWebView2.WebMessageReceived += async (s, e) => {
                    Uri source;
                    if (!Uri.TryCreate(e.Source, UriKind.Absolute, out source) || source.GetLeftPart(UriPartial.Authority) != Origin ||
                        !(source.AbsolutePath == "/friends.html" || source.AbsolutePath == "/auth.html")) return;
                    try
                    {
                        var message = json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
                        if (HandleSecureStoreMessage(message)) return;
                        if (await HandleOAuthMessageAsync(message, source)) return;
                        if (HandleWindowMessage(message)) return;
                        if (HandleLocalQaMessage(message)) return;
                        if (source.AbsolutePath != "/friends.html") return;
                        if (await HandleGamingMessageAsync(message)) return;
                        if (HandleDiagnosticsMessage(message)) return;
                        if (HandleStreamAudioMessage(message)) return;
                        object type, action;
                        if (message != null && message.Count == 2 && message.TryGetValue("type", out type) && type as string == "updates" && message.TryGetValue("action", out action) && action is string)
                            await updates.HandleAsync((string)action);
                    }
                    catch (ArgumentException) { /* Ignore malformed page messages. */ }
                    catch (Exception) { /* A malformed message or closing browser must not escape this async event handler. */ }
                };
                browser.CoreWebView2.NavigationCompleted += async (s, e) => {
                    if (IsDisposed) return;
                    if (!e.IsSuccess)
                    {
                        WriteLocalQaStatus("error", "Local interface navigation failed: " + e.WebErrorStatus);
                        if (startupOverlayActive) loading.ShowError("Vumiro could not load its local interface: " + e.WebErrorStatus);
                    }
                    else
                    {
                        await updates.StartAsync();
                        if (IsDisposed) return;
                        browser.Enabled = true;
                        DismissStartupOverlay();
                        await browser.CoreWebView2.ExecuteScriptAsync("window.__VUMIRO_HOST_READY__=true;window.dispatchEvent(new Event('vumiro-host-ready'));");
                        PublishWindowState();
                        WriteLocalQaStatus("ready");
                    }
                };
                var signaling = DefaultSignaling;
                var fps = 60; var bitrate = 20;
                try
                {
                    var preferences = Path.Combine(ClientRuntime.Current.DataDirectory, "appsettings.xml");
                    if (File.Exists(preferences))
                    {
                        var xml = XDocument.Load(preferences).Root;
                        int value;
                        if (Int32.TryParse((string)xml.Element("FrameRate"), out value)) fps = Math.Max(1, Math.Min(120, value));
                        if (Int32.TryParse((string)xml.Element("MaxBitrateMbps"), out value)) bitrate = Math.Max(0, Math.Min(100, value));
                        Uri endpoint;
                        var saved = (string)xml.Element("CallSignalingUrl");
                        if (Uri.TryCreate(saved, UriKind.Absolute, out endpoint) && endpoint.Scheme == "wss" && String.IsNullOrEmpty(endpoint.UserInfo)) signaling = saved;
                    }
                }
                catch (Exception error) when (error is IOException || error is System.Xml.XmlException || error is UnauthorizedAccessException) { }
                browser.Source = new Uri(Origin + "/friends.html?signaling=" + Uri.EscapeDataString(signaling) + "&fps=" + fps + "&mbps=" + bitrate);
            }
            catch (Exception error)
            {
                ClientDiagnostics.Current.EnqueueException("startup-error", error);
                WriteLocalQaStatus("error", error.Message);
                if (!IsDisposed) loading.ShowError("Vumiro could not start. Microsoft Edge WebView2 Runtime is required.\n\n" + error.Message);
            }
        }

        private async Task<bool> HandleOAuthMessageAsync(Dictionary<string, object> message, Uri source)
        {
            object type, action, requestValue, authUrl, provider, challenge;
            if (message == null || !message.TryGetValue("type", out type) || type as string != "oauth") return false;
            if (message.Count != 6 || !message.TryGetValue("action", out action) || action as string != "start" ||
                !message.TryGetValue("requestId", out requestValue) || !(requestValue is string) ||
                String.IsNullOrEmpty((string)requestValue) || ((string)requestValue).Length > 64 ||
                !message.TryGetValue("authUrl", out authUrl) || !(authUrl is string) ||
                !message.TryGetValue("provider", out provider) || !(provider is string) ||
                !message.TryGetValue("codeChallenge", out challenge) || !(challenge is string)) return true;
            string code = null, error = null;
            try { code = await oauthLogin.SignInAsync((string)authUrl, (string)provider, (string)challenge); }
            catch (InvalidOperationException failure) { error = failure.Message; }
            catch (Exception) { error = "Vumiro could not open account sign-in in your browser. Try again."; }
            if (!IsDisposed && browser.CoreWebView2 != null && browser.Source != null && browser.Source.AbsoluteUri == source.AbsoluteUri)
            {
                if (error == null && code != null) { RestoreFromTray(); OAuthLogin.FocusApp(Handle); }
                browser.CoreWebView2.PostWebMessageAsJson(json.Serialize(new Dictionary<string, object> {
                    ["type"] = "oauth-result", ["requestId"] = (string)requestValue, ["code"] = code, ["error"] = error
                }));
            }
            return true;
        }

        private bool HandleSecureStoreMessage(Dictionary<string, object> message)
        {
            object type, actionValue, requestValue;
            if (message == null || !message.TryGetValue("type", out type) || type as string != "secure-store" ||
                !message.TryGetValue("action", out actionValue) || !message.TryGetValue("requestId", out requestValue)) return false;
            var action = actionValue as string; var requestId = requestValue as string;
            if (message.Count != (action == "set" ? 4 : 3) || String.IsNullOrEmpty(requestId) || requestId.Length > 64 ||
                !(action == "get" || action == "set" || action == "delete")) return true;
            string value = null, error = null;
            try
            {
                var directory = ClientRuntime.Current.DataDirectory;
                var file = Path.Combine(directory, "account-session.bin");
                if (action == "get")
                {
                    if (File.Exists(file)) value = Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(file), null, DataProtectionScope.CurrentUser));
                }
                else if (action == "set")
                {
                    object raw; if (!message.TryGetValue("value", out raw) || !(raw is string) || ((string)raw).Length > 8192) throw new InvalidOperationException("Invalid secure account session.");
                    Directory.CreateDirectory(directory);
                    var protectedBytes = ProtectedData.Protect(Encoding.UTF8.GetBytes((string)raw), null, DataProtectionScope.CurrentUser);
                    var temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
                    try
                    {
                        using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
                        {
                            output.Write(protectedBytes, 0, protectedBytes.Length);
                            output.Flush(true);
                        }
                        if (File.Exists(file)) File.Replace(temporary, file, null, true);
                        else File.Move(temporary, file);
                    }
                    finally
                    {
                        if (File.Exists(temporary)) File.Delete(temporary);
                    }
                }
                else if (File.Exists(file)) File.Delete(file);
            }
            catch (Exception) { error = "The operating system could not access secure account storage."; }
            var response = new Dictionary<string, object> { ["type"] = "secure-store-result", ["requestId"] = requestId, ["value"] = value, ["error"] = error };
            browser.CoreWebView2.PostWebMessageAsJson(json.Serialize(response));
            return true;
        }

        private void DismissStartupOverlay()
        {
            if (!startupOverlayActive) return;
            startupOverlayActive = false;
            loading.StopAnimation();
            Controls.Remove(loading);
            loading.Dispose();

            // Removing the covering WinForms control invalidates the child
            // window region. Now that the native loading surface is gone,
            // enable the DWM backdrop and repaint the parent before asking
            // WebView2 to present its already-loaded page.
            PerformLayout();
            browser.BringToFront();
            ApplyWindowAppearance();
            Invalidate(true);
            Update();
            browser.Invalidate();
            browser.Refresh();
        }
    }

    internal sealed class StartupLoading : Control
    {
        private readonly Timer animation = new Timer { Interval = 32 };
        private float angle;
        private bool spinning = true;

        internal StartupLoading()
        {
            DoubleBuffered = true;
            BackColor = Color.FromArgb(11, 11, 12);
            ForeColor = Color.Gainsboro;
            AccessibleRole = AccessibleRole.StaticText;
            animation.Tick += (s, e) => { angle = (angle + 9) % 360; Invalidate(); };
        }

        internal void ShowError(string message)
        {
            spinning = false;
            animation.Stop();
            Text = message;
            Invalidate();
        }

        internal void StopAnimation()
        {
            spinning = false;
            animation.Stop();
        }

        protected override void OnVisibleChanged(EventArgs e)
        {
            base.OnVisibleChanged(e);
            if (Visible && spinning) animation.Start();
            else animation.Stop();
        }

        protected override void OnTextChanged(EventArgs e)
        {
            base.OnTextChanged(e);
            AccessibleName = Text;
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            var scale = DeviceDpi / 96f;
            var size = 36 * scale;
            var centerY = ClientSize.Height / 2f;
            if (spinning)
            {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                var bounds = new RectangleF((ClientSize.Width - size) / 2f, centerY - size - 12 * scale, size, size);
                using (var track = new Pen(Color.FromArgb(48, 25, 30), 3 * scale)) e.Graphics.DrawEllipse(track, bounds);
                using (var arc = new Pen(Color.FromArgb(225, 29, 46), 3 * scale) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                    e.Graphics.DrawArc(arc, bounds, angle, 95);
            }
            var textBounds = new Rectangle((int)(24 * scale), (int)(spinning ? centerY + 7 * scale : centerY - 50 * scale),
                Math.Max(1, ClientSize.Width - (int)(48 * scale)), (int)(100 * scale));
            TextRenderer.DrawText(e.Graphics, Text, Font, textBounds, ForeColor,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.Top | TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) animation.Dispose();
            base.Dispose(disposing);
        }
    }
}
