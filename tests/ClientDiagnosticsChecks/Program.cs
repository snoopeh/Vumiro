using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Vumiro.Client;

namespace Vumiro.Client
{
    internal sealed partial class ClientWindow : Form
    {
        private readonly FakeBrowser browser = new FakeBrowser();
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        internal bool Dispatch(Dictionary<string, object> message) { return HandleDiagnosticsMessage(message); }
    }
    internal sealed class FakeBrowser { internal FakeCore CoreWebView2 = new FakeCore(); }
    internal sealed class FakeCore { internal void PostWebMessageAsJson(string json) { } }
}

internal static class Program
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NativeOsVersion
    {
        internal uint Size, Major, Minor, Build, Platform;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] internal string ServicePack;
    }
    [DllImport("ntdll.dll", ExactSpelling = true)]
    private static extern int RtlGetVersion(ref NativeOsVersion version);
    private static int checks;
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static void Check(bool ok, string why) { if (!ok) throw new Exception(why); checks++; }
    private static Dictionary<string, object> Fields(params object[] values)
    {
        var result = new Dictionary<string, object>();
        for (int i = 0; i < values.Length; i += 2) result.Add((string)values[i], values[i + 1]);
        return result;
    }
    private static string[] Lines(string folder) { return Directory.GetFiles(folder, "vumiro-*.jsonl").SelectMany(File.ReadAllLines).ToArray(); }
    private static void Main()
    {
        var root = Path.Combine(Path.GetTempPath(), "vumiro-diagnostics-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try { Run(root); Console.WriteLine("Passed " + checks + " diagnostics checks."); }
        finally { Directory.Delete(root, true); }
    }
    private static void Run(string root)
    {
        Check(ClientDiagnostics.ResolveOsVersion(() => new Version(10, 0, 26100)) == "10.0.26100",
            "Successful native version lookup must retain the actual Windows build.");
        Check(ClientDiagnostics.ResolveOsVersion(() => null) == "unknown", "Failed native status must report an unknown OS version.");
        Check(ClientDiagnostics.ResolveOsVersion(() => { throw new EntryPointNotFoundException(); }) == "unknown",
            "Unavailable native version lookup must not fall back to a false Windows version.");
        Check(ClientDiagnostics.ResolveOsVersion(() => new Version(0, 0)) == "unknown", "Incomplete native version values must report unknown.");
        var now = new DateTime(2026, 11, 8, 12, 0, 0, DateTimeKind.Utc);
        var folder = Path.Combine(root, "normal");
        var log = new ClientDiagnostics(folder, () => now);
        log.Start();
        Check(log.Record("capture-started", Fields("source", "friends", "audio", true, "sampleRate", 48000, "channels", 2)), "Allowed technical event must persist.");
        Check(Lines(folder).Length == 2, "Each event must be readable immediately, before normal shutdown.");
        Check(!log.Record("capture-started", Fields("message", "secret-room-token")), "Raw error messages must be rejected.");
        Check(!log.Record("capture-started", Fields("source", "secret-room-token")), "String enum values must be allowlisted.");
        Check(!log.Record("secret-event", Fields("audio", true)), "Event names must be allowlisted.");
        Check(!log.Record("session-end", null), "The browser must not spoof a clean session exit.");
        Check(!log.Record("capture-started", Fields("sampleRate", Double.NaN)), "Nonfinite metrics must be rejected.");
        Check(!log.Record("capture-started", Fields("audio", "true")), "Booleans must not accept string coercion.");
        Check(!log.Record("capture-started", Fields("code", "secret-room-token")), "Error codes must not accept arbitrary strings.");
        Check(!log.Record("peer-state", Fields("connectionState", "https://secret.invalid")), "WebRTC states must reject arbitrary strings.");
        Check(log.Record("peer-state", Fields("connectionState", "connected", "iceConnectionState", "completed", "signalingState", "have-local-offer")), "Standard WebRTC states must be accepted.");
        Check(log.Record("runtime", Fields("osBuild", 26100, "webviewMajor", 131, "webviewBuild", 2903)), "Runtime version numbers must be available for hardware/renderer diagnosis.");
        log.RecordException("host-error", new InvalidOperationException("secret-room-token"));
        var text = String.Join("\n", Lines(folder));
        Check(text.Contains("hresult") && text.Contains("InvalidOperationException") && !text.Contains("secret-room-token"), "Native errors must contain only technical type and HRESULT.");
        var first = Json.Deserialize<Dictionary<string, object>>(Lines(folder)[0]);
        Check((string)first["event"] == "session-start" && ((string)first["session"]).Length == 32, "Session identifiers must be random opaque values.");
        var nativeOs = new NativeOsVersion { Size = (uint)Marshal.SizeOf(typeof(NativeOsVersion)) };
        Check(RtlGetVersion(ref nativeOs) == 0, "The Windows test runner must expose its authoritative version.");
        var actualVersion = nativeOs.Major + "." + nativeOs.Minor + "." + nativeOs.Build;
        Check((string)((Dictionary<string, object>)first["details"])["osVersion"] == actualVersion,
            "Session OS metadata must match RtlGetVersion rather than the manifest-virtualized Environment.OSVersion.");
        var interrupted = new ClientDiagnostics(folder, () => now.AddSeconds(1)); interrupted.Start();
        text = String.Join("\n", Lines(folder));
        Check(text.Contains("\"previousSessionEnded\":false"), "A restart after an unclean exit must identify interruption.");
        interrupted.End(); interrupted.End();
        var clean = new ClientDiagnostics(folder, () => now.AddSeconds(2)); clean.Start();
        var started = Lines(folder).Last();
        Check(started.Contains("\"previousSessionEnded\":true") && started.Contains("lastInterruptedSession"), "A rapid clean restart must retain the preceding interrupted session summary.");
        clean.End();

        var agedFolder = Path.Combine(root, "age-window");
        var aged = new ClientDiagnostics(agedFolder, () => now); aged.Start();
        now = now.AddHours(23); aged.Record("capture-started");
        now = now.AddHours(2); aged.Record("capture-ended");
        Check(!String.Join("\n", Lines(agedFolder)).Contains("session-start"), "A recently appended segment must not retain events older than 24 hours.");
        Check(String.Join("\n", Lines(agedFolder)).Contains("capture-started"), "Recent events must survive expiration of an older session segment.");
        aged.End();

        var floodFolder = Path.Combine(root, "flood");
        log = new ClientDiagnostics(floodFolder, () => now); log.Start();
        Parallel.For(0, 1000, value => log.Record("stream-health", Fields("frames", value)));
        Check(Lines(floodFolder).Length <= 32, "Repeated events must be rate limited even across threads.");
        now = now.AddMinutes(1);
        Check(log.Record("stream-health", Fields("frames", 1001)), "A new minute must admit events after rate limiting.");
        Check(String.Join("\n", Lines(floodFolder)).Contains("diagnostics-rate-limited"), "Dropped event count must be recorded without logging each drop.");
        log.End();

        var queuedFolder = Path.Combine(root, "queued");
        using (var workerEntered = new ManualResetEvent(false))
        using (var releaseWorker = new ManualResetEvent(false))
        {
            var blockWriter = false;
            var mainThread = Thread.CurrentThread.ManagedThreadId;
            var writerThread = 0;
            var queued = new ClientDiagnostics(queuedFolder, () => {
                var currentThread = Thread.CurrentThread.ManagedThreadId;
                if (blockWriter && currentThread != mainThread &&
                    (Interlocked.CompareExchange(ref writerThread, currentThread, 0) == 0 || writerThread == currentThread))
                { workerEntered.Set(); releaseWorker.WaitOne(); }
                return now;
            });
            queued.Start(); blockWriter = true;
            var occurredUtc = now;
            Check(queued.Enqueue("capture-started", Fields("audio", true)), "Normal diagnostics must accept a bounded background write.");
            Check(workerEntered.WaitOne(3000), "Background writer must begin processing the queued event.");
            var producer = Task.Run(() => {
                var admitted = 0;
                for (var i = 0; i < 1000; i++) if (queued.Enqueue("stream-health", Fields("frames", i))) admitted++;
                return admitted;
            });
            try
            {
                Check(producer.Wait(3000), "Logging from the media/UI thread must not wait on the disk writer lock.");
                Check(producer.Result <= 128, "The pending writer queue must remain bounded while storage is stalled.");
                Check(!queued.Drain(10), "A bounded drain must time out safely when storage is stalled.");
                now = now.AddMinutes(1);
            }
            finally { blockWriter = false; releaseWorker.Set(); }
            Check(queued.Drain(), "Pending events must drain after storage recovers.");
            Check(String.Join("\n", Lines(queuedFolder)).Contains("capture-started"), "Draining must make accepted records durable.");
            var occurredLine = Lines(queuedFolder).Select(line => Json.Deserialize<Dictionary<string, object>>(line))
                .Single(line => (string)line["event"] == "capture-started");
            Check((string)occurredLine["utc"] == occurredUtc.ToString("O"), "Queued records must retain occurrence time when persistence is delayed.");
            queued.End();
            Check(!queued.Enqueue("capture-started"), "No background record may be accepted after a clean session end.");
        }

        var boundedFolder = Path.Combine(root, "bounded");
        log = new ClientDiagnostics(boundedFolder, () => now, 2048, 6144, 3); log.Start();
        for (int i = 0; i < 90; i++) { now = now.AddMinutes(1); log.Record("stream-health", Fields("frames", i)); }
        var bounded = Directory.GetFiles(boundedFolder, "vumiro-*.jsonl").Select(path => new FileInfo(path)).ToArray();
        Check(bounded.Length <= 3 && bounded.Sum(info => info.Length) <= 6144, "Log rotation must enforce total byte and file count caps.");
        Check(bounded.All(info => info.Length <= 2048), "A log segment must not exceed its byte cap.");
        now = now.AddHours(25);
        log.Record("capture-ended");
        bounded = Directory.GetFiles(boundedFolder, "vumiro-*.jsonl").Select(path => new FileInfo(path)).ToArray();
        Check(bounded.Length == 1, "The first subsequent event must prune expired log files.");
        var zipPath = Path.Combine(root, "diagnostics.zip");
        Check(log.WriteToZip(zipPath), "Diagnostics must export as a ZIP.");
        Check(log.WriteToZip(zipPath), "Confirmed native save dialog replacement must support exporting over an existing archive.");
        using (var zip = ZipFile.OpenRead(zipPath))
        {
            Check(zip.Entries.Any(entry => entry.Name == "README.txt") && zip.Entries.Any(entry => entry.Name.EndsWith(".jsonl")), "Export must contain instructions and recent events.");
            Check(zip.GetEntry("summary.json") != null, "Export must retain runtime and session context even when startup logs have rotated out.");
            using (var reader = new StreamReader(zip.GetEntry("summary.json").Open()))
                Check((string)Json.Deserialize<Dictionary<string, object>>(reader.ReadToEnd())["osVersion"] == actualVersion,
                    "Export OS metadata must use the same authoritative Windows version as session logs.");
            Check(zip.Entries.All(entry => entry.Name == entry.FullName), "Archive must not expose absolute user paths.");
            var notes = new StreamReader(zip.GetEntry("README.txt").Open());
            using (notes) Check(notes.ReadToEnd().Contains("not uploaded"), "Export must explain that logs are not automatically uploaded.");
        }
        log.End();

        var protectedPath = Path.Combine(root, "do-not-overwrite.jsonl"); File.WriteAllText(protectedPath, "keep");
        Check(!log.WriteToZip(protectedPath) && File.ReadAllText(protectedPath) == "keep", "Export must refuse non-ZIP paths without altering existing files.");

        var badPath = Path.Combine(root, "not-a-directory"); File.WriteAllText(badPath, "occupied");
        log = new ClientDiagnostics(badPath, () => now);
        log.Start(); Check(!log.Record("capture-started"), "Unwritable diagnostics must fail safely."); log.End();
        Check(!log.WriteToZip(Path.Combine(badPath, "broken.zip")), "Export I/O errors must be recoverable.");

        using (var host = new ClientWindow())
        {
            Check(!host.Dispatch(Fields("type", "other", "action", "record")), "Bridge must leave other message types alone.");
            Check(host.Dispatch(Fields("type", "diagnostics", "action", "record", "event", "capture-started", "details", Fields("audio", true), "token", "secret")), "Bridge must consume malformed diagnostic messages safely.");
            Check(host.Dispatch(Fields("type", "diagnostics", "action", "export", "path", "secret")), "Export messages must not accept a browser supplied destination.");
        }
    }
}
