using System;
using System.IO;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length != 1) { Console.Error.WriteLine("Pass the Vumiro repository root."); return 2; }
        string root = Path.GetFullPath(args[0]);
        string source = File.ReadAllText(Path.Combine(root, "Vumiro.Client/WebServer/friends-client.js"));
        int start = source.IndexOf("async function resizeBanner(", StringComparison.Ordinal);
        int end = source.IndexOf("$('bannerFile').onchange", start, StringComparison.Ordinal);
        string encoder = source.Substring(start, end - start);
        string fixtures = File.ReadAllText(Path.Combine(root, "tests/CoverEncodingChecks/fixtures.js"));
        // Separate ephemeral browser data: never open the installed or LOCAL QA profile.
        string data = Path.Combine(Path.GetTempPath(), "vumiro-cover-check-" + Guid.NewGuid().ToString("N"));
        int result = 1;
        Application.EnableVisualStyles();
        using (var form = new Form { Width = 1000, Height = 800, Opacity = 0, ShowInTaskbar = false })
        using (var web = new WebView2 { Dock = DockStyle.Fill })
        using (var timeout = new Timer { Interval = 60000 })
        {
            form.Controls.Add(web);
            timeout.Tick += (_, __) => { Console.Error.WriteLine("Cover encoder runtime checks timed out."); form.Close(); };
            form.Shown += async (_, __) => {
                try {
                    var environment = await CoreWebView2Environment.CreateAsync(null, data);
                    await web.EnsureCoreWebView2Async(environment);
                    web.CoreWebView2.WebMessageReceived += (sender, message) => {
                        string report = message.TryGetWebMessageAsString();
                                                if (report.StartsWith("IMAGE ", StringComparison.Ordinal)) {
                            string output = Path.Combine(root, "dist/local-qa/cover-encoding-comparison.png");
                            Directory.CreateDirectory(Path.GetDirectoryName(output));
                            File.WriteAllBytes(output, Convert.FromBase64String(report.Substring(6)));
                            Console.WriteLine("Comparison: " + output); return;
                        }
                        Console.WriteLine(report);
                        result = report.StartsWith("PASS ", StringComparison.Ordinal) ? 0 : 1;
                        form.Close();
                    };
                    web.CoreWebView2.NavigationCompleted += async (sender, navigation) => {
                        if (!navigation.IsSuccess) { Console.Error.WriteLine("Test document failed to load."); form.Close(); return; }
                        await web.CoreWebView2.ExecuteScriptAsync(encoder + "\n" + fixtures);
                    };
                    web.NavigateToString("<!doctype html><meta charset='utf-8'><title>Vumiro cover encoder checks</title>");
                    timeout.Start();
                } catch (Exception error) { Console.Error.WriteLine(error); form.Close(); }
            };
            Application.Run(form);
        }
        // WebView's child processes may release the temporary folder after exit.
        try { Directory.Delete(data, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        return result;
    }
}