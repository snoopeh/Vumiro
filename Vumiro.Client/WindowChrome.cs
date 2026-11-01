using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Vumiro.Client
{
    internal sealed partial class ClientWindow
    {
        private bool contentFullscreen;
        private bool backdropEnabled;
        private static readonly Dictionary<string, int> ResizeEdges = new Dictionary<string, int> {
            {"w",10}, {"e",11}, {"n",12}, {"nw",13}, {"ne",14}, {"s",15}, {"sw",16}, {"se",17}
        };

        private void InitializeWindowChrome()
        {
            FormBorderStyle = FormBorderStyle.None;
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            HandleCreated += (s, e) => ApplyWindowAppearance();
            Resize += (s, e) => { ApplyWindowAppearance(); PublishWindowState(); };
        }

        protected override CreateParams CreateParams
        {
            get
            {
                var value = base.CreateParams;
                // Retain Windows sizing, snap and taskbar behavior, while the
                // application draws the caption and client border itself.
                value.Style |= 0x00040000 | 0x00020000 | 0x00010000 | 0x00080000;
                return value;
            }
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == 0x0083) { message.Result = IntPtr.Zero; return; } // WM_NCCALCSIZE
            base.WndProc(ref message);
            if (message.Msg == 0x001a || message.Msg == 0x031a || message.Msg == 0x031e)
            {
                ApplyWindowAppearance(); PublishWindowState();
            }
            if (message.Msg == 0x0024 && message.LParam != IntPtr.Zero)
            {
                var monitor = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)) };
                if (GetMonitorInfo(MonitorFromWindow(Handle, 2), ref monitor))
                {
                    var limits = (MinMaxInfo)Marshal.PtrToStructure(message.LParam, typeof(MinMaxInfo));
                    var area = contentFullscreen ? monitor.Monitor : monitor.Work;
                    limits.MaxPosition = new NativePoint { X = area.Left - monitor.Monitor.Left, Y = area.Top - monitor.Monitor.Top };
                    limits.MaxSize = new NativePoint { X = area.Right - area.Left, Y = area.Bottom - area.Top };
                    limits.MinTrackSize = new NativePoint { X = MinimumSize.Width, Y = MinimumSize.Height };
                    Marshal.StructureToPtr(limits, message.LParam, false);
                }
            }
            if (message.Msg == 0x0084 && message.Result == new IntPtr(1) && !contentFullscreen && WindowState == FormWindowState.Normal)
            {
                var packed = message.LParam.ToInt64();
                var point = PointToClient(new Point((short)(packed & 0xffff), (short)((packed >> 16) & 0xffff)));
                var edge = Math.Max(5, (int)Math.Round(6 * DeviceDpi / 96.0));
                var left = point.X < edge; var right = point.X >= ClientSize.Width - edge;
                var top = point.Y < edge; var bottom = point.Y >= ClientSize.Height - edge;
                var hit = top ? left ? 13 : right ? 14 : 12 : bottom ? left ? 16 : right ? 17 : 15 : left ? 10 : right ? 11 : 1;
                message.Result = new IntPtr(hit);
            }
        }

        private void ApplyWindowAppearance()
        {
            if (!IsHandleCreated || IsDisposed) return;
            var dark = 1; var corners = contentFullscreen || WindowState == FormWindowState.Maximized ? 1 : 2;
            var border = 0x00272729;
            DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int));
            DwmSetWindowAttribute(Handle, 33, ref corners, sizeof(int));
            DwmSetWindowAttribute(Handle, 34, ref border, sizeof(int));
            // Let DWM blur/tint the desktop, while WebView paints text and media
            // at full opacity. Unsupported systems retain the solid dark theme.
            var backdrop = !contentFullscreen && TransparencyAllowed() ? 3 : 1; // Desktop Acrylic / none
            var enabled = DwmSetWindowAttribute(Handle, 38, ref backdrop, sizeof(int)) == 0 && backdrop == 3;
            if (enabled != backdropEnabled)
            {
                backdropEnabled = enabled;
                BackColor = enabled ? Color.Black : Color.FromArgb(11, 11, 12);
                browser.DefaultBackgroundColor = enabled ? Color.Transparent : Color.FromArgb(11, 11, 12);
                Invalidate();
            }
            var extent = enabled ? -1 : 1;
            var margins = new Margins { Left = extent, Right = extent, Top = extent, Bottom = extent };
            DwmExtendFrameIntoClientArea(Handle, ref margins);
        }

        private static bool TransparencyAllowed()
        {
            if (SystemInformation.HighContrast) return false;
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                    return !Equals(key?.GetValue("EnableTransparency"), 0);
            }
            catch (System.Security.SecurityException) { return false; }
            catch (UnauthorizedAccessException) { return false; }
        }

        private bool HandleWindowMessage(Dictionary<string, object> message)
        {
            object type, actionValue;
            if (message == null || !message.TryGetValue("type", out type) || type as string != "window") return false;
            if (message.Count < 2 || message.Count > 3 || !message.TryGetValue("action", out actionValue) || !(actionValue is string)) return true;
            var action = (string)actionValue;
            if (action == "close") Close();
            else if (action == "minimize") WindowState = FormWindowState.Minimized;
            else if (action == "maximize" && !contentFullscreen) WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
            else if (action == "drag" && !contentFullscreen && (Control.MouseButtons & MouseButtons.Left) != 0)
            {
                ReleaseCapture(); SendMessage(Handle, 0x00a1, new IntPtr(2), IntPtr.Zero);
            }
            else if (action == "resize" && !contentFullscreen && WindowState == FormWindowState.Normal && (Control.MouseButtons & MouseButtons.Left) != 0)
            {
                object edgeValue; int hit;
                if (message.TryGetValue("edge", out edgeValue) && edgeValue is string && ResizeEdges.TryGetValue((string)edgeValue, out hit))
                { ReleaseCapture(); SendMessage(Handle, 0x00a1, new IntPtr(hit), IntPtr.Zero); }
            }
            else if (action == "notify" && !ContainsFocus)
            {
                var flash = new FlashInfo { Size = (uint)Marshal.SizeOf(typeof(FlashInfo)), Window = Handle, Flags = 3, Count = 3, Timeout = 0 };
                FlashWindowEx(ref flash);
            }
            PublishWindowState(); return true;
        }

        private void SetContentFullscreen(bool fullscreen)
        {
            if (fullscreen == contentFullscreen) return;
            if (fullscreen)
            {
                windowState = WindowState;
                windowBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
                contentFullscreen = true; WindowState = FormWindowState.Normal;
                Bounds = Screen.FromControl(this).Bounds;
            }
            else
            {
                contentFullscreen = false; WindowState = FormWindowState.Normal;
                Bounds = windowBounds; WindowState = windowState;
            }
            ApplyWindowAppearance(); PublishWindowState();
        }

        private void PublishWindowState()
        {
            if (!IsDisposed && browser != null && browser.CoreWebView2 != null)
                browser.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { type = "window-state", maximized = WindowState == FormWindowState.Maximized, fullscreen = contentFullscreen, backdrop = backdropEnabled }));
        }

        [StructLayout(LayoutKind.Sequential)] private struct NativePoint { public int X, Y; }
        [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
        [StructLayout(LayoutKind.Sequential)] private struct MinMaxInfo { public NativePoint Reserved, MaxSize, MaxPosition, MinTrackSize, MaxTrackSize; }
        [StructLayout(LayoutKind.Sequential)] private struct MonitorInfo { public int Size; public NativeRect Monitor, Work; public uint Flags; }
        [StructLayout(LayoutKind.Sequential)] private struct Margins { public int Left, Right, Top, Bottom; }
        [StructLayout(LayoutKind.Sequential)] private struct FlashInfo { public uint Size; public IntPtr Window; public uint Flags, Count, Timeout; }
        [DllImport("user32.dll")] private static extern bool ReleaseCapture();
        [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
        [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
        [DllImport("user32.dll")] private static extern bool FlashWindowEx(ref FlashInfo info);
        [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
        [DllImport("dwmapi.dll")] private static extern int DwmExtendFrameIntoClientArea(IntPtr window, ref Margins margins);
    }
}
