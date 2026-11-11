using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

namespace Vumiro.Client
{
    internal static class DesktopBranding
    {
        private const string Resource = "Vumiro.DesktopIcon";

        internal static Icon LoadIcon()
        {
            // Read the packaged artwork directly, bypassing the shell's executable icon cache.
            using (var stream = typeof(DesktopBranding).Assembly.GetManifestResourceStream(Resource))
            using (var icon = new Icon(stream)) return (Icon)icon.Clone();
        }

        internal static string EnsureIconFile(string directory)
        {
            byte[] bytes;
            using (var stream = typeof(DesktopBranding).Assembly.GetManifestResourceStream(Resource))
            using (var output = new MemoryStream()) { stream.CopyTo(output); bytes = output.ToArray(); }
            string hash;
            using (var sha = SHA256.Create()) hash = BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
            Directory.CreateDirectory(directory);
            var path = Path.Combine(directory, "vumiro-" + hash + ".ico");
            if (IconFileMatches(path, bytes)) return path;
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                // Publish only a complete, flushed ICO. An interrupted write never owns the hash path.
                using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                { output.Write(bytes, 0, bytes.Length); output.Flush(true); }
                if (File.Exists(path)) File.Replace(temporary, path, null);
                else
                    try { File.Move(temporary, path); }
                    catch (IOException)
                    {
                        // Another launch may have published this artwork while we prepared our copy.
                        if (!IconFileMatches(path, bytes)) throw;
                    }
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
            return path;
        }

        private static bool IconFileMatches(string path, byte[] expected)
        {
            try
            {
                using (var input = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete))
                {
                    if (input.Length != expected.Length) return false;
                    for (var index = 0; index < expected.Length; index++)
                        if (input.ReadByte() != expected[index]) return false;
                    return input.ReadByte() == -1;
                }
            }
            catch (FileNotFoundException) { return false; }
            catch (DirectoryNotFoundException) { return false; }
        }

        internal static void RefreshInstalledShortcuts(string executable)
        {
            try
            {
                var icon = EnsureIconFile(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Vumiro", "Icons"));
                RefreshShortcuts(executable, icon, new[] {
                    Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar")
                }, NotifyFileChanged, message => System.Diagnostics.Trace.WriteLine(message));
                RefreshShortcuts(executable, icon, new[] { Environment.GetFolderPath(Environment.SpecialFolder.StartMenu) },
                    NotifyFileChanged, message => System.Diagnostics.Trace.WriteLine(message), recursive: true);
            }
            catch (Exception error) { System.Diagnostics.Trace.WriteLine("Desktop icon refresh skipped: " + error.Message); }
        }

        internal static void RefreshShortcuts(string executable, string icon, IEnumerable<string> roots, Action<string> notify, Action<string> log, bool recursive = false)
        {
            var shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
            try
            {
                foreach (var root in roots)
                    foreach (var path in ShortcutPaths(root, log, recursive))
                    {
                        object shortcut = null;
                        try
                        {
                            shortcut = shell.GetType().InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { path });
                            var type = shortcut.GetType();
                            var target = (string)type.InvokeMember("TargetPath", BindingFlags.GetProperty, null, shortcut, null);
                            var previous = (string)type.InvokeMember("IconLocation", BindingFlags.GetProperty, null, shortcut, null);
                            if (!SamePath(target, executable) || previous == icon + ",0" || !UsesAppIcon(previous, executable, icon)) continue;
                            type.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { icon + ",0" });
                            type.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
                            notify(path);
                        }
                        catch (Exception error) { log("Desktop shortcut icon refresh skipped: " + path + ": " + error.Message); }
                        finally { if (shortcut != null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut); }
                    }
            }
            finally { if (Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell); }
        }

        private static bool UsesAppIcon(string location, string executable, string icon)
        {
            var separator = location.LastIndexOf(',');
            int index;
            if (separator >= 0 && (!Int32.TryParse(location.Substring(separator + 1), out index) || index != 0)) return false;
            var path = (separator >= 0 ? location.Substring(0, separator) : location).Trim().Trim('"');
            if (path.Length == 0 || SamePath(path, executable)) return true;
            // Preserve custom user artwork; only roll forward icons in our dedicated cache.
            return SamePath(Path.GetDirectoryName(path), Path.GetDirectoryName(icon)) &&
                Path.GetFileName(path).StartsWith("vumiro-", StringComparison.Ordinal) && Path.GetExtension(path) == ".ico";
        }

        private static bool SamePath(string left, string right)
        {
            if (String.IsNullOrWhiteSpace(left) || String.IsNullOrWhiteSpace(right)) return false;
            return String.Equals(Path.GetFullPath(Environment.ExpandEnvironmentVariables(left)),
                Path.GetFullPath(Environment.ExpandEnvironmentVariables(right)), StringComparison.OrdinalIgnoreCase);
        }

        private static IEnumerable<string> ShortcutPaths(string root, Action<string> log, bool recursive)
        {
            var pending = new Stack<string>();
            if (!String.IsNullOrEmpty(root)) pending.Push(root);
            while (pending.Count != 0)
            {
                var directory = pending.Pop();
                string[] files;
                try
                {
                    if (!Directory.Exists(directory) || (File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) continue;
                    files = Directory.GetFiles(directory, "*.lnk");
                    if (recursive) foreach (var child in Directory.GetDirectories(directory)) pending.Push(child);
                }
                catch (Exception error) { log("Desktop shortcut folder skipped: " + error.Message); continue; }
                foreach (var file in files)
                    if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) == 0) yield return file;
            }
        }

        private static void NotifyFileChanged(string path)
        {
            SHChangeNotify(0x00002000, 0x0005, path, IntPtr.Zero); // SHCNE_UPDATEITEM, SHCNF_PATHW
        }

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        private static extern void SHChangeNotify(uint change, uint flags, string item, IntPtr second);
    }
}
