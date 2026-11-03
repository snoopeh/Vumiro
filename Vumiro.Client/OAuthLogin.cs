using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace Vumiro.Client
{
    // Provider credentials are entered in the system browser. Only a one-use
    // authorization code returns here; PKCE verification remains in the page.
    internal sealed class OAuthLogin : IDisposable
    {
        private const int Port = 43821;
        private readonly object gate = new object();
        private TcpListener listener;
        private CancellationTokenSource cancellation;
        // A browser may refuse to close a tab it did not open with script. The
        // page always keeps a useful return message, and never echoes the code.
        private const string ReturnScript = "history.replaceState(null,'',location.pathname);window.close();";

        internal static string CallbackBody(bool success)
        {
            return "<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\"><title>Vumiro sign-in</title>" +
                "<style>html{color-scheme:dark}body{font:16px/1.6 system-ui,sans-serif;max-width:32rem;margin:18vh auto;padding:2rem;background:#171416;color:#f7f4f4}h1{font-size:1.7rem}p{color:#c7bec1}</style>" +
                (success ? "<h1>Continue in Vumiro.</h1><p>Your browser sign-in has returned to the app. If this tab stays open, you can close it and return to Vumiro.</p><script>" + ReturnScript + "</script>" :
                    "<h1>Sign-in was not completed.</h1><p>Return to Vumiro to try again. You can close this tab.</p>") + "</html>";
        }

        internal static string CallbackContentSecurityPolicy
        {
            get
            {
                using (var hash = SHA256.Create())
                    return "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; style-src 'unsafe-inline'; script-src 'sha256-" +
                        Convert.ToBase64String(hash.ComputeHash(Encoding.UTF8.GetBytes(ReturnScript))) + "'";
            }
        }

        internal async Task<string> SignInAsync(string authUrl, string provider, string codeChallenge)
        {
            Uri origin;
            if (!Uri.TryCreate(authUrl, UriKind.Absolute, out origin) || origin.Scheme != "https" ||
                !Regex.IsMatch(origin.Host, @"\A[a-z0-9-]+\.supabase\.co\z") || !origin.IsDefaultPort ||
                origin.UserInfo.Length != 0 || origin.AbsolutePath != "/" || origin.Query.Length != 0 || origin.Fragment.Length != 0 ||
                !(provider == "google" || provider == "azure") || codeChallenge == null || !Regex.IsMatch(codeChallenge, @"\A[A-Za-z0-9_-]{43}\z"))
                throw new InvalidOperationException("Invalid account sign-in request.");

            TcpListener active;
            CancellationTokenSource pending;
            lock (gate)
            {
                if (listener != null) throw new InvalidOperationException("An account sign-in is already open in your browser.");
                active = new TcpListener(IPAddress.Loopback, Port);
                try { active.Start(4); }
                catch (SocketException) { throw new InvalidOperationException("The sign-in callback port is busy. Close other Vumiro sign-in windows and try again."); }
                listener = active;
                pending = cancellation = new CancellationTokenSource(TimeSpan.FromMinutes(5));
            }
            try
            {
                var entropy = new byte[24];
                using (var random = RandomNumberGenerator.Create()) random.GetBytes(entropy);
                var callbackPath = "/vumiro-auth/" + Convert.ToBase64String(entropy).TrimEnd('=').Replace('+', '-').Replace('/', '_') + "/";
                var callback = "http://127.0.0.1:" + Port + callbackPath;
                var scopes = provider == "azure" ? "email" : "openid email profile";
                var authorize = origin.GetLeftPart(UriPartial.Authority) + "/auth/v1/authorize?provider=" + provider + "&redirect_to=" + Uri.EscapeDataString(callback) +
                    "&code_challenge=" + codeChallenge + "&code_challenge_method=s256&scopes=" + Uri.EscapeDataString(scopes);
                using (pending.Token.Register(() => active.Stop()))
                {
                    Process.Start(new ProcessStartInfo(authorize) { UseShellExecute = true });
                    while (true)
                    {
                        pending.Token.ThrowIfCancellationRequested();
                        using (var client = await active.AcceptTcpClientAsync().ConfigureAwait(false))
                        {
                            string code = null, error = null;
                            var accepted = false;
                            try
                            {
                                using (var requestTimeout = CancellationTokenSource.CreateLinkedTokenSource(pending.Token))
                                {
                                    requestTimeout.CancelAfter(TimeSpan.FromSeconds(5));
                                    using (requestTimeout.Token.Register(() => client.Close()))
                                    {
                                        var header = await ReadHeaderAsync(client.GetStream(), requestTimeout.Token).ConfigureAwait(false);
                                        accepted = ParseCallback(header, callbackPath, out code, out error);
                                    }
                                }
                                var body = accepted ? CallbackBody(error == null) : "Invalid callback.";
                                var bytes = Encoding.UTF8.GetBytes("HTTP/1.1 " + (accepted ? "200 OK" : "400 Bad Request") + "\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: " + CallbackContentSecurityPolicy + "\r\nConnection: close\r\nContent-Length: " + Encoding.UTF8.GetByteCount(body) + "\r\n\r\n" + body);
                                await client.GetStream().WriteAsync(bytes, 0, bytes.Length, pending.Token).ConfigureAwait(false);
                            }
                            catch (IOException) { }
                            catch (ObjectDisposedException) { pending.Token.ThrowIfCancellationRequested(); }
                            catch (OperationCanceledException) { pending.Token.ThrowIfCancellationRequested(); }
                            // Disconnecting after a valid callback must not consume the code.
                            if (accepted)
                            {
                                if (error != null) throw new InvalidOperationException("The account provider cancelled or declined sign-in. Return to Vumiro and try again.");
                                return code;
                            }
                        }
                    }
                }
            }
            catch (Exception error) when (error is OperationCanceledException || error is ObjectDisposedException || error is SocketException)
            { throw new InvalidOperationException("Account sign-in expired or was cancelled. Try again."); }
            finally
            {
                lock (gate)
                {
                    active.Stop();
                    if (ReferenceEquals(listener, active)) { listener = null; cancellation = null; }
                    pending.Dispose();
                }
            }
        }

        private static async Task<string> ReadHeaderAsync(NetworkStream stream, CancellationToken token)
        {
            var bytes = new byte[8192]; var count = 0;
            while (count < bytes.Length)
            {
                var read = await stream.ReadAsync(bytes, count, bytes.Length - count, token).ConfigureAwait(false);
                if (read == 0) throw new IOException("Incomplete callback.");
                count += read;
                var value = Encoding.ASCII.GetString(bytes, 0, count);
                var end = value.IndexOf("\r\n\r\n", StringComparison.Ordinal);
                if (end >= 0) return value.Substring(0, end);
            }
            throw new IOException("Callback is too large.");
        }

        internal static bool ParseCallback(string header, string callbackPath, out string code, out string error)
        {
            code = null; error = null;
            if (header == null || header.Length > 8192) return false;
            var lines = header.Split(new[] { "\r\n" }, StringSplitOptions.None);
            var request = lines[0].Split(' ');
            if (request.Length != 3 || request[0] != "GET" || !(request[2] == "HTTP/1.1" || request[2] == "HTTP/1.0")) return false;
            var hosts = 0;
            for (var index = 1; index < lines.Length; index++)
            {
                var colon = lines[index].IndexOf(':');
                if (colon <= 0) return false;
                if (!lines[index].Substring(0, colon).Equals("Host", StringComparison.OrdinalIgnoreCase)) continue;
                if (++hosts != 1 || lines[index].Substring(colon + 1).Trim() != "127.0.0.1:" + Port) return false;
            }
            if (hosts != 1 || !request[1].StartsWith(callbackPath + "?", StringComparison.Ordinal)) return false;
            var query = request[1].Substring(callbackPath.Length + 1);
            if (query.IndexOf('#') >= 0) return false;
            var values = new Dictionary<string, string>(StringComparer.Ordinal);
            try
            {
                foreach (var pair in query.Split('&'))
                {
                    var split = pair.IndexOf('=');
                    var key = Uri.UnescapeDataString((split < 0 ? pair : pair.Substring(0, split)).Replace('+', ' '));
                    var value = split < 0 ? "" : Uri.UnescapeDataString(pair.Substring(split + 1).Replace('+', ' '));
                    if (values.ContainsKey(key)) return false;
                    values.Add(key, value);
                }
            }
            catch (UriFormatException) { return false; }
            values.TryGetValue("code", out code); values.TryGetValue("error", out error);
            if (code != null && error != null) return false;
            if (error != null) return error.Length > 0 && error.Length <= 2048;
            return code != null && Regex.IsMatch(code, @"\A[A-Za-z0-9._~-]{1,2048}\z");
        }

        internal void Cancel()
        {
            lock (gate) { if (cancellation != null) cancellation.Cancel(); }
        }

        public void Dispose() { Cancel(); }
    }
}
