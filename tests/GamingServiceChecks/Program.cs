using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Vumiro.Client;

internal static class Program
{
    private static int checks;
    private static void Check(bool condition, string message) { if (!condition) throw new Exception(message); checks++; }
    private static async Task Throws(Func<Task> operation, string code)
    {
        try { await operation(); throw new Exception("Expected " + code); }
        catch (GamingServiceException error) { Check(error.Code == code, "Wrong error: " + error.Code); }
    }
    private static void Main() { Run().GetAwaiter().GetResult(); }
    private static async Task Run()
    {
        foreach (var id in new[] { "8056c2e21c000001", "ABCDEF0123456789" }) Check(GamingServices.IsNetworkId(id), "Valid network rejected");
        foreach (var id in new[] { "", "8056c2e21c000001/", "8056c2e21c00000g", " 8056c2e21c000001", "8056c2e21c000001\n" }) Check(!GamingServices.IsNetworkId(id), "Unsafe network accepted");
        foreach (var host in new[] { "192.168.0.2", "2001:db8::1", "gaming-pc", "gaming-pc.local" }) Check(GamingServices.IsHost(host), "Valid host rejected: " + host);
        foreach (var host in new[] { "", "-help", "--help", "host --help", "https://host", "host:47989", "host/path", "host\"", "host\n", "foo&calc", "[::1]", "999.999.999.999", "a..b" }) Check(!GamingServices.IsHost(host), "Unsafe host accepted: " + host);
        foreach (var component in new[] { "zerotier", "central", "sunshine", "moonlight", "driver" }) Check(GamingServices.SetupUrl(component).StartsWith("https://"), "Setup URL missing");
        Check(GamingServices.SetupUrl("https://evil.example") == null, "Arbitrary setup URL allowed");

        var handler = new FakeHandler();
        var launches = new List<ProcessStartInfo>();
        using (var service = new GamingServices(handler, () => "privateToken123\r\n", path => path.EndsWith("Moonlight.exe") || path.EndsWith("sunshine.exe"), launches.Add))
        {
            var state = await service.GetStatusAsync();
            var lan = (Dictionary<string, object>)state["lan"];
            Check((string)lan["state"] == "ready", "Online service not ready");
            Check((bool)lan["online"], "Online missing");
            Check(((object[])lan["networks"]).Length == 1, "Networks not projected");
            Check(((object[])lan["peers"]).Length == 1, "Peers not projected");
            Check(!new JavaScriptSerializer().Serialize(state).Contains("privateToken123"), "Token leaked to status");
            Check(!new JavaScriptSerializer().Serialize(state).Contains("identitySecret"), "Raw service fields leaked");
            Check(handler.Requests.Count == 3, "Expected status, networks, peers reads");
            await service.ChangeNetworkAsync("ABCDEF0123456789", true);
            Check(handler.Requests.Contains("POST /network/abcdef0123456789 {}"), "Join request incorrect");
            await service.ChangeNetworkAsync("abcdef0123456789", false);
            Check(handler.Requests.Contains("DELETE /network/abcdef0123456789 "), "Leave request incorrect");
            var requestCount = handler.Requests.Count;
            await Throws(() => service.ChangeNetworkAsync("abc/../../status", true), "invalid-network");
            Check(requestCount == handler.Requests.Count, "Invalid network made a request");
            service.Launch("pair", null, "gaming-pc.local");
            Check(launches[0].Arguments == "pair \"gaming-pc.local\"", "Pair argument mismatch");
            Check(!launches[0].UseShellExecute && Path.IsPathRooted(launches[0].FileName), "Executable launch must bypass shell/PATH");
            service.Launch("stream", null, "2001:db8::1");
            Check(launches[1].Arguments == "stream \"2001:db8::1\" \"Desktop\"", "Stream argument mismatch");
            service.Launch("list", null, "192.168.0.2");
            Check(launches[2].Arguments == "list \"192.168.0.2\"", "List argument mismatch");
            await Throws(() => Task.FromResult(service.Launch("stream", null, "--help")), "invalid-host");
            service.Launch("open-host", null, null);
            Check(launches[3].FileName == "https://localhost:47990" && launches[3].UseShellExecute, "Sunshine host URL incorrect");
            await Throws(() => Task.FromResult(service.Launch("open-setup", "cmd.exe", null)), "invalid-component");
        }
        Check(handler.Disposed, "HTTP handler not disposed");
        using (var missing = new GamingServices(new FakeHandler(), () => { throw new FileNotFoundException(); }, path => false, launches.Add))
        {
            var state = await missing.GetStatusAsync();
            Check((string)((Dictionary<string, object>)state["lan"])["state"] == "not-installed", "Missing dependency not reported");
            await Throws(() => Task.FromResult(missing.Launch("pair", null, "host")), "missing-moonlight");
            await Throws(() => Task.FromResult(missing.Launch("open-host", null, null)), "missing-sunshine");
        }
        using (var denied = new GamingServices(new FakeHandler(), () => { throw new UnauthorizedAccessException("privateToken123"); }, path => true, launches.Add))
        {
            var state = await denied.GetStatusAsync();
            Check((string)((Dictionary<string, object>)state["lan"])["state"] == "permission-required", "Unreadable token not explained");
        }
        using (var rejected = new GamingServices(new FakeHandler { StatusCode = HttpStatusCode.Unauthorized }, () => "privateToken123", path => true, launches.Add))
        {
            var state = await rejected.GetStatusAsync();
            Check((string)((Dictionary<string, object>)state["lan"])["state"] == "permission-required", "Rejected token not explained");
        }
        using (var offline = new GamingServices(new FakeHandler { Offline = true }, () => "privateToken123", path => true, launches.Add))
        {
            var state = await offline.GetStatusAsync();
            Check((string)((Dictionary<string, object>)state["lan"])["state"] == "unavailable", "Stopped service not explained");
        }
        using (var malformed = new GamingServices(new FakeHandler { Malformed = true }, () => "privateToken123", path => true, launches.Add))
        {
            var state = await malformed.GetStatusAsync();
            Check((string)((Dictionary<string, object>)state["lan"])["state"] == "error", "Invalid API data not explained");
        }
        using (var invalidShape = new GamingServices(new FakeHandler { MissingStatus = true }, () => "privateToken123", path => true, launches.Add))
        {
            var state = await invalidShape.GetStatusAsync();
            Check((string)((Dictionary<string, object>)state["lan"])["state"] == "error", "Missing online/address fields silently accepted");
        }
        var invalidTokenHandler = new FakeHandler();
        using (var invalidToken = new GamingServices(invalidTokenHandler, () => "secret\r\nInjected: yes", path => true, launches.Add))
        {
            var state = await invalidToken.GetStatusAsync();
            Check((string)((Dictionary<string, object>)state["lan"])["state"] == "permission-required" && invalidTokenHandler.Requests.Count == 0, "Malformed token made a request");
        }
        using (var booting = new GamingServices(new FakeHandler(), () => { throw new FileNotFoundException(); }, path => true, launches.Add))
        {
            var state = await booting.GetStatusAsync();
            Check((string)((Dictionary<string, object>)state["lan"])["state"] == "unavailable", "Installed service without token marked not installed");
        }
        var window = new ClientWindow();
        Check(!await window.Handle(new Dictionary<string, object> { { "type", "other" } }), "Unrelated message consumed");
        Check(await window.Handle(new Dictionary<string, object> { { "type", "gaming" }, { "requestId", "invalid-id!" }, { "action", "open-setup" }, { "component", "moonlight" } }), "Malformed gaming message not consumed");
        Check(window.Replies.Count == 0, "Invalid request ID accepted");
        var validId = "a1234567890123456789012345678901";
        Check(await window.Handle(new Dictionary<string, object> { { "type", "gaming" }, { "requestId", validId }, { "action", "mapper-start" } }), "Mapper not delegated");
        var reply = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(window.Replies[0]);
        Check(!(bool)reply["ok"] && (string)reply["error"] == "Mapper unavailable", "Mapper failure not propagated");
        await window.Handle(new Dictionary<string, object> { { "type", "gaming" }, { "requestId", validId }, { "action", "arbitrary-command" } });
        reply = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(window.Replies[1]);
        Check(!(bool)reply["ok"], "Unknown command accepted");
        await window.Handle(new Dictionary<string, object> { { "type", "gaming" }, { "requestId", "gni7wk2f01" }, { "action", "mapper-start" } });
        Check(window.Replies.Count == 3, "UI-generated short request ID rejected");
        await window.Handle(new Dictionary<string, object> { { "type", "gaming" }, { "requestId", new string('a', 65) }, { "action", "mapper-start" } });
        Check(window.Replies.Count == 3, "Oversized request ID accepted");
        window.Stop();
        Check(window.ControllerStopped, "Controller cleanup missing");
        await window.Handle(new Dictionary<string, object> { { "type", "gaming" }, { "requestId", "afterReload" }, { "action", "mapper-start" } });
        Check(window.Replies.Count == 4, "Gaming bridge stayed stopped after navigation");

        var pendingHandler = new DelayedHandler();
        var navigated = new ClientWindow();
        navigated.UseService(new GamingServices(pendingHandler, () => "privateToken123", path => false, launches.Add));
        var pending = navigated.Handle(new Dictionary<string, object> { { "type", "gaming" }, { "requestId", "oldPage" }, { "action", "status" } });
        navigated.Stop();
        pendingHandler.Complete();
        await pending;
        Check(navigated.Replies.Count == 0 && navigated.ControllerCalls == 0, "Old page request replied or restarted mapper after navigation");
        var merged = new ClientWindow();
        merged.UseService(new GamingServices(new FakeHandler(), () => "privateToken123", path => false, launches.Add));
        await merged.Handle(new Dictionary<string, object> { { "type", "gaming" }, { "requestId", "statusPage" }, { "action", "status" } });
        reply = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(merged.Replies[0]);
        var mergedResult = (Dictionary<string, object>)reply["result"];
        var mergedStatus = (Dictionary<string, object>)mergedResult["status"];
        Check((bool)reply["ok"] && mergedResult["controller"] != null && mergedStatus["controller"] != null, "Controller status missing from native status result");
        merged.Stop();
        Console.WriteLine("Passed " + checks + " gaming service and bridge checks.");
    }
    private sealed class FakeHandler : HttpMessageHandler
    {
        internal readonly List<string> Requests = new List<string>();
        internal HttpStatusCode StatusCode = HttpStatusCode.OK;
        internal bool Offline, Malformed, MissingStatus, Disposed;
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Check(request.RequestUri.Scheme == "http" && request.RequestUri.Host == "127.0.0.1" && request.RequestUri.Port == 9993, "API left loopback");
            Check(string.Join("", request.Headers.GetValues("X-ZT1-AUTH")) == "privateToken123", "Missing local auth header");
            Requests.Add(request.Method + " " + request.RequestUri.AbsolutePath + " " + (request.Content == null ? "" : await request.Content.ReadAsStringAsync()));
            if (Offline) throw new HttpRequestException("privateToken123");
            var path = request.RequestUri.AbsolutePath;
            var body = Malformed ? "bad-json-privateToken123" : path == "/status" ? "{\"address\":\"1234567890\",\"online\":true,\"version\":\"1.16\",\"identitySecret\":\"privateToken123\"}" :
                path == "/network" ? "[{\"id\":\"8056c2e21c000001\",\"name\":\"Party\",\"status\":\"OK\",\"type\":\"PRIVATE\",\"assignedAddresses\":[\"10.1.2.3/24\"]}]" :
                path == "/peer" ? "[{\"address\":\"0123456789\",\"role\":\"LEAF\",\"latency\":12,\"paths\":[{\"address\":\"1.2.3.4/9993\",\"active\":true}]}]" : "{}";
            if (MissingStatus && path == "/status") body = "{}";
            return new HttpResponseMessage(StatusCode) { Content = new StringContent(body) };
        }
        protected override void Dispose(bool disposing) { Disposed = true; base.Dispose(disposing); }
    }
    private sealed class DelayedHandler : HttpMessageHandler
    {
        private readonly TaskCompletionSource<HttpResponseMessage> completion = new TaskCompletionSource<HttpResponseMessage>();
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) { return completion.Task; }
        internal void Complete() { completion.TrySetResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"online\":true}") }); }
    }
}

namespace Vumiro.Client
{
    internal sealed partial class ClientWindow
    {
        private readonly TestBrowser browser = new TestBrowser();
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        internal bool IsDisposed = false, ControllerStopped;
        internal int ControllerCalls;
        internal List<string> Replies { get { return browser.CoreWebView2.Replies; } }
        internal Task<bool> Handle(Dictionary<string, object> value) { return HandleGamingMessageAsync(value); }
        internal void Stop() { StopGaming(); }
        internal void UseService(GamingServices value) { gamingServices = value; }
        private object HandleGamingControllerAction(string action, Dictionary<string, object> value)
        {
            ControllerCalls++;
            if (action == "mapper-start") return new Dictionary<string, object> { { "ok", false }, { "error", "Mapper unavailable" } };
            if (action == "mapper-status") return new Dictionary<string, object> { { "ok", true }, { "controller", new Dictionary<string, object> { { "available", false }, { "active", false } } } };
            return null;
        }
        private void StopGamingController() { ControllerStopped = true; }
    }
    internal sealed class TestBrowser { internal readonly TestCore CoreWebView2 = new TestCore(); }
    internal sealed class TestCore
    {
        internal readonly List<string> Replies = new List<string>();
        internal void PostWebMessageAsJson(string reply) { Replies.Add(reply); }
    }
}
