using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;
using ScreenTask.Client;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        string install = null; bool stopped = false;
        try
        {
            if (args.Length != 5 || args[0] != "--apply") throw new ArgumentException("Start updates from Vumiro.");
            install = Path.GetFullPath(args[1]); var stage = Path.GetFullPath(args[2]);
            var executable = Path.Combine(install, "ScreenTask.Client.exe");
            ClientUpdateInstaller.NoLinks(install); ClientUpdateInstaller.NoLinks(stage);
            using (var parent = Process.GetProcessById(Int32.Parse(args[3])))
            {
                if (!String.Equals(parent.MainModule.FileName, executable, StringComparison.OrdinalIgnoreCase))
                    throw new IOException("The updating application does not match the installation.");
                using (var ready = EventWaitHandle.OpenExisting(args[4])) ready.Set();
                if (!parent.WaitForExit(60000)) throw new IOException("Vumiro did not close. Close all its windows and try again.");
            }
            stopped = true;
            ClientUpdateInstaller.Apply(stage, install);
            Start(executable, install);
            try { Directory.Delete(stage, true); File.Delete(Path.Combine(Path.GetDirectoryName(stage), "ScreenTask-client-win-x64.zip")); } catch { }
            return 0;
        }
        catch (Exception error)
        {
            MessageBox.Show("The update could not finish.\r\n" + error.Message, "Vumiro update", MessageBoxButtons.OK, MessageBoxIcon.Error);
            if (stopped && install != null && File.Exists(Path.Combine(install, "ScreenTask.Client.exe")))
                try { Start(Path.Combine(install, "ScreenTask.Client.exe"), install); } catch { }
            return 1;
        }
    }
    private static void Start(string executable, string directory)
    {
        Process.Start(new ProcessStartInfo(executable) { WorkingDirectory = directory, UseShellExecute = true });
    }
}
