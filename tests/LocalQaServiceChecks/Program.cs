using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using Vumiro.Client;

internal static class Program
{
    private static async Task Main()
    {
        const string local = "ws://127.0.0.1:8787/call-signaling";
        var previous = Environment.GetEnvironmentVariable("VUMIRO_DEV_SIGNALING_URL");
        try
        {
            Environment.SetEnvironmentVariable("VUMIRO_DEV_SIGNALING_URL", local);
            ClientRuntime.Current.IsLocalQa = false;
            var installed = new ClientWindow();
            await installed.Configure();
            if (installed.Scripts.Count != 0) throw new Exception("Installed launch accepted development overrides.");
            ClientRuntime.Current.IsLocalQa = true;
            var qa = new ClientWindow();
            await qa.Configure();
            if (!qa.Scripts.Exists(script => script.Contains("Object.defineProperty(window, '__VUMIRO_LOCAL_QA_SIGNALING__'") && script.Contains(local) && script.Contains("writable: false") && script.Contains("configurable: false")))
                throw new Exception("Loopback service override must be immutable and installed before each document.");
            foreach (var allowed in new[] { "ws://10.0.0.8:8787/call-signaling", "ws://172.16.3.4:8787/call-signaling", "ws://192.168.1.4:8787/call-signaling", "wss://private-qa.example.test/call-signaling" })
            {
                Environment.SetEnvironmentVariable("VUMIRO_DEV_SIGNALING_URL", allowed);
                var remoteQa = new ClientWindow(); await remoteQa.Configure();
                if (!remoteQa.Scripts.Exists(script => script.Contains("Object.defineProperty(window, '__VUMIRO_LOCAL_QA_SIGNALING__'") && script.Contains(allowed)))
                    throw new Exception("Private two-PC QA signaling was rejected: " + allowed);
            }
            foreach (var invalid in new[] { "ws://example.com:8787/call-signaling", "ws://8.8.8.8/call-signaling", "ws://172.32.0.1/call-signaling", "https://127.0.0.1:8787/call-signaling", "ws://127.0.0.1:8787/other", "ws://user@127.0.0.1:8787/call-signaling", "ws://127.0.0.1:8787/call-signaling?extra=1", "ws://127.0.0.1:8787/call-signaling#fragment", "not a URI", "" })
            {
                Environment.SetEnvironmentVariable("VUMIRO_DEV_SIGNALING_URL", invalid);
                var rejected = new ClientWindow();
                await rejected.Configure();
                if (rejected.Scripts.Exists(script => script.Contains("Object.defineProperty(window, '__VUMIRO_LOCAL_QA_SIGNALING__'")))
                    throw new Exception("Unsafe local service was accepted: " + invalid);
            }
            Console.WriteLine("Passed LOCAL QA service override isolation, URL validation and document injection checks.");
        }
        finally { Environment.SetEnvironmentVariable("VUMIRO_DEV_SIGNALING_URL", previous); }
    }
}

// The actual QA integration runs against a small WebView host substitute so
// these checks exercise URL policy and registered document scripts without UI.
namespace Vumiro.Client
{
    internal sealed class ClientRuntime
    {
        internal static readonly ClientRuntime Current = new ClientRuntime();
        internal bool IsLocalQa;
        internal string Label = "LOCAL QA test";
        internal string DataDirectory = ".";
    }
    internal sealed partial class ClientWindow
    {
        private readonly TestBrowser browser = new TestBrowser();
        private readonly TestJson json = new TestJson();
        internal List<string> Scripts => browser.CoreWebView2.Scripts;
        internal Task Configure() => EnableLocalQaToolsAsync();
    }
    internal sealed class TestJson { internal string Serialize(object value) => JsonSerializer.Serialize(value); }
    internal sealed class TestBrowser { internal readonly TestCore CoreWebView2 = new TestCore(); }
    internal sealed class TestCore
    {
        internal readonly List<string> Scripts = new List<string>();
        internal Task CallDevToolsProtocolMethodAsync(string method, string value) => Task.CompletedTask;
        internal Task AddScriptToExecuteOnDocumentCreatedAsync(string script) { Scripts.Add(script); return Task.CompletedTask; }
        internal void Reload() { }
    }
}
