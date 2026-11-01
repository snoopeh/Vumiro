using System;
using System.Drawing;
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
        private readonly Label loading = new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter, ForeColor = Color.Gainsboro, BackColor = Color.FromArgb(11, 11, 12), Text = "Opening Vumiro…" };
        // Keep this origin and ClientBrowser folder stable: IndexedDB stores
        // existing identity keys and contacts under these compatibility names.
        private const string Origin = "https://screentask.local";
        private const string DefaultSignaling = "wss://screentask-rooms.screentask-room-signaling.workers.dev/call-signaling";
        private Rectangle windowBounds;
        private FormWindowState windowState;
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
            Controls.Add(browser); Controls.Add(loading);
            Shown += async (s, e) => await OpenAsync();
            FormClosed += (s, e) => browser.Dispose();
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
                };
                browser.CoreWebView2.NewWindowRequested += (s, e) => { e.Handled = true; };
                browser.CoreWebView2.WebMessageReceived += async (s, e) => {
                    Uri source;
                    if (!Uri.TryCreate(e.Source, UriKind.Absolute, out source) || source.GetLeftPart(UriPartial.Authority) != Origin || source.AbsolutePath != "/friends.html") return;
                    try
                    {
                        var message = json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
                        if (HandleWindowMessage(message)) return;
                        object type, action;
                        if (message != null && message.Count == 2 && message.TryGetValue("type", out type) && type as string == "updates" && message.TryGetValue("action", out action) && action is string)
                            await updates.HandleAsync((string)action);
                    }
                    catch (ArgumentException) { /* Ignore malformed page messages. */ }
                };
                browser.CoreWebView2.NavigationCompleted += async (s, e) => {
                    if (IsDisposed) return;
                    loading.Visible = !e.IsSuccess;
                    if (!e.IsSuccess) loading.Text = "Vumiro could not load its local interface: " + e.WebErrorStatus;
                    else { PublishWindowState(); await updates.HandleAsync("check"); }
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
                if (!IsDisposed) loading.Text = "Vumiro could not start. Microsoft Edge WebView2 Runtime is required.\n\n" + error.Message;
            }
        }
    }
}
