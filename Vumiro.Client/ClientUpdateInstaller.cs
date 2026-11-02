using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Threading;

namespace Vumiro.Client
{
    // Shared by the app and its separate replacement process. User data is never a package target.
    internal static class ClientUpdateInstaller
    {
        private static readonly HashSet<string> Allowed = new HashSet<string>(new[] {
            "Vumiro.exe", "Vumiro.exe.config", "Vumiro.Updater.exe", "Vumiro.Updater.exe.config",
            "Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll",
            "README.md", "PRIVACY.md", "COPYING", "THIRD-PARTY.md", "WEBVIEW2-LICENSE.txt", "WEBVIEW2-NOTICE.txt",
            "WebServer/call.html", "WebServer/call-client.js", "WebServer/friends.html", "WebServer/auth.html", "WebServer/friends-client.js", "WebServer/local-profile.js", "WebServer/peer-profile.js", "WebServer/account-client.js", "WebServer/identity-recovery.js"
        }, StringComparer.Ordinal);

        internal static string Relative(string name)
        {
            // No alternate separators, case aliases, arbitrary DLLs or profile paths are accepted.
            if (!Allowed.Contains(name)) throw new InvalidDataException("Unexpected update file: " + name);
            return name.Replace('/', Path.DirectorySeparatorChar);
        }

        internal static void NoLinks(string path)
        {
            for (var item = new DirectoryInfo(Path.GetFullPath(path)); item != null; item = item.Parent)
                if (item.Exists && (item.Attributes & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("Updates cannot use linked directories: " + item.FullName);
        }

        internal static void Extract(string archive, string stage)
        {
            if (Directory.Exists(stage)) throw new IOException("Update staging directory already exists.");
            NoLinks(Path.GetDirectoryName(stage));
            Directory.CreateDirectory(stage);
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            long total = 0;
            using (var zip = ZipFile.OpenRead(archive))
            {
                if (zip.Entries.Count > 32) throw new InvalidDataException("Too many update files.");
                foreach (var entry in zip.Entries)
                {
                    if (((entry.ExternalAttributes >> 16) & 0xf000) == 0xa000 || (entry.ExternalAttributes & 0x400) != 0)
                        throw new InvalidDataException("Linked update files are not allowed.");
                    if (entry.FullName == "WebServer/" && entry.Length == 0) continue;
                    var relative = Relative(entry.FullName);
                    if (!seen.Add(relative)) throw new InvalidDataException("Duplicate update file.");
                    total = checked(total + entry.Length);
                    if (entry.Length > 32L * 1024 * 1024 || total > 64L * 1024 * 1024)
                        throw new InvalidDataException("Unpacked update exceeds the size limit.");
                    var target = Path.Combine(stage, relative);
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    using (var input = entry.Open())
                    using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                    {
                        var buffer = new byte[81920]; long written = 0; int count;
                        while ((count = input.Read(buffer, 0, buffer.Length)) != 0)
                        {
                            written += count;
                            if (written > entry.Length || written > 32L * 1024 * 1024)
                                throw new InvalidDataException("Unpacked file exceeds its declared size.");
                            output.Write(buffer, 0, count);
                        }
                        if (written != entry.Length) throw new InvalidDataException("Unpacked file is incomplete.");
                    }
                }
            }
            foreach (var required in Allowed)
                if (!File.Exists(Path.Combine(stage, Relative(required)))) throw new InvalidDataException("Update is missing " + required);
        }

        internal static void EnsureNoOtherInstances(string install, int excludedProcessId)
        {
            var executable = Path.GetFullPath(Path.Combine(install, "Vumiro.exe"));
            foreach (var process in Process.GetProcessesByName("Vumiro"))
                using (process)
                {
                    if (process.Id == excludedProcessId) continue;
                    try
                    {
                        if (process.HasExited) continue;
                        if (String.Equals(Path.GetFullPath(process.MainModule.FileName), executable, StringComparison.OrdinalIgnoreCase))
                            throw new IOException("Another Vumiro window from this app folder is still running (process " + process.Id + "). Close all other Vumiro windows, then try the update again.");
                    }
                    catch (System.ComponentModel.Win32Exception error)
                    {
                        if (process.HasExited) continue;
                        throw new IOException("Unable to check another running Vumiro process. Close other Vumiro windows before updating.", error);
                    }
                    catch (InvalidOperationException) { /* The process exited during inspection. */ }
                }
        }

        private static void RetryFileOperation(Action operation)
        {
            for (var attempt = 0; ; attempt++)
                try { operation(); return; }
                catch (IOException error)
                {
                    var code = error.HResult & 0xffff;
                    if (attempt >= 5 || (code != 32 && code != 33)) throw;
                    Thread.Sleep(200);
                }
        }

        private static bool Identical(string source, string target)
        {
            if (!File.Exists(target) || new FileInfo(source).Length != new FileInfo(target).Length) return false;
            using (var left = File.OpenRead(source))
            using (var right = File.OpenRead(target))
            {
                var first = new byte[81920]; var second = new byte[81920]; int count;
                while ((count = left.Read(first, 0, first.Length)) != 0)
                {
                    var read = 0;
                    while (read < count)
                    {
                        var next = right.Read(second, read, count - read);
                        if (next == 0) return false;
                        read += next;
                    }
                    for (var index = 0; index < count; index++) if (first[index] != second[index]) return false;
                }
                return right.ReadByte() == -1;
            }
        }

        private sealed class Replacement
        {
            internal string Relative, Target, Prepared;
            internal bool Existed;
        }

        internal static void Apply(string stage, string install)
        {
            stage = Path.GetFullPath(stage).TrimEnd(Path.DirectorySeparatorChar);
            install = Path.GetFullPath(install).TrimEnd(Path.DirectorySeparatorChar);
            NoLinks(stage); NoLinks(install);
            if (!Directory.Exists(install) || String.Equals(stage, install, StringComparison.OrdinalIgnoreCase) ||
                stage.StartsWith(install + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
                install.StartsWith(stage + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new IOException("Invalid update directories.");
            var files = Directory.GetFiles(stage, "*", SearchOption.AllDirectories)
                .Select(f => Relative(f.Substring(stage.Length + 1).Replace(Path.DirectorySeparatorChar, '/'))).ToArray();
            foreach (var required in Allowed)
                if (!File.Exists(Path.Combine(stage, Relative(required)))) throw new InvalidDataException("Staged update is incomplete.");
            var backup = Path.Combine(install, ".client-backup-" + Guid.NewGuid().ToString("N"));
            var planned = new List<Replacement>();
            var changed = new List<Replacement>();
            string currentFile = null;
            try
            {
                // Prepare every replacement and recovery copy before changing any application file.
                foreach (var relative in files)
                {
                    currentFile = relative;
                    var source = Path.Combine(stage, relative); var target = Path.Combine(install, relative);
                    NoLinks(Path.GetDirectoryName(source)); NoLinks(Path.GetDirectoryName(target));
                    if ((File.GetAttributes(source) & FileAttributes.ReparsePoint) != 0 ||
                        File.Exists(target) && (File.GetAttributes(target) & FileAttributes.ReparsePoint) != 0)
                        throw new IOException("Linked application files cannot be updated.");
                    if (Identical(source, target)) continue;
                    var replacement = new Replacement { Relative = relative, Target = target, Existed = File.Exists(target),
                        Prepared = Path.Combine(Path.GetDirectoryName(target), ".vumiro-update-" + Guid.NewGuid().ToString("N") + ".tmp") };
                    planned.Add(replacement);
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    if (replacement.Existed)
                    {
                        // Opening without truncation catches mapped DLLs, read-only files and sharing locks.
                        RetryFileOperation(() => { using (File.Open(target, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite | FileShare.Delete)) { } });
                        var saved = Path.Combine(backup, relative);
                        Directory.CreateDirectory(Path.GetDirectoryName(saved));
                        RetryFileOperation(() => File.Copy(target, saved));
                    }
                    RetryFileOperation(() => File.Copy(source, replacement.Prepared));
                }
                foreach (var replacement in planned)
                {
                    currentFile = replacement.Relative;
                    RetryFileOperation(() => {
                        if (replacement.Existed) File.Replace(replacement.Prepared, replacement.Target, null);
                        else File.Move(replacement.Prepared, replacement.Target);
                    });
                    // Only a completed atomic replacement needs rolling back.
                    changed.Add(replacement);
                }
            }
            catch (Exception original)
            {
                var detail = "Could not update " + (currentFile ?? "the application files") + ": " + original.Message;
                var errors = new List<Exception> { new IOException(detail, original) };
                foreach (var change in changed.AsEnumerable().Reverse())
                    try
                    {
                        if (change.Existed)
                        {
                            File.Copy(Path.Combine(backup, change.Relative), change.Prepared, true);
                            RetryFileOperation(() => File.Replace(change.Prepared, change.Target, null));
                        }
                        else RetryFileOperation(() => File.Delete(change.Target));
                    }
                    catch (Exception rollback) { errors.Add(new IOException("Could not restore " + change.Relative + ": " + rollback.Message, rollback)); }
                if (errors.Count > 1)
                    throw new AggregateException(detail + "\r\nSome files could not be restored. Recovery copies remain in " + backup + "\r\n" +
                        String.Join("\r\n", errors.Skip(1).Select(error => error.Message)), errors);
                throw new IOException(detail + (changed.Count == 0 ? "\r\nNo application files were changed. Close other Vumiro windows and try again." :
                    "\r\nThe previous application files were restored. Recovery copies remain in " + backup), original);
            }
            finally
            {
                foreach (var replacement in planned)
                    try { if (File.Exists(replacement.Prepared)) File.Delete(replacement.Prepared); } catch { }
            }
            // Keep one recovery copy from this update; no user data is touched.
        }
    }
}
