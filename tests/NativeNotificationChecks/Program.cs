using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;
using Vumiro.Client;
class Program
{
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
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
            popup.Show(); Application.DoEvents();
            typeof(DesktopNotificationPopup).GetMethod("OnMouseEnter", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance).Invoke(popup, new object[] { EventArgs.Empty });
            var lifetime = (Timer)typeof(DesktopNotificationPopup).GetField("lifetime", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance).GetValue(popup);
            Check(lifetime.Enabled && lifetime.Interval <= 12000, "popup lifetime remains bounded even while hovered");
            popup.Close();
        }
        using (var owner = new Form { Bounds = new Rectangle(150, 150, 500, 350) })
        {
            owner.Show(); owner.Activate(); Application.DoEvents();
            var foreground = GetForegroundWindow();
            var data = new DesktopNotificationData { Id = "event-foreground", Category = "message", SenderName = "Alice", Body = "Corner popup while Vumiro is focused", Avatar = "" };
            using (var center = new DesktopNotificationCenter(owner, id => {}))
            {
                center.Show(data); Application.DoEvents();
                var popup = Application.OpenForms.OfType<DesktopNotificationPopup>().Single();
                Check(popup.Visible && popup.Parent == null && popup.Owner == null, "real independent top-level desktop popup");
                Check(popup.Right <= Screen.FromControl(owner).WorkingArea.Right && popup.Bottom <= Screen.FromControl(owner).WorkingArea.Bottom, "popup anchors inside desktop work area");
                Check(GetForegroundWindow() == foreground, "desktop popup keeps the current foreground window");
                center.Show(data); Check(Application.OpenForms.OfType<DesktopNotificationPopup>().Count() == 1, "popup delivery is deduplicated");
                for (int index = 0; index < 6; index++) center.Show(new DesktopNotificationData { Id = "event-" + index, Category = "message", SenderName = "Alice", Body = "Corner popup", Avatar = "" });
                Check(Application.OpenForms.OfType<DesktopNotificationPopup>().Count() == 3, "corner popup stack is bounded");
                center.Dispose();
                center.Show(new DesktopNotificationData { Id = "after-clear", Category = "message", SenderName = "Alice", Body = "Stale delivery", Avatar = "" });
                Check(!Application.OpenForms.OfType<DesktopNotificationPopup>().Any(), "cleared sessions reject stale native delivery");
            }
            owner.Close();
        }
        Console.WriteLine("Native notification payload checks passed.");
    }
}
