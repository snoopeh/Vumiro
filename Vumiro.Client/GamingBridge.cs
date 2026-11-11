using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace Vumiro.Client
{
    internal sealed partial class ClientWindow
    {
        private GamingServices gamingServices;
        private int gamingGeneration;

        private async Task<bool> HandleGamingMessageAsync(Dictionary<string, object> message)
        {
            if (message == null || GamingText(message, "type") != "gaming") return false;
            var requestId = GamingText(message, "requestId");
            // Bad envelopes are consumed without echoing attacker-controlled IDs.
            if (requestId == null || !Regex.IsMatch(requestId, "\\A[a-zA-Z0-9]{1,64}\\z")) return true;
            var requestGeneration = gamingGeneration;
            object result = null;
            string error = null;
            string errorCode = null;
            var ok = false;
            try
            {
                if (IsDisposed) return true;
                var action = GamingText(message, "action");
                if (action == "status" || action == "lan-join" || action == "lan-leave")
                {
                    if (gamingServices == null) gamingServices = new GamingServices();
                    var status = action == "status" ? await gamingServices.GetStatusAsync() : await gamingServices.ChangeNetworkAsync(GamingText(message, "networkId"), action == "lan-join");
                    if (requestGeneration != gamingGeneration || IsDisposed) return true;
                    var controllerReply = HandleGamingControllerAction("mapper-status", message) as Dictionary<string, object>;
                    object controller = null;
                    if (controllerReply != null) controllerReply.TryGetValue("controller", out controller);
                    status["controller"] = controller;
                    result = new Dictionary<string, object> { { "status", status }, { "controller", controller } };
                    ok = true;
                }
                else if (action == "open-setup" || action == "open-host" || action == "pair" || action == "stream" || action == "list")
                {
                    if (gamingServices == null) gamingServices = new GamingServices();
                    result = gamingServices.Launch(action, GamingText(message, "component"), GamingText(message, "host"));
                    ok = true;
                }
                else
                {
                    result = HandleGamingControllerAction(action, message);
                    if (result == null) throw new GamingServiceException("unknown-action", "Unsupported gaming action.");
                    var controllerReply = result as Dictionary<string, object>;
                    object rawOk;
                    ok = controllerReply != null && controllerReply.TryGetValue("ok", out rawOk) && rawOk is bool && (bool)rawOk;
                    if (!ok) error = controllerReply == null ? "Controller action could not complete." : GamingText(controllerReply, "error") ?? "Controller action could not complete.";
                }
            }
            catch (GamingServiceException exception) { error = exception.Message; errorCode = exception.Code; }
            catch (Exception) { error = "The gaming action could not complete. Refresh status and try again."; errorCode = "gaming-error"; }
            if (!IsDisposed && requestGeneration == gamingGeneration && browser.CoreWebView2 != null)
                browser.CoreWebView2.PostWebMessageAsJson(json.Serialize(new Dictionary<string, object> {
                    { "type", "gaming-result" }, { "requestId", requestId }, { "ok", ok },
                    { "result", result }, { "error", error }, { "errorCode", errorCode }
                }));
            return true;
        }

        private static string GamingText(Dictionary<string, object> message, string key)
        {
            object value;
            return message.TryGetValue(key, out value) ? value as string : null;
        }

        private void StopGaming()
        {
            unchecked { gamingGeneration++; }
            try { StopGamingController(); }
            finally
            {
                var previous = gamingServices;
                gamingServices = null;
                if (previous != null) previous.Dispose();
            }
        }
    }
}
