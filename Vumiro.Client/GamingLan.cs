using System;
using System.Collections.Concurrent;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text.RegularExpressions;
using System.Threading;

namespace Vumiro.Client
{
    internal sealed class GamingLanConfiguration
    {
        internal string SessionId { get; private set; }
        internal string Address { get; private set; }
        internal string RemoteAddress { get; private set; }
        internal byte Subnet { get; private set; }
        internal byte LocalHost { get; private set; }
        private volatile byte[] peers;
        internal bool HasPeer(byte host) { return Array.IndexOf(peers, host) >= 0; }
        internal bool SetPeers(object value)
        {
            var values = value as IEnumerable;
            if (values == null || value is string) return false;
            var next = new List<byte>();
            foreach (var raw in values) {
                GamingLanConfiguration peer;
                if (next.Count >= 253 || !TryCreate(SessionId, raw as string, out peer) || peer.Subnet != Subnet || peer.LocalHost == LocalHost || next.Contains(peer.LocalHost)) return false;
                next.Add(peer.LocalHost);
            }
            peers = next.ToArray(); return true;
        }
        internal static bool TryCreate(string sessionId, string address, out GamingLanConfiguration config)
        {
            config = null;
            if (sessionId == null || !Regex.IsMatch(sessionId, "\\A[0-9a-f]{32}\\z")) return false;
            if (address == null || !Regex.IsMatch(address, "\\A10\\.203\\.([1-9][0-9]{0,2})\\.([1-9][0-9]{0,2})\\z")) return false;
            var fields = address.Split('.'); byte subnet;
            if (!byte.TryParse(fields[2], NumberStyles.None, CultureInfo.InvariantCulture, out subnet)) return false;
            byte host;
            if (subnet < 1 || subnet > 250 || !byte.TryParse(fields[3], NumberStyles.None, CultureInfo.InvariantCulture, out host) || host < 1 || host > 254) return false;
            config = new GamingLanConfiguration { SessionId = sessionId, Address = address, Subnet = subnet, LocalHost = host,
                RemoteAddress = "10.203." + subnet.ToString(CultureInfo.InvariantCulture) + "." + (host == 1 ? "2" : "1") };
            config.peers = new[] { (byte)(host == 1 ? 2 : 1) }; return true;
        }
    }

    // A layer-3, two-endpoint LAN. Never admit traffic to another local subnet or
    // route peer traffic through the host's physical NIC/default gateway.
    internal static class GamingLanPacket
    {
        internal static bool IsAllowed(byte[] packet, GamingLanConfiguration config, bool inbound)
        {
            if (config == null || packet == null || packet.Length < 20 || packet.Length > 65535 || packet[0] >> 4 != 4) return false;
            var header = (packet[0] & 15) * 4;
            if (header < 20 || header > packet.Length || ((packet[2] << 8) | packet[3]) != packet.Length || packet[8] == 0) return false;
            uint checksum = 0;
            for (var i = 0; i < header; i += 2) checksum += (uint)((packet[i] << 8) | packet[i + 1]);
            while (checksum >> 16 != 0) checksum = (checksum & 65535) + (checksum >> 16);
            if (checksum != 65535) return false;
            // Original fragments are transported unchanged; Windows reassembles.
            // Source-routing IP options could bypass the destination boundary.
            if (header != 20 || (packet[6] & 0x80) != 0) return false;
            if (packet[9] != 1 && packet[9] != 6 && packet[9] != 17) return false;
            if (packet[12] != 10 || packet[13] != 203 || packet[14] != config.Subnet || (inbound ? !config.HasPeer(packet[15]) : packet[15] != config.LocalHost)) return false;
            return (packet[16] == 10 && packet[17] == 203 && packet[18] == config.Subnet && (packet[19] == 255 || (inbound ? packet[19] == config.LocalHost : config.HasPeer(packet[19]))))
                || (packet[16] == 255 && packet[17] == 255 && packet[18] == 255 && packet[19] == 255)
                || (packet[16] >= 224 && packet[16] <= 239);
        }
    }

    internal interface IGamingLanAdapter : IDisposable
    {
        byte[] Read(CancellationToken cancellation);
        bool Write(byte[] packet);
    }

    internal sealed class GamingLanSession : IDisposable
    {
        internal const int MaxPendingPackets = 128;
        private const int MaxPendingBytes = 2 * 1024 * 1024;
        private readonly GamingLanConfiguration configuration;
        private readonly Func<IGamingLanAdapter> createAdapter;
        private readonly Func<Action, bool> post;
        private readonly Action<byte[]> publish;
        private readonly CancellationTokenSource stop = new CancellationTokenSource();
        private readonly ConcurrentQueue<byte[]> incoming = new ConcurrentQueue<byte[]>();
        private readonly AutoResetEvent incomingReady = new AutoResetEvent(false);
        private readonly object budget = new object();
        private readonly object lifetime = new object();
        private bool resourcesClosed;
        private int queuedPackets, queuedBytes, pendingPackets, pendingBytes;
        private long sent, received, dropped;
        private Thread reader;
        private volatile string state = "stopped", error;
        internal GamingLanSession(GamingLanConfiguration config, Func<IGamingLanAdapter> factory, Func<Action, bool> postToUi, Action<byte[]> publishPacket)
        { configuration = config; createAdapter = factory; post = postToUi; publish = publishPacket; }
        internal string State { get { return state; } }
        internal string Error { get { return error; } }
        internal string SessionId { get { return configuration.SessionId; } }
        internal bool SetPeers(object addresses) { return !stop.IsCancellationRequested && configuration.SetPeers(addresses); }
        internal long PacketsDropped { get { return Interlocked.Read(ref dropped); } }
        internal void Start()
        {
            if (reader != null) throw new InvalidOperationException("LAN session already started.");
            state = "starting";
            reader = new Thread(Run) { IsBackground = true, Name = "Vumiro LAN adapter" }; reader.Start();
        }
        internal Dictionary<string, object> Status()
        {
            return new Dictionary<string, object> { { "state", state }, { "sessionId", configuration.SessionId }, { "address", configuration.Address },
                { "remoteAddress", configuration.RemoteAddress }, { "prefixLength", 24 }, { "packetsSent", Interlocked.Read(ref sent) },
                { "packetsReceived", Interlocked.Read(ref received) }, { "packetsDropped", PacketsDropped }, { "error", error },
                { "driverReady", WintunGamingLanAdapter.DriverReady }, { "requiresElevation", !WintunGamingLanAdapter.IsElevated }, { "backend", "Vumiro IPv4 over WebRTC" } };
        }
        internal bool Receive(string sessionId, string encoded)
        {
            if (stop.IsCancellationRequested || state != "active" || sessionId != configuration.SessionId || encoded == null || encoded.Length > 87380) return Drop();
            byte[] packet;
            try { packet = Convert.FromBase64String(encoded); } catch (FormatException) { return Drop(); }
            if (!GamingLanPacket.IsAllowed(packet, configuration, true)) return Drop();
            lock (budget) {
                if (stop.IsCancellationRequested || queuedPackets >= MaxPendingPackets || queuedBytes + packet.Length > MaxPendingBytes) return Drop();
                queuedPackets++; queuedBytes += packet.Length; incoming.Enqueue(packet); SignalIncoming();
            }
            return true;
        }
        private bool Drop() { Interlocked.Increment(ref dropped); return false; }
        private void Run()
        {
            IGamingLanAdapter adapter = null; Thread writer = null;
            try {
                adapter = createAdapter();
                if (stop.IsCancellationRequested) return;
                writer = new Thread(() => WritePackets(adapter)) { IsBackground = true, Name = "Vumiro LAN inbound" }; writer.Start();
                state = "active";
                while (!stop.IsCancellationRequested) {
                    var packet = adapter.Read(stop.Token);
                    if (packet == null) continue;
                    if (!GamingLanPacket.IsAllowed(packet, configuration, false)) { Drop(); continue; }
                    lock (budget) {
                        if (pendingPackets >= MaxPendingPackets || pendingBytes + packet.Length > MaxPendingBytes) { Drop(); continue; }
                        pendingPackets++; pendingBytes += packet.Length;
                    }
                    var accepted = false;
                    try {
                        accepted = post(() => {
                            try { if (!stop.IsCancellationRequested && GamingLanPacket.IsAllowed(packet, configuration, false)) { publish(packet); Interlocked.Increment(ref sent); } }
                            catch (Exception) { Drop(); }
                            finally { lock (budget) { pendingPackets--; pendingBytes -= packet.Length; } }
                        });
                    }
                    finally { if (!accepted) { lock (budget) { pendingPackets--; pendingBytes -= packet.Length; } Drop(); } }
                }
            }
            catch (OperationCanceledException) { }
            catch (Exception exception) { if (!stop.IsCancellationRequested) { error = exception.Message; state = "error"; } }
            finally {
                RequestStop();
                // Native handles are released only after every reader/writer exits.
                if (writer != null) writer.Join();
                if (adapter != null) adapter.Dispose();
                if (state != "error") state = "stopped";
                lock (lifetime) { resourcesClosed = true; incomingReady.Dispose(); stop.Dispose(); }
            }
        }
        private void WritePackets(IGamingLanAdapter adapter)
        {
            try {
                while (!stop.IsCancellationRequested) {
                    byte[] packet;
                    if (!incoming.TryDequeue(out packet)) { WaitHandle.WaitAny(new[] { stop.Token.WaitHandle, incomingReady }); continue; }
                    lock (budget) { queuedPackets--; queuedBytes -= packet.Length; }
                    if (stop.IsCancellationRequested) return;
                    if (!GamingLanPacket.IsAllowed(packet, configuration, true)) { Drop(); continue; }
                    if (adapter.Write(packet)) Interlocked.Increment(ref received); else Drop();
                }
            }
            catch (Exception exception) { if (!stop.IsCancellationRequested) { error = exception.Message; state = "error"; RequestStop(); } }
        }
        private void SignalIncoming() { lock (lifetime) { if (!resourcesClosed) incomingReady.Set(); } }
        private void RequestStop() { lock (lifetime) { if (!resourcesClosed) { stop.Cancel(); incomingReady.Set(); } } }
        public void Dispose()
        {
            RequestStop();
            if (reader != null && reader != Thread.CurrentThread) reader.Join(2000);
            // A native setup operation may still be returning. Its worker owns
            // adapter cleanup; never close handles underneath an active P/Invoke.
            if (state != "error") state = "stopped";
        }
    }

    internal sealed class WintunGamingLanAdapter : IGamingLanAdapter
    {
        private IntPtr library, adapter, session;
        private CreateAdapter create; private OpenAdapter open; private CloseAdapter close; private GetLuid getLuid;
        private StartSession start; private EndSession end; private ReceivePacket receive; private ReleasePacket release;
        private AllocatePacket allocate; private SendPacket send; private GetReadEvent getEvent;
        private EventWaitHandle readEvent;
        internal static string DriverPath { get { return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "runtimes", "win-x64", "native", "wintun.dll"); } }
        internal static bool DriverReady { get { return File.Exists(DriverPath); } }
        internal static bool IsElevated { get { using (var identity = WindowsIdentity.GetCurrent()) return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator); } }
        internal WintunGamingLanAdapter(GamingLanConfiguration config) : this(config, DriverPath) { }
        internal WintunGamingLanAdapter(GamingLanConfiguration config, string trustedLibraryPath)
        {
            if (!IsElevated) throw new InvalidOperationException("Vumiro LAN needs administrator rights to create and configure its network adapter. Restart Vumiro as administrator.");
            if (string.IsNullOrEmpty(trustedLibraryPath) || !Path.IsPathRooted(trustedLibraryPath) || !string.Equals(Path.GetFileName(trustedLibraryPath), "wintun.dll", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("A trusted absolute Wintun library path is required.", "trustedLibraryPath");
            if (!File.Exists(trustedLibraryPath)) throw new FileNotFoundException("The bundled Vumiro LAN adapter driver is missing. Repair the Vumiro installation.");
            try {
                // Absolute path, search only its own directory and Windows system32.
                library = LoadLibraryEx(Path.GetFullPath(trustedLibraryPath), IntPtr.Zero, 0x00000100 | 0x00000800);
                if (library == IntPtr.Zero) throw NativeError("The bundled LAN driver could not load");
                create = Bind<CreateAdapter>("WintunCreateAdapter"); open = Bind<OpenAdapter>("WintunOpenAdapter"); close = Bind<CloseAdapter>("WintunCloseAdapter");
                getLuid = Bind<GetLuid>("WintunGetAdapterLUID"); start = Bind<StartSession>("WintunStartSession"); end = Bind<EndSession>("WintunEndSession");
                receive = Bind<ReceivePacket>("WintunReceivePacket"); release = Bind<ReleasePacket>("WintunReleaseReceivePacket");
                allocate = Bind<AllocatePacket>("WintunAllocateSendPacket"); send = Bind<SendPacket>("WintunSendPacket"); getEvent = Bind<GetReadEvent>("WintunGetReadWaitEvent");
                var id = Guid.ParseExact(config.SessionId, "N");
                // Never open a similarly named existing interface: this session
                // owns its new adapter, which Wintun removes on CloseAdapter.
                adapter = create("Vumiro-LAN-" + config.SessionId.Substring(0, 12), "Vumiro", ref id);
                if (adapter == IntPtr.Zero) throw NativeError("The Vumiro LAN adapter could not be created");
                ulong luid; getLuid(adapter, out luid); uint index;
                var code = ConvertInterfaceLuidToIndex(ref luid, out index);
                if (code != 0 || index == 0) throw new Win32Exception((int)code, "The LAN adapter interface index could not be resolved.");
                var number = index.ToString(CultureInfo.InvariantCulture);
                RunNetsh("interface ipv4 set address name=" + number + " source=static address=" + config.Address + " mask=255.255.255.0 gateway=none store=active");
                RunNetsh("interface ipv4 set interface interface=" + number + " metric=1 mtu=1400 forwarding=disabled weakhostsend=disabled weakhostreceive=disabled store=active");
                EnsureRoute(luid, 224, 0, 0, 0, 4);
                EnsureRoute(luid, 255, 255, 255, 255, 32);
                session = start(adapter, 0x400000);
                if (session == IntPtr.Zero) throw NativeError("The LAN adapter packet session could not start");
                var nativeEvent = getEvent(session);
                if (nativeEvent == IntPtr.Zero) throw NativeError("The LAN adapter packet event is unavailable");
                readEvent = new EventWaitHandle(false, EventResetMode.AutoReset);
                readEvent.SafeWaitHandle = new Microsoft.Win32.SafeHandles.SafeWaitHandle(nativeEvent, false);
            }
            catch { Dispose(); throw; }
        }
        private T Bind<T>(string name) where T : class
        {
            var address = GetProcAddress(library, name);
            if (address == IntPtr.Zero) throw new InvalidOperationException("The bundled LAN driver has an unsupported API: " + name + ".");
            return Marshal.GetDelegateForFunctionPointer(address, typeof(T)) as T;
        }
        private static Exception NativeError(string message) { return new Win32Exception(Marshal.GetLastWin32Error(), message + "."); }
        private static void EnsureRoute(ulong luid, byte a, byte b, byte c, byte d, byte prefix)
        {
            var row = new RouteRow(); InitializeIpForwardEntry(ref row);
            row.InterfaceLuid = luid; row.DestinationFamily = 2; row.NextHopFamily = 2;
            row.DestinationAddress = (uint)(a | b << 8 | c << 16 | d << 24); row.PrefixLength = prefix;
            row.SitePrefixLength = 0; row.Metric = 1; row.Protocol = 3;
            var code = CreateIpForwardEntry2(ref row);
            if (code == 5010) {
                // Windows commonly creates multicast/broadcast routes with the
                // address. Update only this session's own interface route.
                code = GetIpForwardEntry2(ref row);
                if (code == 0) { row.Metric = 1; code = SetIpForwardEntry2(ref row); }
            }
            if (code != 0) throw new Win32Exception((int)code, "Windows could not configure the LAN discovery route.");
        }
        [StructLayout(LayoutKind.Explicit, Size = 104)]
        internal struct RouteRow
        {
            [FieldOffset(0)] internal ulong InterfaceLuid;
            [FieldOffset(8)] internal uint InterfaceIndex;
            [FieldOffset(12)] internal ushort DestinationFamily;
            [FieldOffset(16)] internal uint DestinationAddress;
            [FieldOffset(40)] internal byte PrefixLength;
            [FieldOffset(44)] internal ushort NextHopFamily;
            [FieldOffset(48)] internal uint NextHopAddress;
            [FieldOffset(72)] internal byte SitePrefixLength;
            [FieldOffset(76)] internal uint ValidLifetime;
            [FieldOffset(80)] internal uint PreferredLifetime;
            [FieldOffset(84)] internal uint Metric;
            [FieldOffset(88)] internal uint Protocol;
        }
        public byte[] Read(CancellationToken cancellation)
        {
            if (cancellation.IsCancellationRequested) return null;
            uint size; var pointer = receive(session, out size);
            if (pointer == IntPtr.Zero) {
                var code = Marshal.GetLastWin32Error();
                if (code != 259) throw new Win32Exception(code, "The LAN adapter packet read failed.");
                WaitHandle.WaitAny(new[] { cancellation.WaitHandle, readEvent }, 250); return null;
            }
            try {
                if (size < 20 || size > 65535) return null;
                var packet = new byte[(int)size]; Marshal.Copy(pointer, packet, 0, packet.Length); return packet;
            }
            finally { release(session, pointer); }
        }
        public bool Write(byte[] packet)
        {
            var pointer = allocate(session, (uint)packet.Length);
            if (pointer == IntPtr.Zero) {
                var code = Marshal.GetLastWin32Error();
                if (code == 111) return false;
                throw new Win32Exception(code, "The LAN adapter packet write failed.");
            }
            Marshal.Copy(packet, 0, pointer, packet.Length); send(session, pointer); return true;
        }
        private static void RunNetsh(string arguments)
        {
            // Every argument is a fixed literal, a canonical validated LAN IPv4,
            // or the numeric index returned by IP Helper. No command shell.
            var executable = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "netsh.exe");
            using (var process = Process.Start(new ProcessStartInfo(executable, arguments) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden })) {
                if (process == null) throw new InvalidOperationException("Windows could not configure the Vumiro LAN adapter.");
                if (!process.WaitForExit(10000)) { try { process.Kill(); process.WaitForExit(2000); } catch (InvalidOperationException) { } throw new TimeoutException("Windows LAN adapter configuration timed out."); }
                if (process.ExitCode != 0) throw new InvalidOperationException("Windows LAN adapter configuration failed (code " + process.ExitCode.ToString(CultureInfo.InvariantCulture) + ").");
            }
        }
        public void Dispose()
        {
            if (readEvent != null) { readEvent.Dispose(); readEvent = null; }
            if (session != IntPtr.Zero) { end(session); session = IntPtr.Zero; }
            if (adapter != IntPtr.Zero) { close(adapter); adapter = IntPtr.Zero; }
            if (library != IntPtr.Zero) { FreeLibrary(library); library = IntPtr.Zero; }
        }
        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode, SetLastError = true)] private delegate IntPtr CreateAdapter(string name, string type, ref Guid guid);
        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode, SetLastError = true)] private delegate IntPtr OpenAdapter(string name);
        [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate void CloseAdapter(IntPtr adapter);
        [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate void GetLuid(IntPtr adapter, out ulong luid);
        [UnmanagedFunctionPointer(CallingConvention.Winapi, SetLastError = true)] private delegate IntPtr StartSession(IntPtr adapter, uint capacity);
        [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate void EndSession(IntPtr session);
        [UnmanagedFunctionPointer(CallingConvention.Winapi, SetLastError = true)] private delegate IntPtr ReceivePacket(IntPtr session, out uint size);
        [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate void ReleasePacket(IntPtr session, IntPtr packet);
        [UnmanagedFunctionPointer(CallingConvention.Winapi, SetLastError = true)] private delegate IntPtr AllocatePacket(IntPtr session, uint size);
        [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate void SendPacket(IntPtr session, IntPtr packet);
        [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate IntPtr GetReadEvent(IntPtr session);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr LoadLibraryEx(string path, IntPtr file, uint flags);
        [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true, SetLastError = true)] private static extern IntPtr GetProcAddress(IntPtr library, string name);
        [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool FreeLibrary(IntPtr library);
        [DllImport("iphlpapi.dll")] private static extern uint ConvertInterfaceLuidToIndex(ref ulong luid, out uint index);
        [DllImport("iphlpapi.dll")] private static extern void InitializeIpForwardEntry(ref RouteRow row);
        [DllImport("iphlpapi.dll")] private static extern uint CreateIpForwardEntry2(ref RouteRow row);
        [DllImport("iphlpapi.dll")] private static extern uint GetIpForwardEntry2(ref RouteRow row);
        [DllImport("iphlpapi.dll")] private static extern uint SetIpForwardEntry2(ref RouteRow row);
    }
}
