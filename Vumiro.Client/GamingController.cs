using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Text;
using System.Windows.Forms;

namespace Vumiro.Client
{
    internal sealed partial class ClientWindow
    {
        private GamingControllerSession gamingController;
        internal object HandleGamingControllerAction(string action, Dictionary<string, object> message)
        {
            if (action != "mapper-status" && action != "controller-status" && action != "mapper-start" && action != "mapper-stop" && action != "mapper-heartbeat") return null;
            if (action == "mapper-stop") StopGamingController();
            if (action == "mapper-heartbeat" && gamingController != null) gamingController.Heartbeat();
            if (action == "mapper-start") {
                object raw; Dictionary<string, string> bindings; string error;
                if (message == null || !message.TryGetValue("bindings", out raw) || !ControllerMapping.TryValidate(raw as Dictionary<string, object>, out bindings, out error))
                    return ControllerReply(false, "Invalid controller bindings. Use unique supported KeyboardEvent.code values; Escape is reserved.");
                StopGamingController();
                gamingController = new GamingControllerSession(bindings, GamingServices.FindInstalledExecutable("moonlight"));
                gamingController.Start();
                if (!gamingController.Active) return ControllerReply(false, gamingController.Message);
            }
            return ControllerReply(true, null);
        }
        private object ControllerReply(bool ok, string error) { return new Dictionary<string, object> { { "ok", ok }, { "error", error }, { "controller", ControllerStatus() } }; }
        private object ControllerStatus()
        {
            if (gamingController != null) return new Dictionary<string, object> { { "available", gamingController.Available }, { "active", gamingController.Active }, { "capturing", gamingController.Capturing }, { "backend", "ViGEmBus" }, { "message", gamingController.Message } };
            string message; bool available;
            // A missing managed client can fail JIT compilation before Probe's
            // own catch block runs. Keep that boundary in this dependency-free host.
            try { available = VirtualGamepad.Probe(out message); }
            catch (Exception error) { available = false; message = "The ViGEm client library is unavailable (" + error.GetType().Name + "). Keyboard mapping is unavailable."; }
            return new Dictionary<string, object> { { "available", available }, { "active", false }, { "capturing", false }, { "backend", "ViGEmBus" }, { "message", message } };
        }
        internal void StopGamingController()
        {
            if (gamingController == null) return;
            gamingController.Dispose(); gamingController = null;
        }
    }

    // The hook and report pump share this dedicated thread. Browser stalls do not
    // block focus release, Escape, report submission, or the five-second lease.
    internal sealed class GamingControllerSession : IDisposable
    {
        private readonly ControllerCaptureState state;
        private readonly string moonlight;
        private readonly int ownProcess = Process.GetCurrentProcess().Id;
        private readonly ManualResetEvent started = new ManualResetEvent(false);
        private Thread thread;
        private long heartbeat = Stopwatch.GetTimestamp();
        private volatile bool stopping, active, available, capturing;
        private volatile string message = "Controller stopped.";
        private IntPtr hook, foreground;
        private uint foregroundPid;
        private bool foregroundAllowed, foregroundNeedsResolve;
        private string foregroundExecutable, foregroundClass;
        private HookCallback callback;
        internal GamingControllerSession(Dictionary<string, string> bindings, string moonlight) { state = new ControllerCaptureState(bindings); this.moonlight = moonlight; }
        internal bool Active { get { return active; } }
        internal bool Available { get { return available; } }
        internal bool Capturing { get { return capturing; } }
        internal string Message { get { return message; } }
        internal void Heartbeat() { Interlocked.Exchange(ref heartbeat, Stopwatch.GetTimestamp()); }
        internal void Start()
        {
            thread = new Thread(Run) { IsBackground = true, Name = "Vumiro keyboard controller" }; thread.SetApartmentState(ApartmentState.STA); thread.Start();
            if (!started.WaitOne(4000)) { stopping = true; message = "Virtual controller startup timed out."; }
        }
        private void Run()
        {
            VirtualGamepad pad = null;
            try {
                pad = new VirtualGamepad(); available = true;
                callback = OnKey;
                hook = SetWindowsHookEx(13, callback, GetModuleHandle(null), 0);
                if (hook == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "Keyboard capture could not start.");
                active = !stopping; message = "Mapping active. Focus a Moonlight streaming window to control its stream. Escape in Moonlight or Vumiro stops mapping.";
                using (var timer = new System.Windows.Forms.Timer { Interval = 8 }) {
                    timer.Tick += (s, e) => {
                        if (stopping) { Application.ExitThread(); return; }
                        if ((Stopwatch.GetTimestamp() - Interlocked.Read(ref heartbeat)) / (double)Stopwatch.Frequency > 5) {
                            message = "Mapping stopped because the app heartbeat expired."; stopping = true; Application.ExitThread(); return;
                        }
                        try { UpdateFocus(); pad.Submit(state.Current); }
                        catch (Exception failure) { available = false; message = VirtualGamepad.Describe(failure); stopping = true; Application.ExitThread(); }
                    };
                    timer.Start(); started.Set();
                    if (!stopping) Application.Run();
                }
            } catch (Exception error) { available = false; message = VirtualGamepad.Describe(error); }
            finally {
                active = false; capturing = false; state.Release();
                if (hook != IntPtr.Zero) { UnhookWindowsHookEx(hook); hook = IntPtr.Zero; }
                if (pad != null) pad.Dispose();
                started.Set();
            }
        }
        private bool UpdateFocus(bool resolveProcess = true)
        {
            var current = GetForegroundWindow();
            uint pid; GetWindowThreadProcessId(current, out pid);
            if (current != foreground || pid != foregroundPid) {
                state.Release(); foreground = current; foregroundPid = pid; foregroundAllowed = false; foregroundNeedsResolve = true; foregroundExecutable = foregroundClass = null;
            }
            // Process image lookup stays out of the low-level hook callback.
            if (foregroundNeedsResolve && resolveProcess) {
                foregroundNeedsResolve = false;
                if (current != IntPtr.Zero && moonlight != null) {
                    try {
                        using (var process = Process.GetProcessById((int)pid)) foregroundExecutable = Path.GetFullPath(process.MainModule.FileName);
                        var className = new StringBuilder(128); GetClassName(current, className, className.Capacity); foregroundClass = className.ToString();
                    }
                    catch { /* Access denied/exited/unknown processes never capture. */ }
                }
            }
            if (resolveProcess) {
                var title = new StringBuilder(512);
                if (string.Equals(foregroundExecutable, moonlight, StringComparison.OrdinalIgnoreCase) && moonlight != null) GetWindowText(current, title, title.Capacity);
                foregroundAllowed = ControllerMapping.StreamWindow(foregroundExecutable, moonlight, foregroundClass, title.ToString());
            }
            capturing = active && foregroundAllowed; state.Focus(capturing); return capturing;
        }
        private IntPtr OnKey(int code, IntPtr wParam, IntPtr lParam)
        {
            if (code >= 0 && !stopping) {
                try {
                    var data = (KeyboardData)Marshal.PtrToStructure(lParam, typeof(KeyboardData));
                    // Never remap software-injected keys, including accessibility shortcuts.
                    if ((data.Flags & 0x10) == 0) {
                        int kind = wParam.ToInt32(); bool down = kind == 0x100 || kind == 0x104, up = kind == 0x101 || kind == 0x105;
                        bool allowed = UpdateFocus(false);
                        string keyCode = ControllerMapping.KeyCode(data.VirtualKey, data.ScanCode, data.Flags);
                        if (ControllerMapping.SystemShortcut(keyCode, (GetAsyncKeyState(0x12) & 0x8000) != 0, (GetAsyncKeyState(0x5b) & 0x8000) != 0 || (GetAsyncKeyState(0x5c) & 0x8000) != 0)) { state.Release(); if (down || up) state.Key(keyCode, down, false); return CallNextHookEx(hook, code, wParam, lParam); }
                        if ((allowed || foregroundPid == ownProcess || (moonlight != null && string.Equals(foregroundExecutable, moonlight, StringComparison.OrdinalIgnoreCase))) && down && data.VirtualKey == 27) { state.Release(); message = "Mapping stopped with Escape."; stopping = true; }
                        else if ((down || up) && state.Key(keyCode, down, allowed)) return new IntPtr(1);
                    }
                } catch { state.Release(); stopping = true; message = "Mapping stopped after a keyboard capture error."; }
            }
            return CallNextHookEx(hook, code, wParam, lParam);
        }
        public void Dispose()
        {
            stopping = true;
            if (thread != null && thread != Thread.CurrentThread) thread.Join(1500);
            // The thread owns device/hook disposal; do not race its final neutral report.
            if (thread == null || !thread.IsAlive) started.Dispose();
        }
        private delegate IntPtr HookCallback(int code, IntPtr message, IntPtr data);
        [StructLayout(LayoutKind.Sequential)] private struct KeyboardData { internal uint VirtualKey, ScanCode, Flags, Time; internal UIntPtr ExtraInfo; }
        [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int id, HookCallback callback, IntPtr module, uint threadId);
        [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
        [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int count);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder title, int count);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);
    }
}
