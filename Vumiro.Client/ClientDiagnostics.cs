using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

namespace Vumiro.Client
{
    // Only bounded technical data is accepted. Never pass messages, URLs, peer identifiers,
    // device names, credentials or captured media through this logger.
    internal sealed class ClientDiagnostics
    {
        internal static readonly ClientDiagnostics Current = new ClientDiagnostics(
            Path.Combine(ClientRuntime.Current.DataDirectory, "Diagnostics"), () => DateTime.UtcNow);
        private static readonly string WindowsVersion = ResolveOsVersion(ReadNativeOsVersion);
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct NativeOsVersion
        {
            internal uint Size, Major, Minor, Build, Platform;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] internal string ServicePack;
        }
        [DllImport("ntdll.dll", ExactSpelling = true)]
        private static extern int RtlGetVersion(ref NativeOsVersion version);

        // .NET Framework's Environment.OSVersion is manifest-virtualized and can
        // report Windows 8 on Windows 11. Native lookup failure must remain unknown.
        internal static string ResolveOsVersion(Func<Version> query)
        {
            try
            {
                var version = query();
                return version != null && version.Major > 0 && version.Build >= 0 ? version.ToString() : "unknown";
            }
            catch (Exception) { return "unknown"; }
        }
        private static Version ReadNativeOsVersion()
        {
            var version = new NativeOsVersion { Size = (uint)Marshal.SizeOf(typeof(NativeOsVersion)) };
            if (RtlGetVersion(ref version) != 0 || version.Major > Int32.MaxValue ||
                version.Minor > Int32.MaxValue || version.Build > Int32.MaxValue) return null;
            return new Version((int)version.Major, (int)version.Minor, (int)version.Build);
        }
        private readonly object gate = new object();
        private readonly object queueGate = new object();
        private sealed class PendingEvent
        {
            internal string Name;
            internal Dictionary<string, object> Fields;
            internal DateTime OccurredUtc;
        }
        private readonly Queue<PendingEvent> pending = new Queue<PendingEvent>();
        private bool queueRunning, accepting = true;
        private int queueDropped;
        private readonly string directory;
        private readonly Func<DateTime> utcNow;
        private readonly int segmentBytes, totalBytes, maxFiles;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private readonly Dictionary<string, int> eventCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        private string session, currentFile;
        private int segment, windowCount, dropped;
        private DateTime windowStart, currentSegmentStart;
        private Dictionary<string, object> marker;
        private bool started, ended;

        private static readonly HashSet<string> Events = Set("page-ready,page-error,promise-rejection,page-unload,capture-requested,capture-started,capture-ended,capture-stopped,capture-error,native-audio-state,native-audio-started,native-audio-warning,native-audio-error,audio-context-state,peer-state,signaling-state,stream-health,playback-boost-error,host-error,webview-failed,share-start,share-stop,share-failed,audio-request,audio-started,audio-stopped,audio-error,audio-warning,audio-fallback,peer-stats,media-ended,volume-change,renderer-error,startup-error,update-error,unhandled-error,runtime");
        private static readonly HashSet<string> BooleanFields = Set("supported,audio,excludeDiscord,fatal");
        private static readonly HashSet<string> NumberFields = Set("width,height,frameRate,sampleRate,channels,audioTracks,videoTracks,peers,frames,bytes,sequence,processId,gain,bitrate,packetsLost,jitter,roundTripTime,bytesSent,bytesReceived,framesEncoded,framesDecoded,osBuild,versionMajor,versionMinor,versionBuild,webviewMajor,webviewBuild");
        private static readonly HashSet<string> ErrorNames = Set("Error,EvalError,RangeError,ReferenceError,SyntaxError,TypeError,URIError,AggregateError,DOMException,AbortError,ConstraintNotSatisfiedError,DataError,EncodingError,InvalidAccessError,InvalidModificationError,InvalidStateError,NetworkError,NotAllowedError,NotFoundError,NotReadableError,NotSupportedError,OperationError,OverconstrainedError,PermissionDeniedError,SecurityError,TimeoutError,TrackStartError,UnknownError,Exception,InvalidOperationException,IOException,UnauthorizedAccessException,ArgumentException,COMException,OutOfMemoryException,NotSupportedException,ObjectDisposedException,Win32Exception");
        private static readonly Dictionary<string, HashSet<string>> Enums = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal) {
            { "source", Set("friends,call,native,browser,display,microphone,voice,system") },
            { "name", ErrorNames }, { "errorName", ErrorNames },
            { "connectionState", Set("new,connecting,connected,disconnected,failed,closed") },
            { "iceConnectionState", Set("new,checking,connected,completed,disconnected,failed,closed") },
            { "signalingState", Set("stable,have-local-offer,have-remote-offer,have-local-pranswer,have-remote-pranswer,closed") },
            { "state", Set("new,checking,connecting,connected,completed,disconnected,failed,closed,ended,live,muted,unmuted,suspended,running,interrupted,open,closing,reconnecting,stable,have-local-offer,have-remote-offer,have-local-pranswer,have-remote-pranswer") },
            { "stage", Set("capture,start,stop,connect,playback,render,transport,update,startup") },
            { "reason", Set("unsupported,permission,unsupported-format,device-lost,timeout,capture-failed,renderer-failed,transport-failed,ended,unknown,requested,user,track-ended,navigation,shutdown,unavailable,unsupported-os,ack-timeout,process-failed") },
            { "kind", Set("audio,video,screen,window,BrowserProcessExited,RenderProcessExited,RenderProcessUnresponsive,FrameRenderProcessExited,UtilityProcessExited,SandboxHelperProcessExited,GpuProcessExited,PpapiPluginProcessExited,PpapiBrokerProcessExited,UnknownProcessExited") }
        };

        internal ClientDiagnostics(string directory, Func<DateTime> utcNow, int segmentBytes = 256 * 1024,
            int totalBytes = 8 * 1024 * 1024, int maxFiles = 32)
        {
            if (directory == null || utcNow == null) throw new ArgumentNullException();
            if (segmentBytes < 1024 || totalBytes < segmentBytes || maxFiles < 1) throw new ArgumentOutOfRangeException();
            this.directory = directory; this.utcNow = utcNow;
            this.segmentBytes = segmentBytes; this.totalBytes = totalBytes; this.maxFiles = maxFiles;
        }

        internal void Start()
        {
            lock (gate)
            {
                if (started) return;
                started = true;
                session = Guid.NewGuid().ToString("N");
                var now = utcNow().ToUniversalTime();
                windowStart = now;
                try
                {
                    Directory.CreateDirectory(directory);
                    var previous = ReadMarker();
                    marker = new Dictionary<string, object> {
                        { "session", session }, { "startedUtc", Stamp(now) }, { "completed", false }
                    };
                    var details = new Dictionary<string, object> {
                        { "appVersion", typeof(ClientDiagnostics).Assembly.GetName().Version.ToString() },
                        { "osVersion", WindowsVersion }, { "is64Bit", Environment.Is64BitProcess },
                        { "clrVersion", Environment.Version.ToString() }
                    };
                    object previousSession, completed, interrupted, interruptedAt;
                    if (previous != null && previous.TryGetValue("session", out previousSession) && SafeSession(previousSession) &&
                        previous.TryGetValue("completed", out completed) && completed is bool)
                    {
                        details["previousSession"] = previousSession;
                        details["previousSessionEnded"] = completed;
                        if (!(bool)completed)
                        {
                            marker["lastInterruptedSession"] = previousSession;
                            marker["lastInterruptedUtc"] = Stamp(now);
                        }
                        else if (previous.TryGetValue("lastInterruptedSession", out interrupted) && SafeSession(interrupted) &&
                            previous.TryGetValue("lastInterruptedUtc", out interruptedAt) && RecentStamp(interruptedAt, now))
                        {
                            marker["lastInterruptedSession"] = interrupted;
                            marker["lastInterruptedUtc"] = interruptedAt;
                        }
                    }
                    if (marker.TryGetValue("lastInterruptedSession", out interrupted)) details["lastInterruptedSession"] = interrupted;
                    WriteMarker();
                    Append("session-start", details, now);
                }
                catch (Exception error) when (IsStorageFailure(error)) { /* Diagnostics cannot prevent startup. */ }
            }
        }

        internal void End()
        {
            lock (queueGate) accepting = false;
            // If storage is stalled, preserve an interrupted marker instead of falsely
            // claiming a clean, fully flushed shutdown or blocking application exit.
            if (!Drain()) return;
            lock (gate)
            {
                if (!started || ended) return;
                ended = true;
                try
                {
                    var now = utcNow().ToUniversalTime();
                    WriteDropped(now);
                    Append("session-end", null, now);
                    if (marker != null) { marker["completed"] = true; marker["endedUtc"] = Stamp(now); WriteMarker(); }
                }
                catch (Exception error) when (IsStorageFailure(error)) { /* Shutdown must remain safe. */ }
            }
        }

        // Normal media/UI event paths use this bounded queue. Only fatal shutdown hooks
        // should call the synchronous Record/RecordException methods directly.
        internal bool Enqueue(string eventName, IDictionary<string, object> details = null)
        {
            Dictionary<string, object> safe;
            if (eventName == null || !Events.Contains(eventName) || !ValidateFields(details, out safe)) return false;
            var occurred = utcNow().ToUniversalTime();
            lock (queueGate)
            {
                if (!accepting) return false;
                if (pending.Count >= 128) { if (queueDropped < Int32.MaxValue) queueDropped++; return false; }
                pending.Enqueue(new PendingEvent { Name = eventName, Fields = safe, OccurredUtc = occurred });
                if (!queueRunning)
                {
                    queueRunning = true;
                    ThreadPool.QueueUserWorkItem(_ => ProcessQueue());
                }
                return true;
            }
        }

        internal void EnqueueException(string eventName, Exception error)
        {
            if (error == null) return;
            var kind = error.GetType().Name;
            Enqueue(eventName, new Dictionary<string, object> {
                { "errorName", ErrorNames.Contains(kind) ? kind : "Exception" }, { "hresult", error.HResult }, { "source", "native" }
            });
        }

        internal bool Drain(int timeoutMilliseconds = 5000)
        {
            if (timeoutMilliseconds < 0) throw new ArgumentOutOfRangeException("timeoutMilliseconds");
            var watch = Stopwatch.StartNew();
            lock (queueGate)
            {
                while (queueRunning || pending.Count > 0)
                {
                    var remaining = timeoutMilliseconds - (int)Math.Min(Int32.MaxValue, watch.ElapsedMilliseconds);
                    if (remaining <= 0) return false;
                    Monitor.Wait(queueGate, remaining);
                }
                return true;
            }
        }

        private void ProcessQueue()
        {
            while (true)
            {
                PendingEvent item;
                int droppedPending;
                lock (queueGate)
                {
                    if (pending.Count == 0)
                    { queueRunning = false; Monitor.PulseAll(queueGate); return; }
                    item = pending.Dequeue(); droppedPending = queueDropped; queueDropped = 0;
                }
                try
                {
                    if (droppedPending > 0)
                        lock (gate)
                        {
                            if (!started) Start();
                            if (!ended) Append("diagnostics-queue-limited", new Dictionary<string, object> { { "dropped", droppedPending } }, utcNow().ToUniversalTime());
                        }
                    RecordCore(item.Name, item.Fields, item.OccurredUtc);
                }
                catch (Exception) { /* A diagnostics worker must never terminate the application. */ }
            }
        }

        internal bool Record(string eventName, IDictionary<string, object> details = null)
        {
            Dictionary<string, object> safe;
            if (eventName == null || !Events.Contains(eventName) || !ValidateFields(details, out safe)) return false;
            return RecordCore(eventName, safe, null);
        }

        private bool RecordCore(string eventName, Dictionary<string, object> safe, DateTime? occurredUtc)
        {
            lock (gate)
            {
                if (!started) Start();
                if (ended) return false;
                try
                {
                    var now = utcNow().ToUniversalTime();
                    if (occurredUtc.HasValue && occurredUtc.Value < now.AddHours(-24)) return false;
                    if (now - windowStart >= TimeSpan.FromMinutes(1))
                    {
                        WriteDropped(now); windowStart = now; windowCount = 0; eventCounts.Clear();
                    }
                    int count; eventCounts.TryGetValue(eventName, out count);
                    if (windowCount >= 120 || count >= 30)
                    {
                        if (dropped < Int32.MaxValue) dropped++;
                        return false;
                    }
                    windowCount++; eventCounts[eventName] = count + 1;
                    Append(eventName, safe, now, occurredUtc);
                    return true;
                }
                catch (Exception error) when (IsStorageFailure(error)) { return false; }
            }
        }

        internal void RecordException(string eventName, Exception error)
        {
            if (error == null) return;
            var kind = error.GetType().Name;
            Record(eventName, new Dictionary<string, object> {
                { "errorName", ErrorNames.Contains(kind) ? kind : "Exception" }, { "hresult", error.HResult }, { "source", "native" }
            });
        }

        internal bool WriteToZip(string destination)
        {
            string temporary = null;
            try
            {
                if (!Drain()) return false;
                var snapshot = new List<KeyValuePair<string, byte[]>>();
                lock (gate)
                {
                    if (!started) Start();
                    Prune(utcNow().ToUniversalTime(), 0, 0);
                    var summary = new Dictionary<string, object> {
                        { "exportedUtc", Stamp(utcNow().ToUniversalTime()) }, { "session", session },
                        { "appVersion", typeof(ClientDiagnostics).Assembly.GetName().Version.ToString() },
                        { "osVersion", WindowsVersion },
                        { "clrVersion", Environment.Version.ToString() }, { "is64Bit", Environment.Is64BitProcess }
                    };
                    if (marker != null) summary["sessionState"] = marker;
                    snapshot.Add(new KeyValuePair<string, byte[]>("summary.json", new UTF8Encoding(false).GetBytes(json.Serialize(summary))));
                    long snapshotBytes = 0;
                    foreach (var file in LogFiles())
                    {
                        if (file.Length > segmentBytes || snapshotBytes + file.Length > totalBytes) continue;
                        var bytes = File.ReadAllBytes(file.FullName); snapshotBytes += bytes.Length;
                        snapshot.Add(new KeyValuePair<string, byte[]>(file.Name, bytes));
                    }
                }
                // The destination may be a slow/network drive. Release the local writer
                // lock before compression or destination I/O so capture diagnostics persist.
                destination = Path.GetFullPath(destination);
                if (!String.Equals(Path.GetExtension(destination), ".zip", StringComparison.OrdinalIgnoreCase)) return false;
                temporary = Path.Combine(Path.GetDirectoryName(destination), ".vumiro-diagnostics-" + Guid.NewGuid().ToString("N") + ".tmp");
                using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                using (var zip = new ZipArchive(output, ZipArchiveMode.Create))
                {
                    using (var writer = new StreamWriter(zip.CreateEntry("README.txt").Open(), new UTF8Encoding(false)))
                        writer.Write("Vumiro technical diagnostics\r\n" +
                            "Includes up to the last 24 hours, limited to 8 MiB and 32 log segments; old data may rotate sooner.\r\n" +
                            "Session start/end records identify normal exits. A missing end can mean a crash, forced termination or power loss.\r\n" +
                            "Technical events include audio/capture state, WebRTC statistics, OS/app versions and numeric failure codes.\r\n" +
                            "No chat, room/peer identifiers, credentials, IP addresses, device names, or audio/video content are recorded.\r\n" +
                            "Logs are stored locally and are not uploaded automatically. Review and share this ZIP with support if desired.\r\n" +
                            "Events are rate limited; diagnostics-rate-limited and diagnostics-queue-limited report dropped counts. Times are UTC.\r\n" +
                            "Accepted events are written and flushed by a bounded background writer; abrupt termination can lose pending events.\r\n");
                    foreach (var file in snapshot)
                        using (var content = zip.CreateEntry(file.Key, CompressionLevel.Optimal).Open())
                            content.Write(file.Value, 0, file.Value.Length);
                }
                if (File.Exists(destination)) File.Replace(temporary, destination, null); else File.Move(temporary, destination);
                temporary = null;
                return true;
            }
            catch (Exception error) when (IsStorageFailure(error)) { return false; }
            finally
            {
                if (temporary != null)
                    try { File.Delete(temporary); } catch (Exception error) when (IsStorageFailure(error)) { }
            }
        }

        private static bool ValidateFields(IDictionary<string, object> fields, out Dictionary<string, object> safe)
        {
            safe = new Dictionary<string, object>(StringComparer.Ordinal);
            if (fields == null) return true;
            if (fields.Count > 32) return false;
            foreach (var field in fields)
            {
                HashSet<string> values;
                if (BooleanFields.Contains(field.Key)) { if (!(field.Value is bool)) return false; }
                else if (NumberFields.Contains(field.Key)) { if (!SafeNumber(field.Value, 0, 9007199254740991)) return false; }
                else if (field.Key == "hresult") { if (!SafeNumber(field.Value, Int32.MinValue, Int32.MaxValue)) return false; }
                else if (field.Key == "code")
                {
                    if (!(field.Value is string && ErrorNames.Contains((string)field.Value)) &&
                        !SafeNumber(field.Value, Int32.MinValue, UInt32.MaxValue)) return false;
                }
                else if (Enums.TryGetValue(field.Key, out values))
                { if (!(field.Value is string) || !values.Contains((string)field.Value)) return false; }
                else return false;
                safe.Add(field.Key, field.Value);
            }
            return true;
        }

        private static bool SafeNumber(object value, double min, double max)
        {
            if (!(value is byte || value is sbyte || value is short || value is ushort || value is int || value is uint ||
                value is long || value is ulong || value is float || value is double || value is decimal)) return false;
            var number = Convert.ToDouble(value, CultureInfo.InvariantCulture);
            return !Double.IsNaN(number) && !Double.IsInfinity(number) && number >= min && number <= max;
        }

        private void WriteDropped(DateTime now)
        {
            if (dropped == 0) return;
            Append("diagnostics-rate-limited", new Dictionary<string, object> { { "dropped", dropped } }, now);
            dropped = 0;
        }

        private void Append(string eventName, Dictionary<string, object> details, DateTime now, DateTime? occurredUtc = null)
        {
            var line = new Dictionary<string, object> { { "utc", Stamp(occurredUtc ?? now) }, { "session", session }, { "event", eventName } };
            if (details != null && details.Count > 0) line["details"] = details;
            var bytes = new UTF8Encoding(false).GetBytes(json.Serialize(line) + "\n");
            if (bytes.Length > segmentBytes) return;
            Directory.CreateDirectory(directory);
            Prune(now, 0, 0);
            var rotate = currentFile == null || !File.Exists(currentFile) || now - currentSegmentStart >= TimeSpan.FromHours(1) ||
                new FileInfo(currentFile).Length + bytes.Length > segmentBytes;
            Prune(now, bytes.Length, rotate ? 1 : 0);
            if (currentFile == null || !File.Exists(currentFile) || rotate)
            {
                currentSegmentStart = now;
                currentFile = Path.Combine(directory, "vumiro-" + now.Ticks.ToString(CultureInfo.InvariantCulture) + "-" + session + "-" + (++segment).ToString(CultureInfo.InvariantCulture) + ".jsonl");
            }
            using (var output = new FileStream(currentFile, FileMode.Append, FileAccess.Write, FileShare.Read))
            { output.Write(bytes, 0, bytes.Length); output.Flush(true); }
            File.SetLastWriteTimeUtc(currentFile, now);
        }

        private void Prune(DateTime now, int incomingBytes, int incomingFiles)
        {
            var files = LogFiles();
            // Hourly segments keep a late append from extending old events past 24 hours.
            foreach (var file in files.Where(file => SegmentStart(file) < now.AddHours(-24) || file.LastWriteTimeUtc < now.AddHours(-24)).ToArray()) file.Delete();
            files = LogFiles();
            long bytes = files.Sum(file => file.Length);
            int count = files.Length;
            foreach (var file in files)
            {
                if (bytes + incomingBytes <= totalBytes && count + incomingFiles <= maxFiles) break;
                bytes -= file.Length; count--; file.Delete();
                if (currentFile == file.FullName) currentFile = null;
            }
        }

        private FileInfo[] LogFiles()
        {
            if (!Directory.Exists(directory)) return new FileInfo[0];
            return new DirectoryInfo(directory).GetFiles("vumiro-*.jsonl")
                .Where(file => Regex.IsMatch(file.Name, "^vumiro-[0-9]{1,19}-[a-f0-9]{32}-[0-9]{1,10}\\.jsonl$"))
                .OrderBy(file => file.LastWriteTimeUtc).ThenBy(file => file.Name, StringComparer.Ordinal).ToArray();
        }

        private static DateTime SegmentStart(FileInfo file)
        {
            long ticks;
            if (Int64.TryParse(file.Name.Split('-')[1], NumberStyles.None, CultureInfo.InvariantCulture, out ticks) &&
                ticks >= DateTime.MinValue.Ticks && ticks <= DateTime.MaxValue.Ticks) return new DateTime(ticks, DateTimeKind.Utc);
            return DateTime.MinValue;
        }

        private Dictionary<string, object> ReadMarker()
        {
            var path = Path.Combine(directory, "session-state.json");
            if (!File.Exists(path) || new FileInfo(path).Length > 8192) return null;
            try { return json.Deserialize<Dictionary<string, object>>(File.ReadAllText(path)); }
            catch (ArgumentException) { return null; }
            catch (InvalidOperationException) { return null; }
        }

        private void WriteMarker()
        {
            var path = Path.Combine(directory, "session-state.json");
            var temp = path + ".tmp";
            var bytes = new UTF8Encoding(false).GetBytes(json.Serialize(marker));
            using (var output = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None))
            { output.Write(bytes, 0, bytes.Length); output.Flush(true); }
            if (File.Exists(path)) File.Replace(temp, path, null); else File.Move(temp, path);
        }

        private static bool SafeSession(object value)
        {
            var text = value as string;
            return text != null && text.Length == 32 && text.All(ch => ch >= '0' && ch <= '9' || ch >= 'a' && ch <= 'f');
        }
        private static bool RecentStamp(object value, DateTime now)
        {
            DateTime when;
            return value is string && DateTime.TryParse((string)value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out when) &&
                when.ToUniversalTime() >= now.AddHours(-24) && when.ToUniversalTime() <= now;
        }
        private static string Stamp(DateTime value) { return value.ToString("O", CultureInfo.InvariantCulture); }
        private static HashSet<string> Set(string values) { return new HashSet<string>(values.Split(','), StringComparer.Ordinal); }
        private static bool IsStorageFailure(Exception error)
        {
            return error is IOException || error is UnauthorizedAccessException || error is System.Security.SecurityException ||
                error is ArgumentException || error is NotSupportedException || error is InvalidOperationException;
        }
    }
}
