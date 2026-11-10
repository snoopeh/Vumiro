using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace Vumiro.Client
{
    internal sealed partial class ClientWindow
    {
        private bool diagnosticsExporting;
        // Origin and page checks are performed by the host before dispatching here.
        private bool HandleDiagnosticsMessage(Dictionary<string, object> message)
        {
            object type, action;
            if (message == null || !message.TryGetValue("type", out type) || type as string != "diagnostics") return false;
            if (!message.TryGetValue("action", out action) || !(action is string)) return true;
            if ((string)action == "record" && message.Count == 4)
            {
                object eventName, details;
                if (message.TryGetValue("event", out eventName) && eventName is string &&
                    message.TryGetValue("details", out details) && details is Dictionary<string, object>)
                    ClientDiagnostics.Current.Enqueue((string)eventName, (Dictionary<string, object>)details);
            }
            else if ((string)action == "export" && message.Count == 2)
            {
                if (!diagnosticsExporting) ExportDiagnosticsAsync();
            }
            return true;
        }

        private async void ExportDiagnosticsAsync()
        {
            diagnosticsExporting = true;
            try
            {
                using (var dialog = new SaveFileDialog {
                    Title = "Export Vumiro diagnostics", Filter = "ZIP archive (*.zip)|*.zip", DefaultExt = "zip", AddExtension = true,
                    FileName = "Vumiro-diagnostics-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + ".zip", OverwritePrompt = true
                })
                {
                    if (dialog.ShowDialog(this) != DialogResult.OK) PublishDiagnostics("cancelled", "Diagnostics export cancelled.");
                    else
                    {
                        var destination = dialog.FileName;
                        var success = await Task.Run(() => ClientDiagnostics.Current.WriteToZip(destination));
                        PublishDiagnostics(success ? "exported" : "error", success ? "Diagnostics exported. Share the ZIP with support when ready." : "Could not export diagnostics. Choose a ZIP file in a writable folder.");
                    }
                }
            }
            catch (Exception) { PublishDiagnostics("error", "Could not export diagnostics."); }
            finally { diagnosticsExporting = false; }
        }

        private void PublishDiagnostics(string action, string message)
        {
            if (IsDisposed || browser.CoreWebView2 == null) return;
            try { browser.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { type = "diagnostics", action, message })); }
            catch (InvalidOperationException) { }
            catch (COMException) { }
        }
    }
}
