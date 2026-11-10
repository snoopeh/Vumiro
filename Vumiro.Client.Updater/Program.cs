using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Vumiro.Client;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        string install = null; bool stopped = false; StreamWriter log = null; string logPath = null;
        try
        {
            if (args.Length != 5 || args[0] != "--apply") throw new ArgumentException("Start updates from Vumiro.");
            install = Path.GetFullPath(args[1]); var stage = Path.GetFullPath(args[2]);
            var executable = Path.Combine(install, "Vumiro.exe");
            ClientUpdateInstaller.NoLinks(install); ClientUpdateInstaller.NoLinks(stage);
            try
            {
                var logDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Vumiro", "Updates");
                ClientUpdateInstaller.NoLinks(logDirectory); Directory.CreateDirectory(logDirectory);
                logPath = Path.Combine(logDirectory, "update-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N") + ".log");
                log = new StreamWriter(new FileStream(logPath, FileMode.CreateNew, FileAccess.Write, FileShare.Read), new UTF8Encoding(false)) { AutoFlush = true };
                WriteLog(log, "Update started. Installation: " + install);
            }
            catch { logPath = null; }
            using (var parent = Process.GetProcessById(Int32.Parse(args[3])))
            {
                if (!String.Equals(parent.MainModule.FileName, executable, StringComparison.OrdinalIgnoreCase))
                    throw new IOException("The updating application does not match the installation.");
                using (var ready = EventWaitHandle.OpenExisting(args[4])) ready.Set();
                WriteLog(log, "Waiting for the updating application to exit.");
                if (!parent.WaitForExit(60000)) throw new IOException("Vumiro did not close. Close all its windows and try again.");
            }
            stopped = true;
            ClientUpdateInstaller.EnsureNoOtherInstances(install, Process.GetCurrentProcess().Id);
            WriteLog(log, "Application stopped. Checking and replacing application files.");
            ClientUpdateInstaller.Apply(stage, install);
            WriteLog(log, "Application files updated successfully.");
            Start(executable, install);
            try
            {
                Directory.Delete(stage, true);
                foreach (var archive in new[] { "Vumiro-win-x64.zip", "Vumiro-win-x64-v2.zip" })
                    File.Delete(Path.Combine(Path.GetDirectoryName(stage), archive));
            }
            catch { }
            return 0;
        }
        catch (Exception error)
        {
            WriteLog(log, error.ToString());
            MessageBox.Show("The update could not finish.\r\n" + error.Message +
                (logPath == null ? "" : "\r\nDetails: " + logPath), "Vumiro update", MessageBoxButtons.OK, MessageBoxIcon.Error);
            if (stopped && install != null && File.Exists(Path.Combine(install, "Vumiro.exe")))
                try
                {
                    ClientUpdateInstaller.EnsureNoOtherInstances(install, Process.GetCurrentProcess().Id);
                    Start(Path.Combine(install, "Vumiro.exe"), install, true);
                }
                catch (Exception restartError) { WriteLog(log, "Application restart skipped: " + restartError.Message); }
            return 1;
        }
        finally { if (log != null) try { log.Dispose(); } catch { } }
    }
    private static void WriteLog(StreamWriter log, string message)
    {
        if (log == null) return;
        try { log.WriteLine(DateTime.UtcNow.ToString("o") + " " + message); } catch { }
    }
    private static void Start(string executable, string directory, bool recovering = false)
    {
        var start = new ProcessStartInfo(executable) { WorkingDirectory = directory, UseShellExecute = false };
        if (recovering) start.EnvironmentVariables["VUMIRO_SKIP_STARTUP_UPDATE"] = "1";
        Process.Start(start);
    }
}
