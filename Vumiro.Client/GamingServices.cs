using System;
using System.Collections.Generic;

namespace Vumiro.Client
{
    internal sealed class GamingServiceException : Exception
    {
        internal string Code { get; private set; }
        internal GamingServiceException(string code, string message) : base(message) { Code = code; }
    }

    // Projection only: gameplay and transport live in Vumiro's own engine.
    internal static class GamingServices
    {
        internal static Dictionary<string, object> StoppedLan(bool helperLost = false)
        {
            return new Dictionary<string, object> {
                { "provider", "vumiro" }, { "builtIn", true }, { "state", helperLost ? "error" : "stopped" },
                { "sessionId", null }, { "address", null }, { "remoteAddress", null }, { "prefixLength", 24 },
                { "driverReady", GamingPayloads.LanDriverBundled }, { "requiresElevation", false },
                { "message", helperLost ? "The Vumiro LAN helper disconnected. Rejoin the session." : GamingPayloads.LanDriverBundled ? "Start a gaming session to connect Vumiro LAN." : "The bundled LAN adapter is missing. Repair the Vumiro installation." },
                { "error", helperLost ? "The LAN helper connection was lost." : null },
                { "packetsSent", 0L }, { "packetsReceived", 0L }, { "packetsDropped", 0L }
            };
        }
        internal static Dictionary<string, object> Status(Dictionary<string, object> lan, object controller)
        {
            return new Dictionary<string, object> {
                { "platform", "windows" }, { "engine", "vumiro" }, { "builtIn", true }, { "lan", lan }, { "controller", controller },
                { "streaming", new Dictionary<string, object> { { "builtIn", true }, { "provider", "vumiro-webrtc" } } },
                { "runtime", new Dictionary<string, object> { { "bundled", true }, { "lanDriverBundled", GamingPayloads.LanDriverBundled }, { "controllerDriverBundled", GamingPayloads.ControllerDriverBundled } } }
            };
        }
    }
}
