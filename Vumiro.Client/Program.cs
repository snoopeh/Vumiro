using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Xml.Linq;
using System.Collections.Generic;
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
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new ClientWindow());
        }
    }

    internal sealed partial class ClientWindow : Form
    {
        private readonly WebView2 browser = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(11, 11, 12) };
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

        internal ClientWindow()
        {
            updates = new ClientUpdates(this, state => {
                if (!IsDisposed && browser.CoreWebView2 != null) browser.CoreWebView2.PostWebMessageAsJson(json.Serialize(state));
            });
            Text = "Vumiro";
            BackColor = Color.FromArgb(11, 11, 12);
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(1160, 800);
            MinimumSize = new Size(940, 640);
            InitializeWindowChrome();
            InitializeTrayIcon();
            Controls.Add(browser); Controls.Add(loading);
            loading.BringToFront();
            Shown += async (s, e) => await OpenAsync();
            FormClosed += (s, e) => {
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
            trayIcon = new NotifyIcon { Icon = Icon ?? SystemIcons.Application, Text = "Vumiro", ContextMenuStrip = trayMenu, Visible = false };
            trayIcon.DoubleClick += (s, e) => RestoreFromTray();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            base.OnFormClosing(e);
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
                var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ScreenTask", "ClientBrowser");
                var environment = await CoreWebView2Environment.CreateAsync(null, profile);
                if (IsDisposed) return;
                await browser.EnsureCoreWebView2Async(environment);
                browser.CoreWebView2.SetVirtualHostNameToFolderMapping(new Uri(Origin).Host, Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "WebServer"), CoreWebView2HostResourceAccessKind.DenyCors);
                browser.CoreWebView2.Settings.IsStatusBarEnabled = false;
                browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                browser.CoreWebView2.ContainsFullScreenElementChanged += (s, e) => {
                    SetContentFullscreen(browser.CoreWebView2.ContainsFullScreenElement);
                };
                browser.CoreWebView2.NavigationStarting += (s, e) => {
                    Uri target;
                    if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out target) || target.GetLeftPart(UriPartial.Authority) != Origin) e.Cancel = true;
                    if (!e.Cancel) StopStreamAudio();
                };
                browser.CoreWebView2.NewWindowRequested += (s, e) => { e.Handled = true; };
                browser.CoreWebView2.WebMessageReceived += async (s, e) => {
                    Uri source;
                    if (!Uri.TryCreate(e.Source, UriKind.Absolute, out source) || source.GetLeftPart(UriPartial.Authority) != Origin || source.AbsolutePath != "/friends.html") return;
                    try
                    {
                        var message = json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
                        if (HandleStreamAudioMessage(message)) return;
                        if (HandleWindowMessage(message)) return;
                        object type, action;
                        if (message != null && message.Count == 2 && message.TryGetValue("type", out type) && type as string == "updates" && message.TryGetValue("action", out action) && action is string)
                            await updates.HandleAsync((string)action);
                    }
                    catch (ArgumentException) { /* Ignore malformed page messages. */ }
                };
                browser.CoreWebView2.NavigationCompleted += async (s, e) => {
                    if (IsDisposed) return;
                    if (!e.IsSuccess)
                    {
                        if (startupOverlayActive) loading.ShowError("Vumiro could not load its local interface: " + e.WebErrorStatus);
                    }
                    else
                    {
                        DismissStartupOverlay();
                        PublishWindowState();
                        await updates.HandleAsync("check");
                    }
                };
                var signaling = DefaultSignaling;
                var fps = 60; var bitrate = 20;
                try
                {
                    var preferences = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ScreenTask", "appsettings.xml");
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
                if (!IsDisposed) loading.ShowError("Vumiro could not start. Microsoft Edge WebView2 Runtime is required.\n\n" + error.Message);
            }
        }

        private void DismissStartupOverlay()
        {
            if (!startupOverlayActive) return;
            startupOverlayActive = false;
            loading.StopAnimation();
            Controls.Remove(loading);
            loading.Dispose();

            // Removing the covering WinForms control invalidates the child
            // window region. Refresh the existing WebView2 surface so its
            // compositor presents the already-loaded page immediately.
            PerformLayout();
            browser.BringToFront();
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
