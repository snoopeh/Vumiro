using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

namespace Vumiro.Client
{
    internal sealed partial class ClientWindow
    {
        private async Task EnableLocalQaToolsAsync()
        {
            if (!ClientRuntime.Current.IsLocalQa) return;
            await browser.CoreWebView2.CallDevToolsProtocolMethodAsync("Network.setCacheDisabled", "{\"cacheDisabled\":true}");
            var service = Environment.GetEnvironmentVariable("VUMIRO_DEV_SIGNALING_URL");
            Uri localService;
            var hasLocalService = Uri.TryCreate(service, UriKind.Absolute, out localService) && localService.IsLoopback &&
                (localService.Scheme == "ws" || localService.Scheme == "wss") && localService.UserInfo.Length == 0 &&
                localService.AbsolutePath == "/call-signaling" && localService.Query.Length == 0 && localService.Fragment.Length == 0;
            if (hasLocalService)
                await browser.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(
                    "Object.defineProperty(window, '__VUMIRO_LOCAL_QA_SIGNALING__', {value:" + json.Serialize(localService.AbsoluteUri) + ", writable: false, configurable: false});");
            await browser.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(@"
                window.__VUMIRO_LOCAL_QA__ = true;
                if (window === window.top) addEventListener('DOMContentLoaded', () => {
                    const bar = document.getElementById('windowTitlebar') || document.getElementById('authTitlebar');
                    if (!bar) return;
                    const tools = document.createElement('span'); tools.id = 'localQaBadge';
                    tools.style.cssText = 'display:flex;align-items:center;gap:10px;margin-left:auto;padding:0 12px;font:11px system-ui;color:#f5c66b';
                    const label = document.createElement('span'); label.textContent = " + json.Serialize(ClientRuntime.Current.Label + (hasLocalService ? " · LOCAL SERVICE" : "")) + @";
                    const reload = document.createElement('button'); reload.type = 'button'; reload.textContent = 'Reload UI';
                    reload.title = 'Load current source files. This ends any room in this QA window.';
                    reload.style.cssText = 'font:inherit;padding:3px 8px;border:1px solid #675127;border-radius:4px;background:#332918;color:#f5c66b';
                    reload.onclick = () => window.chrome.webview.postMessage({type:'development',action:'reload'});
                    tools.append(label, reload); bar.insertBefore(tools, bar.querySelector('.windowControls'));
                    document.title = 'Vumiro · ' + label.textContent;
                });");
        }

        private bool HandleLocalQaMessage(Dictionary<string, object> message)
        {
            object type, action;
            if (!ClientRuntime.Current.IsLocalQa || message == null || message.Count != 2 ||
                !message.TryGetValue("type", out type) || type as string != "development" ||
                !message.TryGetValue("action", out action) || action as string != "reload") return false;
            browser.CoreWebView2.Reload();
            return true;
        }

        private void WriteLocalQaStatus(string state, string message = null)
        {
            if (!ClientRuntime.Current.IsLocalQa) return;
            try
            {
                Directory.CreateDirectory(ClientRuntime.Current.DataDirectory);
                File.WriteAllText(Path.Combine(ClientRuntime.Current.DataDirectory, "local-qa-status.json"),
                    json.Serialize(new { processId = Process.GetCurrentProcess().Id, state, message }));
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }
}
