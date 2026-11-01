using System;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ScreenTask
{
    public partial class frmMain
    {
        private WebView2 callBrowser;
        private TextBox callSignalingInput;
        private Label callStatus;
        private Panel callSurface;
        private Button openCall;
        private string callUserDataFolder = null;

        private void BuildCallTab(TabControl tabs)
        {
            var tab = new TabPage("Call") { BackColor = Color.FromArgb(11, 16, 27), Padding = new Padding(8) };
            tabs.TabPages.Add(tab);
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3 };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            var address = new TableLayoutPanel { Dock = DockStyle.Top, ColumnCount = 2, AutoSize = true };
            address.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            address.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            callSignalingInput = new TextBox { Dock = DockStyle.Fill, AccessibleName = "Call signaling service", Text = "" };
            openCall = new Button { Text = "Open call", AutoSize = true };
            openCall.Click += async (s, e) => await OpenCallAsync();
            address.Controls.Add(callSignalingInput, 0, 0); address.Controls.Add(openCall, 1, 0);
            callStatus = new Label { AutoSize = true, Dock = DockStyle.Fill, ForeColor = Color.Gainsboro,
                Text = "Open your shared call below. Joining does not start a server on this PC." };
            callSurface = new Panel { Dock = DockStyle.Fill, BackColor = Color.FromArgb(11, 16, 27) };
            layout.Controls.Add(address, 0, 0); layout.Controls.Add(callStatus, 0, 1); layout.Controls.Add(callSurface, 0, 2);
            tab.Controls.Add(layout);
            tabs.SelectedTab = tab;
            Shown += async (s, e) => {
                if (IsDisposed) return;
                tabs.SelectedTab = tab;
                if (!String.IsNullOrWhiteSpace(callSignalingInput.Text)) await OpenCallAsync();
            };
        }

        private async Task OpenCallAsync()
        {
            if (openCall == null || !openCall.Enabled) return;
            openCall.Enabled = false;
            try
            {
                var endpoint = callSignalingInput.Text.Trim();
                if (String.IsNullOrEmpty(endpoint))
                {
                    if (!isWorking) { callStatus.Text = "A shared signaling service is required. Enter its HTTPS/WSS address, or start one local server to test the call."; return; }
                    endpoint = "ws://localhost:" + _currentSettings.Port + "/call-signaling";
                }
                var signaling = CallEndpoint(endpoint);
                if (callBrowser == null)
                {
                    callBrowser = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(11, 16, 27) };
                    callSurface.Controls.Add(callBrowser);
                    var data = callUserDataFolder ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ScreenTask", "CallBrowser");
                    var environment = await CoreWebView2Environment.CreateAsync(null, data);
                    await callBrowser.EnsureCoreWebView2Async(environment);
                    callBrowser.CoreWebView2.SetVirtualHostNameToFolderMapping("screentask.local",
                        Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "WebServer"), CoreWebView2HostResourceAccessKind.DenyCors);
                    callBrowser.CoreWebView2.Settings.IsStatusBarEnabled = false;
                    // Keep external navigations out of the embedded capture origin.
                    callBrowser.CoreWebView2.NavigationStarting += (s, e) => {
                        Uri target;
                        if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out target) || target.Host != "screentask.local" || target.Scheme != "https") e.Cancel = true;
                    };
                    callBrowser.CoreWebView2.NewWindowRequested += (s, e) => { e.Handled = true; };
                }
                _currentSettings.CallSignalingUrl = signaling.AbsoluteUri;
                if (_settingsReady) SettingsStore.Save(_preferencesPath, _currentSettings);
                var fps = Math.Max(1, Math.Min(120, (int)numShotEvery.Value));
                callBrowser.Source = new Uri("https://screentask.local/call.html?signaling=" + Uri.EscapeDataString(signaling.AbsoluteUri) +
                    "&fps=" + fps + "&mbps=" + GetSelectedBitrate());
                callStatus.Text = "Create or join a room below. Everyone can share here. Media goes directly between participants; no local server is started by joining.";
            }
            catch (Exception ex)
            {
                callStatus.Text = "Call could not open: " + ex.Message + ". The Microsoft Edge WebView2 Runtime is required.";
                if (callBrowser != null && callBrowser.CoreWebView2 == null) { callBrowser.Dispose(); callBrowser = null; }
            }
            finally { if (!IsDisposed) openCall.Enabled = true; }
        }

        internal static Uri CallEndpoint(string value)
        {
            Uri uri;
            if (!Uri.TryCreate(value, UriKind.Absolute, out uri) || !String.IsNullOrEmpty(uri.UserInfo) ||
                !(uri.Scheme == "http" || uri.Scheme == "https" || uri.Scheme == "ws" || uri.Scheme == "wss"))
                throw new ArgumentException("Use an HTTPS or WSS signaling address without credentials.");
            if ((uri.Scheme == "http" || uri.Scheme == "ws") && !uri.IsLoopback)
                throw new ArgumentException("Remote signaling requires HTTPS/WSS.");
            var builder = new UriBuilder(uri) { Scheme = uri.Scheme == "https" || uri.Scheme == "wss" ? "wss" : "ws", Query = "", Fragment = "" };
            if (uri.IsDefaultPort) builder.Port = -1;
            if (builder.Path == "/" || builder.Path == "/call" || builder.Path == "/call.html") builder.Path = "/call-signaling";
            return builder.Uri;
        }
    }
}
