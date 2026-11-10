using System;
using System.Collections.Generic;
using Vumiro.Client;
class Program
{
    static void Check(bool value, string name) { if (!value) throw new Exception(name); }
    [STAThread] static void Main()
    {
        var payload = new Dictionary<string, object> { {"id", "event-1"}, {"category", "call"}, {"senderName", "Alice"}, {"body", "Incoming call"}, {"avatar", ""} };
        DesktopNotificationData value;
        Check(DesktopNotificationData.TryParse(payload, out value), "valid payload");
        Check(value.SenderName == "Alice" && value.Body == "Incoming call", "identity preserved");
        payload["avatar"] = "https://example.test/a.png";
        Check(!DesktopNotificationData.TryParse(payload, out value), "remote avatar rejected");
        payload["avatar"] = ""; payload["id"] = "javascript:alert(1)";
        Check(!DesktopNotificationData.TryParse(payload, out value), "untrusted action rejected");
        payload["id"] = "event-1"; payload["body"] = new string('x', 321);
        Check(!DesktopNotificationData.TryParse(payload, out value), "oversized text rejected");
        payload["body"] = "Call"; payload["extra"] = "ignore";
        Check(!DesktopNotificationData.TryParse(payload, out value), "unknown field rejected");
        Check(DesktopNotificationData.DecodeAvatar("data:image/png;base64,AA==") == null, "malformed image ignored");
        var largePng = new byte[24]; largePng[0] = 137; largePng[1] = 80; largePng[2] = 78; largePng[3] = 71;
        largePng[18] = 16; largePng[22] = 16;
        Check(DesktopNotificationData.DecodeAvatar("data:image/png;base64," + Convert.ToBase64String(largePng)) == null, "large raster rejected before decoding");
        using (var popup = new DesktopNotificationPopup(new DesktopNotificationData { Id = "event-1", Category = "call", SenderName = "Alice", Body = "Call", Avatar = "" }, () => {}))
        {
            Check(!popup.ShowInTaskbar && popup.TopMost, "popup stays out of taskbar");
            var nonactivating = typeof(DesktopNotificationPopup).GetProperty("ShowWithoutActivation", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
            Check((bool)nonactivating.GetValue(popup, null), "popup cannot steal focus");
        }
        Console.WriteLine("Native notification payload checks passed.");
    }
}
