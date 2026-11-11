using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text.RegularExpressions;
using System.Threading;

namespace Vumiro.Client
{
    internal sealed partial class ClientWindow
    {
        private GamingRemoteInput remoteGamingInput;
        private Timer remoteGamingTimer;
        internal object HandleGamingControllerAction(string action, Dictionary<string, object> message)
        {
            if (action != "mapper-status" && action != "controller-status" && action != "remote-controller-status" && action != "remote-controller-start" && action != "remote-controller-frame" && action != "remote-controller-stop") return null;
            try {
                if (action == "remote-controller-start") {
                    var session = ControllerText(message, "sessionId");
                    if (!GamingRemoteInput.IsSession(session)) return ControllerReply(false, "Invalid gaming session.");
                    StopGamingController();
                    var pad = new VirtualGamepad();
                    try {
                        remoteGamingInput = new GamingRemoteInput(session, pad.Submit, pad.Dispose, () => Stopwatch.GetTimestamp() * 1000 / Stopwatch.Frequency);
                        var input = remoteGamingInput;
                        remoteGamingTimer = new Timer(_ => input.Tick(), null, 50, 50);
                    } catch { pad.Dispose(); throw; }
                } else if (action == "remote-controller-stop") {
                    var session = ControllerText(message, "sessionId");
                    if (session == null || remoteGamingInput == null || session == remoteGamingInput.SessionId) StopGamingController();
                } else if (action == "remote-controller-frame") {
                    object sequence, frame;
                    if (remoteGamingInput == null || message == null || !message.TryGetValue("sequence", out sequence) || !(sequence is int) || !message.TryGetValue("frame", out frame) || !remoteGamingInput.Receive(ControllerText(message, "sessionId"), (int)sequence, frame as Dictionary<string, object>))
                        return ControllerReply(false, "Rejected stale or invalid controller input.");
                }
                return ControllerReply(true, null);
            } catch (Exception e) { StopGamingController(); return ControllerReply(false, "Virtual controller unavailable: " + e.GetType().Name); }
        }
        private static string ControllerText(Dictionary<string, object> message, string key) { object value; return message != null && message.TryGetValue(key, out value) ? value as string : null; }
        private object ControllerReply(bool ok, string error) { return new Dictionary<string, object> { { "ok", ok }, { "error", error }, { "controller", ControllerStatus() } }; }
        private object ControllerStatus()
        {
            string message = "Remote input controller active."; bool available = true;
            var input = remoteGamingInput;
            if (input == null || !input.Active) {
                try { available = VirtualGamepad.Probe(out message); }
                catch (Exception e) { available = false; message = "Bundled controller runtime unavailable: " + e.GetType().Name; }
            }
            return new Dictionary<string, object> { { "available", available }, { "active", input != null && input.Active }, { "backend", "virtual-xbox" }, { "sessionId", input == null ? null : input.SessionId }, { "message", message } };
        }
        internal void StopGamingController()
        {
            var timer = remoteGamingTimer; remoteGamingTimer = null; if (timer != null) timer.Dispose();
            var input = remoteGamingInput; remoteGamingInput = null; if (input != null) input.Dispose();
        }
    }

    // The device accepts frames only for one explicitly authorized gaming session.
    // Even a stalled browser/peer releases all inputs before its connection lease ends.
    internal sealed class GamingRemoteInput : IDisposable
    {
        private readonly object sync = new object();
        private readonly Action<ControllerFrame> submit;
        private readonly Action close;
        private readonly Func<long> milliseconds;
        private long lastInput;
        private int lastSequence = -1;
        private bool active = true, neutral = true;
        internal string SessionId { get; private set; }
        internal bool Active { get { lock (sync) return active; } }
        internal static bool IsSession(string value) { return value != null && Regex.IsMatch(value, "\\A[0-9a-f]{32}\\z"); }
        internal GamingRemoteInput(string sessionId, Action<ControllerFrame> report, Action disconnect, Func<long> clock)
        {
            if (!IsSession(sessionId)) throw new ArgumentException("Invalid session.");
            SessionId = sessionId; submit = report; close = disconnect; milliseconds = clock; lastInput = clock();
        }
        internal bool Receive(string sessionId, int sequence, Dictionary<string, object> values)
        {
            ControllerFrame frame;
            if (sessionId != SessionId || sequence < 0 || !TryFrame(values, out frame)) return false;
            lock (sync) {
                if (!active || sequence <= lastSequence) return false;
                try { submit(frame); lastSequence = sequence; lastInput = milliseconds(); neutral = false; return true; }
                catch { Finish(); return false; }
            }
        }
        internal void Tick()
        {
            lock (sync) {
                if (!active) return;
                var age = milliseconds() - lastInput;
                if (age >= 300 && !neutral) {
                    try { submit(new ControllerFrame()); neutral = true; }
                    catch { Finish(); }
                }
            }
        }
        internal static bool TryFrame(Dictionary<string, object> values, out ControllerFrame frame)
        {
            frame = new ControllerFrame(); if (values == null || values.Count != 7) return false;
            int buttons,lx,ly,rx,ry,lt,rt;
            if (!Number(values,"buttons",0,65535,out buttons) || (buttons & ~0xf3ff) != 0 || !Number(values,"leftX",-32768,32767,out lx) || !Number(values,"leftY",-32768,32767,out ly) || !Number(values,"rightX",-32768,32767,out rx) || !Number(values,"rightY",-32768,32767,out ry) || !Number(values,"leftTrigger",0,255,out lt) || !Number(values,"rightTrigger",0,255,out rt)) return false;
            frame = new ControllerFrame { Buttons=(ushort)buttons, LeftX=(short)lx,LeftY=(short)ly,RightX=(short)rx,RightY=(short)ry,LeftTrigger=(byte)lt,RightTrigger=(byte)rt }; return true;
        }
        private static bool Number(Dictionary<string,object> values,string key,int min,int max,out int number)
        { object value; number=0; if(!values.TryGetValue(key,out value) || !(value is int)) return false; number=(int)value; return number>=min && number<=max; }
        private void Finish()
        {
            if (!active) return; active = false;
            try { submit(new ControllerFrame()); } catch { }
            finally { try { close(); } catch { } }
        }
        public void Dispose() { lock(sync) Finish(); }
    }
}
