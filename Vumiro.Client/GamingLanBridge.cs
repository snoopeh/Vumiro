using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace Vumiro.Client
{
    internal sealed partial class ClientWindow
    {
        private GamingHostClient gamingHost;
        private GamingLanConfiguration gamingLanConfiguration;
        private volatile string gamingLanSessionId;
        private readonly object gamingPacketBudget = new object();
        private int gamingPendingPackets, gamingPendingBytes;
        private long gamingBridgePacketsDropped;
        private GamingHostClient EnsureGamingHost()
        {
            if (gamingHost == null) {
                var host = new GamingHostClient(); gamingHost = host;
                host.PacketReceived += packet => ForwardGamingLanPacket(host, packet);
            }
            return gamingHost;
        }
        private async Task<Dictionary<string, object>> HandleGamingLanActionAsync(string action, Dictionary<string, object> message)
        {
            if (action != "lan-start" && action != "lan-stop" && action != "lan-status" && action != "lan-packet" && action != "lan-set-peers") return null;
            var generation = gamingGeneration;
            if (action == "lan-status" && (gamingHost == null || !gamingHost.IsConnected))
                return new Dictionary<string, object> { { "ok", true }, { "lan", GamingServices.StoppedLan(gamingLanSessionId != null) } };
            var sessionId = GamingText(message, "sessionId");
            GamingLanConfiguration configuration = null;
            if (action == "lan-start") {
                if (!GamingLanConfiguration.TryCreate(sessionId, GamingText(message, "address"), out configuration))
                    return GamingLanFailure("A valid allocated Vumiro LAN address and session ID are required.");
                object peers;
                if (message.TryGetValue("addresses", out peers) && !configuration.SetPeers(peers)) return GamingLanFailure("Invalid authorized LAN peer addresses.");
            } else if (action != "lan-status") {
                if (gamingHost == null || !gamingHost.IsConnected || gamingLanSessionId != sessionId) return GamingLanFailure("The Vumiro LAN session is not active or has changed.");
                if (action == "lan-set-peers") {
                    object peers;
                    if (gamingLanConfiguration == null || !message.TryGetValue("addresses", out peers) || !gamingLanConfiguration.SetPeers(peers)) return GamingLanFailure("Invalid authorized LAN peer addresses.");
                }
            }
            var command = new Dictionary<string, object>();
            if (action != "lan-status") command["sessionId"] = sessionId;
            if (action == "lan-start") command["address"] = configuration.Address;
            object field;
            if ((action == "lan-start" || action == "lan-set-peers") && message.TryGetValue("addresses", out field)) command["addresses"] = field;
            if (action == "lan-packet") command["packet"] = GamingText(message, "packet");
            var result = await EnsureGamingHost().RequestAsync(action, command);
            if (generation != gamingGeneration || IsDisposed || Disposing) return result;
            if (GamingReplyOk(result)) {
                if (action == "lan-start") { gamingLanConfiguration = configuration; gamingLanSessionId = sessionId; }
                else if (action == "lan-stop") StopGamingLan();
            }
            object rawLan;
            var lan = result != null && result.TryGetValue("lan", out rawLan) ? rawLan as Dictionary<string, object> : null;
            if (lan != null) {
                lan["provider"] = "vumiro"; lan["builtIn"] = true;
                lan["bridgePacketsDropped"] = Interlocked.Read(ref gamingBridgePacketsDropped);
            }
            return result;
        }
        private static Dictionary<string, object> GamingLanFailure(string error)
        { return new Dictionary<string, object> { { "ok", false }, { "error", error }, { "errorCode", "lan-rejected" } }; }
        private void ForwardGamingLanPacket(GamingHostClient source, Dictionary<string, object> packet)
        {
            var generation = gamingGeneration;
            var sessionId = GamingText(packet, "sessionId"); var encoded = GamingText(packet, "packet");
            if (!ReferenceEquals(source, gamingHost) || sessionId == null || sessionId != gamingLanSessionId || GamingText(packet, "type") != "gaming-lan-packet" || encoded == null || encoded.Length > 87380 || IsDisposed || Disposing || !IsHandleCreated) return;
            var bytes = encoded.Length;
            lock (gamingPacketBudget) {
                if (gamingPendingPackets >= 128 || gamingPendingBytes + bytes > 2 * 1024 * 1024) { Interlocked.Increment(ref gamingBridgePacketsDropped); return; }
                gamingPendingPackets++; gamingPendingBytes += bytes;
            }
            var posted = false;
            try {
                BeginInvoke(new Action(() => {
                    try {
                        if (generation == gamingGeneration && ReferenceEquals(source, gamingHost) && sessionId == gamingLanSessionId && !IsDisposed && !Disposing && browser.CoreWebView2 != null)
                            browser.CoreWebView2.PostWebMessageAsJson(json.Serialize(packet));
                    }
                    catch (InvalidOperationException) { }
                    finally { lock (gamingPacketBudget) { gamingPendingPackets--; gamingPendingBytes -= bytes; } }
                }));
                posted = true;
            }
            catch (InvalidOperationException) { }
            finally { if (!posted) { Interlocked.Increment(ref gamingBridgePacketsDropped); lock (gamingPacketBudget) { gamingPendingPackets--; gamingPendingBytes -= bytes; } } }
        }
        internal void StopGamingLan() { gamingLanSessionId = null; gamingLanConfiguration = null; }
    }
}
