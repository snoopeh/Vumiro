using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace Vumiro.Client
{
    internal sealed partial class ClientWindow
    {
        private int gamingGeneration;
        private bool gamingDiagnosticRunning;
        private int gamingPendingNativeStarts;
        private async Task<bool> HandleGamingMessageAsync(Dictionary<string, object> message)
        {
            if (message == null || GamingText(message, "type") != "gaming") return false;
            var requestId = GamingText(message, "requestId");
            if (requestId == null || !Regex.IsMatch(requestId, "\\A[a-zA-Z0-9]{1,64}\\z")) return true;
            var generation = gamingGeneration;
            Dictionary<string, object> result = null;
            string error = null, errorCode = null;
            var ok = false;
            var admittedNativeStart = false;
            try {
                if (IsDisposed || Disposing) return true;
                var action = GamingText(message, "action");
                if (gamingDiagnosticRunning && (action == "lan-start" || action == "remote-controller-start"))
                    throw new GamingServiceException("diagnostic-running", "Wait for the native self-test to finish before starting a session.");
                if (action == "lan-start" || action == "remote-controller-start") {
                    // Admission happens on the UI thread before the first await.
                    // Keep it reserved through helper setup and controller retry.
                    Interlocked.Increment(ref gamingPendingNativeStarts);
                    admittedNativeStart = true;
                }
                if (action == "self-test") {
                    if (!ClientRuntime.Current.IsLocalQa) throw new GamingServiceException("local-qa-only", "Native self-tests are available only in LOCAL QA.");
                    var kind = GamingText(message, "kind");
                    if (kind != "lan" && kind != "controller") throw new GamingServiceException("invalid-diagnostic", "Choose the LAN or controller native self-test.");
                    var controllerReply = HandleGamingControllerAction("mapper-status", message) as Dictionary<string, object>;
                    object controllerValue, activeValue;
                    var controller = controllerReply != null && controllerReply.TryGetValue("controller", out controllerValue) ? controllerValue as Dictionary<string, object> : null;
                    var active = controller != null && controller.TryGetValue("active", out activeValue) && activeValue is bool && (bool)activeValue;
                    if (gamingDiagnosticRunning || Volatile.Read(ref gamingPendingNativeStarts) != 0 || gamingLanSessionId != null || active) result = GamingDiagnostics.Unavailable("Wait for pending setup and end the active gaming session before running a native self-test.");
                    else {
                        gamingDiagnosticRunning = true;
                        try {
                            result = kind == "controller" ? await Task.Run(() => GamingDiagnostics.NativeController(() => new GamingDiagnosticPad()))
                                : await EnsureGamingHost().RequestAsync("self-test-lan", new Dictionary<string, object>());
                            if (kind == "lan" && !GamingReplyOk(result)) result = GamingDiagnostics.Unavailable(GamingText(result, "error") ?? "The LAN helper could not run its native adapter check.");
                        } finally { gamingDiagnosticRunning = false; }
                    }
                    ok = true;
                } else if (action == "status") {
                    var lanReply = await HandleGamingLanActionAsync("lan-status", message);
                    if (generation != gamingGeneration || IsDisposed || Disposing) return true;
                    var controllerReply = HandleGamingControllerAction("mapper-status", message) as Dictionary<string, object>;
                    object controller = null; if (controllerReply != null) controllerReply.TryGetValue("controller", out controller);
                    object rawLan; var lan = lanReply != null && lanReply.TryGetValue("lan", out rawLan) ? rawLan as Dictionary<string, object> : null;
                    result = new Dictionary<string, object> { { "status", GamingServices.Status(lan ?? GamingServices.StoppedLan(), controller) }, { "controller", controller } };
                    ok = true;
                } else {
                    result = await HandleGamingLanActionAsync(action, message);
                    if (generation != gamingGeneration || IsDisposed || Disposing) return true;
                    if (result == null) {
                        if (action == "remote-controller-start" && !GamingLanConfiguration.TryCreate(GamingText(message, "sessionId"), "10.203.1.1", out var ignored))
                            throw new GamingServiceException("invalid-session", "A valid gaming session is required for remote input.");
                        result = HandleGamingControllerAction(action, message) as Dictionary<string, object>;
                        if (result == null) throw new GamingServiceException("unknown-action", "Unsupported Vumiro gaming action.");
                        if (action == "remote-controller-start" && ControllerNeedsInstall(result) && GamingPayloads.ControllerDriverBundled) {
                            var installed = await EnsureGamingHost().RequestAsync("install-controller", new Dictionary<string, object>());
                            if (generation != gamingGeneration || IsDisposed || Disposing) return true;
                            if (!GamingReplyOk(installed)) result = installed;
                            else {
                                result = HandleGamingControllerAction(action, message) as Dictionary<string, object>;
                                if (!GamingReplyOk(result)) {
                                    object rawController; var installStatus = installed.TryGetValue("controller", out rawController) ? rawController as Dictionary<string, object> : null;
                                    object restart; var needsRestart = installStatus != null && installStatus.TryGetValue("restartRequired", out restart) && restart is bool && (bool)restart;
                                    result["error"] = needsRestart ? "Restart Windows to finish enabling Vumiro's virtual controller, then rejoin the gaming session." : "The bundled virtual controller driver is not ready. Rejoin the gaming session or restart Windows.";
                                    result["errorCode"] = needsRestart ? "restart-required" : "controller-unavailable";
                                }
                            }
                        }
                    }
                    ok = GamingReplyOk(result);
                    if (!ok) { error = GamingText(result, "error") ?? "The Vumiro gaming action could not complete."; errorCode = GamingText(result, "errorCode"); }
                }
            }
            catch (GamingServiceException exception) { error = exception.Message; errorCode = exception.Code; }
            catch (Exception) { error = "Vumiro could not complete the gaming action. Rejoin the session and try again."; errorCode = "gaming-error"; }
            finally { if (admittedNativeStart) Interlocked.Decrement(ref gamingPendingNativeStarts); }
            if (!IsDisposed && !Disposing && generation == gamingGeneration && browser.CoreWebView2 != null)
                browser.CoreWebView2.PostWebMessageAsJson(json.Serialize(new Dictionary<string, object> {
                    { "type", "gaming-result" }, { "requestId", requestId }, { "ok", ok }, { "result", result }, { "error", error }, { "errorCode", errorCode }
                }));
            return true;
        }
        private sealed class GamingDiagnosticPad : IGamingDiagnosticPad
        {
            private readonly VirtualGamepad pad = new VirtualGamepad();
            public void Submit(GamingDiagnosticFrame value) { pad.Submit(new ControllerFrame { Buttons=value.Buttons,LeftX=value.LeftX,LeftY=value.LeftY,RightX=value.RightX,RightY=value.RightY,LeftTrigger=value.LeftTrigger,RightTrigger=value.RightTrigger }); }
            public void Dispose() { pad.Dispose(); }
        }
        private static bool ControllerNeedsInstall(Dictionary<string, object> reply)
        {
            object value; if (reply == null || !reply.TryGetValue("controller", out value)) return false;
            var controller = value as Dictionary<string, object>;
            return controller != null && controller.TryGetValue("available", out value) && value is bool && !(bool)value;
        }
        private static bool GamingReplyOk(Dictionary<string, object> reply)
        { object value; return reply != null && reply.TryGetValue("ok", out value) && value is bool && (bool)value; }
        private static string GamingText(Dictionary<string, object> message, string key)
        { object value; return message != null && message.TryGetValue(key, out value) ? value as string : null; }
        private void StopGaming()
        {
            unchecked { gamingGeneration++; }
            try { StopGamingController(); }
            finally {
                StopGamingLan();
                var previous = gamingHost; gamingHost = null;
                if (previous != null) previous.Dispose();
            }
        }
    }
}
