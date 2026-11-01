using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace Vumiro.Client
{
    internal sealed class ClientUpdates
    {
        private const string Repository = "https://github.com/snoopeh/Vumiro";
        private const string AssetName = "Vumiro-win-x64.zip";
        private const long PackageLimit = 16L * 1024 * 1024;
        private readonly Form owner;
        private readonly Action<object> emit;
        private readonly Version current = Assembly.GetExecutingAssembly().GetName().Version;
        private bool busy;
        private Release latest;
        private string message = "Check GitHub for updates.";
        private int progress;

        internal sealed class Asset
        {
            public string name { get; set; }
            public string browser_download_url { get; set; }
            public string digest { get; set; }
            public long size { get; set; }
        }
        internal sealed class Release
        {
            public string tag_name { get; set; }
            public bool draft { get; set; }
            public bool prerelease { get; set; }
            public List<Asset> assets { get; set; }
            internal Version Version;
            internal Asset Package;
        }

        internal ClientUpdates(Form owner, Action<object> emit) { this.owner = owner; this.emit = emit; }

        private void State()
        {
            emit(new { type = "updates", version = current.ToString(3), current = current.ToString(3),
                latest = latest == null ? null : latest.Version.ToString(3), available = latest != null && latest.Version > current,
                busy, message, progress });
        }

        internal async Task HandleAsync(string action)
        {
            if (action == "state") { State(); return; }
            if (busy || (action != "check" && action != "install")) return;
            busy = true; progress = 0;
            message = action == "check" ? "Checking GitHub…" : "Preparing update…"; State();
            try
            {
                if (action == "check")
                {
                    latest = await CheckAsync();
                    message = latest == null ? "No published client update is available yet." : latest.Version > current ?
                        "Vumiro " + latest.Version.ToString(3) + " is available." : "You're up to date.";
                }
                else
                {
                    // Recheck metadata immediately before downloading; never trust a URL supplied by the web view.
                    latest = await CheckAsync();
                    if (latest == null || latest.Version <= current) { message = "You're up to date."; return; }
                    await InstallAsync(latest);
                }
            }
            catch (Exception error)
            {
                message = "Update unavailable: " + error.Message;
            }
            finally { busy = false; State(); }
        }

        private static HttpClient Client()
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            var http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromMinutes(5) };
            http.DefaultRequestHeaders.UserAgent.ParseAdd("Vumiro-Client/1.16");
            http.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
            return http;
        }

        private static async Task<Release> CheckAsync()
        {
            var found = new List<Release>();
            using (var http = Client())
            {
                // Dedicated client tags keep the legacy app's newer release dates out of this channel.
                for (var page = 1; page <= 5; page++)
                {
                    using (var response = await http.GetAsync("https://api.github.com/repos/snoopeh/Vumiro/releases?per_page=100&page=" + page, HttpCompletionOption.ResponseHeadersRead))
                    {
                        if ((int)response.StatusCode == 403 || (int)response.StatusCode == 429)
                            throw new IOException("GitHub's request limit was reached. Try again later.");
                        response.EnsureSuccessStatusCode();
                        var json = await ReadBoundedAsync(response, 4 * 1024 * 1024);
                        var items = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 }.Deserialize<List<Release>>(json);
                        if (items == null) throw new InvalidDataException("GitHub returned invalid release metadata.");
                        foreach (var release in items)
                        {
                            if (release == null || release.draft || release.prerelease || !Regex.IsMatch(release.tag_name ?? "", @"^client-v[0-9]+\.[0-9]+\.[0-9]+$")) continue;
                            Version version;
                            if (!Version.TryParse(release.tag_name.Substring(8), out version)) continue;
                            release.Version = new Version(version.Major, version.Minor, version.Build, 0);
                            var packages = (release.assets ?? new List<Asset>()).Where(a => a != null && a.name == AssetName).ToArray();
                            if (packages.Length != 1) continue;
                            release.Package = packages[0]; var asset = release.Package;
                            if (asset.browser_download_url != Repository + "/releases/download/" + release.tag_name + "/" + AssetName ||
                                asset.size <= 0 || asset.size > PackageLimit || !Regex.IsMatch(asset.digest ?? "", "^sha256:[0-9a-fA-F]{64}$")) continue;
                            found.Add(release);
                        }
                        if (items.Count < 100) break;
                    }
                }
            }
            return found.OrderByDescending(r => r.Version).FirstOrDefault();
        }

        private static async Task<string> ReadBoundedAsync(HttpResponseMessage response, int limit)
        {
            if (response.Content.Headers.ContentLength > limit) throw new InvalidDataException("Update metadata is too large.");
            using (var input = await response.Content.ReadAsStreamAsync())
            using (var output = new MemoryStream())
            {
                var buffer = new byte[16384]; int count;
                while ((count = await input.ReadAsync(buffer, 0, buffer.Length)) > 0)
                {
                    if (output.Length + count > limit) throw new InvalidDataException("Update metadata is too large.");
                    output.Write(buffer, 0, count);
                }
                return Encoding.UTF8.GetString(output.ToArray());
            }
        }

        private async Task DownloadAsync(Asset asset, string destination)
        {
            using (var http = Client())
            {
                var url = new Uri(asset.browser_download_url);
                for (var redirects = 0; redirects <= 5; redirects++)
                {
                    using (var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead))
                    {
                        if ((int)response.StatusCode >= 300 && (int)response.StatusCode < 400)
                        {
                            var location = response.Headers.Location;
                            if (location == null) throw new IOException("GitHub returned an invalid download redirect.");
                            url = location.IsAbsoluteUri ? location : new Uri(url, location);
                            if (url.Scheme != "https" || !String.IsNullOrEmpty(url.UserInfo) || !url.IsDefaultPort ||
                                !(url.Host == "github.com" || url.Host == "release-assets.githubusercontent.com" || url.Host == "objects.githubusercontent.com"))
                                throw new InvalidDataException("Update redirect left GitHub's download service.");
                            continue;
                        }
                        response.EnsureSuccessStatusCode();
                        if (response.Content.Headers.ContentLength.HasValue && response.Content.Headers.ContentLength.Value != asset.size)
                            throw new InvalidDataException("Update download size differs from its release metadata.");
                        using (var input = await response.Content.ReadAsStreamAsync())
                        using (var output = new FileStream(destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true))
                        using (var hash = SHA256.Create())
                        {
                            var buffer = new byte[81920]; long received = 0; int count; int previous = -1;
                            while ((count = await input.ReadAsync(buffer, 0, buffer.Length)) > 0)
                            {
                                received += count;
                                if (received > asset.size || received > PackageLimit) throw new InvalidDataException("Update exceeds its declared size.");
                                hash.TransformBlock(buffer, 0, count, buffer, 0); await output.WriteAsync(buffer, 0, count);
                                progress = (int)(received * 100 / asset.size);
                                if (progress != previous) { previous = progress; State(); }
                            }
                            hash.TransformFinalBlock(new byte[0], 0, 0);
                            if (received != asset.size || !String.Equals("sha256:" + BitConverter.ToString(hash.Hash).Replace("-", ""), asset.digest, StringComparison.OrdinalIgnoreCase))
                                throw new InvalidDataException("Update integrity check failed. The installed app has not changed.");
                        }
                        return;
                    }
                }
                throw new IOException("GitHub returned too many redirects.");
            }
        }

        private async Task InstallAsync(Release release)
        {
            var install = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            ClientUpdateInstaller.NoLinks(install);
            var cache = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Vumiro", "Updates", Guid.NewGuid().ToString("N"));
            ClientUpdateInstaller.NoLinks(Path.GetDirectoryName(cache)); Directory.CreateDirectory(cache);
            var archive = Path.Combine(cache, AssetName); var stage = Path.Combine(cache, "stage");
            var handedOff = false;
            try
            {
                message = "Downloading Vumiro " + release.Version.ToString(3) + "…"; State();
                await DownloadAsync(release.Package, archive);
                message = "Verifying update…"; State();
                await Task.Run(() => {
                    ClientUpdateInstaller.Extract(archive, stage);
                    foreach (var executable in new[] { "Vumiro", "Vumiro.Updater" })
                    {
                        var identity = AssemblyName.GetAssemblyName(Path.Combine(stage, executable + ".exe"));
                        if (identity.Name != executable || identity.Version != release.Version)
                            throw new InvalidDataException("Update executable identity does not match its release tag.");
                    }
                    // Run the installed, trusted helper from a disposable location so its installed copy can be replaced.
                    foreach (var file in new[] { "Vumiro.Updater.exe", "Vumiro.Updater.exe.config" })
                        File.Copy(Path.Combine(install, file), Path.Combine(cache, file));
                });
                var eventName = "Local\\VumiroUpdate-" + Guid.NewGuid().ToString("N");
                using (var ready = new EventWaitHandle(false, EventResetMode.ManualReset, eventName))
                {
                    var args = "--apply " + Quote(install) + " " + Quote(stage) + " " + Process.GetCurrentProcess().Id + " " + Quote(eventName);
                    using (var helper = Process.Start(new ProcessStartInfo(Path.Combine(cache, "Vumiro.Updater.exe"), args) { WorkingDirectory = cache, UseShellExecute = false, CreateNoWindow = true }))
                    {
                        if (!await Task.Run(() => ready.WaitOne(15000))) throw new IOException("The update helper did not become ready.");
                    }
                    handedOff = true; message = "Restarting to install update…"; State(); owner.Close();
                }
            }
            finally
            {
                if (!handedOff) try { Directory.Delete(cache, true); } catch { }
            }
        }

        private static string Quote(string value)
        {
            if (value.IndexOf('"') >= 0 || value.EndsWith("\\", StringComparison.Ordinal)) throw new IOException("Unsupported update path.");
            return "\"" + value + "\"";
        }
    }
}
