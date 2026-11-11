using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace Vumiro.Client
{
    internal sealed class GamingServiceException : Exception
    {
        internal string Code { get; private set; }
        internal GamingServiceException(string code, string message) : base(message) { Code = code; }
    }

    // Only this native adapter reads ZeroTier's machine credential. Neither raw
    // service responses nor exception details cross the WebView bridge.
    internal sealed class GamingServices : IDisposable
    {
        private readonly HttpClient http;
        private readonly Func<string> readToken;
        private readonly Func<string, bool> fileExists;
        private readonly Action<ProcessStartInfo> start;

        internal GamingServices() : this(
            new HttpClientHandler { AllowAutoRedirect = false, UseProxy = false },
            () => File.ReadAllText(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "ZeroTier", "One", "authtoken.secret")),
            File.Exists, info => { using (var process = Process.Start(info)) { } }) { }

        internal GamingServices(HttpMessageHandler handler, Func<string> tokenReader, Func<string, bool> exists, Action<ProcessStartInfo> launcher)
        {
            http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(3), MaxResponseContentBufferSize = 1024 * 1024 };
            readToken = tokenReader;
            fileExists = exists;
            start = launcher;
        }

        internal static bool IsNetworkId(string value)
        {
            return value != null && Regex.IsMatch(value, "\\A[0-9a-fA-F]{16}\\z");
        }

        internal static bool IsHost(string value)
        {
            if (string.IsNullOrEmpty(value) || value.Length > 253 || value != value.Trim()) return false;
            // Never accept switches, ports, URLs, quotes, whitespace or shell
            // punctuation. IPv6 literals are allowed without brackets/scopes.
            IPAddress address;
            if (value.IndexOf(':') >= 0)
                return Regex.IsMatch(value, "\\A[0-9a-fA-F:.]+\\z") && IPAddress.TryParse(value, out address);
            if (Regex.IsMatch(value, "\\A[0-9.]+\\z"))
            {
                var octets = value.Split('.');
                if (octets.Length != 4) return false;
                foreach (var octet in octets)
                {
                    byte number;
                    if (octet.Length == 0 || octet.Length > 3 || !byte.TryParse(octet, out number)) return false;
                }
                return true;
            }
            foreach (var label in value.Split('.'))
                if (!Regex.IsMatch(label, "\\A[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\z")) return false;
            return true;
        }

        internal static string SetupUrl(string component)
        {
            switch (component)
            {
                case "zerotier": return "https://www.zerotier.com/download/";
                case "central": return "https://my.zerotier.com/";
                case "sunshine": return "https://github.com/LizardByte/Sunshine/releases/latest";
                case "moonlight": return "https://moonlight-stream.org/";
                case "driver": return "https://docs.nefarius.at/projects/ViGEm/End-of-Life/";
                default: return null;
            }
        }

        internal static string FindInstalledExecutable(string component)
        {
            return FindInstalledExecutable(component, File.Exists);
        }

        private static string FindInstalledExecutable(string component, Func<string, bool> exists)
        {
            string[] relatives;
            switch (component)
            {
                case "moonlight": relatives = new[] { "Moonlight Game Streaming\\Moonlight.exe", "Moonlight\\Moonlight.exe" }; break;
                case "sunshine": relatives = new[] { "Sunshine\\sunshine.exe" }; break;
                case "zerotier": relatives = new[] { "ZeroTier\\One\\zerotier-one_x64.exe", "ZeroTier\\One\\zerotier-one_x86.exe" }; break;
                default: return null;
            }
            var roots = new[] {
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs"),
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
            };
            foreach (var root in roots)
            {
                if (string.IsNullOrEmpty(root) || !Path.IsPathRooted(root)) continue;
                foreach (var relative in relatives)
                {
                    var path = Path.GetFullPath(Path.Combine(root, relative));
                    if (exists(path)) return path;
                }
            }
            return null;
        }

        internal async Task<Dictionary<string, object>> GetStatusAsync()
        {
            Dictionary<string, object> lan;
            try
            {
                var token = Token();
                var service = AsDictionary(await RequestAsync(HttpMethod.Get, "/status", token));
                object rawOnline;
                if (!service.TryGetValue("online", out rawOnline) || !(rawOnline is bool) ||
                    !Regex.IsMatch(Text(service, "address", 11), "\\A[0-9a-fA-F]{10}\\z")) throw InvalidResponse();
                var networks = AsArray(await RequestAsync(HttpMethod.Get, "/network", token));
                var peers = AsArray(await RequestAsync(HttpMethod.Get, "/peer", token));
                var online = Boolean(service, "online");
                var projectedNetworks = new List<object>();
                foreach (var value in networks)
                {
                    var item = AsDictionary(value);
                    projectedNetworks.Add(new Dictionary<string, object> {
                        { "id", Text(item, "id", 16) }, { "name", Text(item, "name", 120) },
                        { "status", Text(item, "status", 64) }, { "type", Text(item, "type", 32) },
                        { "assignedAddresses", Strings(item, "assignedAddresses") }
                    });
                }
                var projectedPeers = new List<object>();
                foreach (var value in peers)
                {
                    var item = AsDictionary(value);
                    var paths = new List<object>();
                    object rawPaths;
                    if (item.TryGetValue("paths", out rawPaths))
                        foreach (var pathValue in AsArray(rawPaths))
                        {
                            var path = AsDictionary(pathValue);
                            paths.Add(new Dictionary<string, object> { { "address", Text(path, "address", 128) }, { "active", Boolean(path, "active") } });
                        }
                    object latency;
                    item.TryGetValue("latency", out latency);
                    projectedPeers.Add(new Dictionary<string, object> {
                        { "address", Text(item, "address", 10) }, { "role", Text(item, "role", 32) },
                        { "latency", latency is int ? latency : -1 }, { "paths", paths.ToArray() }
                    });
                }
                lan = new Dictionary<string, object> {
                    { "provider", "zerotier" }, { "state", online ? "ready" : "offline" }, { "installed", true },
                    { "online", online }, { "nodeId", Text(service, "address", 10) }, { "version", Text(service, "version", 64) },
                    { "networks", projectedNetworks.ToArray() }, { "peers", projectedPeers.ToArray() },
                    { "message", online ? "ZeroTier is online. Private networks require approval in ZeroTier Central." : "ZeroTier is running but offline. Check your internet connection." }
                };
            }
            catch (GamingServiceException error)
            {
                var state = error.Code == "missing-zerotier" ? "not-installed" : error.Code == "permission-required" ? "permission-required" : error.Code == "service-unavailable" ? "unavailable" : "error";
                lan = new Dictionary<string, object> {
                    { "provider", "zerotier" }, { "state", state }, { "installed", state != "not-installed" }, { "online", false },
                    { "nodeId", "" }, { "version", "" }, { "networks", new object[0] }, { "peers", new object[0] }, { "message", error.Message }
                };
            }
            return new Dictionary<string, object> {
                { "platform", "windows" }, { "lan", lan },
                { "streaming", new Dictionary<string, object> {
                    { "provider", "sunshine-moonlight" },
                    { "host", Dependency("sunshine", "Open Sunshine to configure hosting and approve Moonlight's pairing PIN.") },
                    { "client", Dependency("moonlight", "Pair with the host, then stream its Desktop application in Moonlight.") }
                } }
            };
        }

        private Dictionary<string, object> Dependency(string component, string message)
        {
            var installed = FindInstalledExecutable(component, fileExists) != null;
            return new Dictionary<string, object> {
                { "installed", installed }, { "state", installed ? "installed" : "not-installed" },
                { "message", installed ? message : "Install " + (component == "sunshine" ? "Sunshine on the host PC" : "Moonlight on this PC") + " using the official setup link." }
            };
        }

        internal async Task<Dictionary<string, object>> ChangeNetworkAsync(string networkId, bool join)
        {
            if (!IsNetworkId(networkId)) throw new GamingServiceException("invalid-network", "Enter a 16-character hexadecimal ZeroTier network ID.");
            await RequestAsync(join ? HttpMethod.Post : HttpMethod.Delete, "/network/" + networkId.ToLowerInvariant(), Token());
            return await GetStatusAsync();
        }

        internal Dictionary<string, object> Launch(string action, string component, string host)
        {
            ProcessStartInfo info;
            string message;
            if (action == "open-setup")
            {
                var url = SetupUrl(component);
                if (url == null) throw new GamingServiceException("invalid-component", "Choose a supported gaming component.");
                info = new ProcessStartInfo(url) { UseShellExecute = true };
                message = "Opened the official setup page.";
            }
            else if (action == "open-host")
            {
                if (FindInstalledExecutable("sunshine", fileExists) == null) throw new GamingServiceException("missing-sunshine", "Install Sunshine on this PC before opening host settings.");
                component = "sunshine";
                info = new ProcessStartInfo("https://localhost:47990") { UseShellExecute = true };
                message = "Opened Sunshine's local settings. Its local certificate may need confirmation in your browser.";
            }
            else if (action == "pair" || action == "stream" || action == "list")
            {
                if (!IsHost(host)) throw new GamingServiceException("invalid-host", "Enter a host name or an IPv4/IPv6 address without a port or URL.");
                var executable = FindInstalledExecutable("moonlight", fileExists);
                if (executable == null) throw new GamingServiceException("missing-moonlight", "Install Moonlight on this PC first.");
                component = "moonlight";
                // Host is restricted above; the only application name is fixed.
                info = new ProcessStartInfo(executable, action + " \"" + host + "\"" + (action == "stream" ? " \"Desktop\"" : "")) {
                    UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(executable), CreateNoWindow = true
                };
                message = action == "pair" ? "Moonlight pairing launched. Enter its PIN in Sunshine on the host." : action == "stream" ? "Moonlight stream launched. The host must be paired and publish a Desktop application." : "Moonlight's host application list command launched.";
            }
            else throw new GamingServiceException("unknown-action", "Unsupported gaming action.");
            try { start(info); }
            catch (Win32Exception) { throw new GamingServiceException("launch-failed", "Windows could not open the gaming component. Check its installation."); }
            catch (InvalidOperationException) { throw new GamingServiceException("launch-failed", "Windows could not open the gaming component."); }
            return new Dictionary<string, object> { { "launched", true }, { "component", component }, { "action", action }, { "message", message } };
        }

        private string Token()
        {
            string value;
            try { value = readToken(); }
            catch (UnauthorizedAccessException) { throw new GamingServiceException("permission-required", "Windows denied access to ZeroTier's local authorization token. Check the ZeroTier installation permissions."); }
            catch (FileNotFoundException) { throw MissingToken(); }
            catch (DirectoryNotFoundException) { throw MissingToken(); }
            catch (IOException) { throw new GamingServiceException("service-unavailable", "ZeroTier's local token could not be read. Check that its service is installed and running."); }
            value = (value ?? "").Trim();
            if (!Regex.IsMatch(value, "\\A[a-zA-Z0-9]{1,256}\\z")) throw new GamingServiceException("permission-required", "ZeroTier's local authorization token is unavailable or invalid.");
            return value;
        }

        private GamingServiceException MissingToken()
        {
            return FindInstalledExecutable("zerotier", fileExists) == null
                ? new GamingServiceException("missing-zerotier", "ZeroTier was not found in the supported installation locations. Install it using the official setup link.")
                : new GamingServiceException("service-unavailable", "ZeroTier is installed but its service has not created the local authorization token. Start the ZeroTier service.");
        }

        private async Task<object> RequestAsync(HttpMethod method, string path, string token)
        {
            try
            {
                using (var request = new HttpRequestMessage(method, "http://127.0.0.1:9993" + path))
                {
                    request.Headers.Add("X-ZT1-AUTH", token);
                    if (method == HttpMethod.Post) request.Content = new StringContent("{}", Encoding.UTF8, "application/json");
                    using (var response = await http.SendAsync(request).ConfigureAwait(false))
                    {
                        if (response.StatusCode == HttpStatusCode.Forbidden || response.StatusCode == HttpStatusCode.Unauthorized)
                            throw new GamingServiceException("permission-required", "ZeroTier rejected its local authorization token. Check the service installation and permissions.");
                        if (!response.IsSuccessStatusCode) throw new GamingServiceException("service-error", "ZeroTier could not complete the request. Refresh its status and check the network ID.");
                        var body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
                        if (string.IsNullOrEmpty(body) && method == HttpMethod.Delete) return new Dictionary<string, object>();
                        try { return new JavaScriptSerializer { MaxJsonLength = 1024 * 1024, RecursionLimit = 32 }.DeserializeObject(body); }
                        catch (ArgumentException) { throw InvalidResponse(); }
                        catch (InvalidOperationException) { throw InvalidResponse(); }
                    }
                }
            }
            catch (HttpRequestException) { throw new GamingServiceException("service-unavailable", "The local ZeroTier service did not respond. Check that it is running on this PC."); }
            catch (TaskCanceledException) { throw new GamingServiceException("service-unavailable", "The local ZeroTier service timed out. Check that it is running on this PC."); }
            catch (ObjectDisposedException) { throw new GamingServiceException("service-unavailable", "The gaming service has stopped."); }
        }

        private static GamingServiceException InvalidResponse() { return new GamingServiceException("invalid-response", "The local ZeroTier service returned an unsupported response."); }
        private static Dictionary<string, object> AsDictionary(object value)
        {
            var result = value as Dictionary<string, object>;
            if (result == null) throw InvalidResponse();
            return result;
        }
        private static IEnumerable AsArray(object value)
        {
            if (!(value is object[]) && !(value is ArrayList)) throw InvalidResponse();
            return (IEnumerable)value;
        }
        private static string Text(Dictionary<string, object> value, string key, int limit)
        {
            object raw;
            var text = value.TryGetValue(key, out raw) ? raw as string : null;
            if (text == null) return "";
            return text.Length <= limit ? text : text.Substring(0, limit);
        }
        private static bool Boolean(Dictionary<string, object> value, string key)
        {
            object raw;
            return value.TryGetValue(key, out raw) && raw is bool && (bool)raw;
        }
        private static string[] Strings(Dictionary<string, object> value, string key)
        {
            object raw;
            if (!value.TryGetValue(key, out raw)) return new string[0];
            var result = new List<string>();
            foreach (var item in AsArray(raw)) if (item is string && ((string)item).Length <= 128) result.Add((string)item);
            return result.ToArray();
        }
        public void Dispose() { http.Dispose(); }
    }
}
