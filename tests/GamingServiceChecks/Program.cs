using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Vumiro.Client;
internal static class Program
{
    private static int checks;
    private static void Check(bool condition, string text) { if (!condition) throw new Exception(text); checks++; }
    private static Dictionary<string, object> Message(string action, string id = "g123") { return new Dictionary<string, object> { { "type", "gaming" }, { "requestId", id }, { "action", action }, { "sessionId", "00112233445566778899aabbccddeeff" }, { "address", "10.203.42.1" } }; }
    private static Dictionary<string, object> Last(ClientWindow window) { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(window.Replies[window.Replies.Count - 1]); }
    private static void Main() { Run().GetAwaiter().GetResult(); }
    private static async Task Run()
    {
        var window = new ClientWindow();
        Check(!await window.Handle(new Dictionary<string, object> { { "type", "other" } }), "unrelated message consumed");
        foreach (var id in new[] { "", "bad-id", new string('a', 65), "abc\n" }) await window.Handle(Message("status", id));
        Check(window.Replies.Count == 0 && GamingHostClient.Created == 0, "bad envelope replied/elevated");
        await window.Handle(Message("status")); var reply = Last(window); var result = (Dictionary<string, object>)reply["result"]; var status = (Dictionary<string, object>)result["status"];
        Check((bool)reply["ok"] && (string)status["engine"] == "vumiro" && (bool)status["builtIn"], "own status missing");
        Check((string)((Dictionary<string, object>)status["lan"])["state"] == "stopped", "idle status invented LAN readiness");
        Check((bool)((Dictionary<string, object>)status["runtime"])["lanDriverBundled"], "bundled LAN runtime absent");
        Check(status["controller"] != null && result["controller"] != null && GamingHostClient.Created == 0, "status raised UAC or lost controller");
        foreach (var action in new[] { "lan-join", "lan-leave", "open-setup", "open-host", "pair", "stream", "list", "arbitrary-command" }) {
            await window.Handle(Message(action)); Check(!(bool)Last(window)["ok"], "retired action accepted: " + action);
        }
        Check(GamingHostClient.Created == 0, "retired actions created helper");
        var invalid = Message("lan-start"); invalid["address"] = "127.0.0.1"; await window.Handle(invalid);
        Check(!(bool)Last(window)["ok"] && GamingHostClient.Created == 0, "invalid start elevated");
        await window.Handle(Message("lan-start"));
        Check((bool)Last(window)["ok"] && GamingHostClient.Created == 1, "LAN did not use helper");
        Check((string)((Dictionary<string, object>)((Dictionary<string, object>)Last(window)["result"])["lan"])["state"] == "starting", "starting adapter faked active");
        var host = GamingHostClient.Latest;
        for (var i = 0; i < 500; i++) host.Emit("00112233445566778899aabbccddeeff");
        Check(window.Callbacks.Count <= 128, "unbounded helper UI callbacks"); window.Drain();
        Check(window.Replies.Count >= 128, "native packet events not posted");
        await window.Handle(Message("lan-status"));
        Check(Convert.ToInt64(((Dictionary<string, object>)((Dictionary<string, object>)Last(window)["result"])["lan"])["bridgePacketsDropped"]) >= 372, "bridge drops absent from status");
        var previous = window.Replies.Count; host.Emit("ffeeddccbbaa99887766554433221100"); window.Drain();
        Check(window.Replies.Count == previous, "cross session event forwarded");
        host.Emit("00112233445566778899aabbccddeeff"); window.Stop(); window.Drain();
        Check(window.Replies.Count == previous && host.Disposed && window.ControllerStopped, "stop leaked helper or stale event");
        var pendingReply = new TaskCompletionSource<Dictionary<string, object>>(); GamingHostClient.NextReply = (action, message) => pendingReply.Task;
        var navigated = new ClientWindow(); var pending = navigated.Handle(Message("lan-start")); navigated.Stop();
        pendingReply.SetResult(GamingHostClient.Success("starting")); await pending;
        Check(navigated.Replies.Count == 0 && navigated.ControllerCalls == 0, "old page async reply survived");
        GamingHostClient.NextReply = null;
        var controller = new ClientWindow { ControllerAvailable = false }; await controller.Handle(Message("remote-controller-start"));
        Check((bool)Last(controller)["ok"] && GamingHostClient.Latest.Actions.Contains("install-controller") && controller.ControllerStarts == 2, "controller driver did not install and retry");
        controller.Stop();
        GamingHostClient.NextReply = (action, message) => { throw new InvalidOperationException("private path token"); };
        var failure = new ClientWindow(); await failure.Handle(Message("lan-start"));
        Check(!(bool)Last(failure)["ok"] && !new JavaScriptSerializer().Serialize(Last(failure)).Contains("private path token"), "helper exception leaked details");
        failure.Stop(); GamingHostClient.NextReply = null;
        var restart = new ClientWindow { ControllerAvailable = false }; GamingHostClient.NextReply = (action, message) => Task.FromResult(new Dictionary<string, object> { { "ok", true }, { "controller", new Dictionary<string, object> { { "restartRequired", true } } } });
        await restart.Handle(Message("remote-controller-start"));
        Check(!(bool)Last(restart)["ok"], "driver restart falsely reported active"); restart.Stop(); GamingHostClient.NextReply = null;
        Console.WriteLine("PASS " + checks + " built-in gaming bridge checks.");
    }
}
namespace Vumiro.Client
{
    internal sealed partial class ClientWindow
    {
        private readonly TestBrowser browser = new TestBrowser(); private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        internal bool IsDisposed = false, Disposing = false, ControllerStopped, ControllerAvailable = true; internal bool IsHandleCreated = true; internal int ControllerCalls, ControllerStarts;
        internal readonly Queue<Action> Callbacks = new Queue<Action>(); internal List<string> Replies { get { return browser.CoreWebView2.Replies; } }
        internal Task<bool> Handle(Dictionary<string, object> value) { return HandleGamingMessageAsync(value); } internal void Stop() { StopGaming(); }
        internal void BeginInvoke(Action action) { Callbacks.Enqueue(action); }
        internal void Drain() { while (Callbacks.Count > 0) Callbacks.Dequeue()(); }
        private object HandleGamingControllerAction(string action, Dictionary<string, object> value)
        {
            ControllerCalls++; if (action != "mapper-status" && action != "controller-status" && action != "remote-controller-status" && action != "remote-controller-start" && action != "remote-controller-stop" && action != "remote-controller-frame") return null;
            if (action == "remote-controller-start") { ControllerStarts++; if (ControllerStarts > 1 && !GamingHostClient.RestartRequired) ControllerAvailable = true; }
            return new Dictionary<string, object> { { "ok", action != "remote-controller-start" || ControllerAvailable }, { "error", ControllerAvailable ? null : "Controller unavailable." }, { "controller", new Dictionary<string, object> { { "available", ControllerAvailable }, { "active", action == "remote-controller-start" && ControllerAvailable } } } };
        }
        private void StopGamingController() { ControllerStopped = true; }
    }
    internal sealed class TestBrowser { internal readonly TestCore CoreWebView2 = new TestCore(); }
    internal sealed class TestCore { internal readonly List<string> Replies = new List<string>(); internal void PostWebMessageAsJson(string reply) { Replies.Add(reply); } }
    internal static class GamingPayloads { internal static bool LanDriverBundled { get { return true; } } internal static bool ControllerDriverBundled { get { return true; } } }
    internal sealed class GamingHostClient : IDisposable
    {
        internal static int Created; internal static GamingHostClient Latest; internal static Func<string, Dictionary<string, object>, Task<Dictionary<string, object>>> NextReply; internal static bool RestartRequired;
        internal readonly List<string> Actions = new List<string>(); internal bool Disposed; internal bool IsConnected { get { return !Disposed; } }
        internal event Action<Dictionary<string, object>> PacketReceived;
        internal GamingHostClient() { Created++; Latest = this; RestartRequired = false; }
        internal static Dictionary<string, object> Success(string state) { return new Dictionary<string, object> { { "ok", true }, { "lan", new Dictionary<string, object> { { "state", state }, { "sessionId", "00112233445566778899aabbccddeeff" } } } }; }
        internal Task<Dictionary<string, object>> RequestAsync(string action, Dictionary<string, object> message) { if (message.ContainsKey("requestId") || message.ContainsKey("type") || message.ContainsKey("action")) throw new Exception("Browser envelope leaked to strict helper protocol."); Actions.Add(action); if (NextReply != null) { RestartRequired = true; return NextReply(action, message); } return Task.FromResult(Success(action == "lan-start" ? "starting" : "active")); }
        internal void Emit(string sessionId) { var callback = PacketReceived; if (callback != null) callback(new Dictionary<string, object> { { "type", "gaming-lan-packet" }, { "sessionId", sessionId }, { "packet", "RQA=" } }); }
        public void Dispose() { Disposed = true; }
    }
}
