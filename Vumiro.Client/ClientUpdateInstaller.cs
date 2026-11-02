using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;

namespace Vumiro.Client
{
    // Shared by the app and its separate replacement process. User data is never a package target.
    internal static class ClientUpdateInstaller
    {
        private static readonly HashSet<string> Allowed = new HashSet<string>(new[] {
            "Vumiro.exe", "Vumiro.exe.config", "Vumiro.Updater.exe", "Vumiro.Updater.exe.config",
            "Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll",
            "README.md", "PRIVACY.md", "COPYING", "THIRD-PARTY.md", "WEBVIEW2-LICENSE.txt", "WEBVIEW2-NOTICE.txt",
            "WebServer/call.html", "WebServer/call-client.js", "WebServer/friends.html", "WebServer/friends-client.js", "WebServer/local-profile.js", "WebServer/peer-profile.js", "WebServer/account-client.js", "WebServer/identity-recovery.js"
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
            var changed = new List<Tuple<string, bool>>();
            Directory.CreateDirectory(backup);
            try
            {
                foreach (var relative in files)
                {
                    var source = Path.Combine(stage, relative); var target = Path.Combine(install, relative);
                    NoLinks(Path.GetDirectoryName(source)); NoLinks(Path.GetDirectoryName(target));
                    if ((File.GetAttributes(source) & FileAttributes.ReparsePoint) != 0 ||
                        File.Exists(target) && (File.GetAttributes(target) & FileAttributes.ReparsePoint) != 0)
                        throw new IOException("Linked application files cannot be updated.");
                    var exists = File.Exists(target);
                    if (exists)
                    {
                        var saved = Path.Combine(backup, relative);
                        Directory.CreateDirectory(Path.GetDirectoryName(saved)); File.Copy(target, saved);
                    }
                    Directory.CreateDirectory(Path.GetDirectoryName(target));
                    changed.Add(Tuple.Create(relative, exists)); File.Copy(source, target, true);
                }
            }
            catch (Exception original)
            {
                var errors = new List<Exception> { original };
                foreach (var change in changed.AsEnumerable().Reverse())
                    try
                    {
                        var target = Path.Combine(install, change.Item1);
                        if (change.Item2) File.Copy(Path.Combine(backup, change.Item1), target, true);
                        else File.Delete(target);
                    }
                    catch (Exception rollback) { errors.Add(rollback); }
                if (errors.Count > 1) throw new AggregateException("Recovery copies remain in " + backup, errors);
                throw;
            }
            // Keep one recovery copy from this update; no user data is touched.
        }
    }
}
