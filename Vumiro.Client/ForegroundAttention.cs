using System;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace Vumiro.Client
{
    internal static class ForegroundAttention
    {
        // Inspect window geometry only. Never capture another application's pixels.
        internal static Rectangle? ExternalFullscreenMonitor()
        {
            var window = GetForegroundWindow();
            if (window == IntPtr.Zero || !IsWindowVisible(window) || IsIconic(window)) return null;
            uint process;
            GetWindowThreadProcessId(window, out process);
            using (var current = Process.GetCurrentProcess()) if (process == current.Id) return null;
            var name = new StringBuilder(128);
            GetClassName(window, name, name.Capacity);
            if (name.ToString() == "Progman" || name.ToString() == "WorkerW" || name.ToString() == "Shell_TrayWnd") return null;
            NativeRect rect;
            if (!GetWindowRect(window, out rect)) return null;
            var bounds = Rectangle.FromLTRB(rect.Left, rect.Top, rect.Right, rect.Bottom);
            var monitor = Screen.FromHandle(window).Bounds;
            return IsFullscreenBounds(bounds, monitor) ? (Rectangle?)monitor : null;
        }

        internal static bool IsFullscreenBounds(Rectangle window, Rectangle monitor)
        {
            // A normal maximized window includes resize borders and/or leaves the taskbar visible.
            return Math.Abs(window.Left - monitor.Left) <= 2 && Math.Abs(window.Top - monitor.Top) <= 2
                && Math.Abs(window.Right - monitor.Right) <= 2 && Math.Abs(window.Bottom - monitor.Bottom) <= 2;
        }

        [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int maximum);
        [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out NativeRect rect);
    }
}
