using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace Vumiro.Client
{
    // Normal installations share one profile, including copies launched from
    // different folders. Explicitly isolated developer profiles remain separate.
    internal sealed class DesktopInstance : IDisposable
    {
        private readonly Mutex ownership;
        private readonly EventWaitHandle activation;
        private RegisteredWaitHandle waiting;

        private DesktopInstance(Mutex ownership, EventWaitHandle activation)
        { this.ownership = ownership; this.activation = activation; }

        internal static DesktopInstance Acquire()
        {
            var isolatedProfile = Environment.GetEnvironmentVariable("WEBVIEW2_USER_DATA_FOLDER");
            var profile = String.IsNullOrWhiteSpace(isolatedProfile)
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ScreenTask", "ClientBrowser")
                : isolatedProfile;
            var identity = WindowsIdentity.GetCurrent().User.Value + "|" + Path.GetFullPath(profile).TrimEnd('\\', '/').ToUpperInvariant();
            string suffix;
            using (var hash = SHA256.Create()) suffix = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(identity))).Replace("-", "");
            var signal = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\Vumiro.Activate." + suffix);
            var mutex = new Mutex(false, "Local\\Vumiro.Instance." + suffix);
            bool primary;
            try { primary = mutex.WaitOne(0); }
            catch (AbandonedMutexException) { primary = true; }
            if (!primary)
            {
                signal.Set(); signal.Dispose(); mutex.Dispose();
                return null;
            }
            if (String.IsNullOrWhiteSpace(isolatedProfile) && ActivateLegacyCopy())
            {
                signal.Dispose(); mutex.ReleaseMutex(); mutex.Dispose();
                return null;
            }
            return new DesktopInstance(mutex, signal);
        }

        internal void Listen(ClientWindow window)
        {
            window.Shown += (sender, args) => {
                waiting = ThreadPool.RegisterWaitForSingleObject(activation, (state, timedOut) => {
                    try
                    {
                        if (!window.IsDisposed && window.IsHandleCreated)
                            window.BeginInvoke((Action)(() => { if (!window.IsDisposed) window.ActivateExistingInstance(); }));
                    }
                    catch (InvalidOperationException) { }
                }, null, Timeout.Infinite, false);
            };
        }

        private static bool ActivateLegacyCopy()
        {
            // Older versions have no activation event. Avoid creating a second
            // copy in that same folder while the user completes the first update.
            var current = Process.GetCurrentProcess();
            var executable = Path.GetFullPath(Application.ExecutablePath);
            foreach (var candidate in Process.GetProcessesByName("Vumiro"))
                using (candidate)
                {
                    if (candidate.Id == current.Id) continue;
                    try
                    {
                        if (candidate.HasExited || !String.Equals(Path.GetFullPath(candidate.MainModule.FileName), executable, StringComparison.OrdinalIgnoreCase)) continue;
                        var window = candidate.MainWindowHandle;
                        if (window != IntPtr.Zero) { ShowWindow(window, 9); SetForegroundWindow(window); }
                        else MessageBox.Show("Vumiro is already running. Open it from the taskbar or system tray. Quit that copy before updating.", "Vumiro", MessageBoxButtons.OK, MessageBoxIcon.Information);
                        return true;
                    }
                    catch (System.ComponentModel.Win32Exception) { }
                    catch (InvalidOperationException) { }
                }
            return false;
        }

        public void Dispose()
        {
            if (waiting != null) waiting.Unregister(null);
            activation.Dispose(); ownership.ReleaseMutex(); ownership.Dispose();
        }

        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    }
}
