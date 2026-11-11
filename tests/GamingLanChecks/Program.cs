using System;
using System.Collections.Concurrent;
using System.Threading;
using Vumiro.Client;

internal static class Program
{
    private static int checks;
    private static void Check(bool value, string name) { if (!value) throw new Exception(name); checks++; }
    private static GamingLanConfiguration Config(string address = "10.203.42.1") { GamingLanConfiguration config; Check(GamingLanConfiguration.TryCreate("00112233445566778899aabbccddeeff", address, out config), "valid configuration"); return config; }
    private static byte[] Packet(string source, string destination, byte protocol = 17)
    {
        var packet = new byte[28]; packet[0] = 0x45; packet[3] = 28; packet[8] = 64; packet[9] = protocol;
        Buffer.BlockCopy(System.Net.IPAddress.Parse(source).GetAddressBytes(), 0, packet, 12, 4);
        Buffer.BlockCopy(System.Net.IPAddress.Parse(destination).GetAddressBytes(), 0, packet, 16, 4);
        if (protocol == 17) packet[25] = 8;
        Seal(packet); return packet;
    }
    private static void Seal(byte[] packet)
    {
        packet[10] = 0; packet[11] = 0;
        uint sum = 0; for (var i = 0; i < (packet[0] & 15) * 4; i += 2) sum += (uint)((packet[i] << 8) | packet[i + 1]);
        while ((sum >> 16) != 0) sum = (sum & 65535) + (sum >> 16);
        packet[10] = (byte)(~sum >> 8); packet[11] = (byte)~sum;
    }
    private static void Main(string[] args)
    {
        var config = Config(); GamingLanConfiguration rejected;
        Check(!GamingLanConfiguration.TryCreate("bad", "10.203.42.1", out rejected), "session format rejected");
        foreach (var address in new[] { "10.203.0.1", "10.203.251.1", "10.203.42.0", "10.203.42.255", "10.204.42.1", "10.203.042.1", "10.203.42.1 & whoami", "127.0.0.1" })
            Check(!GamingLanConfiguration.TryCreate(config.SessionId, address, out rejected), "reject address " + address);
        Check(config.RemoteAddress == "10.203.42.2", "opposite peer address");
        Check(!GamingLanPacket.IsAllowed(Packet("10.203.42.3", "10.203.42.1"), config, true), "unassigned source rejected");
        Check(config.SetPeers(new object[] { "10.203.42.2", "10.203.42.3" }), "explicit peers accepted");
        Check(GamingLanPacket.IsAllowed(Packet("10.203.42.3", "10.203.42.1"), config, true), "assigned third peer accepted");
        Check(GamingLanPacket.IsAllowed(Packet("10.203.42.1", "10.203.42.3"), config, false), "assigned third outbound accepted");
        Check(!config.SetPeers(new object[] { "10.203.43.3" }), "cross subnet peer refused");
        Check(!config.SetPeers(new object[] { "10.203.42.1" }), "local peer refused");
        Check(config.SetPeers(new object[] { "10.203.42.2" }), "peer removal accepted");
        Check(!config.SetPeers(new object[] { "10.203.42.2", "10.203.42.2" }), "duplicate peers refused");
        Check(!config.SetPeers("10.203.42.2"), "string peer array refused");
        Check(!GamingLanPacket.IsAllowed(Packet("10.203.42.3", "10.203.42.1"), config, true), "removed peer rejected");
        Check(GamingLanPacket.IsAllowed(Packet("10.203.42.2", "10.203.42.1"), config, true), "inbound peer UDP");
        Check(GamingLanPacket.IsAllowed(Packet("10.203.42.1", "10.203.42.2"), config, false), "outbound peer UDP");
        foreach (var destination in new[] { "10.203.42.255", "255.255.255.255", "224.0.0.251", "239.255.255.250" })
            Check(GamingLanPacket.IsAllowed(Packet("10.203.42.2", destination), config, true), "LAN discovery " + destination);
        foreach (var destination in new[] { "8.8.8.8", "192.168.1.1", "10.203.43.1", "127.0.0.1", "10.203.42.2" })
            Check(!GamingLanPacket.IsAllowed(Packet("10.203.42.2", destination), config, true), "no external/self forwarding " + destination);
        Check(!GamingLanPacket.IsAllowed(Packet("192.168.1.2", "10.203.42.1"), config, true), "source spoof rejected");
        Check(!GamingLanPacket.IsAllowed(Packet("10.203.42.1", "10.203.42.1"), config, true), "local source spoof rejected");
        Check(GamingLanPacket.IsAllowed(Packet("10.203.42.2", "10.203.42.1", 1), config, true), "ICMP supported");
        var fragment = Packet("10.203.42.2", "10.203.42.1"); fragment[6] = 0x20; Seal(fragment);
        Check(GamingLanPacket.IsAllowed(fragment, config, true), "original IPv4 fragments supported");
        var option = new byte[32]; Buffer.BlockCopy(Packet("10.203.42.2", "10.203.42.1"), 0, option, 0, 28); option[0] = 0x46; option[3] = 32; Seal(option);
        Check(!GamingLanPacket.IsAllowed(option, config, true), "IP source route/options refused");
        var expired = Packet("10.203.42.2", "10.203.42.1"); expired[8] = 0; Seal(expired);
        Check(!GamingLanPacket.IsAllowed(expired, config, true), "expired packet refused");
        Check(!GamingLanPacket.IsAllowed(Packet("10.203.42.2", "10.203.42.1", 47), config, true), "tunnel nesting protocol refused");
        var bad = Packet("10.203.42.2", "10.203.42.1"); bad[10] ^= 1;
        Check(!GamingLanPacket.IsAllowed(bad, config, true), "bad header checksum");
        bad = Packet("10.203.42.2", "10.203.42.1"); bad[3]--;
        Check(!GamingLanPacket.IsAllowed(bad, config, true), "length mismatch");
        Check(!GamingLanPacket.IsAllowed(new byte[65536], config, true), "oversize rejected");
        Check(!GamingLanPacket.IsAllowed(null, config, true), "null rejected");
        var adapter = new FakeAdapter(); var sent = new ConcurrentQueue<byte[]>();
        using (var session = new GamingLanSession(config, () => adapter, action => { action(); return true; }, packet => sent.Enqueue(packet))) {
            session.Start(); Wait(() => session.State == "active", "active");
            adapter.Outbound.Add(Packet(config.Address, config.RemoteAddress));
            Wait(() => sent.Count == 1, "outbound native-to-browser");
            Check(session.Receive(config.SessionId, Convert.ToBase64String(Packet(config.RemoteAddress, config.Address))), "inbound accepted");
            Wait(() => adapter.Inbound.Count == 1, "browser-to-native");
            Check(!session.Receive("ffeeddccbbaa99887766554433221100", Convert.ToBase64String(Packet(config.RemoteAddress, config.Address))), "cross-session rejected");
            Check(!session.Receive(config.SessionId, "!!!"), "bad base64 rejected");
        }
        Check(adapter.Disposed, "adapter disposed after threads stop");
        var closingAdapter = new FakeAdapter(); var created = new ManualResetEvent(false); var releaseFactory = new ManualResetEvent(false);
        var closing = new GamingLanSession(config, () => { created.Set(); releaseFactory.WaitOne(); return closingAdapter; }, action => true, packet => {});
        closing.Start(); Check(created.WaitOne(1000), "startup factory entered"); closing.Dispose(); releaseFactory.Set();
        Wait(() => closingAdapter.Disposed, "stop during startup cleans late adapter"); closing.Dispose();
        created.Dispose(); releaseFactory.Dispose();
        var blockedPosts = new ConcurrentQueue<Action>(); adapter = new FakeAdapter();
        using (var session = new GamingLanSession(config, () => adapter, action => { blockedPosts.Enqueue(action); return true; }, packet => sent.Enqueue(packet))) {
            session.Start(); Wait(() => session.State == "active", "active backpressure");
            for (var i = 0; i < 500; i++) adapter.Outbound.Add(Packet(config.Address, config.RemoteAddress));
            Wait(() => session.PacketsDropped > 0, "bounded UI queue drops");
            Check(blockedPosts.Count <= GamingLanSession.MaxPendingPackets, "bounded UI work");
        }
        var before = sent.Count; Action stale; while (blockedPosts.TryDequeue(out stale)) stale();
        Check(sent.Count == before, "stale callbacks suppressed after stop");
        using (var failed = new GamingLanSession(config, () => { throw new InvalidOperationException("startup failed"); }, action => true, packet => {})) {
            failed.Start(); Wait(() => failed.State == "error", "startup failure visible");
            Check(failed.Error != null, "startup failure explained");
        }
        if (args.Length == 1 && args[0] == "--native") {
            using (var native = new GamingLanSession(Config("10.203.249.1"), () => new WintunGamingLanAdapter(Config("10.203.249.1")), action => { action(); return true; }, packet => {})) {
                native.Start(); Wait(() => native.State == "active" || native.State == "error", "native startup", 45000);
                Check(native.State == "active", "native elevated smoke: " + native.Error);
            }
        }
        Console.WriteLine("PASS " + checks + " Gaming LAN checks.");
    }
    private static void Wait(Func<bool> condition, string name, int timeout = 4000) { var end = DateTime.UtcNow.AddMilliseconds(timeout); while (!condition() && DateTime.UtcNow < end) Thread.Sleep(10); Check(condition(), name); }
    private sealed class FakeAdapter : IGamingLanAdapter
    {
        internal readonly BlockingCollection<byte[]> Outbound = new BlockingCollection<byte[]>();
        internal readonly ConcurrentQueue<byte[]> Inbound = new ConcurrentQueue<byte[]>();
        internal bool Disposed;
        public byte[] Read(CancellationToken cancellation) { byte[] packet; return Outbound.TryTake(out packet, 50, cancellation) ? packet : null; }
        public bool Write(byte[] packet) { Inbound.Enqueue(packet); return true; }
        public void Dispose() { Disposed = true; Outbound.Dispose(); }
    }
}
