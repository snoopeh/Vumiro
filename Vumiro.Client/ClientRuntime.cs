using System;
using System.IO;

namespace Vumiro.Client
{
    // Local QA overrides are accepted only by Debug builds launched explicitly.
    internal sealed class ClientRuntime
    {
#if DEBUG
        private const bool AllowLocalQa = true;
#else
        private const bool AllowLocalQa = false;
#endif
        internal static readonly ClientRuntime Current = Create(AllowLocalQa, Environment.GetEnvironmentVariable,
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppDomain.CurrentDomain.BaseDirectory);

        internal bool IsLocalQa { get; private set; }
        internal bool UpdatesEnabled { get { return !IsLocalQa; } }
        internal string DataDirectory { get; private set; }
        internal string BrowserProfileDirectory { get; private set; }
        internal string WebRoot { get; private set; }
        internal string Label { get; private set; }

        internal static ClientRuntime Create(bool allowLocalQa, Func<string, string> env, string localData, string install)
        {
            var production = Path.Combine(localData, "ScreenTask");
            var web = allowLocalQa ? env("VUMIRO_DEV_WEB_ROOT") : null;
            var result = new ClientRuntime {
                DataDirectory = production, WebRoot = Path.Combine(install, "WebServer"), Label = "Vumiro"
            };
            if (!String.IsNullOrWhiteSpace(web))
            {
                result.WebRoot = AbsoluteDirectory(web, "VUMIRO_DEV_WEB_ROOT");
                var data = AbsoluteDirectory(env("VUMIRO_DEV_DATA_ROOT"), "VUMIRO_DEV_DATA_ROOT");
                var normal = Path.GetFullPath(production).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                if (Overlaps(data, normal)) throw new ArgumentException("Local QA data must be separate from installed Vumiro data.");
                foreach (var file in new[] { "friends.html", "auth.html", "call.html" })
                    if (!File.Exists(Path.Combine(result.WebRoot, file))) throw new IOException("Local QA source is missing " + file + ".");
                result.IsLocalQa = true;
                result.DataDirectory = data;
                result.BrowserProfileDirectory = Path.Combine(data, "ClientBrowser");
                var label = (env("VUMIRO_DEV_LABEL") ?? "working tree").Replace('\r', ' ').Replace('\n', ' ').Trim();
                result.Label = "LOCAL QA · " + label.Substring(0, Math.Min(80, label.Length));
            }
            else
            {
                var profile = env("WEBVIEW2_USER_DATA_FOLDER");
                result.BrowserProfileDirectory = String.IsNullOrWhiteSpace(profile)
                    ? Path.Combine(production, "ClientBrowser") : Path.GetFullPath(profile);
            }
            return result;
        }

        private static string AbsoluteDirectory(string value, string name)
        {
            if (String.IsNullOrWhiteSpace(value) || !Path.IsPathRooted(value)) throw new ArgumentException(name + " must name an absolute directory.");
            return Path.GetFullPath(value).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        }

        private static bool Overlaps(string a, string b)
        {
            return String.Equals(a, b, StringComparison.OrdinalIgnoreCase) ||
                a.StartsWith(b + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
                b.StartsWith(a + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        }
    }
}
